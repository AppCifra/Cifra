import { connect, type Socket } from 'node:net';
import { codificarPedido, FECHAMENTOS } from '@cifra/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClienteDoRelay } from '../scripts/cliente.ts';
import type { Banco } from '../src/banco.ts';
import {
  abrir,
  codigo,
  falhando,
  marcaDeTeste,
  novaIdentidade,
  novoPar,
  pacoteAleatorio,
  publicacaoDe,
  sodium,
  subirRelay,
  TAXAS_LIVRES,
  type ParDeTeste,
  type RelayDeTeste,
} from './ajuda.ts';

// O relay não cai por causa de uma conexão (RNF-13): um erro do banco no meio de um pedido (disco
// cheio, arquivo danificado) derruba só a conexão daquele pedido, e uma conexão que não lê o que o
// relay manda é derrubada antes de a saída dela encher a memória.

let relay: RelayDeTeste;
let falhar: keyof Banco | null = null;

async function subir() {
  falhar = null;
  relay = await subirRelay(TAXAS_LIVRES, (banco) => falhando(banco, () => falhar));
}

afterEach(async () => {
  falhar = null;
  await relay.fechar();
});

function depositar(cliente: ClienteDoRelay, caixa: ParDeTeste) {
  return cliente.pedir({
    tipo: 'depositar',
    caixa: caixa.publicKey,
    pacote: pacoteAleatorio(),
    marca: marcaDeTeste(),
  });
}

const urlDoAnexo = () =>
  relay.endereco.replace('ws://', 'http://') +
  '/anexos/' +
  Buffer.from(sodium.randombytes_buf(32)).toString('hex');

describe('erro do banco num pedido (RNF-13)', () => {
  it('fecha só a conexão que pediu; as outras continuam', async () => {
    await subir();
    const caixa = novoPar();
    const dono = await relay.conectar();
    expect(codigo(await dono.pedir({ tipo: 'criar-caixa', caixa: caixa.publicKey }))).toBe('ok');
    expect(codigo(await abrir(dono, caixa))).toBe('ok');
    expect((await dono.proximoAviso()).tipo).toBe('em-dia');

    const quem = await relay.conectar();
    falhar = 'depositar';
    await expect(depositar(quem, caixa)).rejects.toThrow('conexão fechada');
    expect(await quem.fechamento).toBe(FECHAMENTOS.erroInterno);

    falhar = null;
    const outro = await relay.conectar();
    expect(codigo(await depositar(outro, caixa))).toBe('ok');
    expect((await dono.proximoAviso()).tipo).toBe('pacote');
  });

  it('nos anexos, responde 500 e o relay continua', async () => {
    await subir();
    falhar = 'comecarAnexo';
    const envio = await fetch(urlDoAnexo(), {
      method: 'PUT',
      body: sodium.randombytes_buf(4096),
    });
    expect(envio.status).toBe(500);
    falhar = 'anexo';
    expect((await fetch(urlDoAnexo())).status).toBe(500);
    falhar = 'apagarAnexo';
    expect((await fetch(urlDoAnexo(), { method: 'DELETE' })).status).toBe(500);

    falhar = null;
    expect((await fetch(urlDoAnexo())).status).toBe(404);
    const cliente = await relay.conectar();
    expect(codigo(await cliente.pedir({ tipo: 'criar-caixa', caixa: novoPar().publicKey }))).toBe(
      'ok',
    );
  });

  it('a limpeza que falha não derruba o relay; a próxima tenta de novo', async () => {
    await subir();
    falhar = 'apagarVencidos';
    expect(() => {
      relay.relay.limpar();
    }).not.toThrow();
    falhar = null;
    expect(() => {
      relay.relay.limpar();
    }).not.toThrow();
  });
});

/** Um quadro WebSocket binário do cliente, mascarado como o protocolo exige. */
function quadro(dados: Uint8Array): Buffer {
  const mascara = sodium.randombytes_buf(4);
  const cabeca =
    dados.length < 126
      ? Buffer.from([0x82, 0x80 | dados.length])
      : Buffer.from([0x82, 0x80 | 126, dados.length >> 8, dados.length & 0xff]);
  const corpo = Buffer.from(dados.map((byte, i) => byte ^ (mascara[i % 4] ?? 0)));
  return Buffer.concat([cabeca, Buffer.from(mascara), corpo]);
}

/**
 * Uma conexão WebSocket feita à mão, que manda pedidos e nunca lê nada do socket: o que o relay
 * manda fica parado do lado dele.
 */
async function conexaoQueNaoLe(endereco: string): Promise<Socket> {
  const { hostname, port } = new URL(endereco.replace('ws://', 'http://'));
  const socket = connect(Number(port), hostname);
  await new Promise<void>((pronto) => socket.once('connect', pronto));
  socket.pause();
  const chave = Buffer.from(sodium.randombytes_buf(16)).toString('base64');
  socket.write(
    `GET / HTTP/1.1\r\nHost: ${hostname}:${port}\r\nUpgrade: websocket\r\n` +
      `Connection: Upgrade\r\nSec-WebSocket-Key: ${chave}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  );
  return socket;
}

describe('uma conexão que não lê (RNF-13)', () => {
  it('a saída dela tem teto: acima dele, o relay derruba a conexão', async () => {
    const livre = { rajada: 1_000_000, porMinuto: 1_000_000 };
    relay = await subirRelay({
      taxas: {
        depositar: livre,
        buscarCartao: livre,
        publicarCartao: livre,
        criarCaixa: livre,
        apagarTudo: livre,
        mensagens: livre,
      },
      saida: 64 * 1024,
    });
    const bob = novaIdentidade();
    const publicador = await relay.conectar();
    const publicacao = publicacaoDe(bob);
    expect((await publicador.pedir({ tipo: 'publicar-cartao', publicacao })).tipo).toBe(
      'cartao-publicado',
    );

    // Milhares de buscas, cada resposta com o cartão inteiro, sem ler nenhuma. O kernel guarda alguns
    // MiB da saída antes de ela esperar no relay (no Linux, uns 4 MiB), e quanto o relay já produziu
    // depende da CPU: em vez de esperar um tempo fixo, a conexão segue pedindo até cair.
    const socket = await conexaoQueNaoLe(relay.endereco);
    socket.on('error', () => undefined);
    let numero = 0;
    const buscar = (quantas: number) => {
      for (let i = 0; i < quantas; i++) {
        socket.write(
          quadro(codificarPedido({ tipo: 'buscar-cartao', numero: ++numero, id: bob.id })),
        );
      }
    };
    buscar(20_000);
    const limite = Date.now() + 15_000;
    while (Date.now() < limite) {
      await new Promise((pronto) => setTimeout(pronto, 50));
      if (socket.destroyed) break;
      buscar(1000);
    }
    expect(socket.destroyed).toBe(true);

    const outro = await relay.conectar();
    expect(codigo(await outro.pedir({ tipo: 'buscar-cartao', id: bob.id }))).toBe(
      'cartao-encontrado',
    );
  }, 30_000);
});
