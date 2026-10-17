import { connect, createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sondar } from '../scripts/sonda.ts';
import { ONION, subirRelay, type RelayDeTeste } from './ajuda.ts';

let relay: RelayDeTeste;

beforeEach(async () => {
  relay = await subirRelay();
  // A sonda data o cartão com o relógio de verdade; o do relay de teste começa num dia fixo, e o
  // cartão passaria das 24 h de tolerância.
  relay.relogio.agora = Date.now();
});

afterEach(async () => {
  await relay.fechar();
});

interface ProxyDeTeste {
  readonly porta: number;
  /** Os destinos pedidos ao proxy, como chegaram: host e porta. */
  readonly pedidos: string[];
  fechar(): Promise<void>;
}

/**
 * Proxy SOCKS5 de teste, como o do Tor: recebe o nome do host sem resolver e liga a conexão ao
 * relay de teste, seja qual for o host pedido.
 */
async function subirProxy(destino: number): Promise<ProxyDeTeste> {
  const pedidos: string[] = [];
  const sockets = new Set<Socket>();
  const servidor: Server = createServer((cliente) => {
    sockets.add(cliente);
    let recebido = Buffer.alloc(0);
    let etapa = 0;
    const aoReceber = (pedaco: Buffer) => {
      recebido = Buffer.concat([recebido, pedaco]);
      if (etapa === 0 && recebido.length >= 3) {
        recebido = recebido.subarray(3);
        etapa = 1;
        cliente.write(Buffer.from([5, 0]));
      }
      if (etapa === 1 && recebido.length >= 5 && recebido.length >= 7 + (recebido[4] ?? 0)) {
        const tamanho = recebido[4] ?? 0;
        const host = recebido.subarray(5, 5 + tamanho).toString('ascii');
        pedidos.push(
          `${String(recebido[3])} ${host}:${String(recebido.readUInt16BE(5 + tamanho))}`,
        );
        cliente.off('data', aoReceber);
        const relaySocket = connect(destino, '127.0.0.1', () => {
          cliente.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
          cliente.pipe(relaySocket).pipe(cliente);
        });
        sockets.add(relaySocket);
      }
    };
    cliente.on('data', aoReceber);
    cliente.on('error', () => undefined);
  });
  await new Promise<void>((pronto) => servidor.listen(0, '127.0.0.1', pronto));
  return {
    porta: (servidor.address() as AddressInfo).port,
    pedidos,
    fechar: () =>
      new Promise((pronto) => {
        for (const socket of sockets) socket.destroy();
        servidor.close(() => {
          pronto();
        });
      }),
  };
}

describe('sonda do relay', () => {
  it('confere o relay de ponta a ponta, como dois apps', async () => {
    const passos = await sondar(relay.endereco);
    expect(passos.map(({ passo }) => passo)).toEqual([
      'conectar',
      'criar caixa',
      'publicar cartão',
      'buscar cartão',
      'depositar',
      'abrir e receber',
      'confirmar',
      'apagar tudo',
    ]);
    // Nada da sonda fica no relay.
    for (const tabela of ['pacotes', 'cartoes', 'prekeys', 'caixas']) {
      expect(relay.consultar(`SELECT count(*) AS n FROM ${tabela}`), tabela).toEqual([{ n: 0 }]);
    }
  });

  it('chega a um .onion pelo SOCKS5, com o nome resolvido pelo proxy e não pelo DNS local', async () => {
    const { port } = relay.relay.servidor.address() as AddressInfo;
    const proxy = await subirProxy(port);
    try {
      await sondar(ONION, { socks: { host: '127.0.0.1', porta: proxy.porta } });
      // Tipo 3: nome de host. As duas conexões da sonda pedem o .onion na porta 80.
      const host = ONION.slice('ws://'.length);
      expect(proxy.pedidos).toEqual([`3 ${host}:80`, `3 ${host}:80`]);
    } finally {
      await proxy.fechar();
    }
  });
});
