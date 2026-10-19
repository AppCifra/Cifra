// O cofre das conversas ocultas cresce em blocos de tamanho exato (RNF-11). Ele existe desde a
// instalação, com um bloco, e só cresce de bloco em bloco: o tamanho do arquivo não diz quanto
// está em uso, e um cofre vazio fica igual a um em uso. Sem `auto_vacuum`, o arquivo nunca encolhe.
//
// Completar o bloco é SQL comum, na mesma transação da gravação: linhas de zeros entram até o
// arquivo chegar ao tamanho do bloco, e saem logo depois. As páginas que elas ocupavam ficam livres,
// zeradas pelo `secure_delete`; o SQLCipher cifra cada página, então elas parecem aleatórias como
// as outras. Sem espaço para o bloco, a transação inteira se desfaz: a gravação não entra, e o
// arquivo volta ao tamanho de antes.
//
// - Primeiro, linhas grandes, na tabela `reserva`, até faltarem poucas páginas. Cada linha nunca
//   passa do alvo: o tamanho dela deixa folga para as páginas que a árvore da tabela pode pedir.
// - Depois, uma página por vez, na tabela `reserva_exata`: cada linha ali tem um pouco mais que uma
//   página, e ocupa exatamente uma página a mais, a do excedente, com qualquer reserva por página
//   que o SQLCipher use (até 255 bytes). A tabela começa vazia, e as poucas linhas cabem na raiz.
//
// As duas tabelas ficam no cofre, vazias. O cofre vazio (de chave sorteada) também as tem.
import type { Armazenamento } from '../portas/armazenamento.ts';

/** O bloco do cofre: 16 MiB. O cofre vazio ocupa um bloco, e cresce de bloco em bloco. */
export const BLOCO_DO_COFRE = 16 * 1024 * 1024;

/** Páginas que a fase das linhas grandes deixa para a fase de uma página por vez. */
const FOLGA = 6;

/**
 * Bytes que cada página carrega, no mínimo, numa linha grande: a página menos a maior reserva do
 * SQLCipher (255), menos o ponteiro da página seguinte (4), com margem.
 */
const BYTES_POR_PAGINA_SEGUROS = 300;

async function pragma(banco: Armazenamento, nome: string): Promise<number> {
  const [linha] = await banco.consultar(`PRAGMA ${nome}`);
  // A pragma devolve um valor só. O SQLCipher responde `page_size` como `cipher_page_size`, em
  // texto.
  const [valor] = linha ? Object.values(linha) : [];
  const numero = typeof valor === 'string' && /^\d+$/.test(valor) ? Number(valor) : valor;
  if (typeof numero !== 'number') throw new Error(`sem ${nome}`);
  return numero;
}

/** As páginas do bloco que contém `paginas`: no mínimo um bloco. */
function alvoDe(paginas: number, porBloco: number): number {
  return Math.max(1, Math.ceil(paginas / porBloco)) * porBloco;
}

/** O tamanho do arquivo do banco, em bytes, pelas páginas: o que fica no disco. */
export async function tamanhoDoBanco(banco: Armazenamento): Promise<number> {
  return (await pragma(banco, 'page_size')) * (await pragma(banco, 'page_count'));
}

/**
 * Deixa o arquivo do banco num múltiplo exato do bloco, com no mínimo um bloco, dentro da transação
 * `t`. Quando ele já está, custa duas pragmas. Sem espaço, lança, e quem abriu a transação a desfaz.
 */
async function completarNaTransacao(t: Armazenamento, bloco: number): Promise<void> {
  const tamanhoDaPagina = await pragma(t, 'page_size');
  if (bloco % tamanhoDaPagina !== 0) throw new Error('bloco fora do tamanho das páginas');
  const porBloco = bloco / tamanhoDaPagina;
  const paginas = await pragma(t, 'page_count');
  if (paginas >= porBloco && paginas % porBloco === 0) return;

  await t.executar('CREATE TABLE IF NOT EXISTS reserva (x BLOB)');
  await t.executar('CREATE TABLE IF NOT EXISTS reserva_exata (x BLOB)');
  const alvo = alvoDe(await pragma(t, 'page_count'), porBloco);
  // As páginas livres são ocupadas antes de o arquivo crescer: contam no que falta.
  const resto = async () =>
    alvo - (await pragma(t, 'page_count')) + (await pragma(t, 'freelist_count'));

  for (let falta = await resto(); falta > FOLGA; falta = await resto()) {
    await t.executar('INSERT INTO reserva (x) VALUES (zeroblob(?))', [
      (falta - FOLGA) * (tamanhoDaPagina - BYTES_POR_PAGINA_SEGUROS),
    ]);
  }
  for (let linhas = 0; ; linhas++) {
    const atual = await pragma(t, 'page_count');
    if (atual === alvo) break;
    // Não acontece com páginas de 4 KiB e reserva de até 255 bytes. Se acontecer, nada fica.
    if (atual > alvo || linhas > FOLGA) throw new Error('o bloco não fechou no tamanho');
    await t.executar('INSERT INTO reserva_exata (x) VALUES (zeroblob(?))', [tamanhoDaPagina + 100]);
  }
  await t.executar('DELETE FROM reserva');
  await t.executar('DELETE FROM reserva_exata');
}

/** Completa o bloco numa transação própria. Fora de transação. */
export async function completarBloco(banco: Armazenamento, bloco = BLOCO_DO_COFRE): Promise<void> {
  await banco.transacao((t) => completarNaTransacao(t, bloco));
}

/**
 * O banco do cofre, que completa o bloco dentro de cada transação e de cada comando fora de uma:
 * o arquivo nunca fica fora de um múltiplo do bloco, e o que não cabe nele não entra.
 */
export function cofreEmBlocos(banco: Armazenamento, bloco = BLOCO_DO_COFRE): Armazenamento {
  const transacao = <T>(operacao: (t: Armazenamento) => Promise<T>): Promise<T> =>
    banco.transacao(async (t) => {
      const resultado = await operacao(t);
      await completarNaTransacao(t, bloco);
      return resultado;
    });
  return {
    executar: (sql, parametros) => transacao((t) => t.executar(sql, parametros)),
    consultar: (sql, parametros) => banco.consultar(sql, parametros),
    transacao,
  };
}
