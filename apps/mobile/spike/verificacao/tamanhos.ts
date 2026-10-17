// Tamanho dos pacotes (RNF-04), numa captura feita no relay, entre o Tor e o relay (porta 8080 do
// namespace de rede do compose; docs/VERIFICACAO.md). Lê cada pedido e cada mensagem do relay com o
// mesmo `@cifra/protocol` do app e do relay e confere: todo pacote de mensagem, depositado ou
// entregue, tem 4096 bytes; todo anexo que sobe tem um tamanho da faixa (Padmé, RF-36).
//
//   node apps/mobile/spike/verificacao/tamanhos.ts <captura.pcap> [porta]
//
// Escreve a contagem por tipo e cada problema; sai com 1 se houver problema ou se nada foi lido.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  lerMensagemDoRelay,
  lerPedido,
  TAMANHO_DO_PACOTE,
  tamanhoDeAnexoValido,
} from '@cifra/protocol';
import { conexoesTcp, lerPcap, quadrosWebSocket, type Conexao } from './pcap.ts';

export interface Relatorio {
  readonly contagem: Record<string, number>;
  readonly problemas: string[];
}

const BINARIO = 2;

function contar(contagem: Record<string, number>, tipo: string): void {
  contagem[tipo] = (contagem[tipo] ?? 0) + 1;
}

function conferirWebSocket(conexao: Conexao, relatorio: Relatorio): void {
  for (const quadro of quadrosWebSocket(conexao.enviado)) {
    if (quadro.opcode !== BINARIO) continue;
    const leitura = lerPedido(quadro.carga);
    if (!leitura.ok) {
      relatorio.problemas.push(`pedido ilegível de ${quadro.carga.length} bytes`);
      continue;
    }
    contar(relatorio.contagem, `pedido ${leitura.pedido.tipo}`);
    if (leitura.pedido.tipo === 'depositar' && leitura.pedido.pacote.length !== TAMANHO_DO_PACOTE) {
      relatorio.problemas.push(`depósito com ${leitura.pedido.pacote.length} bytes`);
    }
  }
  for (const quadro of quadrosWebSocket(conexao.recebido)) {
    if (quadro.opcode !== BINARIO) continue;
    const mensagem = lerMensagemDoRelay(quadro.carga);
    if (!mensagem) {
      relatorio.problemas.push(`mensagem do relay ilegível de ${quadro.carga.length} bytes`);
      continue;
    }
    contar(relatorio.contagem, `relay ${mensagem.tipo}`);
    if (mensagem.tipo === 'pacote' && mensagem.pacote.length !== TAMANHO_DO_PACOTE) {
      relatorio.problemas.push(`entrega com ${mensagem.pacote.length} bytes`);
    }
  }
}

function conferirAnexo(conexao: Conexao, relatorio: Relatorio): void {
  const pedido = conexao.enviado
    .subarray(0, conexao.enviado.indexOf('\r\n\r\n'))
    .toString('latin1');
  const metodo = /^(\w+) /.exec(pedido)?.[1] ?? '?';
  contar(relatorio.contagem, `anexo ${metodo}`);
  if (metodo !== 'PUT') return;
  const tamanho = Number(/\r\ncontent-length: *(\d+)/i.exec(pedido)?.[1] ?? NaN);
  if (!tamanhoDeAnexoValido(tamanho)) relatorio.problemas.push(`anexo com ${tamanho} bytes`);
}

export function conferirCaptura(captura: Buffer, porta = 8080): Relatorio {
  const relatorio: Relatorio = { contagem: {}, problemas: [] };
  for (const conexao of conexoesTcp(lerPcap(captura), porta)) {
    const inicio = conexao.enviado.subarray(0, 200).toString('latin1');
    if (/^GET [^\r\n]*\r\n/.test(inicio) && /\r\nupgrade: *websocket/i.test(inicio)) {
      conferirWebSocket(conexao, relatorio);
    } else if (/^(PUT|GET|DELETE) \/anexos\//.test(inicio)) {
      conferirAnexo(conexao, relatorio);
    } else if (conexao.enviado.length > 0) {
      contar(relatorio.contagem, 'outra conexão');
    }
  }
  return relatorio;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [arquivo, porta] = process.argv.slice(2);
  if (!arquivo) {
    process.stderr.write('uso: tamanhos.ts <captura.pcap> [porta]\n');
    process.exit(2);
  }
  const relatorio = conferirCaptura(readFileSync(arquivo), porta ? Number(porta) : 8080);
  for (const [tipo, quantos] of Object.entries(relatorio.contagem).sort()) {
    process.stdout.write(`${tipo}: ${quantos}\n`);
  }
  for (const problema of relatorio.problemas) process.stdout.write(`problema: ${problema}\n`);
  const nada = !relatorio.contagem['pedido depositar'];
  if (nada) process.stdout.write('problema: nenhum depósito na captura\n');
  process.exitCode = relatorio.problemas.length > 0 || nada ? 1 : 0;
}
