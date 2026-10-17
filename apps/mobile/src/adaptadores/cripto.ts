// Adaptador da porta Cripto no Android: a react-native-libsodium, com o patch que liga as funções
// que faltavam (patches/react-native-libsodium@1.7.0.patch). A atribuição tipada falha no typecheck
// se a biblioteca deixar de cumprir a porta; a conformidade confere os bytes no aparelho.
import type { Cripto } from '@cifra/core';
import * as sodium from 'react-native-libsodium';

export const cripto: Cripto = sodium;
