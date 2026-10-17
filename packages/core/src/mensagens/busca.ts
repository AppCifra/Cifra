// Busca local nas mensagens (RF-12), pelo índice FTS5 da migração 3. Só lê o banco deste aparelho,
// sem rede. Cada palavra digitada vira um termo entre aspas com prefixo: "caf" acha "café", sem
// diferença de acento nem de maiúscula, e nada do que a pessoa digita vira operador do FTS5 (AND,
// OR, NEAR, aspas, asterisco, dois-pontos). As conversas ocultas ficam em outro banco e nunca
// aparecem aqui.
import type { Armazenamento } from '../portas/armazenamento.ts';
import { COLUNAS_DA_MENSAGEM, mensagemDaLinha, type Mensagem } from './repositorio.ts';

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

/** As mensagens que têm todas as palavras do texto, das mais novas para as mais antigas. */
export async function buscarMensagens(
  banco: Armazenamento,
  texto: string,
  limite = LIMITE_DA_BUSCA,
): Promise<Mensagem[]> {
  const consulta = consultaDaBusca(texto);
  if (consulta === null) return [];
  const linhas = await banco.consultar(
    `SELECT ${COLUNAS_DA_MENSAGEM} FROM mensagens
      WHERE ordem IN (SELECT rowid FROM busca WHERE busca MATCH ?)
      ORDER BY ordem DESC LIMIT ?`,
    [consulta, limite],
  );
  return linhas.map(mensagemDaLinha);
}
