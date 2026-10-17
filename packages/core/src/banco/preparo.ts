// Antes de usar o banco principal: confere o que a exclusão real exige e leva o esquema até a
// versão atual. O adaptador de cada plataforma liga estas pragmas ao abrir; o núcleo confere,
// porque sem elas um DELETE deixaria o conteúdo apagado no arquivo (RNF-08). Banco sem elas não
// abre: nunca há exclusão de mentira.
import type { Armazenamento } from '../portas/armazenamento.ts';
import { migrar } from './migracoes.ts';

/** Cada pragma e o valor que o SQLite devolve quando ela está como a exclusão real exige. */
const EXIGIDAS: readonly (readonly [string, number | string])[] = [
  // Apagar sobrescreve o conteúdo com zeros, inclusive nas páginas que ficam livres.
  ['secure_delete', 1],
  // Sem WAL: nada apagado sobra num arquivo ao lado do banco.
  ['journal_mode', 'delete'],
  // Ordenações e tabelas temporárias só na memória, nunca num arquivo temporário.
  ['temp_store', 2],
];

/** `auto_vacuum` incremental: o arquivo pode devolver as páginas livres. */
const VACUO_INCREMENTAL = 2;

/**
 * Confere as pragmas e migra. Rejeita, sem mexer no banco, se alguma faltar. O banco encolhe quando
 * os anexos saem: um banco sem o `auto_vacuum` incremental passa para ele com um VACUUM, uma vez
 * só, quando ainda não tem anexo nenhum.
 */
export async function prepararBanco(banco: Armazenamento): Promise<void> {
  for (const [pragma, valor] of EXIGIDAS) {
    const [linha] = await banco.consultar(`PRAGMA ${pragma}`);
    if (linha?.[pragma] !== valor) throw new Error(`banco sem ${pragma}`);
  }
  await migrar(banco);
  const [vacuo] = await banco.consultar('PRAGMA auto_vacuum');
  if (vacuo?.['auto_vacuum'] !== VACUO_INCREMENTAL) {
    await banco.executar('PRAGMA auto_vacuum = INCREMENTAL');
    await banco.executar('VACUUM');
  }
}

/**
 * O que o cofre das conversas ocultas exige. Como no principal, o que é apagado é sobrescrito e
 * nada vai para arquivo temporário. Mas o diário fica no lugar, com 0 byte, entre uma transação e
 * outra (TRUNCATE), e o arquivo nunca encolhe (sem `auto_vacuum`): ele só cresce de bloco em bloco,
 * e o tamanho não diz quanto está em uso (RNF-11).
 */
const EXIGIDAS_NO_COFRE: readonly (readonly [string, number | string])[] = [
  ['secure_delete', 1],
  ['journal_mode', 'truncate'],
  ['temp_store', 2],
  ['auto_vacuum', 0],
];

/**
 * Confere as pragmas do cofre e migra: o cofre tem o mesmo esquema do principal. Rejeita, sem
 * mexer no banco, se alguma faltar. Quem chama completa o bloco depois.
 */
export async function prepararCofre(banco: Armazenamento): Promise<void> {
  for (const [pragma, valor] of EXIGIDAS_NO_COFRE) {
    const [linha] = await banco.consultar(`PRAGMA ${pragma}`);
    if (linha?.[pragma] !== valor) throw new Error(`cofre sem ${pragma}`);
  }
  await migrar(banco);
}

/**
 * Devolve ao sistema as páginas que ficaram livres (já zeradas pelo `secure_delete`): o tamanho
 * do arquivo não guarda quanto já esteve nele. Fora de transação.
 */
export async function encolherBanco(banco: Armazenamento): Promise<void> {
  await banco.consultar('PRAGMA incremental_vacuum');
}
