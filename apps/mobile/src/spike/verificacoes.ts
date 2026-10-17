// Verificações do spike que só fazem sentido no aparelho: SQLCipher no arquivo de verdade,
// exclusão real nos bytes do disco, Keystore, FLAG_SECURE e Tor. A conformidade das portas vem do
// @cifra/core e é a mesma que roda no Node.
import {
  apagarDeVerdade,
  BLOCO_DO_COFRE,
  buscarMensagens,
  chaveDoCofre,
  completarBloco,
  Correio,
  gerarIdentidade,
  guardarMensagem,
  prepararBanco,
  prepararCofre,
  segredoDoCofre,
  verificarArmazenamento,
  verificarCofre,
  verificarCripto,
  verificarProtocolo,
  verificarRelogio,
  verificarTransporte,
  type EventoDoCorreio,
  type ResultadoDaVerificacao,
} from '@cifra/core';
import { formatarId, idDaChave, LIMITE_DA_MINIATURA, TAMANHO_DO_PACOTE } from '@cifra/protocol';
import { File } from 'expo-file-system';
import {
  anexosNativos,
  avisosNativos,
  relogioNativo,
  tecladoNativo,
} from '../../modules/cifra-plataforma/index.ts';
import {
  abrirBanco,
  abrirCofre,
  apagarBanco,
  type BancoAberto,
} from '../adaptadores/armazenamento.ts';
import { cripto } from '../adaptadores/cripto.ts';
import { contem } from '../adaptadores/formato.ts';
import { relogio } from '../adaptadores/relogio.ts';
import { criarTransporte, PORTA_SOCKS_DO_ORBOT } from '../adaptadores/transporte.ts';

/** Resultado com uma medida opcional, em milissegundos. */
export interface Linha extends ResultadoDaVerificacao {
  readonly ms?: number;
}

const ascii = (texto: string) => Uint8Array.from(texto, (c) => c.charCodeAt(0));
const CABECALHO_SQLITE = ascii('SQLite format 3\0');
/** O OpenSSL do SQLCipher: o compilado do fonte oficial (plugin `openssl`), não o do Maven Central. */
const VERSAO_DO_OPENSSL = '3.5.9';

async function medir<T>(operacao: () => T | Promise<T>): Promise<{ valor: T; ms: number }> {
  const inicio = performance.now();
  const valor = await operacao();
  return { valor, ms: Math.round(performance.now() - inicio) };
}

async function passo(nome: string, verificacao: () => Promise<boolean | number>): Promise<Linha> {
  try {
    const resultado = await verificacao();
    if (typeof resultado === 'number') return { nome, ok: true, erro: '', ms: resultado };
    return { nome, ok: resultado, erro: resultado ? '' : 'resultado diferente do esperado' };
  } catch (erro) {
    return { nome, ok: false, erro: erro instanceof Error ? erro.message : 'erro' };
  }
}

function lerArquivo(caminho: string): Uint8Array {
  return new File(caminho.startsWith('file://') ? caminho : `file://${caminho}`).bytesSync();
}

function apagarArquivo(caminho: string) {
  const arquivo = new File(caminho.startsWith('file://') ? caminho : `file://${caminho}`);
  if (arquivo.exists) arquivo.delete();
}

/**
 * O bloco EXIF de teste (APP1), como o de uma câmera: fabricante, modelo, data, GPS e uma
 * miniatura. Montado aqui, em TIFF big-endian, para conferir que a limpeza não deixa nada dele.
 */
function exifDeTeste(miniatura: Uint8Array): Uint8Array {
  const textos = [MARCA_DE_TESTE, MODELO_DE_TESTE, DATA_DE_TESTE].map((t) => ascii(`${t}\0`));
  const dados = 122;
  const [marca = new Uint8Array(), modelo = new Uint8Array(), data = new Uint8Array()] = textos;
  const racionais = dados + marca.length + modelo.length + data.length;
  const inicioDaMiniatura = racionais + 24;
  const tiff = new Uint8Array(inicioDaMiniatura + miniatura.length);
  const v = new DataView(tiff.buffer);
  const entrada = (posicao: number, tag: number, tipo: number, quantos: number, valor: number) => {
    v.setUint16(posicao, tag);
    v.setUint16(posicao + 2, tipo);
    v.setUint32(posicao + 4, quantos);
    v.setUint32(posicao + 8, valor);
  };
  tiff.set(ascii('MM'), 0);
  v.setUint16(2, 42);
  v.setUint32(4, 8);
  // IFD0: fabricante, modelo, data e o ponteiro do GPS; depois, o IFD1 da miniatura.
  v.setUint16(8, 4);
  entrada(10, 0x010f, 2, marca.length, dados);
  entrada(22, 0x0110, 2, modelo.length, dados + marca.length);
  entrada(34, 0x0132, 2, data.length, dados + marca.length + modelo.length);
  entrada(46, 0x8825, 4, 1, 92);
  v.setUint32(58, 62);
  v.setUint16(62, 2);
  entrada(64, 0x0201, 4, 1, inicioDaMiniatura);
  entrada(76, 0x0202, 4, 1, miniatura.length);
  v.setUint32(88, 0);
  // IFD do GPS: latitude sul, 23° 33' 0".
  v.setUint16(92, 2);
  entrada(94, 0x0001, 2, 2, 0x53000000);
  entrada(106, 0x0002, 5, 3, racionais);
  v.setUint32(118, 0);
  tiff.set(marca, dados);
  tiff.set(modelo, dados + marca.length);
  tiff.set(data, dados + marca.length + modelo.length);
  [23, 1, 33, 1, 0, 1].forEach((n, i) => {
    v.setUint32(racionais + i * 4, n);
  });
  tiff.set(miniatura, inicioDaMiniatura);
  const app1 = new Uint8Array(4 + 6 + tiff.length);
  app1.set([0xff, 0xe1, ((app1.length - 2) >> 8) & 0xff, (app1.length - 2) & 0xff], 0);
  app1.set(ascii('Exif\0\0'), 4);
  app1.set(tiff, 10);
  return app1;
}

const MARCA_DE_TESTE = 'CifraMarcaDeTeste';
const MODELO_DE_TESTE = 'CifraModeloDeTeste';
const DATA_DE_TESTE = '2024:01:02 03:04:05';

/**
 * Limpeza da foto (RF-32): um JPEG com EXIF de câmera (GPS, modelo, data e miniatura) sai
 * recodificado, sem nada disso, com a miniatura que vai na mensagem dentro do limite.
 */
export async function verificarLimpezaDeFoto(): Promise<Linha[]> {
  const jpeg = await anexosNativos.jpegDeTeste();
  const exif = exifDeTeste(jpeg);
  const comExif = new Uint8Array(jpeg.length + exif.length);
  comExif.set(jpeg.subarray(0, 2), 0);
  comExif.set(exif, 2);
  comExif.set(jpeg.subarray(2), 2 + exif.length);
  const limpa = await anexosNativos.prepararImagemDosBytes(comExif);
  const sobrou = (texto: string) => contem(limpa.bytes, ascii(texto));
  return [
    await passo('foto.original-tem-exif', () =>
      Promise.resolve(contem(comExif, ascii(MODELO_DE_TESTE)) && contem(comExif, ascii('Exif'))),
    ),
    await passo('foto.limpa-e-jpeg', () =>
      Promise.resolve(
        limpa.formato === 'image/jpeg' && limpa.bytes[0] === 0xff && limpa.bytes[1] === 0xd8,
      ),
    ),
    await passo('foto.sem-exif', () => Promise.resolve(!sobrou('Exif'))),
    await passo('foto.sem-modelo-marca-e-data', () =>
      Promise.resolve(
        !sobrou(MODELO_DE_TESTE) && !sobrou(MARCA_DE_TESTE) && !sobrou(DATA_DE_TESTE),
      ),
    ),
    await passo('foto.sem-perfil-de-cor', () => Promise.resolve(!sobrou('ICC_PROFILE'))),
    await passo('foto.sem-a-miniatura-original', () =>
      Promise.resolve(!contem(limpa.bytes, jpeg.subarray(2, 66))),
    ),
    await passo('foto.miniatura-dentro-do-limite', () =>
      Promise.resolve(limpa.miniatura.length > 0 && limpa.miniatura.length <= LIMITE_DA_MINIATURA),
    ),
  ];
}

/** Marcador aleatório, só letras minúsculas: vira um único termo no FTS5. */
function marcador(): string {
  return Array.from(cripto.randombytes_buf(16), (b) => String.fromCharCode(97 + (b % 26))).join('');
}

export async function verificarLibsodium(): Promise<Linha[]> {
  const conformidade = await verificarCripto(cripto);
  const sal = cripto.randombytes_buf(cripto.crypto_pwhash_SALTBYTES);
  const senha = ascii('codigo secreto de teste');
  const argon = async (nome: string, ops: number, memoria: number) =>
    passo(nome, async () => {
      const { ms } = await medir(() =>
        cripto.crypto_pwhash(32, senha, sal, ops, memoria, cripto.crypto_pwhash_ALG_ARGON2ID13),
      );
      return ms;
    });
  return [
    ...conformidade,
    await argon(
      'argon2id.tempo-interactive',
      cripto.crypto_pwhash_OPSLIMIT_INTERACTIVE,
      cripto.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    ),
    await argon(
      'argon2id.tempo-moderate',
      cripto.crypto_pwhash_OPSLIMIT_MODERATE,
      cripto.crypto_pwhash_MEMLIMIT_MODERATE,
    ),
  ];
}

export async function verificarBancoCifrado(): Promise<Linha[]> {
  const nome = 'spike-cifrado.sqlite';
  const chave = cripto.randombytes_buf(32);
  const errada = cripto.randombytes_buf(32);
  const segredo = marcador();
  const linhas: Linha[] = [];

  const aberto = await abrirBanco(nome, chave);
  const caminho = aberto.caminho;
  try {
    linhas.push(
      await passo('sqlcipher.cipher-version', async () => {
        const [linha] = await aberto.banco.consultar('PRAGMA cipher_version');
        const versao = linha?.['cipher_version'];
        return typeof versao === 'string' && versao.length > 0;
      }),
      await passo('sqlcipher.openssl', async () => {
        const [provedor] = await aberto.banco.consultar('PRAGMA cipher_provider');
        const [versao] = await aberto.banco.consultar('PRAGMA cipher_provider_version');
        return (
          provedor?.['cipher_provider'] === 'openssl' &&
          String(versao?.['cipher_provider_version']).startsWith(`OpenSSL ${VERSAO_DO_OPENSSL} `)
        );
      }),
      // O adaptador desliga o log do SQLCipher no logcat ao abrir o banco.
      await passo('sqlcipher.sem-log', async () => {
        const [linha] = await aberto.banco.consultar('PRAGMA cipher_log_level');
        return linha?.['cipher_log_level'] === 'NONE';
      }),
      ...(await verificarArmazenamento(aberto.banco)),
    );
    await aberto.banco.executar('CREATE TABLE IF NOT EXISTS segredo (texto TEXT)');
    await aberto.banco.executar('INSERT INTO segredo (texto) VALUES (?)', [segredo]);
  } finally {
    aberto.fechar();
  }

  linhas.push(
    await passo('sqlcipher.arquivo-ilegivel', () => {
      const bytes = lerArquivo(caminho);
      return Promise.resolve(
        bytes.length > 0 &&
          !contem(bytes.subarray(0, 16), CABECALHO_SQLITE) &&
          !contem(bytes, ascii(segredo)),
      );
    }),
    await passo('sqlcipher.chave-errada-falha', async () => {
      try {
        (await abrirBanco(nome, errada)).fechar();
        return false;
      } catch {
        return true;
      }
    }),
    await passo('sqlcipher.sem-chave-falha', async () => {
      try {
        (await abrirBanco(nome, null)).fechar();
        return false;
      } catch {
        return true;
      }
    }),
    await passo('sqlcipher.chave-certa-reabre', async () => {
      const reaberto = await abrirBanco(nome, chave);
      try {
        const [linha] = await reaberto.banco.consultar('SELECT texto FROM segredo');
        return linha?.['texto'] === segredo;
      } finally {
        reaberto.fechar();
      }
    }),
  );
  apagarArquivo(caminho);
  cripto.memzero(chave);
  const custo = await custoDoBanco();
  linhas.push({
    nome: `sqlcipher.tempo-${custo.ligada ? 'com' : 'sem'}-memoria-segura`,
    ok: true,
    erro: '',
    ms: custo.ms,
  });
  return linhas;
}

/**
 * O trabalho de um dia de conversa (gravar 2000 mensagens com busca e ler a conversa 50 vezes), num
 * banco novo, para medir o `cipher_memory_security` (zera a memória que o SQLCipher solta). Vale
 * para o processo inteiro e, depois de ligado, não desliga: cada medida num processo novo. No
 * emulador e no build de desenvolvimento, ligado custou uns 30% a mais (de 866 a 1107 ms sem, de
 * 1210 a 1311 ms com), e ficou desligado (SPEC, riscos).
 */
async function custoDoBanco(): Promise<{ ligada: boolean; ms: number }> {
  const aberto = await abrirBanco('spike-memoria.sqlite', cripto.randombytes_buf(32));
  const caminho = aberto.caminho;
  try {
    const [valor] = await aberto.banco.consultar('PRAGMA cipher_memory_security');
    const ligada = String(valor?.['cipher_memory_security']) === '1';
    await prepararBanco(aberto.banco);
    await aberto.banco.executar('CREATE TABLE t (id INTEGER PRIMARY KEY, texto TEXT)');
    await aberto.banco.executar("CREATE VIRTUAL TABLE b USING fts5(texto, content='t')");
    const { ms } = await medir(async () => {
      await aberto.banco.transacao(async (t) => {
        for (let i = 0; i < 2000; i++) {
          const texto = `${marcador()} ${marcador()} ${marcador()} ${i}`;
          await t.executar('INSERT INTO t (id, texto) VALUES (?, ?)', [i, texto]);
          await t.executar('INSERT INTO b (rowid, texto) VALUES (?, ?)', [i, texto]);
        }
      });
      for (let i = 0; i < 50; i++) {
        await aberto.banco.consultar('SELECT texto FROM t ORDER BY id DESC LIMIT 200');
      }
    });
    return { ligada, ms };
  } finally {
    aberto.fechar();
    apagarArquivo(caminho);
  }
}

interface Rastro {
  readonly antes: boolean;
  readonly depois: boolean;
  readonly sobrouJournal: boolean;
}

/**
 * Grava um marcador na tabela e no índice FTS5, apaga a linha e diz se o marcador aparece nos
 * bytes do arquivo antes e depois. `seguro` liga o secure_delete e o secure-delete do FTS5.
 */
async function rastroDaExclusao(nome: string, seguro: boolean): Promise<Rastro> {
  const alvo = marcador();
  const aberto = await abrirBanco(nome, null);
  const caminho = aberto.caminho;
  let antes: boolean;
  try {
    const { banco } = aberto;
    if (!seguro) await banco.executar('PRAGMA secure_delete = OFF');
    await banco.executar('CREATE TABLE mensagem (id INTEGER PRIMARY KEY, texto TEXT)');
    await banco.executar(
      "CREATE VIRTUAL TABLE busca USING fts5(texto, tokenize = 'unicode61 remove_diacritics 2')",
    );
    if (seguro) await banco.executar("INSERT INTO busca(busca, rank) VALUES('secure-delete', 1)");
    // Volume para o marcador não ficar sozinho numa página.
    for (let i = 0; i < 50; i++) {
      const texto = i === 25 ? `mensagem ${alvo} apagavel` : `mensagem comum numero ${String(i)}`;
      await banco.executar('INSERT INTO mensagem (id, texto) VALUES (?, ?)', [i, texto]);
      await banco.executar('INSERT INTO busca (rowid, texto) VALUES (?, ?)', [i, texto]);
    }
    antes = contem(lerArquivo(caminho), ascii(alvo));
    await banco.transacao(async (t) => {
      await t.executar('DELETE FROM mensagem WHERE id = 25');
      await t.executar('DELETE FROM busca WHERE rowid = 25');
    });
  } finally {
    aberto.fechar();
  }
  const rastro = {
    antes,
    depois: contem(lerArquivo(caminho), ascii(alvo)),
    sobrouJournal:
      new File(`file://${caminho}-journal`).exists || new File(`file://${caminho}-wal`).exists,
  };
  apagarArquivo(caminho);
  return rastro;
}

/**
 * A mesma exclusão com o esquema do app: `prepararBanco`, 50 mensagens guardadas pelo núcleo e
 * `apagarDeVerdade`. O marcador é só de letras minúsculas: o texto da mensagem e o termo do índice
 * de busca são os mesmos bytes, e os dois precisam sumir.
 */
async function rastroDoEsquemaDoApp(nome: string): Promise<Rastro & { readonly busca: boolean }> {
  apagarBanco(nome);
  const alvo = marcador();
  const aberto = await abrirBanco(nome, null);
  const caminho = aberto.caminho;
  let antes: boolean;
  let busca: boolean;
  try {
    const { banco } = aberto;
    await prepararBanco(banco);
    const conversa = cripto.randombytes_buf(10);
    const ids: Uint8Array[] = [];
    for (let i = 0; i < 50; i++) {
      const id = cripto.randombytes_buf(16);
      ids.push(id);
      await guardarMensagem(banco, {
        id,
        conversa,
        deMim: true,
        texto: i === 25 ? `mensagem ${alvo} apagavel` : `mensagem comum numero ${String(i)}`,
        enviadaEm: i,
        recebidaEm: null,
        ttl: 0,
        expiraEm: null,
        status: 'enviada',
      });
    }
    antes = contem(lerArquivo(caminho), ascii(alvo));
    const apagar = ids.slice(25, 26);
    await banco.transacao((t) => apagarDeVerdade(t, { mensagens: apagar }));
    busca = (await buscarMensagens(banco, alvo)).length > 0;
  } finally {
    aberto.fechar();
  }
  const rastro = {
    antes,
    depois: contem(lerArquivo(caminho), ascii(alvo)),
    sobrouJournal:
      new File(`file://${caminho}-journal`).exists || new File(`file://${caminho}-wal`).exists,
    busca,
  };
  apagarArquivo(caminho);
  return rastro;
}

/**
 * Exclusão real (RNF-08) num banco em claro, para enxergar os bytes: com secure_delete e o
 * secure-delete do FTS5, o marcador some do arquivo. O controle, com os dois desligados, mostra
 * que sem eles o texto apagado continua no disco: é isso que a verificação distingue. Depois, o
 * mesmo com o esquema do app e o `apagarDeVerdade` do núcleo.
 */
export async function verificarExclusaoReal(): Promise<Linha[]> {
  const seguro = await rastroDaExclusao('spike-exclusao.sqlite', true);
  const controle = await rastroDaExclusao('spike-controle.sqlite', false);
  const app = await rastroDoEsquemaDoApp('spike-exclusao-app.sqlite');
  return [
    await passo('exclusao.marcador-gravado-antes', () => Promise.resolve(seguro.antes)),
    await passo('exclusao.marcador-some-do-arquivo', () => Promise.resolve(!seguro.depois)),
    await passo('exclusao.sem-journal-sobrando', () => Promise.resolve(!seguro.sobrouJournal)),
    await passo('exclusao.controle-sem-secure-delete-deixa-rastro', () =>
      Promise.resolve(controle.antes && controle.depois),
    ),
    await passo('exclusao.app-marcador-gravado-antes', () => Promise.resolve(app.antes)),
    await passo('exclusao.app-marcador-some-do-arquivo', () => Promise.resolve(!app.depois)),
    await passo('exclusao.app-busca-nao-acha', () => Promise.resolve(!app.busca)),
    await passo('exclusao.app-sem-journal-sobrando', () => Promise.resolve(!app.sobrouJournal)),
  ];
}

/** Ida e volta de um pacote de 4096 bytes até o eco .onion, pelo Orbot (RNF-04, RNF-21). */
export async function verificarTor(endereco: string): Promise<Linha[]> {
  const transporte = criarTransporte({ portaSocks: PORTA_SOCKS_DO_ORBOT });
  const pacote = cripto.randombytes_buf(TAMANHO_DO_PACOTE);
  const linhas: Linha[] = [];

  const { valor: conexao, ms: msConexao } = await medir(() => transporte.conectar(endereco, 'eco'));
  linhas.push({ nome: 'tor.conectar', ok: true, erro: '', ms: msConexao });
  try {
    linhas.push(
      await passo('tor.eco-4096-bytes', async () => {
        const inicio = performance.now();
        const resposta = await new Promise<Uint8Array>((resolver, rejeitar) => {
          const limite = setTimeout(() => {
            rejeitar(new Error('sem resposta em 60 s'));
          }, 60_000);
          const cancelar = conexao.aoReceber((dados) => {
            clearTimeout(limite);
            cancelar();
            resolver(dados);
          });
          conexao.enviar(pacote).catch(rejeitar);
        });
        const ms = Math.round(performance.now() - inicio);
        if (resposta.length !== TAMANHO_DO_PACOTE || !resposta.every((b, i) => b === pacote[i])) {
          throw new Error('eco diferente do enviado');
        }
        return ms;
      }),
    );
  } finally {
    await conexao.fechar();
  }
  return linhas;
}

/** Sem Orbot no ar, a conexão tem de falhar com `tor-indisponivel`, sem tentar o caminho direto. */
export async function verificarTorIndisponivel(endereco: string): Promise<Linha[]> {
  const transporte = criarTransporte({ portaSocks: PORTA_SOCKS_DO_ORBOT });
  return [
    await passo('tor.indisponivel-nao-conecta', async () => {
      try {
        await (await transporte.conectar(endereco, 'eco')).fechar();
        return false;
      } catch (erro) {
        return erro instanceof Error && erro.message === 'tor-indisponivel';
      }
    }),
    await passo('tor.sem-tor-recusa-texto-claro', async () => {
      try {
        await criarTransporte({ portaSocks: null }).conectar(endereco, 'eco');
        return false;
      } catch (erro) {
        return erro instanceof Error && erro.message === 'texto-claro-fora-do-tor';
      }
    }),
  ];
}

/** Os vetores do X3DH e do Double Ratchet na libsodium deste aparelho: bytes iguais aos do Node. */
export function verificarProtocoloNoAparelho(): Promise<Linha[]> {
  return verificarProtocolo(cripto);
}

/**
 * Relógio e transporte contra o relay, pelo Orbot (RF-44). Depois, o tempo de abrir uma conexão
 * num circuito novo, no mesmo de novo e em outro: com a mesma credencial o Tor reaproveita o
 * circuito, com outra monta um novo, e a diferença de tempo mostra o isolamento.
 */
export async function verificarRelay(endereco: string): Promise<Linha[]> {
  const transporte = criarTransporte({ portaSocks: PORTA_SOCKS_DO_ORBOT });
  const linhas: Linha[] = [
    ...(await verificarRelogio(relogio)),
    ...(await verificarTransporte(transporte, endereco, cripto, relogio)),
  ];
  for (const [nome, circuito] of [
    ['circuito.novo', 'medida-a'],
    ['circuito.o-mesmo-de-novo', 'medida-a'],
    ['circuito.outro', 'medida-b'],
  ] as const) {
    linhas.push(
      await passo(nome, async () => {
        const { valor: conexao, ms } = await medir(() => transporte.conectar(endereco, circuito));
        await conexao.fechar();
        return ms;
      }),
    );
  }
  return linhas;
}

/** Espera o evento do correio, até o prazo. Registra antes de quem chama disparar a ação. */
function esperarEvento(
  correio: Correio,
  filtro: (evento: EventoDoCorreio) => boolean,
): Promise<void> {
  return new Promise((pronto, falhou) => {
    const limite = setTimeout(() => {
      cancelar();
      falhou(new Error('sem resposta em 120 s'));
    }, 120_000);
    const cancelar = correio.aoMudar((evento) => {
      if (!filtro(evento)) return;
      clearTimeout(limite);
      cancelar();
      pronto();
    });
  });
}

/**
 * Duas identidades descartáveis, cada uma com banco, caixa e circuitos próprios, conversam pelo
 * relay e pelo Orbot (RF-13). Mede do envio até a outra receber (RNF-21, meta de 5 s). Os bancos
 * são apagados no fim; os cartões e as caixas somem do relay pelo prazo.
 */
export async function verificarConversa(endereco: string): Promise<Linha[]> {
  const nomes = ['verificacao-a.sqlite', 'verificacao-b.sqlite'];
  const abertos: BancoAberto[] = [];
  const correios: Correio[] = [];
  try {
    const pessoas: { readonly correio: Correio; readonly id: string }[] = [];
    for (const nome of nomes) {
      apagarBanco(nome);
      const aberto = await abrirBanco(nome, cripto.randombytes_buf(32));
      abertos.push(aberto);
      await prepararBanco(aberto.banco);
      const { identidade } = gerarIdentidade(cripto, 'portugues');
      const correio = new Correio({
        cripto,
        banco: aberto.banco,
        transporte: criarTransporte({ portaSocks: PORTA_SOCKS_DO_ORBOT }),
        relogio,
        identidade,
        sementeDaCaixa: cripto.randombytes_buf(32),
        relay: endereco,
      });
      correios.push(correio);
      pessoas.push({ correio, id: formatarId(idDaChave(cripto, identidade.assinatura.publicKey)) });
    }
    const [a, b] = pessoas;
    if (!a || !b) throw new Error('sem identidades');
    const linhas: Linha[] = [];

    linhas.push(
      await passo('conversa.publicar-e-abrir-as-caixas', async () => {
        const abertas = pessoas.map((p) =>
          esperarEvento(p.correio, (e) => e.tipo === 'caixa' && e.aberta),
        );
        const { ms } = await medir(async () => {
          for (const p of pessoas) p.correio.iniciar();
          await Promise.all(abertas);
        });
        return ms;
      }),
      await passo('conversa.buscar-cartao-e-abrir-sessao', async () => {
        const { ms } = await medir(() => a.correio.iniciarConversa(b.id));
        return ms;
      }),
    );
    for (const [nome, de, para] of [
      ['conversa.entrega-primeira', a, b],
      ['conversa.entrega-resposta', b, a],
      ['conversa.entrega-seguinte', a, b],
    ] as const) {
      linhas.push(
        await passo(nome, async () => {
          // A primeira chega como pedido de conversa: só sai resposta depois de aceitar (RF-07).
          if (de === b && nome === 'conversa.entrega-resposta') {
            await b.correio.iniciarConversa(a.id);
          }
          const chegou = esperarEvento(para.correio, (e) => e.tipo === 'mensagem');
          const { ms } = await medir(async () => {
            await de.correio.enviarTexto(para.id, nome);
            await chegou;
          });
          return ms;
        }),
      );
    }
    return linhas;
  } finally {
    await Promise.all(correios.map((correio) => correio.parar()));
    for (const aberto of abertos) aberto.fechar();
    for (const nome of nomes) apagarBanco(nome);
  }
}

/**
 * Ajustes e privacidade: o relógio nativo passa na conformidade do núcleo (ele é o que anda com o
 * app fora da frente), o tempo do aparelho só anda para frente, e a pergunta do teclado e das
 * notificações responde. O teclado sem aprender se confere com um campo em foco e o
 * `dumpsys input_method` (docs/DESENVOLVIMENTO.md).
 */
export async function verificarPrivacidade(): Promise<Linha[]> {
  return [
    await passo('privacidade.relogio-nativo', async () =>
      (await verificarRelogio(relogio)).every(({ ok }) => ok),
    ),
    await passo('privacidade.decorrido-anda', async () => {
      const antes = relogioNativo.decorrido();
      await new Promise<void>((pronto) => setTimeout(pronto, 50));
      return relogioNativo.decorrido() - antes >= 40;
    }),
    await passo('privacidade.teclado-responde', async () =>
      ['sem-campo', 'sem-aprender', 'aprende'].includes(await tecladoNativo.campoEmFoco()),
    ),
    await passo('privacidade.notificacoes-respondem', async () => {
      await avisosNativos.permitidas();
      return true;
    }),
  ];
}

/**
 * O cofre das conversas ocultas no aparelho (RNF-11): a conformidade do adaptador num arquivo só
 * dela (a chave certa reabre, a errada falha igual à sorteada, as pragmas, o bloco exato com a
 * reserva de página do SQLCipher e a troca de chave); o cofre vazio de verdade, com 16 MiB e o
 * diário com 0 byte; e quanto o Argon2id leva a cada código tentado.
 */
export async function verificarOcultas(): Promise<Linha[]> {
  const nome = 'spike-cofre.sqlite';
  let caminho = '';
  const apagar = () => {
    apagarBanco(nome);
    if (caminho) {
      const diario = new File(`file://${caminho}-journal`);
      if (diario.exists) diario.delete();
    }
  };
  const arquivo = {
    abrir: async (chave: Uint8Array) => {
      const aberto = await abrirCofre(nome, chave);
      caminho = aberto.caminho;
      return aberto;
    },
    apagar: () => Promise.resolve().then(apagar),
  };
  const linhas: Linha[] = [...(await verificarCofre(cripto, arquivo))];
  linhas.push(
    await passo('cofre.vazio-de-16-mib', async () => {
      const aberto = await arquivo.abrir(cripto.randombytes_buf(32));
      try {
        await prepararCofre(aberto.banco);
        await completarBloco(aberto.banco);
      } finally {
        aberto.fechar();
      }
      const tamanho = new File(`file://${caminho}`).size;
      const diario = new File(`file://${caminho}-journal`);
      const semDiario = !diario.exists || diario.size === 0;
      apagar();
      return tamanho === BLOCO_DO_COFRE && semDiario;
    }),
    await passo('cofre.argon2id-por-codigo', async () => {
      const segredo = segredoDoCofre(cripto, cripto.randombytes_buf(32));
      const { valor, ms } = await medir(() => chaveDoCofre(cripto, 'um código de teste', segredo));
      cripto.memzero(valor);
      cripto.memzero(segredo);
      return ms;
    }),
  );
  return linhas;
}
