// X3DH (Signal, revisão 1) com as chaves do Cifra: identidade Ed25519, convertida em X25519 para o
// acordo; prekey assinada e one-time prekeys X25519, publicadas no relay.
//
//   DH1 = DH(IKa, SPKb)   DH2 = DH(EKa, IKb)   DH3 = DH(EKa, SPKb)   DH4 = DH(EKa, OPKb)
//   SK  = KDF(F ‖ DH1 ‖ DH2 ‖ DH3 [‖ DH4])
//   AD  = IKa ‖ IKb, com as chaves Ed25519: as do cartão, de onde sai o ID
//
// "a" é quem abre a sessão; "b", quem responde. Sem one-time prekey (o relay pode não ter mais
// nenhuma), o DH4 fica de fora, como na especificação.
import {
  cartaoAutentico,
  juntar,
  type AberturaDaSessao,
  type Cartao,
  type Prekey,
} from '@cifra/protocol';
import type { Identidade } from '../identidade/identidade.ts';
import type { Cripto, ParDeChaves } from '../portas/cripto.ts';
import { derivarSegredoDoX3dh } from './derivacao.ts';

export interface ResultadoDoX3dh {
  /** SK: a raiz que a catraca recebe. */
  readonly segredo: Uint8Array;
  /** AD: entra nos dados associados de toda mensagem da sessão. */
  readonly dadosAssociados: Uint8Array;
}

/**
 * Lado de quem abre a sessão. Confere de novo as assinaturas do cartão: sem elas, a prekey não é
 * do dono do ID. Consome a chave efêmera: a parte privada é zerada aqui, como a especificação pede.
 * Lança com cartão inválido ou chave que não serve para acordo.
 */
export function iniciarX3dh(
  cripto: Cripto,
  identidade: Identidade,
  cartao: Cartao,
  avulsa: Prekey | null,
  efemera: ParDeChaves,
): ResultadoDoX3dh {
  if (!cartaoAutentico(cripto, cartao)) throw new Error('cartão com assinatura inválida');
  try {
    const identidadeDoOutro = cripto.crypto_sign_ed25519_pk_to_curve25519(cartao.chaveDeIdentidade);
    const assinada = cartao.prekeyAssinada.chave;
    const saidas = [
      cripto.crypto_scalarmult(identidade.acordo.privateKey, assinada),
      cripto.crypto_scalarmult(efemera.privateKey, identidadeDoOutro),
      cripto.crypto_scalarmult(efemera.privateKey, assinada),
      ...(avulsa ? [cripto.crypto_scalarmult(efemera.privateKey, avulsa.chave)] : []),
    ];
    return {
      segredo: derivarSegredoDoX3dh(cripto, saidas),
      dadosAssociados: juntar(identidade.assinatura.publicKey, cartao.chaveDeIdentidade),
    };
  } finally {
    cripto.memzero(efemera.privateKey);
  }
}

/**
 * Lado de quem responde, ao receber a mensagem inicial. `assinada` é o par da prekey assinada e
 * `avulsa`, a chave privada da one-time prekey, as duas que a mensagem diz ter usado. Lança com
 * chave que não serve para acordo.
 */
export function responderX3dh(
  cripto: Cripto,
  identidade: Identidade,
  abertura: AberturaDaSessao,
  assinada: ParDeChaves,
  avulsa: Uint8Array | null,
): ResultadoDoX3dh {
  const identidadeDoOutro = cripto.crypto_sign_ed25519_pk_to_curve25519(abertura.chaveDeIdentidade);
  const efemera = abertura.chaveEfemera;
  const saidas = [
    cripto.crypto_scalarmult(assinada.privateKey, identidadeDoOutro),
    cripto.crypto_scalarmult(identidade.acordo.privateKey, efemera),
    cripto.crypto_scalarmult(assinada.privateKey, efemera),
    ...(avulsa ? [cripto.crypto_scalarmult(avulsa, efemera)] : []),
  ];
  return {
    segredo: derivarSegredoDoX3dh(cripto, saidas),
    dadosAssociados: juntar(abertura.chaveDeIdentidade, identidade.assinatura.publicKey),
  };
}
