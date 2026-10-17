// A exclusão real (RNF-08). Toda exclusão de mensagem passa por aqui: temporária, apagar pra todos,
// apagar só neste celular e apagar a conversa, só neste celular ou nos dois. Sai a linha, os termos
// dela no índice de busca (pelo gatilho da migração 3) e o pacote que ainda esperava na fila:
// mensagem apagada antes de sair não sai mais. Se o pacote já estava a caminho do relay, chega.
// Apagar a conversa leva também as notas de sistema dela.
//
// O banco foi aberto com `secure_delete` (conferido em `prepararBanco`) e o índice tem o
// `secure-delete` do FTS5: o que sai é sobrescrito no arquivo, não só marcado como livre. A prévia
// da lista de conversas sai da própria mensagem, então não há cópia dela para apagar. Sai também o
// anexo da mensagem: o blob cifrado e a chave dele, que ficam no mesmo banco. Se o blob ainda
// esperava subir, não sobe mais; se já estava no relay, some de lá pelo prazo.
//
// Apagar só neste celular dá alguns segundos para desfazer: a mensagem fica escondida (nenhuma
// leitura a devolve) e sai de verdade no fim do prazo, pela limpeza das temporárias.
import { BYTES_DO_ID, BYTES_DO_ID_DA_MENSAGEM } from '@cifra/protocol';
import type { Armazenamento } from '../portas/armazenamento.ts';

export type AlvoDaExclusao =
  /** Mensagens pelo ID. */
  | { readonly mensagens: readonly Uint8Array[] }
  /**
   * Todas as mensagens e notas de uma conversa, pelo ID do contato em bytes. Com `minhasAte`, o
   * pedido do contato de apagar a conversa (RF-59): das minhas, só as enviadas até ali, que já
   * tinham chegado a ele; as que ele ainda não tinha recebido ficam.
   */
  | { readonly conversa: Uint8Array; readonly minhasAte?: number };

/**
 * Apaga de verdade as mensagens do alvo e devolve quantas saíram. Roda na transação de quem chama:
 * a mensagem e o pacote dela saem juntos, ou nada sai.
 */
export async function apagarDeVerdade(banco: Armazenamento, alvo: AlvoDaExclusao): Promise<number> {
  if ('conversa' in alvo) {
    if (alvo.conversa.length !== BYTES_DO_ID) throw new Error('ID de conversa inválido');
    const { minhasAte } = alvo;
    const quais =
      minhasAte === undefined
        ? { filtro: 'conversa = ?', valores: [alvo.conversa] }
        : {
            filtro: 'conversa = ? AND (de_mim = 0 OR enviada_em <= ?)',
            valores: [alvo.conversa, minhasAte],
          };
    await banco.executar(
      `DELETE FROM fila WHERE mensagem IN (SELECT id FROM mensagens WHERE ${quais.filtro})`,
      quais.valores,
    );
    await banco.executar(
      `DELETE FROM anexos WHERE mensagem IN (SELECT id FROM mensagens WHERE ${quais.filtro})`,
      quais.valores,
    );
    await banco.executar('DELETE FROM notas WHERE conversa = ?', [alvo.conversa]);
    const { linhasAlteradas } = await banco.executar(
      `DELETE FROM mensagens WHERE ${quais.filtro}`,
      quais.valores,
    );
    return linhasAlteradas;
  }

  let apagadas = 0;
  for (const id of alvo.mensagens) {
    if (id.length !== BYTES_DO_ID_DA_MENSAGEM) throw new Error('ID de mensagem inválido');
    await banco.executar('DELETE FROM fila WHERE mensagem = ?', [id]);
    await banco.executar('DELETE FROM anexos WHERE mensagem = ?', [id]);
    const { linhasAlteradas } = await banco.executar('DELETE FROM mensagens WHERE id = ?', [id]);
    apagadas += linhasAlteradas;
  }
  return apagadas;
}

/**
 * Apagar só neste celular: as mensagens da conversa somem na hora e saem de verdade em `ate`, se
 * ninguém desfizer. Devolve quantas foram escondidas.
 */
export async function esconderParaApagar(
  banco: Armazenamento,
  conversa: Uint8Array,
  mensagens: readonly Uint8Array[],
  ate: number,
): Promise<number> {
  let escondidas = 0;
  for (const id of mensagens) {
    const { linhasAlteradas } = await banco.executar(
      `UPDATE mensagens SET desfazer_ate = ?
        WHERE id = ? AND conversa = ? AND desfazer_ate IS NULL`,
      [ate, id, conversa],
    );
    escondidas += linhasAlteradas;
  }
  return escondidas;
}

/** Desfaz o apagar só neste celular, enquanto o prazo não acabou. Devolve quantas voltaram. */
export async function desfazerApagar(
  banco: Armazenamento,
  conversa: Uint8Array,
  mensagens: readonly Uint8Array[],
  agora: number,
): Promise<number> {
  let voltaram = 0;
  for (const id of mensagens) {
    const { linhasAlteradas } = await banco.executar(
      'UPDATE mensagens SET desfazer_ate = NULL WHERE id = ? AND conversa = ? AND desfazer_ate > ?',
      [id, conversa, agora],
    );
    voltaram += linhasAlteradas;
  }
  return voltaram;
}
