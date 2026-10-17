// Número de segurança (RF-37): 60 dígitos, em 12 grupos de 5, iguais nos dois aparelhos. Segue o
// do Signal, com o BLAKE2b-512 da libsodium no lugar do SHA-512 (RNF-01). Para cada lado:
//
//   h = versão (2 bytes) ‖ chave Ed25519 de identidade (32) ‖ ID (10)
//   5200 vezes: h = BLAKE2b-512(h ‖ chave)
//   os primeiros 30 bytes de h, em 6 pedaços de 5; cada pedaço, como inteiro big-endian, módulo
//   100000, com 5 dígitos: 30 dígitos
//
// Os 30 dígitos de cada lado vão em ordem fixa, o menor primeiro: os dois aparelhos mostram o
// mesmo número. Muitas iterações tornam caro achar outra chave que dê os mesmos dígitos. A
// verificação é manual: comparar pessoalmente ou por outro canal.
import { idDaChave, juntar } from '@cifra/protocol';
import type { Cripto } from '../portas/cripto.ts';

const VERSAO = new Uint8Array([0, 0]);

export const ITERACOES_DO_NUMERO = 5200;

/** 12 grupos de 5 dígitos. */
export const GRUPOS_DO_NUMERO = 12;

/** Os 30 dígitos de um lado. */
function digitosDe(cripto: Cripto, chave: Uint8Array): string {
  let h = juntar(VERSAO, chave, idDaChave(cripto, chave));
  for (let i = 0; i < ITERACOES_DO_NUMERO; i++) {
    h = cripto.crypto_generichash(64, juntar(h, chave), null);
  }
  let digitos = '';
  for (let pedaco = 0; pedaco < 6; pedaco++) {
    let valor = 0;
    // 5 bytes cabem com folga nos 53 bits exatos de um número do JS.
    for (const byte of h.subarray(pedaco * 5, pedaco * 5 + 5)) valor = valor * 256 + byte;
    digitos += String(valor % 100_000).padStart(5, '0');
  }
  return digitos;
}

/**
 * O número de segurança entre duas chaves Ed25519 de identidade: o mesmo, seja qual for a ordem
 * em que elas chegam.
 */
export function numeroDeSeguranca(
  cripto: Cripto,
  minhaChave: Uint8Array,
  chaveDoContato: Uint8Array,
): string[] {
  const lados = [digitosDe(cripto, minhaChave), digitosDe(cripto, chaveDoContato)].sort();
  const todos = lados.join('');
  return Array.from({ length: GRUPOS_DO_NUMERO }, (_, i) => todos.slice(i * 5, i * 5 + 5));
}

/**
 * O número colado comparado com o daqui (SPEC, "Colar e comparar"): só os 60 dígitos contam, sem
 * os espaços nem as quebras de linha. `incompleto`: só dígitos, mas ainda faltam; `diferente`:
 * tem outra coisa, passa de 60 ou não é o mesmo número.
 */
export type ComparacaoDoNumero = 'vazio' | 'incompleto' | 'confere' | 'diferente';

export function compararNumero(colado: string, grupos: readonly string[]): ComparacaoDoNumero {
  const digitos = colado.replace(/\s/g, '');
  const esperado = grupos.join('');
  if (digitos === '') return 'vazio';
  if (/^\d+$/.test(digitos) && digitos.length < esperado.length) return 'incompleto';
  return digitos === esperado && /^\d{60}$/.test(esperado) ? 'confere' : 'diferente';
}
