// Fila de saída (RF-15, RNF-12). Guarda o pacote pronto, selado, e reenvia os mesmos bytes até o
// relay aceitar: um reenvio do que já tinha chegado tem o mesmo ID de pacote, e o relay não
// duplica (RF-16). Cada contato tem a sua ordem: o primeiro pacote que falha segura os seguintes,
// e as tentativas se espaçam em 1 s, 2 s, 4 s… até 1 min.
//
// O SQLite reaproveita a ordem de um item apagado no próximo que entra. Quem volta da rede com um
// item lido antes (entregue, ou falhou) confere também o pacote: o item pode ter sido apagado no
// meio, e outro ter entrado com a mesma ordem.
import { bytesDe, numeroDe } from '../banco/linhas.ts';
import type { Armazenamento, LinhaSql } from '../portas/armazenamento.ts';

export const PRIMEIRO_INTERVALO = 1000;
export const MAIOR_INTERVALO = 60_000;

/** O intervalo depois da tentativa número `tentativas` (1, 2, …). */
export function intervaloDeReenvio(tentativas: number): number {
  return Math.min(MAIOR_INTERVALO, PRIMEIRO_INTERVALO * 2 ** Math.max(0, tentativas - 1));
}

export interface ItemDaFila {
  readonly ordem: number;
  readonly contato: Uint8Array;
  /** A mensagem de texto que o pacote leva; nula nos controles, como a confirmação de leitura. */
  readonly mensagem: Uint8Array | null;
  readonly pacote: Uint8Array;
  readonly tentativas: number;
  readonly proximaTentativa: number;
}

export async function enfileirar(
  banco: Armazenamento,
  contato: Uint8Array,
  mensagem: Uint8Array | null,
  pacote: Uint8Array,
  agora: number,
): Promise<void> {
  await banco.executar(
    `INSERT INTO fila (contato, mensagem, pacote, tentativas, proxima_tentativa)
     VALUES (?, ?, ?, 0, ?)`,
    [contato, mensagem, pacote, agora],
  );
}

const COLUNAS_DA_FILA = 'ordem, contato, mensagem, pacote, tentativas, proxima_tentativa';

/** Toda a fila, na ordem em que entrou. */
export async function itensDaFila(banco: Armazenamento): Promise<ItemDaFila[]> {
  return itensDe(await banco.consultar(`SELECT ${COLUNAS_DA_FILA} FROM fila ORDER BY ordem`));
}

/** O que espera para sair para um contato, na ordem. */
export async function itensDaFilaDe(
  banco: Armazenamento,
  contato: Uint8Array,
): Promise<ItemDaFila[]> {
  return itensDe(
    await banco.consultar(`SELECT ${COLUNAS_DA_FILA} FROM fila WHERE contato = ? ORDER BY ordem`, [
      contato,
    ]),
  );
}

/**
 * Troca o pacote que esperava por outro, cifrado de novo (o contato trocou de aparelho), e ele
 * tenta sair agora. O anterior nunca chegaria ao aparelho novo: não há o que duplicar.
 */
export async function trocarPacote(
  banco: Armazenamento,
  ordem: number,
  pacote: Uint8Array,
  agora: number,
): Promise<void> {
  await banco.executar(
    'UPDATE fila SET pacote = ?, tentativas = 0, proxima_tentativa = ? WHERE ordem = ?',
    [pacote, agora, ordem],
  );
}

function itensDe(linhas: readonly LinhaSql[]): ItemDaFila[] {
  return linhas.map((linha) => ({
    ordem: numeroDe(linha, 'ordem'),
    contato: bytesDe(linha, 'contato'),
    mensagem: linha['mensagem'] === null ? null : bytesDe(linha, 'mensagem'),
    pacote: bytesDe(linha, 'pacote'),
    tentativas: numeroDe(linha, 'tentativas'),
    proximaTentativa: numeroDe(linha, 'proxima_tentativa'),
  }));
}

/** Tira o item da fila, se ele ainda está lá com o mesmo pacote. */
export async function tirarDaFila(
  banco: Armazenamento,
  item: Pick<ItemDaFila, 'ordem' | 'pacote'>,
): Promise<void> {
  await banco.executar('DELETE FROM fila WHERE ordem = ? AND pacote = ?', [
    item.ordem,
    item.pacote,
  ]);
}

/** O item ainda espera na fila com o mesmo pacote: não foi entregue nem apagado no meio. */
export async function naFila(
  banco: Armazenamento,
  item: Pick<ItemDaFila, 'ordem' | 'pacote'>,
): Promise<boolean> {
  const linhas = await banco.consultar(
    'SELECT 1 AS existe FROM fila WHERE ordem = ? AND pacote = ?',
    [item.ordem, item.pacote],
  );
  return linhas.length > 0;
}

/**
 * Tira da fila tudo o que esperava para sair para o contato, como a confirmação de leitura. As
 * mensagens saem antes, por `apagarDeVerdade`, junto com o pacote delas.
 */
export async function esvaziarFilaDe(banco: Armazenamento, contato: Uint8Array): Promise<void> {
  await banco.executar('DELETE FROM fila WHERE contato = ?', [contato]);
}

/** A mensagem já chegou (o contato até leu): o pacote dela não precisa mais sair. */
export async function tirarMensagemDaFila(
  banco: Armazenamento,
  mensagem: Uint8Array,
): Promise<void> {
  await banco.executar('DELETE FROM fila WHERE mensagem = ?', [mensagem]);
}

/**
 * Mais uma tentativa que falhou: a próxima fica para depois do intervalo. Só se o item ainda está
 * na fila com o mesmo pacote.
 */
export async function adiar(banco: Armazenamento, item: ItemDaFila, agora: number): Promise<void> {
  const tentativas = item.tentativas + 1;
  await banco.executar(
    'UPDATE fila SET tentativas = ?, proxima_tentativa = ? WHERE ordem = ? AND pacote = ?',
    [tentativas, agora + intervaloDeReenvio(tentativas), item.ordem, item.pacote],
  );
}

/**
 * O item sai de novo, já: a conversa mudou de caixa enquanto o pacote ia para a anterior. Só se o
 * item ainda está na fila com o mesmo pacote.
 */
export async function tentarDeNovo(
  banco: Armazenamento,
  item: Pick<ItemDaFila, 'ordem' | 'pacote'>,
  agora: number,
): Promise<void> {
  await banco.executar(
    'UPDATE fila SET tentativas = 0, proxima_tentativa = ? WHERE ordem = ? AND pacote = ?',
    [agora, item.ordem, item.pacote],
  );
}

/** O relay voltou: tudo tenta agora, e os intervalos recomeçam do primeiro. */
export async function tentarTudoAgora(banco: Armazenamento, agora: number): Promise<void> {
  await banco.executar('UPDATE fila SET tentativas = 0, proxima_tentativa = ?', [agora]);
}

/**
 * Quando a próxima tentativa vence, ou `null` com a fila vazia. Conta só o primeiro pacote de
 * cada contato, o que segura os outros. Os contatos de `fora` não contam: esperam um anexo subir,
 * e a entrega volta a eles quando a subida terminar.
 */
export async function proximaTentativa(
  banco: Armazenamento,
  fora: readonly Uint8Array[] = [],
): Promise<number | null> {
  const semOsDeFora =
    fora.length > 0 ? `AND contato NOT IN (${fora.map(() => '?').join(', ')})` : '';
  const [linha] = await banco.consultar(
    `SELECT min(proxima_tentativa) AS quando FROM fila
      WHERE ordem IN (SELECT min(ordem) FROM fila GROUP BY contato) ${semOsDeFora}`,
    [...fora],
  );
  const quando = linha?.['quando'];
  return typeof quando === 'number' ? quando : null;
}
