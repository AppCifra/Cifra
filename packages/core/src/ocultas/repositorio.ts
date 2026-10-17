// O que só o cofre das conversas ocultas guarda (migração 9): a semente da caixa de cada conversa
// oculta e a marca de uma mudança em andamento (ocultar ou reexibir). No banco principal estas
// tabelas existem e ficam vazias; só a marca de reexibir passa por lá, durante a mudança, porque é
// lá que a cópia acontece. Todas recebem o banco de quem chama, que pode ser uma transação.
import { bytesDe, numeroDe, textoDe } from '../banco/linhas.ts';
import type { Armazenamento } from '../portas/armazenamento.ts';

export interface CaixaOculta {
  /** O ID do contato da conversa oculta, em bytes. */
  readonly contato: Uint8Array;
  /** A semente (32 bytes) do par Ed25519 da caixa. Quem lê zera depois de usar. */
  readonly semente: Uint8Array;
}

export async function caixasOcultas(banco: Armazenamento): Promise<CaixaOculta[]> {
  const linhas = await banco.consultar('SELECT contato, semente FROM caixas_ocultas');
  return linhas.map((linha) => ({
    contato: bytesDe(linha, 'contato'),
    semente: bytesDe(linha, 'semente'),
  }));
}

/** A semente da caixa da conversa oculta com o contato, ou `null` se ela não é oculta. */
export async function sementeDaCaixaOculta(
  banco: Armazenamento,
  contato: Uint8Array,
): Promise<Uint8Array | null> {
  const [linha] = await banco.consultar('SELECT semente FROM caixas_ocultas WHERE contato = ?', [
    contato,
  ]);
  return linha ? bytesDe(linha, 'semente') : null;
}

export async function guardarCaixaOculta(
  banco: Armazenamento,
  contato: Uint8Array,
  semente: Uint8Array,
): Promise<void> {
  await banco.executar('INSERT INTO caixas_ocultas (contato, semente) VALUES (?, ?)', [
    contato,
    semente,
  ]);
}

export async function apagarCaixaOculta(banco: Armazenamento, contato: Uint8Array): Promise<void> {
  await banco.executar('DELETE FROM caixas_ocultas WHERE contato = ?', [contato]);
}

export type TipoDaMudanca = 'ocultar' | 'reexibir';

export interface Mudanca {
  readonly contato: Uint8Array;
  readonly tipo: TipoDaMudanca;
  /** As linhas da conversa já foram copiadas para o banco de destino. */
  readonly copiada: boolean;
}

function tipoDaMudanca(texto: string): TipoDaMudanca {
  if (texto === 'ocultar' || texto === 'reexibir') return texto;
  throw new Error('mudança ilegível no banco');
}

/** Marca a mudança em andamento; com `copiada`, a cópia das linhas entrou junto. */
export async function marcarMudanca(
  banco: Armazenamento,
  contato: Uint8Array,
  tipo: TipoDaMudanca,
  copiada = false,
): Promise<void> {
  await banco.executar(
    `INSERT INTO mudancas (contato, tipo, copiada) VALUES (?, ?, ?)
     ON CONFLICT (contato) DO UPDATE SET tipo = excluded.tipo, copiada = excluded.copiada`,
    [contato, tipo, copiada ? 1 : 0],
  );
}

export async function marcarCopiada(banco: Armazenamento, contato: Uint8Array): Promise<void> {
  await banco.executar('UPDATE mudancas SET copiada = 1 WHERE contato = ?', [contato]);
}

export async function mudancas(banco: Armazenamento): Promise<Mudanca[]> {
  const linhas = await banco.consultar('SELECT contato, tipo, copiada FROM mudancas');
  return linhas.map((linha) => ({
    contato: bytesDe(linha, 'contato'),
    tipo: tipoDaMudanca(textoDe(linha, 'tipo')),
    copiada: numeroDe(linha, 'copiada') === 1,
  }));
}

export async function mudancaDe(
  banco: Armazenamento,
  contato: Uint8Array,
): Promise<Mudanca | null> {
  const [linha] = await banco.consultar(
    'SELECT contato, tipo, copiada FROM mudancas WHERE contato = ?',
    [contato],
  );
  return linha
    ? {
        contato: bytesDe(linha, 'contato'),
        tipo: tipoDaMudanca(textoDe(linha, 'tipo')),
        copiada: numeroDe(linha, 'copiada') === 1,
      }
    : null;
}

export async function tirarMudanca(banco: Armazenamento, contato: Uint8Array): Promise<void> {
  await banco.executar('DELETE FROM mudancas WHERE contato = ?', [contato]);
}
