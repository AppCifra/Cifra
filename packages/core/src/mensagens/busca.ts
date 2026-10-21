// Busca local nas mensagens (RF-12), pelo índice FTS5 da migração 3. Só lê o banco deste aparelho,
// sem rede. Cada palavra digitada vira um termo entre aspas com prefixo: "caf" acha "café", sem
// diferença de acento nem de maiúscula, e nada do que a pessoa digita vira operador do FTS5 (AND,
// OR, NEAR, aspas, asterisco, dois-pontos). As conversas ocultas ficam em outro banco e nunca
// aparecem aqui. A agenda busca por aqui.
import type { Armazenamento } from '../portas/armazenamento.ts';
import { COLUNAS_DA_MENSAGEM, mensagemDaLinha, visivel, type Mensagem } from './repositorio.ts';

/** Quantas mensagens a busca devolve, no máximo. */
export const LIMITE_DA_BUSCA = 50;

/**
 * A consulta do FTS5 para o texto digitado, ou `null` quando ele não tem nenhuma letra ou número.
 * Todas as palavras precisam aparecer na mensagem, em qualquer ordem.
 */
export function consultaDaBusca(texto: string): string | null {
  const termos = texto
    .split(/\s+/u)
    .filter((palavra) => /[\p{L}\p{N}]/u.test(palavra))
    .map((palavra) => `"${palavra.replaceAll('"', '""')}"*`);
  return termos.length > 0 ? termos.join(' ') : null;
}

/**
 * As mensagens que têm todas as palavras do texto, das mais novas para as mais antigas. Só nos
 * contatos aceitos e na nota pessoal (`nota`, o próprio ID): pedidos ficam de fora, e as apagadas
 * só neste celular também.
 */
export async function buscarMensagens(
  banco: Armazenamento,
  texto: string,
  nota: Uint8Array | null = null,
  limite = LIMITE_DA_BUSCA,
): Promise<Mensagem[]> {
  const consulta = consultaDaBusca(texto);
  if (consulta === null) return [];
  // A nota pessoal entra pelo próprio ID; sem ela, nenhuma mensagem tem essa conversa.
  const linhas = await banco.consultar(
    `SELECT ${COLUNAS_DA_MENSAGEM} FROM mensagens
      WHERE ordem IN (SELECT rowid FROM busca WHERE busca MATCH ?)
        AND (conversa = ? OR conversa IN (SELECT contato FROM contatos WHERE aceito = 1))
        AND ${visivel()}
      ORDER BY ordem DESC LIMIT ?`,
    [consulta, nota ?? new Uint8Array(0), limite],
  );
  return linhas.map(mensagemDaLinha);
}
