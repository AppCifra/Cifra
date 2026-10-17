// A libsodium de referência, só nos testes: o protocolo recebe dela as funções que valida, e os
// testes assinam com ela.
import sodium from 'libsodium-wrappers-sumo';
import type { Assinar } from '../src/index.ts';

await sodium.ready;

export { sodium };

export interface ParDeTeste {
  readonly publicKey: Uint8Array;
  readonly privateKey: Uint8Array;
  readonly assinar: Assinar;
}

/** Par Ed25519 novo, com a função que assina com ele. */
export function novoPar(): ParDeTeste {
  const { publicKey, privateKey } = sodium.crypto_sign_keypair();
  return {
    publicKey,
    privateKey,
    assinar: (mensagem) => sodium.crypto_sign_detached(mensagem, privateKey),
  };
}

export const hex = (texto: string) => Uint8Array.from(Buffer.from(texto, 'hex'));
