// O que a tela mostra do backup (RF-46, RF-47), sem React: o nome sugerido do arquivo, com a data de
// hoje, e o resumo do backup escolhido na restauração.
import type { ConteudoDoBackup } from '@cifra/core';
import { dataComAno } from './formato-da-conversa.ts';
import type { Traduzir } from './i18n.ts';

const doisDigitos = (n: number) => String(n).padStart(2, '0');

/** O nome sugerido no "salvar como": "Cifra backup 2026-10-15", na data deste aparelho. */
export function nomeDoBackup(t: Traduzir, instante: number): string {
  const data = new Date(instante);
  const dia = `${String(data.getFullYear())}-${doisDigitos(data.getMonth() + 1)}-${doisDigitos(data.getDate())}`;
  return t('ajustes.backup.arquivo', { data: dia });
}

/** "backup de 15/10/2026 · 12 contatos". Os IDs bloqueados que vieram de pedidos não contam. */
export function resumoDoBackup(t: Traduzir, backup: ConteudoDoBackup): string {
  const n = backup.contatos.filter((contato) => contato.aceito).length;
  const data = dataComAno(t, backup.criadoEm);
  return n === 1
    ? t('restaurar.restaurada.backupUm', { data })
    : t('restaurar.restaurada.backup', { data, n });
}
