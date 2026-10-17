// Contato de teste: uma segunda identidade rodando no PC, para conferir no emulador as conversas,
// os pedidos, o número de segurança e a troca de aparelho. Usa o núcleo de verdade, com o SQLite e
// a libsodium do Node, e fala direto com o relay local (sem Tor deste lado). Só para o
// desenvolvimento: não entra no app.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//     --import ./apps/mobile/spike/contato/ganchos.ts apps/mobile/spike/contato/contato.ts \
//     <pasta> <comando> [argumentos]
//
// Comandos:
//   nova                    cria a identidade na pasta e mostra o ID e as 12 palavras
//   restaurar "<palavras>"  restaura a identidade na pasta (outro aparelho, RF-05)
//   ouvir [segundos]        fica conectado e mostra o que chega (padrão: 120 s)
//   escrever <ID> [--ttl <s>] <texto>
//                           adiciona o ID, se preciso, e envia, com o timer só desta mensagem se
//                           houver --ttl; espera o relay aceitar
//   aceitar <ID>            aceita o pedido de conversa do ID
//   numero <ID>             mostra o número de segurança com o ID
//   timer <ID> <s> [anteriores]  muda o timer da conversa (0 desliga), só para as novas ou também
//                           para as anteriores
//   apagar <ID> <texto>     apaga pra todos a última mensagem da conversa com esse texto
//   ver <ID>                mostra a conversa: mensagens, com o timer, e notas de sistema
//   anexo <ID> <arquivo> [--tipo imagem|video|documento] [--legenda <texto>]
//                           envia o arquivo como está (sem limpar: a limpeza é do app), cifrado
//                           como qualquer anexo; o vídeo vai em 1280x720, sem capa
//   salvar <ID> <pasta>     baixa os anexos da conversa e grava decifrados na pasta (para o exiftool)
//   responder <ID> <original> <texto>
//                           responde à última mensagem da conversa com o texto <original>
//   ler <ID>                marca a conversa como lida e manda a confirmação de leitura (RF-17)
//   digitar <ID> [segundos] manda "digitando" e, depois do tempo (padrão: 8 s), "parou" (RF-18)
//   prints <ID> sim|nao     bloqueia ou libera os prints da conversa, para os dois (RF-58)
//   apagar-conversa <ID>    apaga a conversa nos dois celulares (RF-59)
//   ocultar <ID>            oculta a conversa deste lado: cria a caixa nova, avisa o app
//                           e muda a conversa para o cofre da pasta (cofre.sqlite, sem cifra)
//   reexibir <ID>           traz a conversa oculta de volta
//
// Com o cofre na pasta, todo comando abre as ocultas também: o que chega nelas aparece com
// "(oculta)", e escrever, ver e os outros comandos de uma conversa oculta vão pelo cofre.
//
// Ambiente: CIFRA_RELAY, o relay local (padrão ws://127.0.0.1:8080); CIFRA_ONION, o endereço que vai
// no cartão, o mesmo .onion que o app usa.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import {
  Agenda,
  Cofre,
  Temporarias,
  Correio,
  criarExclusivo,
  gerarIdentidade,
  guardarIdentidade,
  carregarIdentidade,
  prepararBanco,
  prepararCofre,
  restaurarIdentidade,
  type Identidade,
} from '../../../../packages/core/src/index.ts';
import { relogioDoNode } from '../../../../packages/core/test/adaptadores/relogio.ts';
import { cripto } from '../../../../packages/core/test/adaptadores/sodium-node.ts';
import { abrirBancoNoArquivo } from '../../../../packages/core/test/adaptadores/sqlite-node.ts';
import { transporteNode } from '../../../../packages/core/test/adaptadores/transporte-node.ts';

const [pasta = '', comando = '', ...argumentos] = process.argv.slice(2);
const RELAY = process.env['CIFRA_RELAY'] ?? 'ws://127.0.0.1:8080';
const ONION = process.env['CIFRA_ONION'] ?? '';

function sair(mensagem: string): never {
  process.stderr.write(`${mensagem}\n`);
  process.exit(2);
}

if (pasta === '' || comando === '') sair('uso: contato.ts <pasta> <comando> [argumentos]');
if (!ONION.endsWith('.onion')) sair('defina CIFRA_ONION com o endereço .onion do relay do app');
mkdirSync(pasta, { recursive: true });

const banco = abrirBancoNoArquivo(join(pasta, 'contato.sqlite'));
await prepararBanco(banco.banco);

async function identidadeDaPasta(): Promise<Identidade> {
  if (comando === 'nova' || comando === 'restaurar') {
    if (await carregarIdentidade(banco.banco, cripto)) sair('a pasta já tem uma identidade');
    let identidade: Identidade;
    if (comando === 'nova') {
      const nova = gerarIdentidade(cripto, 'portugues');
      process.stdout.write(`palavras: ${nova.palavras.join(' ')}\n`);
      identidade = nova.identidade;
    } else {
      const restauracao = restaurarIdentidade(cripto, argumentos.join(' '));
      if (!restauracao.ok) sair(`palavras: ${restauracao.problema.tipo}`);
      identidade = restauracao.identidade;
    }
    await guardarIdentidade(banco.banco, identidade);
    writeFileSync(join(pasta, 'caixa'), cripto.randombytes_buf(32));
    return identidade;
  }
  const guardada = await carregarIdentidade(banco.banco, cripto);
  if (!guardada || !existsSync(join(pasta, 'caixa'))) sair('a pasta não tem identidade');
  return guardada;
}

const identidade = await identidadeDaPasta();
process.stdout.write(`id: ${identidade.id}\n`);
const exclusivo = criarExclusivo();
const agenda = new Agenda({
  cripto,
  banco: banco.banco,
  relogio: relogioDoNode,
  identidade,
  exclusivo,
});
const correio = new Correio({
  cripto,
  banco: banco.banco,
  transporte: transporteNode(() => RELAY),
  relogio: relogioDoNode,
  identidade,
  sementeDaCaixa: new Uint8Array(readFileSync(join(pasta, 'caixa'))),
  relay: ONION,
  exclusivo,
});

const espera = (ms: number) => new Promise((pronto) => setTimeout(pronto, ms));
let aberta = false;
correio.aoMudar((evento) => {
  if (evento.tipo === 'caixa') aberta = evento.aberta;
  if (evento.tipo === 'substituido')
    process.stdout.write('substituido: a identidade está em outro aparelho\n');
  if (evento.tipo === 'mensagem') {
    void agenda.mensagens(evento.conversa).then((mensagens) => {
      const texto = mensagens.find((m) => m.id.every((b, i) => b === evento.id[i]))?.texto;
      process.stdout.write(
        `${evento.pedido ? 'pedido' : 'mensagem'} de ${evento.conversa}: ${String(texto)}\n`,
      );
    });
  }
  if (evento.tipo === 'status') process.stdout.write(`status: ${evento.status}\n`);
  if (evento.tipo === 'prints') {
    process.stdout.write(
      `prints: ${evento.conversa} ${evento.bloqueados ? 'bloqueados' : 'liberados'}\n`,
    );
  }
  if (evento.tipo === 'conversaApagada') {
    process.stdout.write(`conversa apagada: ${evento.conversa}\n`);
  }
  if (evento.tipo === 'digitando') {
    process.stdout.write(
      `digitando: ${evento.conversa} ${evento.digitando ? 'começou' : 'parou'}\n`,
    );
  }
});
const temporarias = new Temporarias({ banco: banco.banco, relogio: relogioDoNode, exclusivo });
temporarias.iniciar();
correio.iniciar();
// O ouvinte muda `aberta` entre uma espera e outra.
const conectado = () => aberta;
for (let i = 0; i < 600 && !conectado(); i++) await espera(100);
if (!conectado()) sair('não conectou ao relay');

const [id, ...resto] = argumentos;

// O cofre das conversas ocultas deste contato, sem cifra, na pasta.
const arquivoDoCofre = join(pasta, 'cofre.sqlite');
let cofre: Cofre | null = null;
if (existsSync(arquivoDoCofre) || comando === 'ocultar') {
  const aberto = abrirBancoNoArquivo(arquivoDoCofre, 'TRUNCATE');
  await prepararCofre(aberto.banco);
  cofre = new Cofre({
    cripto,
    relogio: relogioDoNode,
    identidade,
    banco: aberto.banco,
    transporte: transporteNode(() => RELAY),
    relay: ONION,
    principal: { banco: banco.banco, exclusivo, correio },
  });
  cofre.correio?.aoMudar((evento) => {
    if (evento.tipo === 'mensagem') {
      process.stdout.write(`mensagem (oculta) de ${evento.conversa}\n`);
    }
  });
  await cofre.iniciar();
}
// Uma conversa oculta usa a agenda e o correio do cofre.
const oculta = cofre !== null && id !== undefined && (await cofre.conhece(id));
const agendaDaConversa = oculta && cofre ? cofre.agenda : agenda;
const correioDaConversa = (oculta ? cofre?.correio : null) ?? correio;
switch (comando) {
  case 'ocultar':
  case 'reexibir': {
    if (!id || !cofre) sair(`uso: ${comando} <ID>`);
    await (comando === 'ocultar' ? cofre.ocultar(id) : cofre.reexibir(id));
    process.stdout.write(`${comando === 'ocultar' ? 'oculta' : 'reexibida'}: ${id}\n`);
    break;
  }
  case 'nova':
  case 'restaurar':
    await espera(2000);
    break;
  case 'ouvir':
    await espera(Number(id ?? 120) * 1000);
    break;
  case 'escrever': {
    if (!id) sair('falta o ID');
    await correioDaConversa.iniciarConversa(id);
    const comTtl = resto[0] === '--ttl';
    const ttl = comTtl ? Number(resto[1]) : undefined;
    const texto = (comTtl ? resto.slice(2) : resto).join(' ');
    const mensagem = await correioDaConversa.enviarTexto(id, texto, ttl);
    for (let i = 0; i < 300; i++) {
      const enviada = (await agendaDaConversa.mensagens(id)).find((m) =>
        m.id.every((b, j) => b === mensagem[j]),
      );
      if (enviada?.status !== 'pendente') break;
      await espera(100);
    }
    await espera(1000);
    break;
  }
  case 'aceitar':
    if (!id) sair('falta o ID');
    await agendaDaConversa.aceitar(id);
    break;
  case 'timer':
    if (!id) sair('falta o ID');
    await correioDaConversa.iniciarConversa(id);
    await correioDaConversa.mudarTimer(id, Number(resto[0] ?? 0), resto[1] === 'anteriores');
    await espera(3000);
    break;
  case 'apagar': {
    if (!id) sair('falta o ID');
    const alvo = (await agendaDaConversa.mensagens(id))
      .filter((m) => m.texto === resto.join(' '))
      .at(-1);
    if (!alvo) sair('mensagem não encontrada');
    await correioDaConversa.apagarParaTodos(id, [alvo.id]);
    await espera(3000);
    break;
  }
  case 'ver':
    if (!id) sair('falta o ID');
    process.stdout.write(`timer: ${String((await agendaDaConversa.conversa(id))?.timer ?? 0)} s\n`);
    process.stdout.write(
      `prints: ${(await agendaDaConversa.conversa(id))?.printsBloqueados ? 'bloqueados' : 'liberados'}\n`,
    );
    for (const item of await agendaDaConversa.itens(id)) {
      if (item.tipo === 'nota') {
        process.stdout.write(`nota: ${JSON.stringify(item.nota)}\n`);
        continue;
      }
      const { mensagem } = item;
      const falta =
        mensagem.expiraEm === null
          ? ''
          : ` (some em ${String(Math.round((mensagem.expiraEm - Date.now()) / 1000))} s)`;
      const anexo = item.anexo ? ` [${item.anexo.arquivo} ${item.anexo.estado}]` : '';
      const citada = item.citada ? ` (responde: ${item.citada.mensagem?.texto ?? 'apagada'})` : '';
      process.stdout.write(
        `${mensagem.deMim ? 'eu' : 'contato'}: ${mensagem.texto}${anexo}${citada}${falta}\n`,
      );
    }
    break;
  case 'anexo': {
    const [arquivo = '', ...opcoes] = resto;
    if (!id || !arquivo) sair('falta o ID ou o arquivo');
    const opcao = (nome: string) => {
      const i = opcoes.indexOf(nome);
      return i < 0
        ? undefined
        : opcoes
            .slice(i + 1)
            .join(' ')
            .split(' --')[0];
    };
    const bytes = new Uint8Array(readFileSync(arquivo));
    const ext = extname(arquivo).toLowerCase();
    const tipo = (opcao('--tipo') ??
      (['.jpg', '.jpeg', '.png'].includes(ext)
        ? 'imagem'
        : ext === '.mp4'
          ? 'video'
          : 'documento')) as 'imagem' | 'video' | 'documento';
    const [largura, altura] =
      tipo === 'imagem' ? medidasDaImagem(bytes) : tipo === 'video' ? [1280, 720] : [0, 0];
    const formato =
      tipo === 'imagem'
        ? ext === '.png'
          ? 'image/png'
          : 'image/jpeg'
        : tipo === 'video'
          ? 'video/mp4'
          : ext === '.pdf'
            ? 'application/pdf'
            : 'application/octet-stream';
    await correioDaConversa.iniciarConversa(id);
    const mensagem = await correioDaConversa.enviarAnexo(
      id,
      { arquivo: tipo, formato, bytes, largura, altura },
      { legenda: opcao('--legenda') ?? '' },
    );
    for (let i = 0; i < 600; i++) {
      const enviada = (await agendaDaConversa.mensagens(id)).find((m) =>
        m.id.every((b, j) => b === mensagem[j]),
      );
      if (enviada?.status !== 'pendente') break;
      await espera(100);
    }
    process.stdout.write(`anexo enviado: ${basename(arquivo)}\n`);
    await espera(1000);
    break;
  }
  case 'salvar': {
    const destino = resto[0];
    if (!id || !destino) sair('falta o ID ou a pasta');
    mkdirSync(destino, { recursive: true });
    await agendaDaConversa.mudarBaixarSozinho(true);
    correioDaConversa.conferirAnexos();
    let n = 0;
    for (let i = 0; i < 600; i++) {
      const itens = (await agendaDaConversa.itens(id)).filter(
        (item) => item.tipo === 'mensagem' && item.anexo !== null,
      );
      const esperando = itens.some(
        (item) =>
          item.tipo === 'mensagem' && ['baixar', 'manual'].includes(item.anexo?.estado ?? ''),
      );
      if (!esperando) break;
      await espera(500);
    }
    for (const item of await agendaDaConversa.itens(id)) {
      if (item.tipo !== 'mensagem' || !item.anexo) continue;
      const aberto = await agendaDaConversa.abrirAnexo(id, item.mensagem.id);
      if (!aberto) continue;
      n++;
      const extensao =
        aberto.formato === 'image/png'
          ? 'png'
          : aberto.arquivo === 'imagem'
            ? 'jpg'
            : aberto.arquivo === 'video'
              ? 'mp4'
              : 'bin';
      writeFileSync(join(destino, `anexo-${String(n)}.${extensao}`), aberto.bytes);
      if (aberto.capa) writeFileSync(join(destino, `anexo-${String(n)}-capa.jpg`), aberto.capa);
    }
    process.stdout.write(`salvos: ${String(n)}\n`);
    break;
  }
  case 'responder': {
    const [original = '', ...palavras] = resto;
    if (!id) sair('falta o ID');
    const alvo = (await agendaDaConversa.mensagens(id)).filter((m) => m.texto === original).at(-1);
    if (!alvo) sair('mensagem não encontrada');
    await correioDaConversa.iniciarConversa(id);
    await correioDaConversa.enviarTexto(id, palavras.join(' '), undefined, alvo.id);
    await espera(3000);
    break;
  }
  case 'ler':
    if (!id) sair('falta o ID');
    await correioDaConversa.marcarLidas(id, true);
    await espera(5000);
    break;
  case 'digitar':
    if (!id) sair('falta o ID');
    await correioDaConversa.sinalizarDigitacao(id, true);
    await espera(Number(resto[0] ?? '8') * 1000);
    await correioDaConversa.sinalizarDigitacao(id, false);
    await espera(2000);
    break;
  case 'prints':
    if (!id) sair('falta o ID');
    await correioDaConversa.mudarPrints(id, resto[0] === 'sim');
    await espera(3000);
    break;
  case 'apagar-conversa':
    if (!id) sair('falta o ID');
    await correioDaConversa.apagarConversaParaOsDois(id);
    await espera(3000);
    break;
  case 'numero':
    if (!id) sair('falta o ID');
    process.stdout.write(`numero: ${(await agendaDaConversa.numeroDeSeguranca(id)).join(' ')}\n`);
    break;
  default:
    sair(`comando desconhecido: ${comando}`);
}
await cofre?.fechar();
await correio.parar();
await temporarias.parar();
banco.fechar();

/** Largura e altura de um JPEG (marcador SOF) ou de um PNG (IHDR). */
function medidasDaImagem(bytes: Uint8Array): [number, number] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] === 0x89) return [v.getUint32(16), v.getUint32(20)];
  for (let i = 2; i + 9 < bytes.length;) {
    const marcador = bytes[i + 1] ?? 0;
    if (marcador >= 0xc0 && marcador <= 0xc3) return [v.getUint16(i + 7), v.getUint16(i + 5)];
    i += 2 + v.getUint16(i + 2);
  }
  return [1, 1];
}
