// Sonda do relay: confere um relay de ponta a ponta, como dois apps fariam, com chaves descartáveis.
//
//   node apps/relay/scripts/sonda.ts ws://127.0.0.1:8080
//   node apps/relay/scripts/sonda.ts ws://<endereço>.onion --socks 127.0.0.1:9050
//
// B cria a caixa e publica o cartão; A busca o cartão, confere e deposita um pacote; B abre a caixa
// com o desafio, recebe o mesmo pacote e confirma. No fim, apaga o cartão e a caixa, como o pânico
// do app: nada da sonda fica no relay. Escreve o tempo de cada passo ou o passo que falhou: nenhuma
// chave, ID ou endereço.
import { connect as conectarTls } from 'node:tls';
import { pathToFileURL } from 'node:url';
import {
  BYTES_DA_MARCA,
  cartaoAutentico,
  criarCartao,
  criarPublicacao,
  enderecoDeRelayValido,
  idDaChave,
  idDoCartao,
  mensagemDaAbertura,
  mensagemDoApagarCaixa,
  mensagemDoApagarTudo,
  TAMANHO_DO_PACOTE,
  type Assinar,
} from '@cifra/protocol';
import sodium from 'libsodium-wrappers-sumo';
import { ClienteDoRelay, type Aviso, type Resposta } from './cliente.ts';
import { conectarPorSocks, type Destino } from './socks.ts';

await sodium.ready;

export interface PassoDaSonda {
  readonly passo: string;
  readonly ms: number;
}

export interface OpcoesDaSonda {
  /** Proxy SOCKS5, como o do Tor. */
  readonly socks?: Destino;
}

async function conectar(endereco: string, { socks }: OpcoesDaSonda): Promise<ClienteDoRelay> {
  if (!socks) return ClienteDoRelay.conectar(endereco);
  const url = new URL(endereco);
  const seguro = url.protocol === 'wss:';
  const destino = { host: url.hostname, porta: Number(url.port || (seguro ? 443 : 80)) };
  const tunel = await conectarPorSocks(socks, destino);
  const socket = seguro ? conectarTls({ socket: tunel, servername: destino.host }) : tunel;
  return ClienteDoRelay.conectar(endereco, { socket });
}

function par(): { publicKey: Uint8Array; assinar: Assinar } {
  const { publicKey, privateKey } = sodium.crypto_sign_keypair();
  return { publicKey, assinar: (mensagem) => sodium.crypto_sign_detached(mensagem, privateKey) };
}

/** Falha da sonda. Só a mensagem dela é escrita: erro de rede traz endereço. */
export class FalhaDaSonda extends Error {}

function exigir(condicao: boolean, passo: string): asserts condicao {
  if (!condicao) throw new FalhaDaSonda(`falhou em: ${passo}`);
}

function ok(resposta: Resposta): boolean {
  return resposta.tipo === 'resposta' && resposta.codigo === 'ok';
}

/** Roda a sonda. Lança no primeiro passo que não sair como um app espera. */
export async function sondar(
  endereco: string,
  opcoes: OpcoesDaSonda = {},
): Promise<PassoDaSonda[]> {
  const passos: PassoDaSonda[] = [];
  const medir = async <T>(passo: string, operacao: () => Promise<T>): Promise<T> => {
    const inicio = performance.now();
    const resultado = await operacao();
    passos.push({ passo, ms: Math.round(performance.now() - inicio) });
    return resultado;
  };

  const b = await medir('conectar', () => conectar(endereco, opcoes));
  const a = await conectar(endereco, opcoes);
  try {
    const identidade = par();
    const caixa = par();
    exigir(
      ok(
        await medir('criar caixa', () => b.pedir({ tipo: 'criar-caixa', caixa: caixa.publicKey })),
      ),
      'criar caixa',
    );

    const cartao = criarCartao(
      {
        chaveDeIdentidade: identidade.publicKey,
        prekeyAssinada: { numero: 1, chave: sodium.randombytes_buf(32) },
        caixaPrincipal: caixa.publicKey,
        data: Date.now(),
        relays: [enderecoDeRelayValido(endereco) ? endereco : 'wss://sonda.invalid'],
      },
      identidade.assinar,
    );
    const prekeys = [2, 3].map((numero) => ({ numero, chave: sodium.randombytes_buf(32) }));
    const publicacao = criarPublicacao('substituir', cartao, prekeys, identidade.assinar);
    const publicado = await medir('publicar cartão', () =>
      b.pedir({ tipo: 'publicar-cartao', publicacao }),
    );
    exigir(publicado.tipo === 'cartao-publicado' && publicado.prekeys === 2, 'publicar cartão');

    const id = idDaChave(sodium, identidade.publicKey);
    const encontrado = await medir('buscar cartão', () => a.pedir({ tipo: 'buscar-cartao', id }));
    exigir(
      encontrado.tipo === 'cartao-encontrado' &&
        cartaoAutentico(sodium, encontrado.cartao) &&
        idDoCartao(sodium, encontrado.cartao).every((byte, i) => byte === id[i]) &&
        encontrado.prekey?.numero === 2,
      'buscar cartão',
    );

    const pacote = sodium.randombytes_buf(TAMANHO_DO_PACOTE);
    // A marca de aviso é opaca para o relay: aqui, bytes quaisquer do tamanho certo.
    const marca = sodium.randombytes_buf(BYTES_DA_MARCA);
    const destino = encontrado.cartao.caixaPrincipal;
    exigir(
      ok(
        await medir('depositar', () =>
          a.pedir({ tipo: 'depositar', caixa: destino, pacote, marca }),
        ),
      ),
      'depositar',
    );

    const assinatura = caixa.assinar(mensagemDaAbertura(b.desafio, caixa.publicKey));
    const [aberta, entregue, emDia] = await medir(
      'abrir e receber',
      async () =>
        [
          await b.pedir({ tipo: 'abrir-caixa', caixa: caixa.publicKey, assinatura }),
          await b.proximoAviso(),
          await b.proximoAviso(),
        ] as [Resposta, Aviso, Aviso],
    );
    exigir(
      ok(aberta) &&
        entregue.tipo === 'pacote' &&
        entregue.pacote.every((byte, i) => byte === pacote[i]) &&
        emDia.tipo === 'em-dia',
      'abrir e receber',
    );

    exigir(
      ok(await medir('confirmar', () => b.pedir({ tipo: 'confirmar', ids: [entregue.id] }))),
      'confirmar',
    );

    // Pela conexão sem caixa: a que estava com a caixa aberta cai quando ela some.
    const apagar = identidade.assinar(mensagemDoApagarTudo(a.desafio, identidade.publicKey));
    const daCaixa = caixa.assinar(mensagemDoApagarCaixa(a.desafio, caixa.publicKey));
    exigir(
      ok(
        await medir('apagar tudo', () =>
          a.pedir({
            tipo: 'apagar-tudo',
            chave: identidade.publicKey,
            assinatura: apagar,
            caixa: caixa.publicKey,
            assinaturaDaCaixa: daCaixa,
          }),
        ),
      ),
      'apagar tudo',
    );
    return passos;
  } finally {
    await Promise.all([a.fechar(), b.fechar()]);
  }
}

function lerArgumentos(argumentos: readonly string[]): { endereco: string; opcoes: OpcoesDaSonda } {
  const [endereco, opcao, valor] = argumentos;
  if (!endereco || !/^wss?:\/\//.test(endereco)) {
    throw new FalhaDaSonda('uso: sonda.ts <ws://endereço> [--socks <host>:<porta>]');
  }
  if (opcao === undefined) return { endereco, opcoes: {} };
  const [, host, porta] = /^([^:]+):(\d+)$/.exec(valor ?? '') ?? [];
  if (opcao !== '--socks' || !host || !porta) throw new FalhaDaSonda('uso: --socks <host>:<porta>');
  return { endereco, opcoes: { socks: { host, porta: Number(porta) } } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { endereco, opcoes } = lerArgumentos(process.argv.slice(2));
    const passos = await sondar(endereco, opcoes);
    for (const { passo, ms } of passos) process.stdout.write(`${passo}: ${ms} ms\n`);
    process.stdout.write('relay ok\n');
  } catch (erro) {
    process.stderr.write(`${erro instanceof FalhaDaSonda ? erro.message : 'não conectou'}\n`);
    process.exitCode = 1;
  }
}
