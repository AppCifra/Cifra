// Leitura e escrita dos formatos binários do protocolo, com inteiros em big-endian. A leitura é
// estrita: cada campo tem tamanho conhecido, e faltar ou sobrar byte é erro. O relay não confia no
// app, e o app não confia no relay (RNF-13).

/** Lançado pelo leitor quando os bytes não seguem o formato. Quem lê troca o erro por `null`. */
export class ErroDeFormato extends Error {}

export class Leitor {
  readonly #bytes: Uint8Array;
  readonly #visao: DataView;
  #posicao = 0;

  constructor(bytes: Uint8Array) {
    // Visão comum sobre a mesma memória: um Buffer do Node vira Uint8Array, e as cópias também.
    this.#bytes = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.#visao = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  /** Quantos bytes já foram lidos. */
  get posicao(): number {
    return this.#posicao;
  }

  #avancar(tamanho: number): number {
    const inicio = this.#posicao;
    if (tamanho > this.#bytes.length - inicio) throw new ErroDeFormato('faltam bytes');
    this.#posicao += tamanho;
    return inicio;
  }

  uint8(): number {
    return this.#visao.getUint8(this.#avancar(1));
  }

  uint16(): number {
    return this.#visao.getUint16(this.#avancar(2));
  }

  uint32(): number {
    return this.#visao.getUint32(this.#avancar(4));
  }

  /** Até `Number.MAX_SAFE_INTEGER`: acima disso, o número não cabe exato em JS. */
  uint64(): number {
    const valor = this.#visao.getBigUint64(this.#avancar(8));
    if (valor > BigInt(Number.MAX_SAFE_INTEGER)) throw new ErroDeFormato('número grande demais');
    return Number(valor);
  }

  /** Cópia dos próximos `tamanho` bytes. */
  bytes(tamanho: number): Uint8Array {
    const inicio = this.#avancar(tamanho);
    return this.#bytes.slice(inicio, inicio + tamanho);
  }

  /** Cópia de um trecho já lido, como o que uma assinatura cobre. */
  trecho(inicio: number, fim: number): Uint8Array {
    if (inicio < 0 || fim < inicio || fim > this.#posicao) throw new Error('trecho fora do lido');
    return this.#bytes.slice(inicio, fim);
  }

  /** Exige que nada tenha sobrado. */
  fim(): void {
    if (this.#posicao !== this.#bytes.length) throw new ErroDeFormato('bytes sobrando');
  }
}

/** Monta uma mensagem. Valor fora do tamanho do campo é erro de programação e lança. */
export class Escritor {
  readonly #partes: Uint8Array[] = [];
  #tamanho = 0;

  #inteiro(valor: number, bytes: 1 | 2 | 4 | 8): this {
    const maximo = bytes === 8 ? Number.MAX_SAFE_INTEGER : 2 ** (bytes * 8) - 1;
    if (!Number.isInteger(valor) || valor < 0 || valor > maximo) {
      throw new RangeError(`inteiro fora de ${bytes} bytes`);
    }
    const parte = new Uint8Array(bytes);
    const visao = new DataView(parte.buffer);
    if (bytes === 1) visao.setUint8(0, valor);
    else if (bytes === 2) visao.setUint16(0, valor);
    else if (bytes === 4) visao.setUint32(0, valor);
    else visao.setBigUint64(0, BigInt(valor));
    return this.bytes(parte);
  }

  uint8(valor: number): this {
    return this.#inteiro(valor, 1);
  }

  uint16(valor: number): this {
    return this.#inteiro(valor, 2);
  }

  uint32(valor: number): this {
    return this.#inteiro(valor, 4);
  }

  uint64(valor: number): this {
    return this.#inteiro(valor, 8);
  }

  bytes(bytes: Uint8Array): this {
    this.#partes.push(bytes.slice());
    this.#tamanho += bytes.length;
    return this;
  }

  resultado(): Uint8Array {
    const saida = new Uint8Array(this.#tamanho);
    let posicao = 0;
    for (const parte of this.#partes) {
      saida.set(parte, posicao);
      posicao += parte.length;
    }
    return saida;
  }
}

/** Junta pedaços de bytes. */
export function juntar(...partes: readonly Uint8Array[]): Uint8Array {
  const escritor = new Escritor();
  for (const parte of partes) escritor.bytes(parte);
  return escritor.resultado();
}

/** Bytes de um texto ASCII imprimível. Lança com qualquer outro caractere. */
export function ascii(texto: string): Uint8Array {
  if (!/^[ -~]*$/.test(texto)) throw new RangeError('texto fora do ASCII');
  return Uint8Array.from(texto, (caractere) => caractere.charCodeAt(0));
}

/** Texto de bytes ASCII imprimíveis, ou `null` se algum byte não for. */
export function deAscii(bytes: Uint8Array): string | null {
  let texto = '';
  for (const byte of bytes) {
    if (byte < 0x20 || byte > 0x7e) return null;
    texto += String.fromCharCode(byte);
  }
  return texto;
}

export function iguais(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** Bytes em hexadecimal minúsculo. */
export function paraHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
