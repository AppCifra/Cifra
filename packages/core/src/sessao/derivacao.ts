// Derivações de chave do X3DH e do Double Ratchet, com BLAKE2b (SPEC, "Sessão e mensagens"). As
// especificações do Signal recomendam HKDF e HMAC com SHA-256; aqui o papel do HMAC é do BLAKE2b
// com chave, que a libsodium já oferece: `crypto_generichash` com chave extrai, como o
// HKDF-Extract, e `crypto_kdf_derive_from_key` expande em subchaves numeradas, como o HKDF-Expand
// e as constantes 0x01 e 0x02 do KDF_CK. Nenhuma primitiva nova: só chamadas da libsodium (RNF-01).
import { CONTEXTOS_DE_DERIVACAO, juntar } from '@cifra/protocol';
import type { Cripto } from '../portas/cripto.ts';

/** Raiz, cadeias, chave de mensagem e SK: 256 bits. */
export const BYTES_DA_CHAVE_SIMETRICA = 32;

/** O F do X3DH com X25519: 32 bytes 0xFF antes das saídas do DH, separando de outros usos. */
const F = new Uint8Array(32).fill(0xff);

/** HKDF-Extract com BLAKE2b: `sal` é a chave do hash, ou nenhuma. Devolve a PRK. */
function extrair(cripto: Cripto, entrada: Uint8Array, sal: Uint8Array | null): Uint8Array {
  return cripto.crypto_generichash(BYTES_DA_CHAVE_SIMETRICA, entrada, sal);
}

function subchave(
  cripto: Cripto,
  chave: Uint8Array,
  numero: number,
  contexto: string,
  tamanho = 32,
) {
  return cripto.crypto_kdf_derive_from_key(tamanho, numero, contexto, chave);
}

/** X3DH: SK = KDF(F ‖ DH1 ‖ DH2 ‖ DH3 [‖ DH4]). Zera as saídas do DH depois de usar. */
export function derivarSegredoDoX3dh(
  cripto: Cripto,
  saidasDoDh: readonly Uint8Array[],
): Uint8Array {
  const material = juntar(F, ...saidasDoDh);
  const prk = extrair(cripto, material, null);
  try {
    return subchave(cripto, prk, 1, CONTEXTOS_DE_DERIVACAO.x3dh);
  } finally {
    cripto.memzero(prk);
    cripto.memzero(material);
    for (const saida of saidasDoDh) cripto.memzero(saida);
  }
}

/** KDF_RK(rk, dh_out): a raiz nova e a chave da cadeia nova. */
export function derivarRaiz(
  cripto: Cripto,
  raiz: Uint8Array,
  saidaDoDh: Uint8Array,
): { readonly raiz: Uint8Array; readonly cadeia: Uint8Array } {
  const prk = extrair(cripto, saidaDoDh, raiz);
  try {
    return {
      raiz: subchave(cripto, prk, 1, CONTEXTOS_DE_DERIVACAO.raiz),
      cadeia: subchave(cripto, prk, 2, CONTEXTOS_DE_DERIVACAO.raiz),
    };
  } finally {
    cripto.memzero(prk);
  }
}

/** KDF_CK(ck): a chave desta mensagem e a próxima chave da cadeia. */
export function derivarCadeia(
  cripto: Cripto,
  cadeia: Uint8Array,
): { readonly mensagem: Uint8Array; readonly cadeia: Uint8Array } {
  return {
    mensagem: subchave(cripto, cadeia, 1, CONTEXTOS_DE_DERIVACAO.cadeia),
    cadeia: subchave(cripto, cadeia, 2, CONTEXTOS_DE_DERIVACAO.cadeia),
  };
}

/**
 * A chave e o nonce do XChaCha20-Poly1305 de uma mensagem. Cada chave de mensagem cifra uma vez
 * só, então derivar o nonce dela não repete nonce com a mesma chave.
 */
export function derivarCifra(
  cripto: Cripto,
  chaveDaMensagem: Uint8Array,
): { readonly chave: Uint8Array; readonly nonce: Uint8Array } {
  return {
    chave: subchave(cripto, chaveDaMensagem, 1, CONTEXTOS_DE_DERIVACAO.mensagem),
    nonce: subchave(
      cripto,
      chaveDaMensagem,
      2,
      CONTEXTOS_DE_DERIVACAO.mensagem,
      cripto.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
    ),
  };
}
