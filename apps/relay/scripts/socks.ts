// Cliente SOCKS5 mínimo (RFC 1928): só CONNECT, sem autenticação, com o nome do host resolvido pelo
// proxy. É como a sonda chega a um .onion pelo Tor: o nome vai para o Tor sem passar pelo DNS local.
import { connect, type Socket } from 'node:net';

export interface Destino {
  readonly host: string;
  readonly porta: number;
}

const VERSAO = 0x05;
const SEM_AUTENTICACAO = 0x00;
const CONECTAR = 0x01;
const NOME_DE_HOST = 0x03;
const TAMANHO_DO_ENDERECO: Readonly<Record<number, number>> = { 0x01: 4, 0x04: 16 };

/** Abre uma conexão TCP até `destino` passando pelo proxy SOCKS5 em `proxy`. */
export function conectarPorSocks(proxy: Destino, destino: Destino): Promise<Socket> {
  const host = Buffer.from(destino.host, 'ascii');
  if (host.length < 1 || host.length > 255) throw new RangeError('host fora do SOCKS5');

  return new Promise((pronto, falhou) => {
    const socket = connect(proxy.porta, proxy.host);
    let recebido = Buffer.alloc(0);
    let etapa: 'metodo' | 'conexao' = 'metodo';

    const falhar = (erro: Error) => {
      socket.destroy();
      falhou(erro);
    };

    const aoReceber = (pedaco: Buffer) => {
      recebido = Buffer.concat([recebido, pedaco]);
      if (etapa === 'metodo') {
        if (recebido.length < 2) return;
        if (recebido[0] !== VERSAO || recebido[1] !== SEM_AUTENTICACAO) {
          falhar(new Error('o proxy recusou SOCKS5 sem autenticação'));
          return;
        }
        recebido = recebido.subarray(2);
        etapa = 'conexao';
        const porta = Buffer.alloc(2);
        porta.writeUInt16BE(destino.porta);
        socket.write(
          Buffer.concat([
            Buffer.from([VERSAO, CONECTAR, 0x00, NOME_DE_HOST, host.length]),
            host,
            porta,
          ]),
        );
      }
      // Resposta: versão, código, reservado, tipo do endereço, endereço e porta.
      if (recebido.length < 5) return;
      if (recebido[1] !== 0x00) {
        falhar(new Error(`o proxy não conectou (código ${String(recebido[1])})`));
        return;
      }
      const tipo = recebido[3] ?? 0;
      const endereco = tipo === NOME_DE_HOST ? 1 + (recebido[4] ?? 0) : TAMANHO_DO_ENDERECO[tipo];
      if (endereco === undefined) {
        falhar(new Error('resposta SOCKS5 fora do formato'));
        return;
      }
      const tamanho = 4 + endereco + 2;
      if (recebido.length < tamanho) return;
      // No WebSocket, o servidor só fala depois do pedido do cliente: byte a mais é erro.
      if (recebido.length > tamanho) {
        falhar(new Error('o proxy mandou dados antes da hora'));
        return;
      }
      socket.off('data', aoReceber);
      socket.off('error', falhar);
      pronto(socket);
    };

    socket.once('connect', () => {
      socket.write(Buffer.from([VERSAO, 1, SEM_AUTENTICACAO]));
    });
    socket.on('data', aoReceber);
    socket.on('error', falhar);
  });
}
