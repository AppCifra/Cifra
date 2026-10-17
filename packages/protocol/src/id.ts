// Formato do ID: os primeiros 80 bits do BLAKE2b da chave pública de identidade, em base32
// Crockford, sem letras ambíguas (I, L, O e U ficam de fora). Aparece em grupos de 4:
// XXXX-XXXX-XXXX-XXXX. A derivação e a codificação ficam aqui, as mesmas no app e no relay; o hash
// vem da libsodium de quem chama.
import { BITS_DO_ID, CARACTERES_DO_ID } from './limites.ts';
import type { Hash } from './verificador.ts';

/** O ID em bytes: 80 bits. */
export const BYTES_DO_ID = BITS_DO_ID / 8;

/** O ID de uma chave pública Ed25519, em bytes: os primeiros 80 bits do BLAKE2b-256 dela. */
export function idDaChave(hash: Hash, chavePublica: Uint8Array): Uint8Array {
  return hash.crypto_generichash(32, chavePublica, null).slice(0, BYTES_DO_ID);
}

const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Na leitura, as letras que o Crockford trata como sinônimo de um dígito. */
const SINONIMOS: Readonly<Record<string, string>> = { O: '0', I: '1', L: '1' };

/** Os 10 bytes do ID no formato XXXX-XXXX-XXXX-XXXX. */
export function formatarId(bytes: Uint8Array): string {
  if (bytes.length !== BYTES_DO_ID) throw new Error(`o ID tem ${BYTES_DO_ID} bytes`);
  let texto = '';
  let acumulado = 0;
  let bits = 0;
  for (const byte of bytes) {
    acumulado = (acumulado << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      texto += ALFABETO.charAt((acumulado >> bits) & 31);
    }
    acumulado &= (1 << bits) - 1;
  }
  return [0, 4, 8, 12].map((inicio) => texto.slice(inicio, inicio + 4)).join('-');
}

/**
 * Lê um ID digitado ou colado: aceita minúsculas, sem hífen ou com espaços, e O, I e L no lugar
 * de 0 e 1. Devolve `null` se não for um ID.
 */
export function lerId(texto: string): Uint8Array | null {
  const limpo = texto.replace(/[\s-]/g, '').toUpperCase();
  if (limpo.length !== CARACTERES_DO_ID) return null;
  const bytes = new Uint8Array(BYTES_DO_ID);
  let acumulado = 0;
  let bits = 0;
  let posicao = 0;
  for (const caractere of limpo) {
    const valor = ALFABETO.indexOf(SINONIMOS[caractere] ?? caractere);
    if (valor === -1) return null;
    acumulado = (acumulado << 5) | valor;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes[posicao++] = (acumulado >> bits) & 0xff;
      acumulado &= (1 << bits) - 1;
    }
  }
  return bytes;
}
