import { describe, expect, it } from 'vitest';
import {
  andarAte,
  ate,
  conversa,
  online,
  pessoa,
  relogio,
  textos,
  type Pessoa,
} from '../../../packages/core/test/correio-de-teste.ts';
import { ConversasDoApp } from '../src/conversas.ts';

// As conversas do app sobre o núcleo de verdade e o relay no mesmo processo: o que o painel "Nova
// conversa" e a conversa mostram (RF-06, RF-07, RF-19, RF-05), e as temporárias e a exclusão
// (RF-25, RF-26, RF-30, RF-31).

function conversasDe(p: Pessoa, { comCorreio = true } = {}) {
  const avisos = { substituido: 0 };
  const conversas = new ConversasDoApp({
    agenda: p.agenda,
    correio: comCorreio ? p.correio : null,
    temporarias: p.temporarias,
    identidade: p.identidade,
    aoSubstituir: () => {
      avisos.substituido++;
    },
  });
  return Object.assign(conversas, { avisos });
}

describe('nova conversa pelo ID (RF-06)', () => {
  it('o que não é ID, o ID que ninguém usa e o ID de um contato bloqueado', async () => {
    const [alice, bob] = await conversa();
    const app = conversasDe(alice);
    expect(await app.adicionar('nao-e-id')).toEqual({ ok: false, erro: 'id-invalido' });
    const estranho = await pessoa();
    expect(await app.adicionar(estranho.id)).toEqual({ ok: false, erro: 'inexistente' });
    await alice.agenda.bloquear(bob.id);
    expect(await app.adicionar(bob.id)).toEqual({ ok: false, erro: 'bloqueado' });
  });

  it('um ID novo vira contato; o próprio ID abre a nota pessoal; um contato só abre', async () => {
    const [alice, bob] = [await pessoa(), await pessoa()];
    await online(alice, bob);
    const app = conversasDe(alice);
    const versao = app.versao;
    expect(await app.adicionar(bob.id.toLowerCase().replace(/-/g, ' '))).toEqual({
      ok: true,
      id: bob.id,
    });
    expect(app.versao).toBeGreaterThan(versao);
    expect((await alice.agenda.conversa(bob.id))?.tipo).toBe('contato');
    expect(await app.adicionar(alice.id)).toEqual({ ok: true, id: alice.id });
    expect(await app.adicionar(bob.id)).toEqual({ ok: true, id: bob.id });
  });

  it('o ID de um pedido aceita o pedido, mesmo sem conexão', async () => {
    const [alice, bob] = [await pessoa(), await pessoa()];
    await online(alice, bob);
    await alice.correio.iniciarConversa(bob.id);
    await alice.correio.enviarTexto(bob.id, 'oi');
    await ate(async () => (await bob.agenda.pedidos()).length === 1, 'pedido');
    const app = conversasDe(bob, { comCorreio: false });
    expect(await app.adicionar(alice.id)).toEqual({ ok: true, id: alice.id });
    expect(await bob.agenda.pedidos()).toEqual([]);
  });

  it('sem correio, um ID novo avisa que não há conexão', async () => {
    const [alice, bob] = [await pessoa(), await pessoa()];
    const app = conversasDe(alice, { comCorreio: false });
    expect(app.rede).toBe('sem-conexao');
    expect(await app.adicionar(bob.id)).toEqual({ ok: false, erro: 'sem-conexao' });
  });
});

describe('enviar, ler e a conexão', () => {
  it('a nota pessoal fica aqui; texto longo demais não sai; a leitura fica neste aparelho', async () => {
    const [alice, bob] = await conversa();
    const app = conversasDe(alice);
    expect(await app.enviar(alice.id, 'só minha')).toBe('ok');
    expect((await alice.agenda.mensagens(alice.id)).map((m) => m.texto)).toEqual(['só minha']);
    expect(await app.enviar(bob.id, 'x'.repeat(3501))).toBe('longa');
    expect((await alice.agenda.conversa(bob.id))?.naoLidas).toBe(1);
    await app.ler(bob.id);
    expect((await alice.agenda.conversa(bob.id))?.naoLidas).toBe(0);
  });

  it('a linha de status segue a caixa: conectando até abrir, conectado depois', async () => {
    const alice = await pessoa();
    const app = conversasDe(alice);
    expect(app.rede).toBe('conectando');
    app.iniciar();
    await ate(() => app.rede === 'conectado', 'conectado');
    await app.parar();
  });

  it('a identidade restaurada em outro aparelho avisa o app (RF-05)', async () => {
    const alice = await pessoa();
    const app = conversasDe(alice);
    app.iniciar();
    await ate(() => app.rede === 'conectado', 'conectado');
    await online(await pessoa(alice.identidade));
    await ate(() => app.avisos.substituido === 1, 'aviso');
    expect(app.rede).toBe('sem-conexao');
  });
});

describe('temporárias e apagar, pela tela', () => {
  it('o timer da conversa e o desta mensagem; timer maior que o da conversa não sai', async () => {
    const [alice, bob] = await conversa();
    const app = conversasDe(alice);
    expect(await app.mudarTimer(bob.id, 3600, false)).toBe(true);
    expect((await alice.agenda.conversa(bob.id))?.timer).toBe(3600);
    expect(await app.enviar(bob.id, 'dez minutos', 600)).toBe('ok');
    expect(await app.enviar(bob.id, 'duas horas', 7200)).toBe('timer');
    const ultima = (await alice.agenda.mensagens(bob.id)).at(-1);
    expect(ultima).toMatchObject({ texto: 'dez minutos', ttl: 600 });
    await ate(async () => (await textos(bob, alice)).includes('dez minutos'), 'bob recebe');
  });

  it('na nota pessoal, o timer fica só aqui; sem correio, o de um contato não muda', async () => {
    const [alice, bob] = await conversa();
    const semCorreio = conversasDe(alice, { comCorreio: false });
    expect(await semCorreio.mudarTimer(alice.id, 300, false)).toBe(true);
    expect((await alice.agenda.conversa(alice.id))?.timer).toBe(300);
    expect(await semCorreio.enviar(alice.id, 'nota de dez minutos', 600)).toBe('timer');
    expect(await semCorreio.mudarTimer(bob.id, 300, false)).toBe(false);
  });

  it('apagar só aqui some na hora e desfaz; apagar pra todos tira dos dois', async () => {
    const [alice, bob] = await conversa();
    const app = conversasDe(alice);
    const [oi, resposta] = await alice.agenda.mensagens(bob.id);
    if (!oi || !resposta) throw new Error('sem mensagens');
    const versao = app.versao;
    await app.apagarSoAqui(bob.id, [oi.id]);
    expect(app.versao).toBeGreaterThan(versao);
    expect(await textos(alice, bob)).toEqual(['oi, alice']);
    expect(await app.desfazer(bob.id, [oi.id])).toBe(true);
    expect(await textos(alice, bob)).toEqual(['oi', 'oi, alice']);

    expect(await app.apagarParaTodos(bob.id, [resposta.id])).toBe(true);
    expect(await textos(alice, bob)).toEqual(['oi']);
    await ate(async () => (await textos(bob, alice)).length === 1, 'some do bob');
    expect(await app.apagarParaTodos(alice.id, [oi.id])).toBe(false);
  });

  it('a tela fica sabendo quando uma mensagem vence; ao parar, o apagado só aqui sai de vez', async () => {
    const [alice, bob] = await conversa();
    const app = conversasDe(alice);
    app.iniciar();
    await app.enviar(bob.id, 'some logo', 10);
    const versao = app.versao;
    await andarAte(relogio.agora() + 10_000);
    await ate(() => app.versao > versao, 'a tela é avisada');
    expect(await textos(alice, bob)).not.toContain('some logo');

    const [oi] = await alice.agenda.mensagens(bob.id);
    if (!oi) throw new Error('sem mensagens');
    await app.apagarSoAqui(bob.id, [oi.id]);
    await app.parar();
    expect(await app.desfazer(bob.id, [oi.id])).toBe(false);
  });
});
