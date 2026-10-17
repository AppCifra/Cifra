// Adaptador da porta Armazenamento no Android: op-sqlite com SQLCipher e FTS5 (RNF-07, RNF-08).
// Também o cofre das conversas ocultas, um segundo banco SQLCipher na mesma pasta, com o diário que
// fica no lugar (TRUNCATE) e sem `auto_vacuum`: ele só cresce em blocos (RNF-11).
import type { Armazenamento, CofreAberto, LinhaSql, ValorSql } from '@cifra/core';
import { open, type DB, type Scalar, type Transaction } from '@op-engineering/op-sqlite';
import { arquivoNaoAbre, chaveDoSqlcipher } from './formato.ts';

export interface BancoAberto {
  readonly banco: Armazenamento;
  /** Caminho do arquivo no aparelho. */
  readonly caminho: string;
  /** Fecha a conexão. O SQLCipher apaga da memória nativa a chave que recebeu. */
  fechar(): void;
}

/** O cofre aberto: troca a chave no lugar (`PRAGMA rekey`). */
export interface CofreNoAparelho extends CofreAberto {
  readonly caminho: string;
  fechar(): void;
}

function normalizar(valor: Scalar): ValorSql {
  if (valor === null || typeof valor === 'number' || typeof valor === 'string') return valor;
  if (typeof valor === 'boolean') return valor ? 1 : 0;
  if (valor instanceof ArrayBuffer) return new Uint8Array(valor);
  return new Uint8Array(valor.buffer, valor.byteOffset, valor.byteLength).slice();
}

function linhas(resultado: { rows: Record<string, Scalar>[] }): LinhaSql[] {
  return resultado.rows.map((linha) =>
    Object.fromEntries(Object.entries(linha).map(([coluna, valor]) => [coluna, normalizar(valor)])),
  );
}

function sobre(executar: DB['execute'] | Transaction['execute']): Omit<Armazenamento, 'transacao'> {
  return {
    async executar(sql, parametros = []) {
      const { rowsAffected } = await executar(sql, [...parametros]);
      return { linhasAlteradas: rowsAffected };
    },
    async consultar(sql, parametros = []) {
      return linhas(await executar(sql, [...parametros]));
    },
  };
}

/**
 * Abre o arquivo e liga o que a exclusão real exige, com o diário pedido. A sonda vem antes de
 * qualquer pragma: com a chave errada, nada é escrito no arquivo. Rejeita com `banco-ilegivel`.
 */
async function abrirSqlcipher(
  nome: string,
  chave: Uint8Array | null,
  diario: 'DELETE' | 'TRUNCATE',
): Promise<DB> {
  const db = open(chave ? { name: nome, encryptionKey: chaveDoSqlcipher(chave) } : { name: nome });
  try {
    // O SQLCipher escreve no logcat por padrão (por exemplo, quando uma chave não abre o arquivo).
    // Vale para o processo inteiro; não lê o arquivo.
    await db.execute('PRAGMA cipher_log_level = NONE');
    try {
      // Primeira leitura do arquivo: com a chave errada, ou com o arquivo danificado, falha aqui.
      await db.execute('SELECT count(*) FROM sqlite_schema');
    } catch (erro) {
      if (erro instanceof Error && arquivoNaoAbre(erro.message)) {
        throw new Error('banco-ilegivel', { cause: erro });
      }
      throw erro;
    }
    await db.execute('PRAGMA secure_delete = ON');
    await db.execute(`PRAGMA journal_mode = ${diario}`);
    // O op-sqlite já compila o SQLCipher com os temporários na memória; a pragma deixa isso
    // explícito e é o que o núcleo confere (prepararBanco, prepararCofre).
    await db.execute('PRAGMA temp_store = MEMORY');
  } catch (erro) {
    db.close();
    throw erro;
  }
  return db;
}

function armazenamentoDe(db: DB): Armazenamento {
  const banco: Armazenamento = {
    ...sobre((sql, parametros) => db.execute(sql, parametros)),
    async transacao(operacao) {
      let resultado: Awaited<ReturnType<typeof operacao>> | undefined;
      await db.transaction(async (tx) => {
        resultado = await operacao({
          ...sobre((sql, parametros) => tx.execute(sql, parametros)),
          transacao: () => Promise.reject(new Error('transação dentro de transação')),
        });
      });
      return resultado as Awaited<ReturnType<typeof operacao>>;
    },
  };
  return banco;
}

/**
 * Abre (ou cria) um banco. Com `chave`, o arquivo é cifrado pelo SQLCipher; sem chave, fica em
 * claro (só nos testes de exclusão do spike). Liga o que a exclusão real exige antes de qualquer
 * uso. Rejeita com `banco-ilegivel` quando o arquivo existe e não abre com a chave.
 */
export async function abrirBanco(nome: string, chave: Uint8Array | null): Promise<BancoAberto> {
  const db = await abrirSqlcipher(nome, chave, 'DELETE');
  return {
    banco: armazenamentoDe(db),
    caminho: db.getDbPath(),
    fechar: () => {
      db.close();
    },
  };
}

/**
 * Abre (ou cria) o cofre das conversas ocultas com a chave. Rejeita com `banco-ilegivel` quando o
 * arquivo existe e não abre com ela, sem escrever nada: a busca tenta cada código digitado, e o
 * arquivo fica como estava. O `auto_vacuum` fica no padrão (desligado): o cofre nunca encolhe.
 */
export async function abrirCofre(nome: string, chave: Uint8Array): Promise<CofreNoAparelho> {
  const db = await abrirSqlcipher(nome, chave, 'TRUNCATE');
  return {
    banco: armazenamentoDe(db),
    caminho: db.getDbPath(),
    async trocarChave(nova) {
      await db.execute(`PRAGMA rekey = "${chaveDoSqlcipher(nova)}"`);
    },
    fechar: () => {
      db.close();
    },
  };
}

/** Apaga o arquivo do banco, se existir. Não precisa da chave: o arquivo nem chega a ser lido. */
export function apagarBanco(nome: string): void {
  open({ name: nome }).delete();
}
