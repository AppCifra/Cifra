// Ocultar e reexibir mudam a conversa de banco: do principal para o cofre, ou de volta. Tudo o que
// é da conversa vai, e nada fica na origem: contato, sessões, cartão, mensagens (com o índice de
// busca, pelos gatilhos), anexos, notas de sistema e a fila de saída. O que é de todos fica: as
// chaves efêmeras já vistas e as prekeys não dizem nada de ninguém.
//
// Os dois bancos não têm uma transação em comum. A cópia é uma transação no destino; apagar da
// origem é outra, na origem. Quem chama marca a mudança antes, no cofre, e a marca diz, se o app
// parar no meio, se a cópia já tinha entrado: a próxima abertura do cofre termina ou desfaz.
import { bytesDe, numeroDe } from '../banco/linhas.ts';
import { apagarDeVerdade } from '../mensagens/exclusao.ts';
import type { Armazenamento, LinhaSql } from '../portas/armazenamento.ts';

/** Insere a linha na tabela, com as mesmas colunas, menos as de `sem`. */
async function inserir(
  banco: Armazenamento,
  tabela: string,
  linha: LinhaSql,
  sem: readonly string[] = [],
): Promise<void> {
  const colunas = Object.keys(linha).filter((coluna) => !sem.includes(coluna));
  await banco.executar(
    `INSERT INTO ${tabela} (${colunas.join(', ')}) VALUES (${colunas.map(() => '?').join(', ')})`,
    colunas.map((coluna) => linha[coluna] ?? null),
  );
}

/** A nota que vinha depois da mensagem `antiga` vem, no destino, depois da cópia dela. */
function depoisDe(antiga: number, mapa: readonly (readonly [number, number])[]): number {
  let nova = 0;
  for (const [origem, destino] of mapa) {
    if (origem > antiga) break;
    nova = destino;
  }
  return nova;
}

/**
 * Copia a conversa com o contato da origem para o destino, numa transação do destino. As mensagens
 * ganham ordem nova no destino, e as notas de sistema continuam no mesmo lugar entre elas. A fila
 * vai na mesma ordem. Os anexos, com o blob, vão um por vez. `junto` roda na mesma transação: é ali
 * que a marca da mudança diz que a cópia entrou. Lança se o destino já tem o contato.
 */
export async function copiarConversa(
  origem: Armazenamento,
  destino: Armazenamento,
  contato: Uint8Array,
  junto: (destino: Armazenamento) => Promise<void> = () => Promise.resolve(),
): Promise<void> {
  const [linhaDoContato] = await origem.consultar('SELECT * FROM contatos WHERE contato = ?', [
    contato,
  ]);
  if (!linhaDoContato) throw new Error('conversa sem contato na origem');
  const sessoes = await origem.consultar(
    'SELECT * FROM sessoes WHERE contato = ? ORDER BY posicao',
    [contato],
  );
  const destinos = await origem.consultar('SELECT * FROM destinos WHERE contato = ?', [contato]);
  const mensagens = await origem.consultar(
    'SELECT * FROM mensagens WHERE conversa = ? ORDER BY ordem',
    [contato],
  );
  const comAnexo = await origem.consultar(
    `SELECT a.mensagem FROM anexos a JOIN mensagens m ON m.id = a.mensagem
      WHERE m.conversa = ? ORDER BY a.ordem`,
    [contato],
  );
  const notas = await origem.consultar('SELECT * FROM notas WHERE conversa = ? ORDER BY ordem', [
    contato,
  ]);
  const fila = await origem.consultar('SELECT * FROM fila WHERE contato = ? ORDER BY ordem', [
    contato,
  ]);

  await destino.transacao(async (t) => {
    await inserir(t, 'contatos', linhaDoContato);
    for (const sessao of sessoes) await inserir(t, 'sessoes', sessao);
    for (const cartao of destinos) await inserir(t, 'destinos', cartao);
    const mapa: [number, number][] = [];
    for (const mensagem of mensagens) {
      await inserir(t, 'mensagens', mensagem, ['ordem']);
      const [nova] = await t.consultar('SELECT ordem FROM mensagens WHERE id = ?', [
        bytesDe(mensagem, 'id'),
      ]);
      if (!nova) throw new Error('mensagem não entrou no destino');
      mapa.push([numeroDe(mensagem, 'ordem'), numeroDe(nova, 'ordem')]);
    }
    for (const linha of comAnexo) {
      // Um por vez: o blob passa pela memória inteiro.
      const [anexo] = await origem.consultar('SELECT * FROM anexos WHERE mensagem = ?', [
        bytesDe(linha, 'mensagem'),
      ]);
      if (anexo) await inserir(t, 'anexos', anexo, ['ordem']);
    }
    for (const nota of notas) {
      await inserir(
        t,
        'notas',
        {
          ...nota,
          depois_de: depoisDe(numeroDe(nota, 'depois_de'), mapa),
        },
        ['ordem'],
      );
    }
    for (const item of fila) await inserir(t, 'fila', item, ['ordem']);
    await junto(t);
  });
}

/**
 * Apaga de verdade a conversa com o contato do banco, numa transação, com o que for da conversa:
 * mensagens, anexos, notas e fila pela exclusão real, e depois a fila de controle, as sessões, o
 * cartão e o contato. `junto` roda na mesma transação. O banco principal ainda devolve as páginas
 * livres depois (`encolherBanco`); o cofre nunca encolhe.
 */
export async function apagarConversaDoBanco(
  banco: Armazenamento,
  contato: Uint8Array,
  junto: (banco: Armazenamento) => Promise<void> = () => Promise.resolve(),
): Promise<void> {
  await banco.transacao(async (t) => {
    await apagarDeVerdade(t, { conversa: contato });
    await t.executar('DELETE FROM fila WHERE contato = ?', [contato]);
    await t.executar('DELETE FROM sessoes WHERE contato = ?', [contato]);
    await t.executar('DELETE FROM destinos WHERE contato = ?', [contato]);
    await t.executar('DELETE FROM contatos WHERE contato = ?', [contato]);
    await junto(t);
  });
}
