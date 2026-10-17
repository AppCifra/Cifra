// Varredura de marcadores numa extração do aparelho (testes de perícia, conversas ocultas e pânico,
// docs/VERIFICACAO.md). O cenário de teste usa textos únicos (mensagens, apelidos, nome de anexo), e
// a perícia procura cada um deles em tudo o que saiu do aparelho: dentro de cada arquivo de um .tar
// (a extração lógica, com o nome do arquivo em que achou) ou byte a byte numa imagem crua.
//
//   node apps/mobile/spike/verificacao/varredura.ts <marcadores.txt> <extração.tar | imagem>...
//
// Cada marcador (ASCII) é procurado em UTF-8, UTF-16 (os dois sentidos) e base64; `hex:<bytes>`, como
// está. Sai com 1 se achou algum.
// Lê em pedaços: a extração pode ter vários GB.
import { closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export interface Forma {
  readonly marcador: string;
  readonly forma: 'utf8' | 'utf16' | 'base64' | 'bytes';
  readonly bytes: Buffer;
}

export interface Achado {
  readonly marcador: string;
  readonly forma: Forma['forma'];
  /** O arquivo dentro do .tar, ou vazio numa imagem crua. */
  readonly arquivo: string;
  readonly deslocamento: number;
}

/**
 * As formas em que um marcador pode aparecer no disco. `hex:` procura os bytes como estão: um
 * trecho de um anexo, por exemplo.
 */
export function formasDe(marcador: string): Forma[] {
  if (marcador.startsWith('hex:')) {
    return [{ marcador, forma: 'bytes', bytes: Buffer.from(marcador.slice(4), 'hex') }];
  }
  const utf8 = Buffer.from(marcador, 'utf8');
  // Sem o último zero, o UTF-16 em ASCII acha os dois sentidos: "a\0b\0c" está em "a\0b\0c\0" e em
  // "\0a\0b\0c". Os marcadores são ASCII.
  const utf16 = Buffer.from(marcador, 'utf16le').subarray(0, -1);
  const formas: Forma[] = [
    { marcador, forma: 'utf8', bytes: utf8 },
    { marcador, forma: 'utf16', bytes: utf16 },
  ];
  // Em base64, o marcador muda conforme a posição dele no texto codificado: três alinhamentos, sem
  // os caracteres das pontas, que dependem dos bytes vizinhos.
  for (let antes = 0; antes < 3; antes++) {
    const texto = Buffer.concat([Buffer.alloc(antes), utf8]).toString('base64');
    const inicio = Math.ceil((antes * 4) / 3) + 1;
    const fim = Math.floor(((antes + utf8.length) * 4) / 3) - 1;
    if (fim - inicio >= 8) {
      formas.push({ marcador, forma: 'base64', bytes: Buffer.from(texto.slice(inicio, fim)) });
    }
  }
  return formas;
}

/** Procura as formas num pedaço; `base` é o deslocamento do pedaço no arquivo. */
function procurar(pedaco: Buffer, formas: readonly Forma[], base: number, arquivo: string) {
  const achados: Achado[] = [];
  for (const forma of formas) {
    let i = pedaco.indexOf(forma.bytes);
    while (i !== -1) {
      achados.push({
        marcador: forma.marcador,
        forma: forma.forma,
        arquivo,
        deslocamento: base + i,
      });
      i = pedaco.indexOf(forma.bytes, i + 1);
    }
  }
  return achados;
}

const PEDACO = 16 * 1024 * 1024;

/** Varre `tamanho` bytes de `fd` a partir de `inicio`, em pedaços que se sobrepõem. */
function varrerTrecho(
  fd: number,
  inicio: number,
  tamanho: number,
  formas: readonly Forma[],
  arquivo: string,
): Achado[] {
  const sobra = Math.max(...formas.map((forma) => forma.bytes.length)) - 1;
  const achados: Achado[] = [];
  const vistos = new Set<string>();
  let lido = 0;
  while (lido < tamanho) {
    const quanto = Math.min(PEDACO + sobra, tamanho - lido);
    const pedaco = Buffer.alloc(quanto);
    readSync(fd, pedaco, 0, quanto, inicio + lido);
    for (const achado of procurar(pedaco, formas, lido, arquivo)) {
      const chave = `${achado.forma}:${achado.marcador}:${achado.deslocamento}`;
      if (!vistos.has(chave)) {
        vistos.add(chave);
        achados.push(achado);
      }
    }
    if (quanto < PEDACO + sobra) break;
    lido += PEDACO;
  }
  return achados;
}

export interface EntradaDoTar {
  readonly nome: string;
  readonly tipo: string;
  /** Onde os dados começam no .tar. */
  readonly inicio: number;
  readonly tamanho: number;
}

const texto = (bloco: Buffer, de: number, ate: number) =>
  bloco.subarray(de, ate).toString('utf8').replace(/\0.*$/s, '');

function octal(bloco: Buffer, de: number, ate: number): number {
  // GNU: tamanho acima de 8 GB em binário, com o bit alto ligado.
  if (((bloco[de] ?? 0) & 0x80) !== 0) {
    let valor = 0;
    for (let i = de + 1; i < ate; i++) valor = valor * 256 + (bloco[i] ?? 0);
    return valor;
  }
  const digitos = texto(bloco, de, ate).trim();
  return digitos === '' ? 0 : parseInt(digitos, 8);
}

/** As entradas de um .tar (ustar, GNU e pax), sem ler os dados. */
export function entradasDoTar(fd: number): EntradaDoTar[] {
  const total = fstatSync(fd).size;
  const entradas: EntradaDoTar[] = [];
  const cabecalho = Buffer.alloc(512);
  let posicao = 0;
  let nomeLongo: string | null = null;
  while (posicao + 512 <= total) {
    readSync(fd, cabecalho, 0, 512, posicao);
    if (cabecalho.every((byte) => byte === 0)) break;
    const tamanho = octal(cabecalho, 124, 136);
    const tipo = String.fromCharCode(cabecalho[156] ?? 0) || '0';
    const inicio = posicao + 512;
    posicao = inicio + Math.ceil(tamanho / 512) * 512;
    if (tipo === 'L' || tipo === 'x') {
      const dados = Buffer.alloc(tamanho);
      readSync(fd, dados, 0, tamanho, inicio);
      nomeLongo =
        tipo === 'L'
          ? dados.toString('utf8').replace(/\0.*$/s, '')
          : (/(?:^|\n)\d+ path=([^\n]*)\n/.exec(dados.toString('utf8'))?.[1] ?? null);
      continue;
    }
    const prefixo = texto(cabecalho, 345, 500);
    const nome = nomeLongo ?? (prefixo ? `${prefixo}/` : '') + texto(cabecalho, 0, 100);
    nomeLongo = null;
    entradas.push({ nome, tipo, inicio, tamanho });
  }
  return entradas;
}

const ehTar = (fd: number) => {
  const magia = Buffer.alloc(5);
  readSync(fd, magia, 0, 5, 257);
  return magia.toString('latin1') === 'ustar';
};

/** Varre um .tar arquivo por arquivo, ou outro arquivo inteiro como imagem crua. */
export function varrer(caminho: string, marcadores: readonly string[]): Achado[] {
  const formas = marcadores.flatMap(formasDe);
  const fd = openSync(caminho, 'r');
  try {
    if (!ehTar(fd)) return varrerTrecho(fd, 0, fstatSync(fd).size, formas, '');
    return entradasDoTar(fd)
      .filter((entrada) => entrada.tamanho > 0)
      .flatMap((entrada) =>
        varrerTrecho(fd, entrada.inicio, entrada.tamanho, formas, entrada.nome),
      );
  } finally {
    closeSync(fd);
  }
}

/** Um marcador por linha; linhas vazias e com # ficam de fora. */
export function lerMarcadores(conteudo: string): string[] {
  return conteudo
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter((linha) => linha !== '' && !linha.startsWith('#'));
}

/** Os arquivos do .tar cujo nome casa com `filtro`, com o tamanho. */
export function listar(caminho: string, filtro: RegExp): EntradaDoTar[] {
  const fd = openSync(caminho, 'r');
  try {
    return entradasDoTar(fd).filter((entrada) => filtro.test(entrada.nome));
  } finally {
    closeSync(fd);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--listar') {
    // varredura.ts --listar <expressão> <extração.tar>: o que sobrou de um app, por exemplo.
    const [, , , filtro = '', caminho = ''] = process.argv;
    for (const entrada of listar(caminho, new RegExp(filtro))) {
      process.stdout.write(`${entrada.tipo} ${entrada.tamanho} ${entrada.nome}\n`);
    }
    process.exit(0);
  }
  const [arquivoDeMarcadores, ...caminhos] = process.argv.slice(2);
  if (!arquivoDeMarcadores || caminhos.length === 0) {
    process.stderr.write('uso: varredura.ts <marcadores.txt> <extração.tar | imagem>...\n');
    process.exit(2);
  }
  const marcadores = lerMarcadores(readFileSync(arquivoDeMarcadores, 'utf8'));
  let total = 0;
  for (const caminho of caminhos) {
    const achados = varrer(caminho, marcadores);
    total += achados.length;
    for (const achado of achados) {
      process.stdout.write(
        `${caminho}: ${achado.marcador} (${achado.forma}) em ${achado.arquivo || '[imagem]'} @${achado.deslocamento}\n`,
      );
    }
    process.stdout.write(`${caminho}: ${achados.length} achado(s)\n`);
  }
  process.exitCode = total > 0 ? 1 : 0;
}
