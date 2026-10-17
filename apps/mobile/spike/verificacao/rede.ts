// Captura de rede do aparelho (RNF-06, RF-44), feita com `emulator -tcpdump` (docs/VERIFICACAO.md).
// Resume os fluxos e os nomes perguntados ao DNS e acusa o que não pode aparecer: qualquer nome
// .onion no DNS (o nome vai ao Tor, nunca à rede) e qualquer conexão com os destinos proibidos (o
// relay sem Tor, por exemplo o 10.0.2.2:8080 do Docker no PC).
//
//   node apps/mobile/spike/verificacao/rede.ts <captura.pcap> [proibido ip:porta]...
//
// Sai com 1 se achou algo proibido.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fluxos, lerPcap, perguntasDeDns, type Fluxo } from './pcap.ts';

export interface ResumoDaRede {
  readonly fluxos: Fluxo[];
  readonly nomes: string[];
  readonly problemas: string[];
}

export function resumirRede(captura: Buffer, proibidos: readonly string[]): ResumoDaRede {
  const pacotes = lerPcap(captura);
  const todos = fluxos(pacotes);
  const nomes = [...new Set(perguntasDeDns(pacotes))];
  const problemas = [
    ...nomes.filter((nome) => /\.onion\.?$/i.test(nome)).map((nome) => `DNS de ${nome}`),
    ...todos
      .filter((fluxo) => proibidos.includes(fluxo.destino) || proibidos.includes(fluxo.origem))
      .map((fluxo) => `${fluxo.protocolo} ${fluxo.origem} > ${fluxo.destino}`),
  ];
  return { fluxos: todos, nomes, problemas };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [arquivo, ...proibidos] = process.argv.slice(2);
  if (!arquivo) {
    process.stderr.write('uso: rede.ts <captura.pcap> [proibido ip:porta]...\n');
    process.exit(2);
  }
  const resumo = resumirRede(readFileSync(arquivo), proibidos);
  for (const fluxo of resumo.fluxos) {
    process.stdout.write(
      `${fluxo.protocolo} ${fluxo.origem} > ${fluxo.destino}: ${fluxo.pacotes} pacotes, ${fluxo.bytes} bytes\n`,
    );
  }
  for (const nome of resumo.nomes) process.stdout.write(`dns: ${nome}\n`);
  for (const problema of resumo.problemas) process.stdout.write(`problema: ${problema}\n`);
  process.exitCode = resumo.problemas.length > 0 ? 1 : 0;
}
