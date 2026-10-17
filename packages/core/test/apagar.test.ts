import { readFileSync } from 'node:fs';
import { BYTES_DO_ID_DA_MENSAGEM, lerId } from '@cifra/protocol';
import { describe, expect, it } from 'vitest';
import { ErroDoCorreio, PRAZO_DO_DESFAZER, type Mensagem } from '../src/index.ts';
import { enfileirarConteudo } from '../src/mensagens/correspondencia.ts';
import { cripto } from './adaptadores/sodium-node.ts';
import {
  andarAte,
  ate,
  avancarAte,
  conversa,
  DIA,
  online,
  pessoa,
  relay,
  relogio,
  textos,
  type Pessoa,
} from './correio-de-teste.ts';

// Apagar pra todos (RF-30), apagar só neste celular, com o desfazer, e apagar a conversa deste
// aparelho (RF-31), contra o relay de verdade. A exclusão é a mesma das temporárias: o texto some
// também do arquivo do banco, que nestes testes não é cifrado.

const codigo = (promessa: Promise<unknown>) =>
  promessa.then(
    () => 'aceito',
    (erro: unknown) => (erro instanceof ErroDoCorreio ? erro.codigo : 'outro'),
  );

async function mensagem(p: Pessoa, de: Pessoa, texto: string): Promise<Mensagem> {
  const achada = (await p.agenda.mensagens(de.id)).find((m) => m.texto === texto);
  if (!achada) throw new Error(`sem a mensagem "${texto}"`);
  return achada;
}

const recebe = (p: Pessoa, de: Pessoa, texto: string) =>
  ate(async () => (await textos(p, de)).includes(texto), `chega "${texto}"`);

const noArquivo = (p: Pessoa, texto: string) =>
  readFileSync(p.banco.caminho).toString('utf8').includes(texto);

const filaVazia = async (p: Pessoa) =>
  (await p.banco.banco.consultar('SELECT count(*) AS n FROM fila'))[0]?.['n'] === 0;

describe('apagar pra todos (RF-30)', () => {
  it('qualquer mensagem, minha ou recebida, some dos dois lados, sem nota e sem rastro', async () => {
    const [alice, bob] = await conversa();
    await alice.correio.enviarTexto(bob.id, 'palavrasecretadaalice');
    await bob.correio.enviarTexto(alice.id, 'palavrasecretadobob');
    await recebe(bob, alice, 'palavrasecretadaalice');
    await recebe(alice, bob, 'palavrasecretadobob');
    const minha = await mensagem(alice, bob, 'palavrasecretadaalice');
    const dele = await mensagem(alice, bob, 'palavrasecretadobob');

    const apagadas = await alice.correio.apagarParaTodos(bob.id, [minha.id, dele.id]);
    expect(apagadas).toEqual([minha.id, dele.id]);
    expect(await textos(alice, bob)).toEqual(['oi', 'oi, alice']);
    await ate(async () => (await textos(bob, alice)).length === 2, 'some do bob');
    expect(await textos(bob, alice)).toEqual(['oi', 'oi, alice']);
    expect(bob.eventos).toContainEqual({
      tipo: 'apagadas',
      conversa: alice.id,
      ids: [minha.id, dele.id],
    });
    // Sem rastro: nenhuma nota no lugar, nada na busca, nada no arquivo.
    expect((await bob.agenda.itens(alice.id)).every((item) => item.tipo === 'mensagem')).toBe(true);
    for (const p of [alice, bob]) {
      expect((await p.agenda.buscar('palavrasecretadaalice')).mensagens).toEqual([]);
      expect(noArquivo(p, 'palavrasecretadaalice')).toBe(false);
      expect(noArquivo(p, 'palavrasecretadobob')).toBe(false);
    }
  });

  it('sem limite de tempo: a mensagem de um mês atrás também some dos dois lados', async () => {
    const [alice, bob] = await conversa();
    await Promise.all([alice.correio.parar(), bob.correio.parar()]);
    relogio.avancar(30 * DIA);
    await online(alice, bob);
    const antiga = await mensagem(bob, alice, 'oi');
    expect(await bob.correio.apagarParaTodos(alice.id, [antiga.id])).toHaveLength(1);
    await ate(async () => !(await textos(alice, bob)).includes('oi'), 'some da alice');
    expect(await textos(alice, bob)).toEqual(['oi, alice']);
  });

  it('com o outro fora do ar, some quando ele volta', async () => {
    const [alice, bob] = await conversa();
    await bob.correio.parar();
    const minha = await mensagem(alice, bob, 'oi');
    await alice.correio.apagarParaTodos(bob.id, [minha.id]);
    await avancarAte(() => filaVazia(alice), 'o pedido chega ao relay');
    expect(await textos(bob, alice)).toContain('oi');
    await online(bob);
    await ate(async () => !(await textos(bob, alice)).includes('oi'), 'some ao voltar');
  });

  it('só dentro da própria conversa: um contato não apaga a mensagem de outra', async () => {
    const [alice, bob] = await conversa();
    const carol = await pessoa();
    await online(carol);
    await carol.correio.iniciarConversa(bob.id);
    await carol.correio.enviarTexto(bob.id, 'da carol');
    await recebe(bob, carol, 'da carol');
    const daCarol = await mensagem(bob, carol, 'da carol');

    // Pela API, a Alice nem manda: o ID não é da conversa dela.
    expect(await alice.correio.apagarParaTodos(bob.id, [daCarol.id])).toEqual([]);
    // Um app modificado manda assim mesmo.
    await alice.correio.parar();
    await alice.banco.banco.transacao((t) =>
      enfileirarConteudo(
        {
          cripto,
          identidade: alice.identidade,
          gerarPar: () => cripto.crypto_box_keypair(),
        },
        t,
        lerId(bob.id) ?? new Uint8Array(),
        {
          tipo: 'apagar',
          id: cripto.randombytes_buf(BYTES_DO_ID_DA_MENSAGEM),
          enviadaEm: relogio.agora(),
          ttl: 0,
          apagadas: [daCarol.id],
        },
        relogio.agora(),
      ),
    );
    await online(alice);
    await alice.correio.enviarTexto(bob.id, 'depois');
    await recebe(bob, alice, 'depois');
    expect(await textos(bob, carol)).toEqual(['da carol']);
  });

  it('nada sai para um pedido ou um bloqueado; o pedido de um bloqueado é ignorado', async () => {
    const [alice, bob] = [await pessoa(), await pessoa()];
    await online(alice, bob);
    await alice.correio.iniciarConversa(bob.id);
    await alice.correio.enviarTexto(bob.id, 'oi');
    await recebe(bob, alice, 'oi');
    const oi = await mensagem(bob, alice, 'oi');
    expect(await codigo(bob.correio.apagarParaTodos(alice.id, [oi.id]))).toBe('nao-aceito');
    expect(await textos(bob, alice)).toEqual(['oi']);

    await bob.agenda.aceitar(alice.id);
    await bob.agenda.bloquear(alice.id);
    expect(await codigo(bob.correio.apagarParaTodos(alice.id, [oi.id]))).toBe('bloqueado');
    await alice.correio.apagarParaTodos(bob.id, [oi.id]);
    await avancarAte(
      () => relay.consultar('SELECT count(*) AS n FROM pacotes')[0]?.['n'] === 0,
      'o bob recebe e descarta',
    );
    expect(await textos(bob, alice)).toEqual(['oi']);
  });
});

describe('apagar só neste celular', () => {
  it('some na hora, dá para desfazer, e no fim do prazo sai de verdade; o outro lado não muda', async () => {
    const [alice, bob] = await conversa();
    alice.temporarias.iniciar();
    await alice.correio.enviarTexto(bob.id, 'copiadaalicesome');
    await recebe(bob, alice, 'copiadaalicesome');
    const { id } = await mensagem(alice, bob, 'copiadaalicesome');

    const ate1 = await alice.agenda.apagarSoAqui(bob.id, [id]);
    expect(ate1).toBe(relogio.agora() + PRAZO_DO_DESFAZER);
    // Escondida de tudo: da conversa, da prévia da lista e da busca.
    expect(await textos(alice, bob)).toEqual(['oi', 'oi, alice']);
    expect((await alice.agenda.conversa(bob.id))?.ultima?.texto).toBe('oi, alice');
    expect((await alice.agenda.buscar('copiadaalicesome')).mensagens).toEqual([]);

    expect(await alice.agenda.desfazer(bob.id, [id])).toBe(true);
    expect(await textos(alice, bob)).toEqual(['oi', 'oi, alice', 'copiadaalicesome']);

    await alice.agenda.apagarSoAqui(bob.id, [id]);
    await andarAte(relogio.agora() + PRAZO_DO_DESFAZER);
    await ate(() => !noArquivo(alice, 'copiadaalicesome'), 'sai do arquivo');
    expect(await alice.agenda.desfazer(bob.id, [id])).toBe(false);
    expect(await textos(alice, bob)).toEqual(['oi', 'oi, alice']);
    expect(await textos(bob, alice)).toEqual(['oi', 'oi, alice', 'copiadaalicesome']);
  });

  it('ao parar, como no bloqueio do app, o que estava escondido sai na hora', async () => {
    const [alice, bob] = await conversa();
    alice.temporarias.iniciar();
    const { id } = await mensagem(alice, bob, 'oi');
    await alice.agenda.apagarSoAqui(bob.id, [id]);
    await alice.temporarias.parar();
    expect(await alice.agenda.desfazer(bob.id, [id])).toBe(false);
    expect(
      await alice.banco.banco.consultar('SELECT count(*) AS n FROM mensagens WHERE id = ?', [id]),
    ).toEqual([{ n: 0 }]);
  });

  it('a nota pessoal também apaga e desfaz', async () => {
    const alice = await pessoa();
    const id = await alice.agenda.escreverNota('lembrete');
    await alice.agenda.apagarSoAqui(alice.id, [id]);
    expect(await alice.agenda.mensagens(alice.id)).toEqual([]);
    expect(await alice.agenda.desfazer(alice.id, [id])).toBe(true);
    expect((await alice.agenda.mensagens(alice.id)).map((m) => m.texto)).toEqual(['lembrete']);
  });
});

describe('apagar conversa deste aparelho (RF-31)', () => {
  it('mensagens e notas saem de verdade; contato, sessão e timer ficam; o outro lado não muda', async () => {
    const [alice, bob] = await conversa();
    await alice.correio.mudarTimer(bob.id, 86_400, false);
    await alice.correio.enviarTexto(bob.id, 'conversainteirasome');
    await recebe(bob, alice, 'conversainteirasome');

    await alice.agenda.apagarConversa(bob.id);
    expect(await alice.agenda.itens(bob.id)).toEqual([]);
    expect(await alice.agenda.conversa(bob.id)).toMatchObject({
      tipo: 'contato',
      timer: 86_400,
      ultima: null,
    });
    expect(noArquivo(alice, 'conversainteirasome')).toBe(false);
    expect(await textos(bob, alice)).toContain('conversainteirasome');

    // A conversa continua na mesma sessão, com o mesmo timer.
    await alice.correio.enviarTexto(bob.id, 'depois de apagar');
    await recebe(bob, alice, 'depois de apagar');
    expect((await mensagem(bob, alice, 'depois de apagar')).ttl).toBe(86_400);
  });

  it('o que esperava na fila para a conversa apagada não sai', async () => {
    const [alice, bob] = await conversa();
    await relay.derrubar();
    await ate(() => alice.eventos.some((e) => e.tipo === 'caixa' && !e.aberta), 'alice cai');
    await alice.correio.enviarTexto(bob.id, 'nunca chega');
    await alice.agenda.apagarConversa(bob.id);
    expect(await filaVazia(alice)).toBe(true);
    await relay.voltar();
    await alice.correio.enviarTexto(bob.id, 'esta chega');
    await avancarAte(async () => (await textos(bob, alice)).includes('esta chega'), 'chega');
    expect(await textos(bob, alice)).toEqual(['oi', 'oi, alice', 'esta chega']);
  });
});
