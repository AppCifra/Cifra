// Adaptador de referência da porta Cripto no Node: a própria libsodium-wrappers-sumo, a mesma
// candidata do relay e da web. A atribuição tipada falha no typecheck se ela não cumprir a porta.
import sodium from 'libsodium-wrappers-sumo';
import type { Cripto } from '../../src/index.ts';

await sodium.ready;

export const cripto: Cripto = sodium;
