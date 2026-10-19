// Banco do relay, no SQLite que vem com o Node (node:sqlite). Guarda só o que a entrega precisa:
// cartões, one-time prekeys, caixas, pacotes cifrados e anexos cifrados. Nenhuma coluna de
// remetente, IP ou conexão (RNF-03), e as datas ficam só na hora cheia, sem dizer em que minuto
// algo chegou.
//
// O que é apagado some do arquivo: `secure_delete` sobrescreve com zeros, e o journal DELETE não
// deixa cópia num WAL (RNF-14).
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { iguais, lerCartao, type ModoDaPublicacao, type Prekey } from '@cifra/protocol';

const MIGRACOES: readonly (readonly string[])[] = [
  // 1. Cartões, prekeys, caixas e pacotes.
  [
    `CREATE TABLE cartoes (
      id BLOB PRIMARY KEY CHECK (length(id) = 10),
      cartao BLOB NOT NULL,
      data INTEGER NOT NULL,
      expira_em INTEGER NOT NULL
    ) STRICT, WITHOUT ROWID`,
    `CREATE TABLE prekeys (
      cartao BLOB NOT NULL REFERENCES cartoes (id) ON DELETE CASCADE,
      numero INTEGER NOT NULL,
      chave BLOB NOT NULL CHECK (length(chave) = 32),
      PRIMARY KEY (cartao, numero)
    ) STRICT, WITHOUT ROWID`,
    `CREATE TABLE caixas (
      chave BLOB PRIMARY KEY CHECK (length(chave) = 32),
      expira_em INTEGER NOT NULL
    ) STRICT, WITHOUT ROWID`,
    // A ordem só serve para entregar na ordem de chegada.
    `CREATE TABLE pacotes (
      ordem INTEGER PRIMARY KEY,
      caixa BLOB NOT NULL REFERENCES caixas (chave) ON DELETE CASCADE,
      id BLOB NOT NULL CHECK (length(id) = 16),
      pacote BLOB NOT NULL CHECK (length(pacote) = 4096),
      expira_em INTEGER NOT NULL,
      UNIQUE (caixa, id)
    ) STRICT`,
    'CREATE INDEX pacotes_por_caixa ON pacotes (caixa, ordem)',
    'CREATE INDEX pacotes_por_prazo ON pacotes (expira_em)',
    'CREATE INDEX cartoes_por_prazo ON cartoes (expira_em)',
    'CREATE INDEX caixas_por_prazo ON caixas (expira_em)',
  ],
  // 2. Anexos. O ID é o BLAKE2b do token: o banco não guarda o token, que daria para baixar. O blob
  // fica em pedaços de 64 KiB, gravados à medida que chegam e lidos um de cada vez: nenhum anexo
  // inteiro passa pela memória, e o que é apagado sai pelo secure_delete. Enquanto sobe, o anexo
  // fica incompleto e ninguém baixa.
  [
    `CREATE TABLE anexos (
      id BLOB PRIMARY KEY CHECK (length(id) = 32),
      tamanho INTEGER NOT NULL,
      completo INTEGER NOT NULL CHECK (completo IN (0, 1)),
      expira_em INTEGER NOT NULL
    ) STRICT, WITHOUT ROWID`,
    `CREATE TABLE pedacos (
      anexo BLOB NOT NULL REFERENCES anexos (id) ON DELETE CASCADE,
      indice INTEGER NOT NULL,
      dados BLOB NOT NULL,
      UNIQUE (anexo, indice)
    ) STRICT`,
    'CREATE INDEX anexos_por_prazo ON anexos (expira_em)',
  ],
  // 3. Marca de aviso: 1 byte selado para a chave da caixa, que o relay guarda e repassa sem abrir.
  // O pacote de antes dela fica com uma marca de zeros, que não abre: o aparelho avisa.
  [
    `ALTER TABLE pacotes ADD COLUMN marca BLOB NOT NULL
       DEFAULT x'${'00'.repeat(49)}' CHECK (length(marca) = 49)`,
  ],
];

export interface NovaPublicacao {
  /** O ID em bytes, derivado da chave de identidade do cartão. */
  readonly id: Uint8Array;
  readonly cartao: Uint8Array;
  /** A caixa principal do cartão novo. */
  readonly caixa: Uint8Array;
  readonly data: number;
  readonly expiraEm: number;
  readonly modo: ModoDaPublicacao;
  readonly prekeys: readonly Prekey[];
  readonly maximoDePrekeys: number;
}

/**
 * - `caixaSubstituida`: a caixa principal do cartão anterior, quando o novo trouxe outra (RF-05).
 *   Ela já saiu do banco, com os pacotes: o aparelho novo não decifraria nenhum.
 * - `caixa-substituida`: a publicação traz outra caixa sem ser `substituir`; nada muda.
 */
export type ResultadoDaPublicacao =
  | { readonly prekeysGuardadas: number; readonly caixaSubstituida: Uint8Array | null }
  | 'cartao-antigo'
  | 'prekeys-recusadas'
  | 'caixa-substituida';

export interface CartaoGuardado {
  readonly cartao: Uint8Array;
  /** A one-time prekey entregue nesta busca, já apagada do banco. */
  readonly prekey: Prekey | null;
}

export interface NovoPacote {
  readonly caixa: Uint8Array;
  readonly id: Uint8Array;
  readonly pacote: Uint8Array;
  /** A marca de aviso, selada para a chave da caixa: o relay não abre. */
  readonly marca: Uint8Array;
  readonly expiraEm: number;
  readonly maximoNaCaixa: number;
}

/** `repetido`: o mesmo pacote já estava na caixa, e nada mudou. */
export type ResultadoDoDeposito = 'novo' | 'repetido' | 'caixa-inexistente' | 'caixa-cheia';

export interface PacoteGuardado {
  readonly id: Uint8Array;
  readonly pacote: Uint8Array;
  readonly marca: Uint8Array;
}

/**
 * - `existe`: já há um anexo completo com esse token; nada muda.
 * - `subindo`: o anexo com esse token ainda está subindo, por outro envio; nada muda.
 * - `sem-espaco`: o espaço dos anexos acabaria; nada muda.
 */
export type InicioDoAnexo = 'ok' | 'existe' | 'subindo' | 'sem-espaco';

export interface AnexoGuardado {
  readonly tamanho: number;
  readonly pedacos: number;
}

export interface Banco {
  /**
   * Guarda o cartão mais novo e as prekeys. Um aparelho por ID: só `substituir` troca a caixa
   * principal, e a caixa anterior sai na mesma transação.
   */
  publicarCartao(publicacao: NovaPublicacao): ResultadoDaPublicacao;
  /** Devolve o cartão com uma one-time prekey, que sai do banco: cada uma é entregue uma vez. */
  buscarCartao(id: Uint8Array): CartaoGuardado | null;
  /**
   * Pânico: apaga o cartão do ID, as prekeys, a caixa principal do cartão e os pacotes dela, numa
   * transação. Devolve a caixa apagada, ou `null` se o ID não tinha cartão.
   */
  apagarTudo(id: Uint8Array): Uint8Array | null;
  /** Cria a caixa se ela não existe. Criar de novo não muda nada, nem o prazo. */
  criarCaixa(caixa: Uint8Array, expiraEm: number): void;
  /** Adia o prazo da caixa. Devolve `false` se ela não existe. */
  renovarCaixa(caixa: Uint8Array, expiraEm: number): boolean;
  depositar(pacote: NovoPacote): ResultadoDoDeposito;
  /** Os pacotes mais antigos da caixa, na ordem de chegada. */
  pendentes(caixa: Uint8Array, limite: number): PacoteGuardado[];
  contarPacotes(caixa: Uint8Array): number;
  /** Apaga os pacotes confirmados. ID que não está na caixa é ignorado. */
  confirmar(caixa: Uint8Array, ids: readonly Uint8Array[]): void;
  /** Apaga pacotes, cartões (com as prekeys), caixas (com os pacotes) e anexos vencidos. */
  apagarVencidos(agora: number): void;
  /** Reserva o anexo, ainda incompleto, se ele não existe e cabe em `espaco` bytes. */
  comecarAnexo(id: Uint8Array, tamanho: number, expiraEm: number, espaco: number): InicioDoAnexo;
  /** Grava pedaços do anexo, a partir do número `primeiro`, numa transação. */
  guardarPedacos(id: Uint8Array, primeiro: number, pedacos: readonly Uint8Array[]): void;
  /** O anexo chegou inteiro: passa a ser baixado. */
  concluirAnexo(id: Uint8Array): void;
  /** Apaga o anexo, completo ou não, com os pedaços. Devolve `false` se ele não existia. */
  apagarAnexo(id: Uint8Array): boolean;
  /** O anexo completo, ou `null`. */
  anexo(id: Uint8Array): AnexoGuardado | null;
  pedaco(id: Uint8Array, indice: number): Uint8Array | null;
  /** Ao subir: o que estava subindo quando o relay caiu não volta. */
  apagarIncompletos(): void;
  fechar(): void;
}

type Linha = Record<string, SQLOutputValue>;

function bytes(linha: Linha | undefined, coluna: string): Uint8Array {
  const valor = linha?.[coluna];
  if (!(valor instanceof Uint8Array)) throw new Error('coluna sem bytes');
  return new Uint8Array(valor);
}

function numero(linha: Linha | undefined, coluna: string): number {
  const valor = linha?.[coluna];
  if (typeof valor !== 'number') throw new Error('coluna sem número');
  return valor;
}

function migrar(db: DatabaseSync): void {
  const versao = numero(db.prepare('PRAGMA user_version').get(), 'user_version');
  if (versao > MIGRACOES.length) throw new Error('banco de uma versão mais nova do relay');
  for (const [indice, comandos] of MIGRACOES.entries()) {
    if (indice < versao) continue;
    db.exec('BEGIN');
    try {
      for (const comando of comandos) db.exec(comando);
      db.exec(`PRAGMA user_version = ${indice + 1}`);
      db.exec('COMMIT');
    } catch (erro) {
      db.exec('ROLLBACK');
      throw erro;
    }
  }
}

/** Abre (ou cria) o banco do relay no arquivo, com o que a exclusão real exige ligado. */
export function abrirBanco(caminho: string): Banco {
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA journal_mode = DELETE');
  db.exec('PRAGMA secure_delete = ON');
  db.exec('PRAGMA foreign_keys = ON');
  migrar(db);

  const sql = {
    cartaoGuardado: db.prepare('SELECT cartao, data FROM cartoes WHERE id = ?'),
    guardarCartao: db.prepare(
      `INSERT INTO cartoes (id, cartao, data, expira_em) VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         cartao = excluded.cartao, data = excluded.data, expira_em = excluded.expira_em`,
    ),
    apagarPrekeys: db.prepare('DELETE FROM prekeys WHERE cartao = ?'),
    contarPrekeys: db.prepare('SELECT count(*) AS n FROM prekeys WHERE cartao = ?'),
    prekeyExiste: db.prepare('SELECT 1 AS existe FROM prekeys WHERE cartao = ? AND numero = ?'),
    guardarPrekey: db.prepare('INSERT INTO prekeys (cartao, numero, chave) VALUES (?, ?, ?)'),
    cartao: db.prepare('SELECT cartao FROM cartoes WHERE id = ?'),
    apagarCartao: db.prepare('DELETE FROM cartoes WHERE id = ?'),
    consumirPrekey: db.prepare(
      `DELETE FROM prekeys WHERE cartao = ?1
         AND numero = (SELECT min(numero) FROM prekeys WHERE cartao = ?1)
       RETURNING numero, chave`,
    ),
    criarCaixa: db.prepare(
      'INSERT INTO caixas (chave, expira_em) VALUES (?, ?) ON CONFLICT (chave) DO NOTHING',
    ),
    renovarCaixa: db.prepare('UPDATE caixas SET expira_em = ? WHERE chave = ?'),
    apagarCaixa: db.prepare('DELETE FROM caixas WHERE chave = ?'),
    caixaExiste: db.prepare('SELECT 1 AS existe FROM caixas WHERE chave = ?'),
    pacoteExiste: db.prepare('SELECT 1 AS existe FROM pacotes WHERE caixa = ? AND id = ?'),
    contarPacotes: db.prepare('SELECT count(*) AS n FROM pacotes WHERE caixa = ?'),
    guardarPacote: db.prepare(
      'INSERT INTO pacotes (caixa, id, pacote, marca, expira_em) VALUES (?, ?, ?, ?, ?)',
    ),
    pendentes: db.prepare(
      'SELECT id, pacote, marca FROM pacotes WHERE caixa = ? ORDER BY ordem LIMIT ?',
    ),
    apagarPacote: db.prepare('DELETE FROM pacotes WHERE caixa = ? AND id = ?'),
    pacotesVencidos: db.prepare('DELETE FROM pacotes WHERE expira_em <= ?'),
    cartoesVencidos: db.prepare('DELETE FROM cartoes WHERE expira_em <= ?'),
    caixasVencidas: db.prepare('DELETE FROM caixas WHERE expira_em <= ?'),
    anexosVencidos: db.prepare('DELETE FROM anexos WHERE expira_em <= ?'),
    anexoExiste: db.prepare('SELECT completo FROM anexos WHERE id = ?'),
    espacoUsado: db.prepare('SELECT coalesce(sum(tamanho), 0) AS n FROM anexos'),
    reservarAnexo: db.prepare(
      'INSERT INTO anexos (id, tamanho, completo, expira_em) VALUES (?, ?, 0, ?)',
    ),
    guardarPedaco: db.prepare('INSERT INTO pedacos (anexo, indice, dados) VALUES (?, ?, ?)'),
    concluirAnexo: db.prepare('UPDATE anexos SET completo = 1 WHERE id = ?'),
    apagarAnexo: db.prepare('DELETE FROM anexos WHERE id = ?'),
    anexoCompleto: db.prepare(
      `SELECT tamanho, (SELECT count(*) FROM pedacos WHERE anexo = ?1) AS pedacos
         FROM anexos WHERE id = ?1 AND completo = 1`,
    ),
    pedaco: db.prepare('SELECT dados FROM pedacos WHERE anexo = ? AND indice = ?'),
    anexosIncompletos: db.prepare('DELETE FROM anexos WHERE completo = 0'),
  };

  /** Roda `operacao` numa transação. Se ela devolver `desfazer`, nada do que fez fica. */
  function transacao<T>(operacao: () => T, desfazer: (resultado: T) => boolean = () => false): T {
    db.exec('BEGIN IMMEDIATE');
    let resultado: T;
    try {
      resultado = operacao();
    } catch (erro) {
      db.exec('ROLLBACK');
      throw erro;
    }
    db.exec(desfazer(resultado) ? 'ROLLBACK' : 'COMMIT');
    return resultado;
  }

  const contar = (linha: Linha | undefined) => numero(linha, 'n');

  return {
    publicarCartao(publicacao) {
      const { id, prekeys } = publicacao;
      return transacao(
        (): ResultadoDaPublicacao => {
          const guardado = sql.cartaoGuardado.get(id);
          // O cartão guardado foi conferido ao entrar; só lê a caixa dele.
          const anterior = guardado ? lerCartao(bytes(guardado, 'cartao')) : null;
          const outraCaixa =
            anterior !== null && !iguais(anterior.caixaPrincipal, publicacao.caixa);
          // Antes da data: o aparelho trocado descobre isso na primeira renovação.
          if (outraCaixa && publicacao.modo !== 'substituir') return 'caixa-substituida';
          if (guardado && numero(guardado, 'data') >= publicacao.data) return 'cartao-antigo';
          if (publicacao.modo === 'substituir') sql.apagarPrekeys.run(id);
          const existentes = contar(sql.contarPrekeys.get(id));
          if (
            existentes + prekeys.length > publicacao.maximoDePrekeys ||
            prekeys.some((prekey) => sql.prekeyExiste.get(id, prekey.numero))
          ) {
            return 'prekeys-recusadas';
          }
          sql.guardarCartao.run(id, publicacao.cartao, publicacao.data, publicacao.expiraEm);
          for (const prekey of prekeys) sql.guardarPrekey.run(id, prekey.numero, prekey.chave);
          const caixaSubstituida = outraCaixa ? anterior.caixaPrincipal : null;
          if (caixaSubstituida) sql.apagarCaixa.run(caixaSubstituida);
          return { prekeysGuardadas: existentes + prekeys.length, caixaSubstituida };
        },
        (resultado) => typeof resultado === 'string',
      );
    },

    buscarCartao(id) {
      return transacao(() => {
        const linha = sql.cartao.get(id);
        if (!linha) return null;
        const prekey = sql.consumirPrekey.get(id);
        return {
          cartao: bytes(linha, 'cartao'),
          prekey: prekey
            ? { numero: numero(prekey, 'numero'), chave: bytes(prekey, 'chave') }
            : null,
        };
      });
    },

    apagarTudo(id) {
      return transacao(() => {
        const linha = sql.cartao.get(id);
        // O cartão guardado foi conferido ao entrar; só lê a caixa dele.
        const cartao = linha ? lerCartao(bytes(linha, 'cartao')) : null;
        if (!cartao) return null;
        // As prekeys saem junto com o cartão, e os pacotes junto com a caixa (ON DELETE CASCADE).
        sql.apagarCartao.run(id);
        sql.apagarCaixa.run(cartao.caixaPrincipal);
        return cartao.caixaPrincipal;
      });
    },

    criarCaixa(caixa, expiraEm) {
      sql.criarCaixa.run(caixa, expiraEm);
    },

    renovarCaixa(caixa, expiraEm) {
      return Number(sql.renovarCaixa.run(expiraEm, caixa).changes) > 0;
    },

    depositar(novo) {
      return transacao((): ResultadoDoDeposito => {
        if (!sql.caixaExiste.get(novo.caixa)) return 'caixa-inexistente';
        if (sql.pacoteExiste.get(novo.caixa, novo.id)) return 'repetido';
        if (contar(sql.contarPacotes.get(novo.caixa)) >= novo.maximoNaCaixa) return 'caixa-cheia';
        sql.guardarPacote.run(novo.caixa, novo.id, novo.pacote, novo.marca, novo.expiraEm);
        return 'novo';
      });
    },

    pendentes(caixa, limite) {
      return sql.pendentes.all(caixa, limite).map((linha) => ({
        id: bytes(linha, 'id'),
        pacote: bytes(linha, 'pacote'),
        marca: bytes(linha, 'marca'),
      }));
    },

    contarPacotes(caixa) {
      return contar(sql.contarPacotes.get(caixa));
    },

    confirmar(caixa, ids) {
      transacao(() => {
        for (const id of ids) sql.apagarPacote.run(caixa, id);
      });
    },

    apagarVencidos(agora) {
      transacao(() => {
        sql.pacotesVencidos.run(agora);
        sql.cartoesVencidos.run(agora);
        sql.caixasVencidas.run(agora);
        sql.anexosVencidos.run(agora);
      });
    },

    comecarAnexo(id, tamanho, expiraEm, espaco) {
      return transacao((): InicioDoAnexo => {
        const existente = sql.anexoExiste.get(id);
        if (existente) return numero(existente, 'completo') === 1 ? 'existe' : 'subindo';
        if (contar(sql.espacoUsado.get()) + tamanho > espaco) return 'sem-espaco';
        sql.reservarAnexo.run(id, tamanho, expiraEm);
        return 'ok';
      });
    },

    guardarPedacos(id, primeiro, pedacos) {
      transacao(() => {
        for (const [i, dados] of pedacos.entries()) sql.guardarPedaco.run(id, primeiro + i, dados);
      });
    },

    concluirAnexo(id) {
      sql.concluirAnexo.run(id);
    },

    apagarAnexo(id) {
      return Number(sql.apagarAnexo.run(id).changes) > 0;
    },

    anexo(id) {
      const linha = sql.anexoCompleto.get(id);
      return linha
        ? { tamanho: numero(linha, 'tamanho'), pedacos: numero(linha, 'pedacos') }
        : null;
    },

    pedaco(id, indice) {
      const linha = sql.pedaco.get(id, indice);
      return linha ? bytes(linha, 'dados') : null;
    },

    apagarIncompletos() {
      sql.anexosIncompletos.run();
    },

    fechar() {
      db.close();
    },
  };
}
