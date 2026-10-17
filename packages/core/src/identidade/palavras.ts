// Palavras de recuperação (BIP39). As 12 palavras guardam os 128 bits de entropia da identidade e
// mais 4 bits de checksum, os primeiros do SHA-256 da entropia: 11 bits por palavra. A identidade
// sai da entropia, não do texto: as mesmas posições nas listas em português e em inglês dão a
// mesma identidade, e a restauração aceita as duas listas.
//
// As listas são as oficiais do BIP39 (github.com/bitcoin/bips, pasta bip-0039), sem mudança. Não
// têm palavra em comum nem acento, e nenhuma repete as 4 primeiras letras.
import type { Cripto } from '../portas/cripto.ts';
import ingles from './listas/ingles.json';
import portugues from './listas/portugues.json';

export type IdiomaDasPalavras = 'portugues' | 'ingles';

export const LISTAS: Readonly<Record<IdiomaDasPalavras, readonly string[]>> = { portugues, ingles };

export const QUANTIDADE_DE_PALAVRAS = 12;

/** 128 bits de entropia. */
export const BYTES_DA_ENTROPIA = 16;

const BITS_POR_PALAVRA = 11;
const BITS_DO_CHECKSUM = (BYTES_DA_ENTROPIA * 8) / 32;

const POSICOES: Readonly<Record<IdiomaDasPalavras, ReadonlyMap<string, number>>> = {
  portugues: new Map(portugues.map((palavra, posicao) => [palavra, posicao] as const)),
  ingles: new Map(ingles.map((palavra, posicao) => [palavra, posicao] as const)),
};

export type ProblemaNasPalavras =
  | { readonly tipo: 'quantidade'; readonly encontradas: number }
  /** `posicao` vai de 1 a 12. */
  | { readonly tipo: 'desconhecida'; readonly posicao: number }
  /** Todas estão nas listas, mas não conferem: ordem trocada ou palavra errada que existe. */
  | { readonly tipo: 'checksum' };

export type LeituraDasPalavras =
  | { readonly ok: true; readonly entropia: Uint8Array; readonly idioma: IdiomaDasPalavras }
  | { readonly ok: false; readonly problema: ProblemaNasPalavras };

function checksum(cripto: Cripto, entropia: Uint8Array): number {
  const [primeiro = 0] = cripto.crypto_hash_sha256(entropia);
  return primeiro >> (8 - BITS_DO_CHECKSUM);
}

/** As 12 palavras que guardam a entropia, na lista do idioma pedido. */
export function palavrasDaEntropia(
  cripto: Cripto,
  entropia: Uint8Array,
  idioma: IdiomaDasPalavras,
): string[] {
  if (entropia.length !== BYTES_DA_ENTROPIA) {
    throw new Error(`a entropia tem ${BYTES_DA_ENTROPIA} bytes`);
  }
  const lista = LISTAS[idioma];
  const palavras: string[] = [];
  let acumulado = 0;
  let bits = 0;
  const juntar = (valor: number, quantos: number) => {
    acumulado = (acumulado << quantos) | valor;
    bits += quantos;
    if (bits >= BITS_POR_PALAVRA) {
      bits -= BITS_POR_PALAVRA;
      const palavra = lista[(acumulado >> bits) & 0x7ff];
      if (palavra === undefined) throw new Error('lista de palavras incompleta');
      palavras.push(palavra);
      acumulado &= (1 << bits) - 1;
    }
  };
  for (const byte of entropia) juntar(byte, 8);
  juntar(checksum(cripto, entropia), BITS_DO_CHECKSUM);
  return palavras;
}

/**
 * Separa o texto digitado em palavras: ignora maiúsculas e acentos, e qualquer coisa que não seja
 * letra separa uma palavra da outra (espaço, quebra de linha, número, vírgula).
 */
export function separarPalavras(texto: string): string[] {
  return texto
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/\P{L}+/u)
    .filter((palavra) => palavra !== '');
}

/** O idioma da maioria das palavras. As listas não têm palavra em comum. */
function idiomaDaMaioria(palavras: readonly string[]): IdiomaDasPalavras {
  const contar = (idioma: IdiomaDasPalavras) =>
    palavras.filter((palavra) => POSICOES[idioma].has(palavra)).length;
  return contar('ingles') > contar('portugues') ? 'ingles' : 'portugues';
}

/** Lê as 12 palavras digitadas, em português ou em inglês, e devolve a entropia. */
export function lerPalavras(cripto: Cripto, texto: string): LeituraDasPalavras {
  const palavras = separarPalavras(texto);
  if (palavras.length !== QUANTIDADE_DE_PALAVRAS) {
    return { ok: false, problema: { tipo: 'quantidade', encontradas: palavras.length } };
  }

  const idioma = idiomaDaMaioria(palavras);
  const entropia = new Uint8Array(BYTES_DA_ENTROPIA);
  let acumulado = 0;
  let bits = 0;
  let preenchidos = 0;
  for (const [i, palavra] of palavras.entries()) {
    const posicao = POSICOES[idioma].get(palavra);
    if (posicao === undefined) {
      cripto.memzero(entropia);
      return { ok: false, problema: { tipo: 'desconhecida', posicao: i + 1 } };
    }
    acumulado = (acumulado << BITS_POR_PALAVRA) | posicao;
    bits += BITS_POR_PALAVRA;
    while (bits >= 8 && preenchidos < BYTES_DA_ENTROPIA) {
      bits -= 8;
      entropia[preenchidos++] = (acumulado >> bits) & 0xff;
      acumulado &= (1 << bits) - 1;
    }
  }

  // Sobram os 4 bits do checksum.
  if (acumulado !== checksum(cripto, entropia)) {
    cripto.memzero(entropia);
    return { ok: false, problema: { tipo: 'checksum' } };
  }
  return { ok: true, entropia, idioma };
}
