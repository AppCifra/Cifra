// A libsodium do relay: a libsodium-wrappers-sumo, a mesma referência dos testes do núcleo (RNF-01).
// O relay só confere assinaturas, calcula hashes e sorteia desafios.
import type { Verificador } from '@cifra/protocol';
import sodium from 'libsodium-wrappers-sumo';

export interface SodiumDoRelay extends Verificador {
  randombytes_buf(tamanho: number): Uint8Array;
}

await sodium.ready;

export const libsodium: SodiumDoRelay = sodium;
