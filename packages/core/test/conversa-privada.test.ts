import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ErroDoCorreio } from '../src/index.ts';
import {
  ate,
  avancarAte,
  conversa,
  online,
  pessoa,
  redeParada,
  relogio,
  textos,
  type Pessoa,
} from './correio-de-teste.ts';

// Prints bloqueados numa conversa, para os dois (RF-58), e apagar a conversa nos dois celulares
// (RF-59), contra o relay de verdade.

const codigo = (promessa: Promise<unknown>) =>
  promessa.then(
    () => 'aceito',
    (erro: unknown) => (erro instanceof ErroDoCorreio ? erro.codigo : 'outro'),
  );

const printsDe = async (p: Pessoa, de: Pessoa) =>
  (await p.agenda.conversa(de.id))?.printsBloqueados ?? null;

const notasDosPrints = async (p: Pessoa, de: Pessoa) =>
  (await p.agenda.itens(de.id)).flatMap((item) =>
    item.tipo === 'nota' && item.nota.tipo === 'prints'
      ? [item.nota.bloqueados ? 'bloqueados' : 'liberados']
      : [],
  );

const recebe = (p: Pessoa, de: Pessoa, texto: string) =>
  ate(async () => (await textos(p, de)).includes(texto), `chega "${texto}"`);

const noArquivo = (p: Pessoa, texto: string) =>
  readFileSync(p.banco.caminho).toString('utf8').includes(texto);

describe('prints bloqueados na conversa (RF-58)', () => {
  it('qualquer um bloqueia e libera; vale nos dois lados, com nota nos dois', async () => {
    const [alice, bob] = await conversa();
    expect(await printsDe(alice, bob)).toBe(false);

    expect(await alice.correio.mudarPrints(bob.id, true)).toBe(true);
    expect(await printsDe(alice, bob)).toBe(true);
    await ate(async () => (await printsDe(bob, alice)) === true, 'bloqueia no Bob');
    expect(bob.eventos).toContainEqual({ tipo: 'prints', conversa: alice.id, bloqueados: true });
    expect(await notasDosPrints(alice, bob)).toEqual(['bloqueados']);
    expect(await notasDosPrints(bob, alice)).toEqual(['bloqueados']);
    // Bloquear de novo não muda nada.
    expect(await alice.correio.mudarPrints(bob.id, true)).toBe(false);

    // O outro lado também pode liberar.
    expect(await bob.correio.mudarPrints(alice.id, false)).toBe(true);
    await ate(async () => (await printsDe(alice, bob)) === false, 'libera na Alice');
    expect(await notasDosPrints(alice, bob)).toEqual(['bloqueados', 'liberados']);
    expect(await notasDosPrints(bob, alice)).toEqual(['bloqueados', 'liberados']);
    // A nota pessoal nunca tem prints bloqueados.
    expect((await alice.agenda.conversa(alice.id))?.printsBloqueados).toBe(false);
  });

  it('mudança ao mesmo tempo nos dois lados: vale a mais nova, e os dois acabam no mesmo', async () => {
    const [alice, bob] = await conversa();
    await bob.correio.parar();
    await alice.correio.mudarPrints(bob.id, true);
    await redeParada();
    relogio.avancar(1000);
    // O Bob libera depois, sem ter recebido o bloqueio da Alice: era o que ele já tinha, nada muda.
    expect(await bob.correio.mudarPrints(alice.id, false)).toBe(false);
    await bob.correio.mudarPrints(alice.id, true);
    relogio.avancar(1000);
    await bob.correio.mudarPrints(alice.id, false);
    await online(bob);
    await avancarAte(
      async () => (await printsDe(alice, bob)) === false && (await printsDe(bob, alice)) === false,
      'os dois liberados',
    );
  });

  it('só para contato aceito e não bloqueado', async () => {
    const [alice, bob] = await conversa();
    await alice.agenda.bloquear(bob.id);
    expect(await codigo(alice.correio.mudarPrints(bob.id, true))).toBe('bloqueado');
    const carol = await pessoa();
    expect(await codigo(alice.correio.mudarPrints(carol.id, true))).not.toBe('aceito');
  });
});

describe('apagar a conversa nos dois celulares (RF-59)', () => {
  it('some dos dois, sem nota e sem rastro; contato, timer e prints ficam', async () => {
    const [alice, bob] = await conversa();
    await alice.correio.mudarTimer(bob.id, 3600, false);
    await alice.correio.mudarPrints(bob.id, true);
    await alice.correio.enviarTexto(bob.id, 'segredoapagadoalice');
    await bob.correio.enviarTexto(alice.id, 'segredoapagadobob');
    await recebe(bob, alice, 'segredoapagadoalice');
    await recebe(alice, bob, 'segredoapagadobob');

    await alice.correio.apagarConversaParaOsDois(bob.id);
    expect(await alice.agenda.itens(bob.id)).toEqual([]);
    await ate(async () => (await bob.agenda.itens(alice.id)).length === 0, 'some do Bob');
    expect(bob.eventos).toContainEqual({ tipo: 'conversaApagada', conversa: alice.id });
    for (const [p, de] of [
      [alice, bob],
      [bob, alice],
    ] as const) {
      const resumo = await p.agenda.conversa(de.id);
      expect(resumo).toMatchObject({ tipo: 'contato', timer: 3600, printsBloqueados: true });
      expect((await p.agenda.buscar('segredoapagadoalice')).mensagens).toEqual([]);
      expect(noArquivo(p, 'segredoapagadoalice')).toBe(false);
      expect(noArquivo(p, 'segredoapagadobob')).toBe(false);
    }
    // A conversa continua: a sessão ficou.
    await bob.correio.enviarTexto(alice.id, 'depois de apagar');
    await recebe(alice, bob, 'depois de apagar');
  });

  it('o que o outro mandou depois do pedido não some de nenhum dos dois', async () => {
    const [alice, bob] = await conversa();
    await bob.correio.parar();
    await alice.correio.apagarConversaParaOsDois(bob.id);
    await redeParada();
    relogio.avancar(1000);
    // O Bob escreve sem ter recebido o pedido: a mensagem chega depois dele na Alice.
    await bob.correio.enviarTexto(alice.id, 'escrita depois do pedido');
    await online(bob);
    await recebe(alice, bob, 'escrita depois do pedido');
    await avancarAte(
      async () => !(await textos(bob, alice)).includes('oi'),
      'o Bob apaga o que era de antes',
    );
    expect(await textos(bob, alice)).toEqual(['escrita depois do pedido']);
    expect(await textos(alice, bob)).toEqual(['escrita depois do pedido']);
  });

  it('só para contato aceito e não bloqueado', async () => {
    const [alice, bob] = await conversa();
    await alice.agenda.bloquear(bob.id);
    expect(await codigo(alice.correio.apagarConversaParaOsDois(bob.id))).toBe('bloqueado');
  });
});
