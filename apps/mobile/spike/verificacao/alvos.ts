// Áreas de toque de 44 dp ou mais (RNF-18), na tela que está no emulador: lê o `uiautomator dump`
// e lista o que é clicável, ou segurável, e menor que isso. A densidade sai do `wm density`. O
// `hitSlop` do React Native não aparece no dump: o que ele aumenta sai na lista e é conferido no
// código (docs/VERIFICACAO.md).
//
//   adb exec-out uiautomator dump --compressed /dev/tty > tela.xml
//   node apps/mobile/spike/verificacao/alvos.ts tela.xml <densidade em dpi>
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export interface Alvo {
  readonly texto: string;
  readonly largura: number;
  readonly altura: number;
}

const atributo = (no: string, nome: string) =>
  new RegExp(`\\s${nome}="([^"]*)"`).exec(no)?.[1] ?? '';

/** Os nós clicáveis do app, com o tamanho em dp. */
export function alvosDaTela(xml: string, dpi: number, pacote = 'org.cifra.app'): Alvo[] {
  const escala = dpi / 160;
  return [...xml.matchAll(/<node\s[^>]*>/g)]
    .map(([no]) => no)
    .filter(
      (no) =>
        atributo(no, 'package') === pacote &&
        (atributo(no, 'clickable') === 'true' || atributo(no, 'long-clickable') === 'true'),
    )
    .map((no) => {
      const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = (
        /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(atributo(no, 'bounds')) ?? []
      )
        .slice(1)
        .map(Number);
      return {
        texto: atributo(no, 'text') || atributo(no, 'content-desc') || atributo(no, 'resource-id'),
        largura: Math.round((x2 - x1) / escala),
        altura: Math.round((y2 - y1) / escala),
      };
    });
}

export const pequenos = (alvos: readonly Alvo[]) =>
  alvos.filter((alvo) => alvo.largura < 44 || alvo.altura < 44);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [arquivo, dpi] = process.argv.slice(2);
  if (!arquivo || !dpi) {
    process.stderr.write('uso: alvos.ts <tela.xml> <dpi>\n');
    process.exit(2);
  }
  const alvos = alvosDaTela(readFileSync(arquivo, 'utf8'), Number(dpi));
  for (const alvo of pequenos(alvos)) {
    process.stdout.write(`pequeno: "${alvo.texto}" ${alvo.largura}x${alvo.altura} dp\n`);
  }
  process.stdout.write(`${alvos.length} alvo(s), ${pequenos(alvos).length} abaixo de 44 dp\n`);
}
