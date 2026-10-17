// Contexto de cada assinatura do protocolo. A assinatura cobre o contexto seguido dos bytes
// assinados: assim uma assinatura feita para um fim nunca vale para outro. Nenhum contexto é o
// começo de outro, e o número no fim muda quando o formato assinado mudar.
import { ascii } from './bytes.ts';

export const CONTEXTOS = {
  /** Prekey assinada do cartão: Sig(IK, Encode(SPK)) do X3DH. */
  prekeyAssinada: ascii('cifra/prekey-assinada/1'),
  /** O cartão inteiro, menos a própria assinatura. */
  cartao: ascii('cifra/cartao/1'),
  /** A publicação no relay: modo, cartão e one-time prekeys. */
  publicacao: ascii('cifra/publicacao/1'),
  /** Resposta ao desafio do relay para abrir uma caixa. */
  aberturaDeCaixa: ascii('cifra/abrir-caixa/1'),
  /** O pânico: a resposta ao desafio do relay para apagar o cartão e a caixa principal. */
  apagarTudo: ascii('cifra/apagar-tudo/1'),
} as const;

/**
 * Contexto de cada derivação de chave do X3DH e do Double Ratchet: o `info` das especificações do
 * Signal. São os 8 caracteres que o `crypto_kdf_derive_from_key` da libsodium exige, todos
 * diferentes, e mudam junto com a versão do envelope quando a derivação mudar.
 */
export const CONTEXTOS_DE_DERIVACAO = {
  /** SK, o segredo que o X3DH entrega à catraca. */
  x3dh: 'Cifra-SK',
  /** KDF_RK: a raiz nova e a cadeia nova de cada passo da catraca. */
  raiz: 'Cifra-RK',
  /** KDF_CK: a chave da mensagem e a próxima chave da cadeia. */
  cadeia: 'Cifra-CK',
  /** A chave e o nonce do XChaCha20-Poly1305 de cada mensagem. */
  mensagem: 'Cifra-MK',
} as const;
