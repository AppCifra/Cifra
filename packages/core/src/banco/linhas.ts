// Leitura das colunas de uma linha do banco, conferindo o tipo. Coluna com tipo errado só aparece
// com o banco corrompido: lança.
import type { LinhaSql } from '../portas/armazenamento.ts';

export function bytesDe(linha: LinhaSql, coluna: string): Uint8Array {
  const valor = linha[coluna];
  if (!(valor instanceof Uint8Array)) throw new Error(`coluna ${coluna} sem bytes`);
  return valor;
}

export function numeroDe(linha: LinhaSql, coluna: string): number {
  const valor = linha[coluna];
  if (typeof valor !== 'number') throw new Error(`coluna ${coluna} sem número`);
  return valor;
}

export function numeroOuNulo(linha: LinhaSql, coluna: string): number | null {
  const valor = linha[coluna];
  if (valor === null) return null;
  if (typeof valor !== 'number') throw new Error(`coluna ${coluna} sem número`);
  return valor;
}

export function textoDe(linha: LinhaSql, coluna: string): string {
  const valor = linha[coluna];
  if (typeof valor !== 'string') throw new Error(`coluna ${coluna} sem texto`);
  return valor;
}
