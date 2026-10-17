// Eco WebSocket do spike: devolve cada mensagem binária como chegou. Serve só para provar o caminho
// app → Orbot → Tor → .onion; o relay de verdade fica em apps/relay. Só módulos do Node, sem
// dependência. Aceita apenas quadros binários inteiros, mascarados e de até 64 KB; qualquer outra
// coisa fecha a conexão. Não escreve log.
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const LIMITE = 64 * 1024;

const BINARIO = 0x2;
const FECHAR = 0x8;
const PING = 0x9;
const PONG = 0xa;

/** Quadro do servidor: sem máscara, sempre final. */
function quadro(opcode: number, dados: Buffer): Buffer {
  const tamanho = dados.length;
  const cabecalho =
    tamanho < 126
      ? Buffer.from([0x80 | opcode, tamanho])
      : Buffer.from([0x80 | opcode, 126, tamanho >> 8, tamanho & 0xff]);
  return Buffer.concat([cabecalho, dados]);
}

const fechamento = (codigo: number) => quadro(FECHAR, Buffer.from([codigo >> 8, codigo & 0xff]));

/**
 * Lê um quadro do cliente. Devolve `null` se ainda faltam bytes, `{ erro }` se o quadro não é
 * aceito, ou `{ opcode, dados, usados }`.
 */
export type Quadro = { erro: number } | { opcode: number; dados: Buffer; usados: number };

export function lerQuadro(buffer: Buffer): Quadro | null {
  if (buffer.length < 2) return null;
  const [b0 = 0, b1 = 0] = buffer;
  const final = (b0 & 0x80) !== 0;
  const opcode = b0 & 0x0f;
  const mascarado = (b1 & 0x80) !== 0;
  let tamanho = b1 & 0x7f;
  let posicao = 2;
  if (!final || !mascarado) return { erro: 1002 };
  if (tamanho === 126) {
    if (buffer.length < 4) return null;
    tamanho = buffer.readUInt16BE(2);
    posicao = 4;
  } else if (tamanho === 127) {
    return { erro: 1009 };
  }
  if (tamanho > LIMITE) return { erro: 1009 };
  if (buffer.length < posicao + 4 + tamanho) return null;
  const mascara = buffer.subarray(posicao, posicao + 4);
  const dados = Buffer.from(buffer.subarray(posicao + 4, posicao + 4 + tamanho));
  for (let i = 0; i < dados.length; i++) dados[i] = (dados[i] ?? 0) ^ (mascara[i % 4] ?? 0);
  return { opcode, dados, usados: posicao + 4 + tamanho };
}

export function criarServidorDeEco(): Server {
  const servidor = createServer((_pedido, resposta) => {
    resposta.writeHead(426).end();
  });

  servidor.on('upgrade', (pedido, socket) => {
    const chave = pedido.headers['sec-websocket-key'];
    if (pedido.headers.upgrade?.toLowerCase() !== 'websocket' || typeof chave !== 'string') {
      socket.destroy();
      return;
    }
    const aceite = createHash('sha1')
      .update(chave + GUID)
      .digest('base64');
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${aceite}`,
        '',
        '',
      ].join('\r\n'),
    );

    let pendente: Buffer = Buffer.alloc(0);
    socket.on('error', () => socket.destroy());
    socket.on('data', (pedaco: Buffer) => {
      pendente = Buffer.concat([pendente, pedaco]);
      for (;;) {
        const lido = lerQuadro(pendente);
        if (lido === null) return;
        if ('erro' in lido) {
          socket.end(fechamento(lido.erro));
          return;
        }
        pendente = pendente.subarray(lido.usados);
        if (lido.opcode === BINARIO) {
          socket.write(quadro(BINARIO, lido.dados));
        } else if (lido.opcode === PING) {
          socket.write(quadro(PONG, lido.dados));
        } else if (lido.opcode === PONG) {
          // nada a fazer
        } else if (lido.opcode === FECHAR) {
          socket.end(fechamento(1000));
          return;
        } else {
          // Texto e continuação: o protocolo do Cifra só tem mensagens binárias inteiras.
          socket.end(fechamento(1003));
          return;
        }
      }
    });
  });

  return servidor;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  criarServidorDeEco().listen(Number(process.env['PORTA'] ?? 8080), '127.0.0.1');
}
