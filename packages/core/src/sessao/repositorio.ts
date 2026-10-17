// As sessões no banco: por contato, a atual e as anteriores que ainda decifram; as chaves efêmeras
// de X3DH já aceitas; e o cartão conferido de cada contato, que diz a caixa dele. Todas recebem o
// banco de quem chama, que pode ser uma transação.
import { lerCartao, type Cartao } from '@cifra/protocol';
import { bytesDe, numeroDe } from '../banco/linhas.ts';
import type { Armazenamento } from '../portas/armazenamento.ts';
import { codificarSessao, lerSessao, type Sessao } from './sessao.ts';

/**
 * A atual e até 4 anteriores. Como no libsignal, que guarda 40: quando os dois lados abrem sessão
 * ao mesmo tempo, ou quando o contato reinstala, as mensagens da sessão anterior ainda decifram.
 */
export const SESSOES_POR_CONTATO = 5;

export async function sessoesDe(banco: Armazenamento, contato: Uint8Array): Promise<Sessao[]> {
  const linhas = await banco.consultar(
    'SELECT sessao FROM sessoes WHERE contato = ? ORDER BY posicao',
    [contato],
  );
  return linhas.map((linha) => lerSessao(bytesDe(linha, 'sessao')));
}

/** Troca as sessões do contato pela lista, na ordem: a primeira é a atual. O que passar sai. */
export async function guardarSessoes(
  banco: Armazenamento,
  contato: Uint8Array,
  sessoes: readonly Sessao[],
): Promise<void> {
  await banco.executar('DELETE FROM sessoes WHERE contato = ?', [contato]);
  for (const [posicao, sessao] of sessoes.slice(0, SESSOES_POR_CONTATO).entries()) {
    await banco.executar('INSERT INTO sessoes (contato, posicao, sessao) VALUES (?, ?, ?)', [
      contato,
      posicao,
      codificarSessao(sessao),
    ]);
  }
}

export async function baseJaVista(banco: Armazenamento, base: Uint8Array): Promise<boolean> {
  const linhas = await banco.consultar('SELECT 1 AS vista FROM bases_vistas WHERE base = ?', [
    base,
  ]);
  return linhas.length > 0;
}

/** Registra a chave efêmera de uma sessão aceita. Sai junto com a prekey assinada que ela usou. */
export async function registrarBase(
  banco: Armazenamento,
  base: Uint8Array,
  prekeyAssinada: number,
): Promise<void> {
  await banco.executar('INSERT OR IGNORE INTO bases_vistas (base, prekey_assinada) VALUES (?, ?)', [
    base,
    prekeyAssinada,
  ]);
}

export interface Destino {
  readonly cartao: Cartao;
  /** O contato abriu uma sessão nova: o cartão pode ter mudado e é buscado antes do próximo envio. */
  readonly desatualizado: boolean;
}

export async function destinoDe(
  banco: Armazenamento,
  contato: Uint8Array,
): Promise<Destino | null> {
  const [linha] = await banco.consultar(
    'SELECT cartao, desatualizado FROM destinos WHERE contato = ?',
    [contato],
  );
  if (!linha) return null;
  const cartao = lerCartao(bytesDe(linha, 'cartao'));
  if (!cartao) throw new Error('cartão ilegível no banco');
  return { cartao, desatualizado: numeroDe(linha, 'desatualizado') === 1 };
}

/** Guarda o cartão conferido do contato, no lugar do anterior. */
export async function guardarDestino(
  banco: Armazenamento,
  contato: Uint8Array,
  cartao: Cartao,
): Promise<void> {
  await banco.executar(
    `INSERT INTO destinos (contato, cartao, desatualizado) VALUES (?, ?, 0)
     ON CONFLICT (contato) DO UPDATE SET cartao = excluded.cartao, desatualizado = 0`,
    [contato, cartao.bytes],
  );
}

export async function marcarDestinoDesatualizado(
  banco: Armazenamento,
  contato: Uint8Array,
): Promise<void> {
  await banco.executar('UPDATE destinos SET desatualizado = 1 WHERE contato = ?', [contato]);
}
