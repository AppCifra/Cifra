// Adaptador de referência da porta Armazenamento no Node, sobre o `node:sqlite` embutido no
// Node 24 (SQLite com FTS5). Sem cifra: serve para testar no Node a parte SQL do núcleo.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Armazenamento, LinhaSql, ValorSql } from '../../src/index.ts';

export interface BancoNoArquivo {
  readonly banco: Armazenamento;
  /** Fecha a conexão. O arquivo continua lá. */
  fechar(): void;
}

export interface BancoDeTeste {
  readonly banco: Armazenamento;
  readonly caminho: string;
  /** Fecha a conexão e apaga a pasta temporária. */
  fechar(): void;
}

function normalizar(valor: unknown): ValorSql {
  if (valor === null || typeof valor === 'number' || typeof valor === 'string') return valor;
  if (typeof valor === 'bigint') return Number(valor);
  if (valor instanceof Uint8Array) return new Uint8Array(valor);
  throw new Error('tipo SQL inesperado');
}

/** Pasta temporária nova, para os arquivos de um teste. */
export function pastaTemporaria(): string {
  return mkdtempSync(join(tmpdir(), 'cifra-'));
}

/**
 * Abre (ou cria) o banco no arquivo, com o que a exclusão real exige ligado. Com o `diario`
 * TRUNCATE, como o app abre o cofre das conversas ocultas.
 */
export function abrirBancoNoArquivo(
  caminho: string,
  diario: 'DELETE' | 'TRUNCATE' = 'DELETE',
): BancoNoArquivo {
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA secure_delete = ON');
  db.exec(`PRAGMA journal_mode = ${diario}`);
  db.exec('PRAGMA temp_store = MEMORY');

  const parametros = (lista: readonly ValorSql[]) => lista as SQLInputValue[];

  // Como num adaptador assíncrono de verdade, erro do SQLite vira promessa rejeitada.
  const banco: Armazenamento = {
    executar(sql, lista = []) {
      return new Promise((resolver) => {
        const { changes } = db.prepare(sql).run(...parametros(lista));
        resolver({ linhasAlteradas: Number(changes) });
      });
    },
    consultar(sql, lista = []) {
      return new Promise((resolver) => {
        const linhas = db.prepare(sql).all(...parametros(lista));
        resolver(
          linhas.map((linha): LinhaSql =>
            Object.fromEntries(Object.entries(linha).map(([k, v]) => [k, normalizar(v)])),
          ),
        );
      });
    },
    async transacao(operacao) {
      db.exec('BEGIN');
      try {
        const resultado = await operacao(banco);
        db.exec('COMMIT');
        return resultado;
      } catch (erro) {
        db.exec('ROLLBACK');
        throw erro;
      }
    },
  };

  return {
    banco,
    fechar() {
      db.close();
    },
  };
}

/**
 * O mesmo banco, contando as idas a ele: cada instrução, dentro ou fora de transação. No aparelho,
 * cada ida atravessa a ponte até o SQLCipher.
 */
export function contandoAsIdas(banco: Armazenamento): {
  readonly banco: Armazenamento;
  idas(): number;
} {
  let idas = 0;
  const contar = (alvo: Armazenamento): Armazenamento => ({
    executar(sql, parametros) {
      idas++;
      return alvo.executar(sql, parametros);
    },
    consultar(sql, parametros) {
      idas++;
      return alvo.consultar(sql, parametros);
    },
    transacao(operacao) {
      return alvo.transacao((t) => operacao(contar(t)));
    },
  });
  return { banco: contar(banco), idas: () => idas };
}

/** Abre um banco novo num arquivo temporário. */
export function abrirBancoDeTeste(): BancoDeTeste {
  const pasta = pastaTemporaria();
  const caminho = join(pasta, 'teste.sqlite');
  const aberto = abrirBancoNoArquivo(caminho);
  return {
    banco: aberto.banco,
    caminho,
    fechar() {
      aberto.fechar();
      rmSync(pasta, { recursive: true, force: true });
    },
  };
}
