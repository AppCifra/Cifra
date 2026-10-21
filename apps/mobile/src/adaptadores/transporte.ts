// Adaptador da porta Transporte no Android: a lógica de transporte-por-modulo.ts sobre o módulo
// nativo, com Tor (Orbot) por padrão e a credencial de cada circuito sorteada pela libsodium.
import type { Transporte } from '@cifra/core';
import { transporteNativo } from '../../modules/cifra-plataforma/index.ts';
import { cripto } from './cripto.ts';
import { transportePorModulo, type OpcoesDoTransporte } from './transporte-por-modulo.ts';

/** Porta SOCKS padrão do Orbot. */
export const PORTA_SOCKS_DO_ORBOT = 9050;

export function criarTransporte(opcoes: OpcoesDoTransporte): Transporte {
  return transportePorModulo(transporteNativo, cripto, opcoes);
}
