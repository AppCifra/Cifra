// As mensagens de texto no banco cifrado. A conversa é o ID do contato, em bytes. Enviadas passam
// por pendente (na fila), enviada (o relay aceitou) e lida (o contato confirmou a leitura).
// Recebidas passam por recebida e lida (a pessoa abriu a conversa).
//
// Mensagem temporária guarda quando some (`expira_em`, no relógio deste aparelho). A apagada só
// neste celular fica escondida até o fim do prazo do desfazer (`desfazer_ate`) e depois sai de
// verdade: nenhuma leitura daqui a devolve nesse meio-tempo.
import { BYTES_DO_ID_DA_MENSAGEM, LIMITE_DA_LEGENDA, LIMITE_DO_TEXTO, utf8 } from '@cifra/protocol';
import { bytesDe, numeroDe, numeroOuNulo, textoDe } from '../banco/linhas.ts';
import type { Armazenamento, LinhaSql } from '../portas/armazenamento.ts';

export type StatusDaMensagem = 'pendente' | 'enviada' | 'lida' | 'recebida';

/** Texto, ou o tipo do anexo: no anexo, o texto é a legenda, que pode ser vazia. */
export type TipoDaMensagem = 'texto' | 'imagem' | 'video' | 'documento';

const TIPOS: readonly TipoDaMensagem[] = ['texto', 'imagem', 'video', 'documento'];

/** Texto que cabe numa mensagem: UTF-8 válido, de 1 a 3500 bytes. */
export function textoAceito(texto: string): boolean {
  let tamanho: number;
  try {
    tamanho = utf8(texto).length;
  } catch {
    return false;
  }
  return tamanho >= 1 && tamanho <= LIMITE_DO_TEXTO;
}

/** A legenda de um anexo: UTF-8 válido, até 2000 bytes, ou vazia. */
export function legendaAceita(legenda: string): boolean {
  try {
    return utf8(legenda).length <= LIMITE_DA_LEGENDA;
  } catch {
    return false;
  }
}

const STATUS: readonly StatusDaMensagem[] = ['pendente', 'enviada', 'lida', 'recebida'];

export interface Mensagem {
  readonly id: Uint8Array;
  /** O ID do contato, em bytes. */
  readonly conversa: Uint8Array;
  readonly deMim: boolean;
  readonly tipo: TipoDaMensagem;
  /** Texto, ou a legenda do anexo (pode ser vazia). */
  readonly texto: string;
  /** O ID da mensagem que esta responde (RF-55); a citação sai da cópia daqui. */
  readonly resposta: Uint8Array | null;
  /** No relógio de quem escreveu. */
  readonly enviadaEm: number;
  /** No relógio deste aparelho; nula nas enviadas. */
  readonly recebidaEm: number | null;
  /** Segundos até sumir; 0 é sem timer. */
  readonly ttl: number;
  /** Quando some, no relógio deste aparelho; nula sem timer (RF-27). */
  readonly expiraEm: number | null;
  readonly status: StatusDaMensagem;
}

/** A condição das mensagens que aparecem: as apagadas só neste celular ficam de fora. */
export function visivel(tabela?: string): string {
  return `${tabela ? `${tabela}.` : ''}desfazer_ate IS NULL`;
}

/** Uma mensagem nova: sem tipo, é texto; sem resposta, não responde a nenhuma. */
export type NovaMensagem = Omit<Mensagem, 'tipo' | 'resposta'> &
  Partial<Pick<Mensagem, 'tipo' | 'resposta'>>;

/** Guarda a mensagem. Devolve `false` se já havia uma com o mesmo ID: a repetida é descartada. */
export async function guardarMensagem(
  banco: Armazenamento,
  mensagem: NovaMensagem,
): Promise<boolean> {
  if (mensagem.id.length !== BYTES_DO_ID_DA_MENSAGEM) throw new Error('ID de mensagem inválido');
  const { linhasAlteradas } = await banco.executar(
    `INSERT OR IGNORE INTO mensagens
       (id, conversa, de_mim, tipo, texto, resposta, enviada_em, recebida_em, ttl, expira_em,
        status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      mensagem.id,
      mensagem.conversa,
      mensagem.deMim ? 1 : 0,
      mensagem.tipo ?? 'texto',
      mensagem.texto,
      mensagem.resposta ?? null,
      mensagem.enviadaEm,
      mensagem.recebidaEm,
      mensagem.ttl,
      mensagem.expiraEm,
      mensagem.status,
    ],
  );
  return linhasAlteradas === 1;
}

/** Muda o status se ele estiver entre `de`. Devolve `true` se mudou. */
export async function mudarStatus(
  banco: Armazenamento,
  id: Uint8Array,
  de: readonly StatusDaMensagem[],
  para: StatusDaMensagem,
): Promise<boolean> {
  const { linhasAlteradas } = await banco.executar(
    `UPDATE mensagens SET status = ? WHERE id = ? AND status IN (${de.map(() => '?').join(', ')})`,
    [para, id, ...de],
  );
  return linhasAlteradas === 1;
}

/**
 * Marca como lidas as mensagens enviadas a `conversa` que o contato confirmou ter lido. Só vale
 * para mensagens da própria conversa: um contato não confirma leitura de outra. Devolve as que
 * mudaram.
 */
export async function marcarLidasPeloContato(
  banco: Armazenamento,
  conversa: Uint8Array,
  ids: readonly Uint8Array[],
): Promise<Uint8Array[]> {
  const mudaram: Uint8Array[] = [];
  for (const id of ids) {
    const { linhasAlteradas } = await banco.executar(
      `UPDATE mensagens SET status = 'lida'
        WHERE id = ? AND conversa = ? AND de_mim = 1 AND status IN ('pendente', 'enviada')`,
      [id, conversa],
    );
    if (linhasAlteradas === 1) mudaram.push(id);
  }
  return mudaram;
}

/** Marca como lidas as recebidas da conversa que ainda não foram. Devolve os IDs, em ordem. */
export async function lerRecebidas(
  banco: Armazenamento,
  conversa: Uint8Array,
): Promise<Uint8Array[]> {
  const condicao = `conversa = ? AND de_mim = 0 AND status = 'recebida' AND ${visivel()}`;
  const linhas = await banco.consultar(
    `SELECT id FROM mensagens WHERE ${condicao} ORDER BY ordem`,
    [conversa],
  );
  await banco.executar(`UPDATE mensagens SET status = 'lida' WHERE ${condicao}`, [conversa]);
  return linhas.map((linha) => bytesDe(linha, 'id'));
}

/** Das mensagens pedidas, as que são desta conversa, de qualquer um dos lados. */
export async function idsDaConversa(
  banco: Armazenamento,
  conversa: Uint8Array,
  ids: readonly Uint8Array[],
): Promise<Uint8Array[]> {
  const daConversa: Uint8Array[] = [];
  for (const id of ids) {
    if (id.length !== BYTES_DO_ID_DA_MENSAGEM) continue;
    const linhas = await banco.consultar(
      'SELECT 1 AS existe FROM mensagens WHERE id = ? AND conversa = ?',
      [id, conversa],
    );
    if (linhas.length > 0) daConversa.push(id);
  }
  return daConversa;
}

function statusDe(texto: string): StatusDaMensagem {
  const status = STATUS.find((s) => s === texto);
  if (!status) throw new Error('status ilegível no banco');
  return status;
}

/** As colunas que viram uma `Mensagem`, na ordem do SELECT. */
export const COLUNAS_DA_MENSAGEM =
  'id, conversa, de_mim, tipo, texto, resposta, enviada_em, recebida_em, ttl, expira_em, status';

/** O tipo de uma mensagem lido do banco. */
export function tipoDe(texto: string): TipoDaMensagem {
  const tipo = TIPOS.find((t) => t === texto);
  if (!tipo) throw new Error('tipo ilegível no banco');
  return tipo;
}

/** A mensagem de uma linha com as `COLUNAS_DA_MENSAGEM`. */
export function mensagemDaLinha(linha: LinhaSql): Mensagem {
  return {
    id: bytesDe(linha, 'id'),
    conversa: bytesDe(linha, 'conversa'),
    deMim: numeroDe(linha, 'de_mim') === 1,
    tipo: tipoDe(textoDe(linha, 'tipo')),
    texto: textoDe(linha, 'texto'),
    resposta: linha['resposta'] === null ? null : bytesDe(linha, 'resposta'),
    enviadaEm: numeroDe(linha, 'enviada_em'),
    recebidaEm: numeroOuNulo(linha, 'recebida_em'),
    ttl: numeroDe(linha, 'ttl'),
    expiraEm: numeroOuNulo(linha, 'expira_em'),
    status: statusDe(textoDe(linha, 'status')),
  };
}

export async function mensagemPeloId(
  banco: Armazenamento,
  id: Uint8Array,
): Promise<Mensagem | null> {
  const [linha] = await banco.consultar(
    `SELECT ${COLUNAS_DA_MENSAGEM} FROM mensagens WHERE id = ?`,
    [id],
  );
  return linha ? mensagemDaLinha(linha) : null;
}

/** As mensagens da conversa, na ordem em que entraram neste aparelho. */
export async function mensagensDa(banco: Armazenamento, conversa: Uint8Array): Promise<Mensagem[]> {
  const linhas = await banco.consultar(
    `SELECT ${COLUNAS_DA_MENSAGEM} FROM mensagens WHERE conversa = ? AND ${visivel()}
      ORDER BY ordem`,
    [conversa],
  );
  return linhas.map(mensagemDaLinha);
}
