// Conformidade da porta Armazenamento: o SQL de que o núcleo depende. Inclui o que a exclusão
// real exige (RNF-08): `secure_delete` ligado, journal DELETE, temporários só na memória e FTS5
// com `secure-delete`, também no índice de conteúdo externo que o esquema do app usa. A busca
// ignora acento, como o usuário espera em português (RF-12).
//
// O adaptador abre o banco já com `secure_delete`, `journal_mode = DELETE` e
// `temp_store = MEMORY`; estas verificações conferem, não ligam. As tabelas usadas aqui são
// apagadas no fim, mesmo quando algo falha.
import type { Armazenamento, LinhaSql } from '../portas/armazenamento.ts';
import { iguais, rodar, type ResultadoDaVerificacao } from './resultado.ts';

const TABELA = 'conformidade_tabela';
const BUSCA = 'conformidade_busca';
const TEXTOS = 'conformidade_textos';
const INDICE = 'conformidade_indice';

async function apagarTabelas(banco: Armazenamento): Promise<void> {
  // O índice antes da tabela de textos: os gatilhos dela escrevem nele.
  for (const tabela of [TABELA, BUSCA, INDICE, TEXTOS]) {
    await banco.executar(`DROP TABLE IF EXISTS ${tabela}`);
  }
}

function primeira(linhas: readonly LinhaSql[]): LinhaSql {
  const [linha] = linhas;
  if (!linha) throw new Error('consulta sem linha');
  return linha;
}

async function contar(banco: Armazenamento, sql: string, parametros: string[] = []) {
  return primeira(await banco.consultar(sql, parametros))['n'];
}

export async function verificarArmazenamento(
  banco: Armazenamento,
): Promise<ResultadoDaVerificacao[]> {
  await apagarTabelas(banco);
  await banco.executar(
    `CREATE TABLE ${TABELA} (id INTEGER PRIMARY KEY, texto TEXT, numero REAL, bytes BLOB, nada TEXT)`,
  );

  try {
    return await rodar({
      'sql.parametros-e-tipos': async () => {
        const bytes = new Uint8Array([0, 1, 2, 250, 255]);
        await banco.executar(
          `INSERT INTO ${TABELA} (id, texto, numero, bytes, nada) VALUES (?, ?, ?, ?, ?)`,
          [1, "aspas ' e acentuação", 1.5, bytes, null],
        );
        const linha = primeira(await banco.consultar(`SELECT * FROM ${TABELA} WHERE id = ?`, [1]));
        const lidos = linha['bytes'];
        return (
          linha['texto'] === "aspas ' e acentuação" &&
          linha['numero'] === 1.5 &&
          linha['nada'] === null &&
          lidos instanceof Uint8Array &&
          iguais(lidos, bytes)
        );
      },

      'sql.linhas-alteradas': async () => {
        await banco.executar(`INSERT INTO ${TABELA} (id, texto) VALUES (2, 'a'), (3, 'a')`);
        const { linhasAlteradas } = await banco.executar(
          `UPDATE ${TABELA} SET texto = 'b' WHERE texto = 'a'`,
        );
        return linhasAlteradas === 2;
      },

      // A cópia de uma conversa para o cofre lê a ordem nova de cada mensagem na mesma ida.
      'sql.insert-devolve-linhas': async () => {
        const linhas = await banco.consultar(
          `INSERT INTO ${TABELA} (id, texto) VALUES (30, ?) RETURNING id, texto`,
          ['devolvida'],
        );
        return (
          linhas.length === 1 &&
          primeira(linhas)['id'] === 30 &&
          primeira(linhas)['texto'] === 'devolvida' &&
          (await contar(banco, `SELECT count(*) AS n FROM ${TABELA} WHERE id = 30`)) === 1
        );
      },

      'transacao.confirma': async () => {
        const devolvido = await banco.transacao(async (t) => {
          await t.executar(`INSERT INTO ${TABELA} (id) VALUES (10)`);
          return 'pronto';
        });
        return (
          devolvido === 'pronto' &&
          (await contar(banco, `SELECT count(*) AS n FROM ${TABELA} WHERE id = 10`)) === 1
        );
      },

      'transacao.desfaz-no-erro': async () => {
        const falha = new Error('falha proposital');
        let repassou = false;
        try {
          await banco.transacao(async (t) => {
            await t.executar(`INSERT INTO ${TABELA} (id) VALUES (20)`);
            throw falha;
          });
        } catch (erro) {
          repassou = erro === falha;
        }
        return (
          repassou &&
          (await contar(banco, `SELECT count(*) AS n FROM ${TABELA} WHERE id = 20`)) === 0
        );
      },

      'pragma.secure-delete': async () =>
        primeira(await banco.consultar('PRAGMA secure_delete'))['secure_delete'] === 1,

      'pragma.journal-delete': async () =>
        primeira(await banco.consultar('PRAGMA journal_mode'))['journal_mode'] === 'delete',

      'pragma.temp-store-memoria': async () =>
        primeira(await banco.consultar('PRAGMA temp_store'))['temp_store'] === 2,

      'fts5.secure-delete-e-sem-acento': async () => {
        await banco.executar(
          `CREATE VIRTUAL TABLE ${BUSCA} USING fts5(texto, tokenize = 'unicode61 remove_diacritics 2')`,
        );
        await banco.executar(`INSERT INTO ${BUSCA}(${BUSCA}, rank) VALUES('secure-delete', 1)`);
        await banco.executar(`INSERT INTO ${BUSCA}(rowid, texto) VALUES (1, ?)`, [
          'Não há café na estação',
        ]);
        const achar = (termo: string) =>
          contar(banco, `SELECT count(*) AS n FROM ${BUSCA} WHERE ${BUSCA} MATCH ?`, [termo]);
        const configurado = primeira(
          await banco.consultar(`SELECT v FROM ${BUSCA}_config WHERE k = 'secure-delete'`),
        )['v'];
        const antes = [await achar('nao'), await achar('CAFE'), await achar('estação')];
        await banco.executar(`DELETE FROM ${BUSCA} WHERE rowid = 1`);
        return configurado === 1 && antes.every((n) => n === 1) && (await achar('cafe')) === 0;
      },

      // Como o esquema do app: o índice não guarda cópia do texto, e os gatilhos da tabela o
      // mantêm em dia, com o comando 'delete' do FTS5 na exclusão.
      'fts5.conteudo-externo-com-gatilhos': async () => {
        await banco.executar(
          `CREATE TABLE ${TEXTOS} (ordem INTEGER PRIMARY KEY, texto TEXT NOT NULL)`,
        );
        await banco.executar(
          `CREATE VIRTUAL TABLE ${INDICE} USING fts5(texto, content = '${TEXTOS}',
            content_rowid = 'ordem', tokenize = 'unicode61 remove_diacritics 2')`,
        );
        await banco.executar(`INSERT INTO ${INDICE}(${INDICE}, rank) VALUES('secure-delete', 1)`);
        await banco.executar(
          `CREATE TRIGGER ${INDICE}_entra AFTER INSERT ON ${TEXTOS} BEGIN
            INSERT INTO ${INDICE} (rowid, texto) VALUES (new.ordem, new.texto);
          END`,
        );
        await banco.executar(
          `CREATE TRIGGER ${INDICE}_sai AFTER DELETE ON ${TEXTOS} BEGIN
            INSERT INTO ${INDICE} (${INDICE}, rowid, texto) VALUES ('delete', old.ordem, old.texto);
          END`,
        );
        await banco.executar(`INSERT INTO ${TEXTOS} (ordem, texto) VALUES (1, ?), (2, ?)`, [
          'Reunião às nove',
          'Café na estação',
        ]);
        const achar = (consulta: string) =>
          contar(banco, `SELECT count(*) AS n FROM ${INDICE} WHERE ${INDICE} MATCH ?`, [consulta]);
        const antes = [await achar('reuniao'), await achar('"caf"*')];
        await banco.executar(`DELETE FROM ${TEXTOS} WHERE ordem = 1`);
        return (
          antes.every((n) => n === 1) &&
          (await achar('reuniao')) === 0 &&
          (await achar('estacao')) === 1
        );
      },
    });
  } finally {
    await apagarTabelas(banco);
  }
}
