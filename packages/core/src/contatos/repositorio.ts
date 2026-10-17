// Os contatos no banco cifrado (migração 4). Só existem aqui: nada vai para a agenda do sistema
// (RF-10), e o apelido nunca sai do aparelho (RF-09). Todas recebem o banco de quem chama, que
// pode ser uma transação.
import { bytesDe, numeroDe } from '../banco/linhas.ts';
import type { Armazenamento, LinhaSql } from '../portas/armazenamento.ts';

/** Um apelido tem de 1 a 40 caracteres. */
export const LIMITE_DO_APELIDO = 40;

export interface Contato {
  /** O ID em bytes. */
  readonly contato: Uint8Array;
  /** `false`: um pedido de conversa, de quem escreveu sem ser contato (RF-07). */
  readonly aceito: boolean;
  readonly bloqueado: boolean;
  readonly verificado: boolean;
  readonly apelido: string | null;
  /** Quando entrou, no relógio deste aparelho. */
  readonly criadoEm: number;
  /** O timer das mensagens temporárias da conversa, em segundos; 0 é sem timer (RF-25). */
  readonly timer: number;
  /** Quando o timer mudou, no relógio de quem mudou; 0 se nunca mudou. Vale a mudança mais nova. */
  readonly timerDesde: number;
  /** O timer padrão ainda não foi avisado ao contato: sai junto com a primeira mensagem. */
  readonly timerPorAvisar: boolean;
  /** Prints bloqueados nesta conversa, nos dois celulares (RF-58). */
  readonly printsBloqueados: boolean;
  /** Quando os prints mudaram, no relógio de quem mudou; 0 se nunca. Vale a mudança mais nova. */
  readonly printsDesde: number;
  /**
   * O `enviadaEm` mais novo das mensagens que chegaram dele, no relógio dele; 0 se nenhuma. Vai no
   * pedido de apagar a conversa nos dois celulares (RF-59).
   */
  readonly recebidasAte: number;
  /**
   * A caixa que o contato pediu para esta conversa: a de uma conversa oculta do lado dele. `null`:
   * a caixa principal do cartão dele.
   */
  readonly caixa: Uint8Array | null;
  /** Quando o contato pediu a caixa, no relógio dele; 0 se nunca. Vale o pedido mais novo. */
  readonly caixaDesde: number;
}

export const COLUNAS_DO_CONTATO =
  'contato, aceito, bloqueado, verificado, apelido, criado_em, timer, timer_desde, timer_por_avisar, ' +
  'prints_bloqueados, prints_desde, recebidas_ate, caixa, caixa_desde';

export function contatoDaLinha(linha: LinhaSql): Contato {
  const apelido = linha['apelido'];
  if (apelido !== null && typeof apelido !== 'string') throw new Error('apelido ilegível');
  const caixa = linha['caixa'];
  if (caixa !== null && !(caixa instanceof Uint8Array)) throw new Error('caixa ilegível');
  return {
    contato: bytesDe(linha, 'contato'),
    aceito: numeroDe(linha, 'aceito') === 1,
    bloqueado: numeroDe(linha, 'bloqueado') === 1,
    verificado: numeroDe(linha, 'verificado') === 1,
    apelido,
    criadoEm: numeroDe(linha, 'criado_em'),
    timer: numeroDe(linha, 'timer'),
    timerDesde: numeroDe(linha, 'timer_desde'),
    timerPorAvisar: numeroDe(linha, 'timer_por_avisar') === 1,
    printsBloqueados: numeroDe(linha, 'prints_bloqueados') === 1,
    printsDesde: numeroDe(linha, 'prints_desde'),
    recebidasAte: numeroDe(linha, 'recebidas_ate'),
    caixa,
    caixaDesde: numeroDe(linha, 'caixa_desde'),
  };
}

/** O timer novo da conversa com o contato, de quando ele é e se ainda falta avisar o contato. */
export async function mudarTimerDoContato(
  banco: Armazenamento,
  contato: Uint8Array,
  timer: { readonly segundos: number; readonly desde: number; readonly porAvisar: boolean },
): Promise<void> {
  await banco.executar(
    'UPDATE contatos SET timer = ?, timer_desde = ?, timer_por_avisar = ? WHERE contato = ?',
    [timer.segundos, timer.desde, timer.porAvisar ? 1 : 0, contato],
  );
}

/** Prints bloqueados ou liberados na conversa com o contato (RF-58), e de quando é a mudança. */
export async function mudarPrintsDoContato(
  banco: Armazenamento,
  contato: Uint8Array,
  prints: { readonly bloqueados: boolean; readonly desde: number },
): Promise<void> {
  await banco.executar(
    'UPDATE contatos SET prints_bloqueados = ?, prints_desde = ? WHERE contato = ?',
    [prints.bloqueados ? 1 : 0, prints.desde, contato],
  );
}

/** Chegou mensagem do contato enviada em `enviadaEm`, no relógio dele (RF-59). */
export async function marcarRecebidaAte(
  banco: Armazenamento,
  contato: Uint8Array,
  enviadaEm: number,
): Promise<void> {
  await banco.executar(
    'UPDATE contatos SET recebidas_ate = max(recebidas_ate, ?) WHERE contato = ?',
    [enviadaEm, contato],
  );
}

/**
 * O contato pediu outra caixa para a conversa: a de uma conversa oculta do lado dele, ou `null`
 * para a do cartão. `desde` é a hora do pedido, no relógio dele.
 */
export async function mudarCaixaDoContato(
  banco: Armazenamento,
  contato: Uint8Array,
  caixa: { readonly caixa: Uint8Array | null; readonly desde: number },
): Promise<void> {
  await banco.executar('UPDATE contatos SET caixa = ?, caixa_desde = ? WHERE contato = ?', [
    caixa.caixa,
    caixa.desde,
    contato,
  ]);
}

/**
 * Esquece a caixa que o contato pediu: ele abriu uma sessão nova ou trocou de aparelho, e o aparelho
 * novo não lê a caixa de antes. A hora do último pedido fica: um pedido velho não volta.
 */
export async function esquecerCaixaDoContato(
  banco: Armazenamento,
  contato: Uint8Array,
): Promise<void> {
  await banco.executar('UPDATE contatos SET caixa = NULL WHERE contato = ?', [contato]);
}

/** O contato já sabe do timer: o aviso saiu na fila. */
export async function marcarTimerAvisado(banco: Armazenamento, contato: Uint8Array): Promise<void> {
  await banco.executar('UPDATE contatos SET timer_por_avisar = 0 WHERE contato = ?', [contato]);
}

export async function contatoDe(
  banco: Armazenamento,
  contato: Uint8Array,
): Promise<Contato | null> {
  const [linha] = await banco.consultar(
    `SELECT ${COLUNAS_DO_CONTATO} FROM contatos WHERE contato = ?`,
    [contato],
  );
  return linha ? contatoDaLinha(linha) : null;
}

/** Contato aceito: novo, ou um pedido que passa a contato. Não mexe no bloqueio. */
export async function aceitarContato(
  banco: Armazenamento,
  contato: Uint8Array,
  agora: number,
): Promise<void> {
  await banco.executar(
    `INSERT INTO contatos (contato, aceito, criado_em) VALUES (?, 1, ?)
     ON CONFLICT (contato) DO UPDATE SET aceito = 1`,
    [contato, agora],
  );
}

/** Quem escreveu sem ser contato vira pedido. Devolve `false` se o ID já estava aqui. */
export async function registrarPedido(
  banco: Armazenamento,
  contato: Uint8Array,
  agora: number,
): Promise<boolean> {
  const { linhasAlteradas } = await banco.executar(
    'INSERT OR IGNORE INTO contatos (contato, aceito, criado_em) VALUES (?, 0, ?)',
    [contato, agora],
  );
  return linhasAlteradas === 1;
}

/** Bloqueia um ID, mesmo um que nunca escreveu: a linha nasce como não aceita. */
export async function bloquearContato(
  banco: Armazenamento,
  contato: Uint8Array,
  agora: number,
): Promise<void> {
  await banco.executar(
    `INSERT INTO contatos (contato, aceito, bloqueado, criado_em) VALUES (?, 0, 1, ?)
     ON CONFLICT (contato) DO UPDATE SET bloqueado = 1`,
    [contato, agora],
  );
}

export async function desbloquearContato(banco: Armazenamento, contato: Uint8Array): Promise<void> {
  await banco.executar('UPDATE contatos SET bloqueado = 0 WHERE contato = ?', [contato]);
}

export async function marcarVerificado(
  banco: Armazenamento,
  contato: Uint8Array,
  verificado: boolean,
): Promise<boolean> {
  const { linhasAlteradas } = await banco.executar(
    'UPDATE contatos SET verificado = ? WHERE contato = ?',
    [verificado ? 1 : 0, contato],
  );
  return linhasAlteradas === 1;
}

/** Troca o apelido; `null` volta ao nome padrão. Quem chama já conferiu o tamanho. */
export async function mudarApelido(
  banco: Armazenamento,
  contato: Uint8Array,
  apelido: string | null,
): Promise<boolean> {
  const { linhasAlteradas } = await banco.executar(
    'UPDATE contatos SET apelido = ? WHERE contato = ?',
    [apelido, contato],
  );
  return linhasAlteradas === 1;
}

export async function apagarContato(banco: Armazenamento, contato: Uint8Array): Promise<void> {
  await banco.executar('DELETE FROM contatos WHERE contato = ?', [contato]);
}
