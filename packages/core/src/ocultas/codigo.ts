// O código secreto das conversas ocultas (RF-21, RF-22). O código nunca é guardado: só a chave que
// sai dele abre o cofre. A chave é o Argon2id do código, com um sal que sai do segredo do cofre,
// combinado por BLAKE2b com chave com o próprio segredo. O segredo sai da chave mestra, que só
// existe embrulhada no aparelho e só sai no desbloqueio: sem ele, quem copiar o cofre não consegue
// testar códigos fora do aparelho.
//
// O Argon2id usa o nível INTERACTIVE (64 MB): ele roda a cada texto aceito na busca, com o mesmo
// custo, acerte ou não (RF-22). O MODERATE levaria segundos em cada busca.
import { utf8 } from '@cifra/protocol';
import type { Cripto } from '../portas/cripto.ts';

/** O código tem de 6 a 64 caracteres, depois de tirar o espaço das pontas. */
export const MINIMO_DO_CODIGO = 6;
export const MAXIMO_DO_CODIGO = 64;

/** Bytes do segredo do cofre e da chave do cofre. */
export const BYTES_DA_CHAVE_DO_COFRE = 32;

// Cada derivação com um contexto próprio: o segredo nunca vale como o sal, nem o contrário.
const CONTEXTO_DO_SEGREDO = utf8('cifra/cofre/segredo');
const CONTEXTO_DO_SAL = utf8('cifra/cofre/sal');

/**
 * O código como ele vale: sem espaço nas pontas, na forma NFC (o mesmo código digitado em teclados
 * diferentes dá a mesma chave). Maiúscula e minúscula são diferentes.
 */
export function normalizarCodigo(texto: string): string {
  return texto.trim().normalize('NFC');
}

/** O texto pode ser um código: de 6 a 64 caracteres depois de normalizar. */
export function codigoAceito(texto: string): boolean {
  const tamanho = Array.from(normalizarCodigo(texto)).length;
  return tamanho >= MINIMO_DO_CODIGO && tamanho <= MAXIMO_DO_CODIGO;
}

/** O segredo do cofre, que sai da chave mestra. Fica na memória só com o app desbloqueado. */
export function segredoDoCofre(cripto: Cripto, chaveMestra: Uint8Array): Uint8Array {
  return cripto.crypto_generichash(BYTES_DA_CHAVE_DO_COFRE, CONTEXTO_DO_SEGREDO, chaveMestra);
}

/**
 * A chave do cofre para o código: o Argon2id do código, combinado com o segredo. Roda sempre, com o
 * mesmo custo, para todo código aceito: o tempo não diz se ele abre o cofre (RF-22). Código fora do
 * tamanho é erro de quem chama.
 */
export function chaveDoCofre(cripto: Cripto, codigo: string, segredo: Uint8Array): Uint8Array {
  if (!codigoAceito(codigo)) throw new RangeError('código fora do tamanho');
  const sal = cripto.crypto_generichash(cripto.crypto_pwhash_SALTBYTES, CONTEXTO_DO_SAL, segredo);
  const senha = utf8(normalizarCodigo(codigo));
  const derivada = cripto.crypto_pwhash(
    BYTES_DA_CHAVE_DO_COFRE,
    senha,
    sal,
    cripto.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    cripto.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    cripto.crypto_pwhash_ALG_ARGON2ID13,
  );
  try {
    return cripto.crypto_generichash(BYTES_DA_CHAVE_DO_COFRE, derivada, segredo);
  } finally {
    cripto.memzero(derivada);
    cripto.memzero(senha);
  }
}
