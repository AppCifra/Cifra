// Porta do banco local cifrado. No celular é SQLCipher com FTS5; na web (fase 3), SQLite em WASM
// sobre IndexedDB cifrado. O núcleo fala SQL porque a exclusão real depende de recursos do
// SQLite: `secure_delete`, `journal_mode = DELETE` e o `secure-delete` do FTS5 (RNF-08).

/** Valor que entra e sai do banco. */
export type ValorSql = null | number | string | Uint8Array;

/** Uma linha de resultado: nome da coluna para valor. */
export type LinhaSql = Readonly<Record<string, ValorSql>>;

export interface ResultadoDaExecucao {
  /** Quantas linhas a instrução alterou. */
  readonly linhasAlteradas: number;
}

export interface Armazenamento {
  executar(sql: string, parametros?: readonly ValorSql[]): Promise<ResultadoDaExecucao>;
  consultar(sql: string, parametros?: readonly ValorSql[]): Promise<readonly LinhaSql[]>;
  /** Roda `operacao` numa transação: confirma se ela termina, desfaz se ela lança erro. */
  transacao<T>(operacao: (banco: Armazenamento) => Promise<T>): Promise<T>;
}
