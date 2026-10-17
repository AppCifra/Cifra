import { lerId } from '@cifra/protocol';
import { describe, expect, it } from 'vitest';
import { ErroDaAgenda, ErroDoCorreio, type Mensagem } from '../src/index.ts';
import {
  andarAte,
  ate,
  avancarAte,
  caixaAberta,
  conversa,
  DIA,
  HORA,
  online,
  pedidos,
  pessoa,
  redeParada,
  relay,
  relogio,
  textos,
  type Pessoa,
} from './correio-de-teste.ts';

// Mensagens temporárias contra o relay de verdade: timer da conversa (RF-25), timer por mensagem
// (RF-26), contagem a partir do envio (RF-27), mensagem que chega vencida (RF-28) e timer padrão
// das conversas novas (RF-50). Os dois aparelhos usam o mesmo relógio do teste: "no mesmo horário"
// é no mesmo instante dele.

const codigo = (promessa: Promise<unknown>) =>
  promessa.then(
    () => 'aceito',
    (erro: unknown) =>
      erro instanceof ErroDoCorreio || erro instanceof ErroDaAgenda ? erro.codigo : 'outro',
  );

/** A conversa como a tela mostra: os textos e as notas de sistema, em ordem. */
async function itens(p: Pessoa, de: Pessoa): Promise<string[]> {
  return (await p.agenda.itens(de.id)).map((item) => {
    if (item.tipo === 'mensagem') return item.mensagem.texto;
    const { nota } = item;
    if (nota.tipo === 'expirou') return 'expirou';
    if (nota.tipo === 'prints') return nota.bloqueados ? 'prints bloqueados' : 'prints liberados';
    return `timer ${String(nota.segundos)}${nota.anteriores ? ' e anteriores' : ''}`;
  });
}

const timerDe = async (p: Pessoa, de: Pessoa) => (await p.agenda.conversa(de.id))?.timer;

async function mensagem(p: Pessoa, de: Pessoa, texto: string): Promise<Mensagem> {
  const achada = (await p.agenda.mensagens(de.id)).find((m) => m.texto === texto);
  if (!achada) throw new Error(`sem a mensagem "${texto}"`);
  return achada;
}

const recebe = (p: Pessoa, de: Pessoa, texto: string) =>
  ate(async () => (await textos(p, de)).includes(texto), `chega "${texto}"`);

const depositos = (p: Pessoa) =>
  pedidos(p).filter(({ pedido }) => pedido.tipo === 'depositar').length;

/** Os dois saem do ar, o relógio anda um dia e eles voltam: o histórico fica antigo. */
async function umDiaDepois(...lista: Pessoa[]): Promise<void> {
  await Promise.all(lista.map((p) => p.correio.parar()));
  relogio.avancar(DIA);
  await online(...lista);
}

describe('timer da conversa (RF-25)', () => {
  it('um lado muda e os dois passam a usar o mesmo timer, com a nota nos dois', async () => {
    const [alice, bob] = await conversa();
    expect(await alice.correio.mudarTimer(bob.id, 3600, false)).toBe(true);
    expect(await timerDe(alice, bob)).toBe(3600);
    await ate(async () => (await timerDe(bob, alice)) === 3600, 'bob recebe o timer');
    expect(await itens(alice, bob)).toEqual(['oi', 'oi, alice', 'timer 3600']);
    expect(await itens(bob, alice)).toEqual(['oi', 'oi, alice', 'timer 3600']);
    expect(bob.eventos).toContainEqual({ tipo: 'timer', conversa: alice.id, segundos: 3600 });

    // As novas saem com o timer da conversa, dos dois lados.
    await bob.correio.enviarTexto(alice.id, 'com timer');
    await recebe(alice, bob, 'com timer');
    expect((await mensagem(bob, alice, 'com timer')).ttl).toBe(3600);
    expect((await mensagem(alice, bob, 'com timer')).ttl).toBe(3600);

    // Desligar também vale para os dois.
    await bob.correio.mudarTimer(alice.id, 0, false);
    await ate(async () => (await timerDe(alice, bob)) === 0, 'alice desliga');
    expect((await itens(alice, bob)).at(-1)).toBe('timer 0');
    // O mesmo timer de novo não muda nada e não manda nada.
    await redeParada();
    const antes = depositos(alice);
    expect(await alice.correio.mudarTimer(bob.id, 0, false)).toBe(false);
    await redeParada();
    expect(depositos(alice)).toBe(antes);
  });

  it('mudança ao mesmo tempo nos dois lados: vale a mais nova, e os dois acabam no mesmo', async () => {
    const [alice, bob] = await conversa();
    await bob.correio.parar();
    await alice.correio.mudarTimer(bob.id, 3600, false);
    await redeParada();
    relogio.avancar(1000);
    // O Bob muda depois, sem ter recebido a mudança da Alice.
    await bob.correio.mudarTimer(alice.id, 86_400, false);
    await online(bob);
    await avancarAte(
      async () => (await timerDe(alice, bob)) === 86_400 && (await timerDe(bob, alice)) === 86_400,
      'os dois com 1 dia',
    );
    // A da Alice, mais velha, não mexeu no Bob: só a nota da mudança dele.
    expect((await itens(bob, alice)).filter((item) => item.startsWith('timer'))).toEqual([
      'timer 86400',
    ]);
  });

  it('empate no mesmo instante: fica o timer maior, nos dois lados', async () => {
    const [alice, bob] = await conversa();
    await Promise.all([alice.correio.parar(), bob.correio.parar()]);
    await alice.correio.mudarTimer(bob.id, 3600, false);
    await bob.correio.mudarTimer(alice.id, 300, false);
    await online(alice, bob);
    await avancarAte(
      async () => (await timerDe(alice, bob)) === 3600 && (await timerDe(bob, alice)) === 3600,
      'os dois com 1 hora',
    );
  });

  it('de quem não é contato, o timer chega com o pedido; de um ID bloqueado, não muda nada', async () => {
    const [alice, bob] = [await pessoa(), await pessoa()];
    await online(alice, bob);
    await alice.correio.iniciarConversa(bob.id);
    await alice.correio.mudarTimer(bob.id, 3600, false);
    await alice.correio.enviarTexto(bob.id, 'oi');
    await ate(async () => (await bob.agenda.pedidos()).length === 1, 'pedido');
    await recebe(bob, alice, 'oi');
    expect(await timerDe(bob, alice)).toBe(3600);
    expect(await itens(bob, alice)).toEqual(['timer 3600', 'oi']);
    expect((await mensagem(bob, alice, 'oi')).ttl).toBe(3600);

    await bob.agenda.bloquear(alice.id);
    await alice.correio.mudarTimer(bob.id, 86_400, false);
    await alice.correio.enviarTexto(bob.id, 'depois do bloqueio');
    await avancarAte(
      () => relay.consultar('SELECT count(*) AS n FROM pacotes')[0]?.['n'] === 0,
      'o bob recebe e descarta',
    );
    expect(await bob.agenda.conversa(alice.id)).toMatchObject({ bloqueado: true, timer: 3600 });
  });
});

describe('o timer da conversa nas mensagens que já estão nela (RF-25, RF-27)', () => {
  it('"também às anteriores": as sem timer somem dos dois lados no prazo, contado da mudança', async () => {
    const [alice, bob] = await conversa();
    await umDiaDepois(alice, bob);
    const mudanca = relogio.agora();
    await alice.correio.mudarTimer(bob.id, 3600, true);
    await ate(async () => (await timerDe(bob, alice)) === 3600, 'bob recebe');
    for (const [p, de] of [
      [alice, bob],
      [bob, alice],
    ] as const) {
      const prazos = (await p.agenda.mensagens(de.id)).map((m) => [m.ttl, m.expiraEm]);
      expect(prazos).toEqual([
        [3600, mudanca + HORA],
        [3600, mudanca + HORA],
      ]);
      expect((await itens(p, de)).at(-1)).toBe('timer 3600 e anteriores');
    }
  });

  it('"só às novas": as sem timer continuam; as de timer maior passam ao novo, contado da mudança', async () => {
    const [alice, bob] = await conversa();
    // Com a conversa sem timer, uma mensagem com timer próprio de 7 dias.
    await alice.correio.enviarTexto(bob.id, 'uma semana', 604_800);
    await recebe(bob, alice, 'uma semana');
    await umDiaDepois(alice, bob);
    const mudanca = relogio.agora();
    await alice.correio.mudarTimer(bob.id, 3600, false);
    await ate(async () => (await timerDe(bob, alice)) === 3600, 'bob recebe');
    for (const [p, de] of [
      [alice, bob],
      [bob, alice],
    ] as const) {
      expect((await mensagem(p, de, 'oi')).expiraEm).toBeNull();
      expect(await mensagem(p, de, 'uma semana')).toMatchObject({
        ttl: 3600,
        expiraEm: mudanca + HORA,
      });
    }
  });

  it('o timer menor de uma mensagem não muda; aumentar ou desligar o da conversa não muda nada', async () => {
    const [alice, bob] = await conversa();
    await alice.correio.mudarTimer(bob.id, 86_400, false);
    const enviada = relogio.agora();
    await alice.correio.enviarTexto(bob.id, 'dez minutos', 600);
    await alice.correio.enviarTexto(bob.id, 'um dia');
    await recebe(bob, alice, 'um dia');
    await alice.correio.mudarTimer(bob.id, 3600, false);
    await alice.correio.mudarTimer(bob.id, 604_800, false);
    await alice.correio.mudarTimer(bob.id, 0, false);
    await ate(async () => (await timerDe(bob, alice)) === 0, 'bob desliga');
    for (const [p, de] of [
      [alice, bob],
      [bob, alice],
    ] as const) {
      expect((await mensagem(p, de, 'dez minutos')).expiraEm).toBe(enviada + 600_000);
      // Cortada para 1 hora na primeira mudança; depois, aumentar e desligar não a esticam.
      expect((await mensagem(p, de, 'um dia')).expiraEm).toBe(enviada + HORA);
    }
  });
});

describe('timer por mensagem (RF-26)', () => {
  it('nunca maior que o da conversa; sem timer na conversa, de 10 s a 7 dias', async () => {
    const [alice, bob] = await conversa();
    expect(await codigo(alice.correio.enviarTexto(bob.id, 'curta demais', 5))).toBe(
      'timer-invalido',
    );
    expect(await codigo(alice.correio.enviarTexto(bob.id, 'longa demais', 604_801))).toBe(
      'timer-invalido',
    );
    expect(await codigo(alice.correio.enviarTexto(bob.id, 'trinta segundos', 30))).toBe('aceito');
    await alice.correio.mudarTimer(bob.id, 3600, false);
    expect(await codigo(alice.correio.enviarTexto(bob.id, 'duas horas', 7200))).toBe(
      'timer-invalido',
    );
    expect(await codigo(alice.correio.enviarTexto(bob.id, 'sem timer', 0))).toBe('timer-invalido');
    expect(await codigo(alice.correio.enviarTexto(bob.id, 'dez minutos', 600))).toBe('aceito');
    await recebe(bob, alice, 'dez minutos');
    expect(await textos(alice, bob)).toEqual(['oi', 'oi, alice', 'trinta segundos', 'dez minutos']);
    // O timer da mensagem, menor que o da conversa, vale dos dois lados.
    expect((await mensagem(bob, alice, 'dez minutos')).ttl).toBe(600);
    expect((await mensagem(bob, alice, 'trinta segundos')).ttl).toBe(30);
  });

  it('quem recebe corta o timer maior que o da conversa, e dá o da conversa à que vem sem', async () => {
    const [alice, bob] = await conversa();
    await bob.correio.mudarTimer(alice.id, 3600, false);
    await ate(async () => (await timerDe(alice, bob)) === 3600, 'alice recebe');
    // Um app modificado do lado da Alice ignora o timer da conversa.
    await alice.correio.parar();
    await alice.banco.banco.executar('UPDATE contatos SET timer = 0 WHERE contato = ?', [
      lerId(bob.id) ?? new Uint8Array(),
    ]);
    await online(alice);
    const enviada = relogio.agora();
    await alice.correio.enviarTexto(bob.id, 'um dia', 86_400);
    await alice.correio.enviarTexto(bob.id, 'sem timer');
    await recebe(bob, alice, 'sem timer');
    for (const texto of ['um dia', 'sem timer']) {
      expect(await mensagem(bob, alice, texto)).toMatchObject({
        ttl: 3600,
        expiraEm: enviada + HORA,
      });
    }
  });
});

describe('contagem a partir do envio (RF-27)', () => {
  it('a mensagem some dos dois aparelhos no mesmo horário, pela exclusão real', async () => {
    const [alice, bob] = await conversa();
    alice.temporarias.iniciar();
    bob.temporarias.iniciar();
    const enviada = relogio.agora();
    await alice.correio.enviarTexto(bob.id, 'some em dez segundos', 10);
    await recebe(bob, alice, 'some em dez segundos');
    expect((await mensagem(alice, bob, 'some em dez segundos')).expiraEm).toBe(enviada + 10_000);
    expect((await mensagem(bob, alice, 'some em dez segundos')).expiraEm).toBe(enviada + 10_000);

    await andarAte(enviada + 9_999);
    expect(await textos(alice, bob)).toContain('some em dez segundos');
    expect(await textos(bob, alice)).toContain('some em dez segundos');

    await andarAte(enviada + 10_000);
    await ate(
      async () =>
        !(await textos(alice, bob)).includes('some em dez segundos') &&
        !(await textos(bob, alice)).includes('some em dez segundos'),
      'some dos dois',
    );
    expect(relogio.agora()).toBe(enviada + 10_000);
    // Saiu de verdade: nem na busca.
    expect((await alice.agenda.buscar('dez segundos')).mensagens).toEqual([]);
    expect((await bob.agenda.buscar('dez segundos')).mensagens).toEqual([]);
  });

  it('a pendente que vence antes de sair não sai mais', async () => {
    const [alice, bob] = await conversa();
    alice.temporarias.iniciar();
    await relay.derrubar();
    await ate(() => alice.eventos.some((e) => e.tipo === 'caixa' && !e.aberta), 'alice cai');
    const enviada = relogio.agora();
    await alice.correio.enviarTexto(bob.id, 'nunca sai', 10);
    await andarAte(enviada + 10_000);
    await ate(async () => !(await textos(alice, bob)).includes('nunca sai'), 'some da alice');
    expect(await alice.banco.banco.consultar('SELECT count(*) AS n FROM fila')).toEqual([{ n: 0 }]);

    await relay.voltar();
    await alice.correio.enviarTexto(bob.id, 'esta sai');
    await avancarAte(async () => (await textos(bob, alice)).includes('esta sai'), 'chega');
    expect(await textos(bob, alice)).toEqual(['oi', 'oi, alice', 'esta sai']);
  });

  it('o que venceu com o app fechado sai antes da primeira leitura', async () => {
    const [alice, bob] = await conversa();
    await alice.correio.enviarTexto(bob.id, 'curta', 10);
    await recebe(bob, alice, 'curta');
    // O app do Bob fecha; o prazo passa com ele fechado.
    await bob.correio.parar();
    await andarAte(relogio.agora() + 11_000);
    bob.temporarias.iniciar();
    // A primeira leitura depois de abrir já vem sem ela.
    expect(await textos(bob, alice)).toEqual(['oi', 'oi, alice']);
  });
});

describe('mensagem que chega vencida (RF-28)', () => {
  it('timer de 10 s com o destinatário fora do ar: o conteúdo não fica, e aparece a nota', async () => {
    const [alice, bob] = await conversa();
    await bob.correio.parar();
    const id = await alice.correio.enviarTexto(bob.id, 'segredo de dez segundos', 10);
    await avancarAte(
      async () => (await alice.agenda.mensagens(bob.id)).some((m) => m.status === 'enviada'),
      'no relay',
    );
    await andarAte(relogio.agora() + 11_000);
    await online(bob);
    await ate(async () => (await itens(bob, alice)).at(-1) === 'expirou', 'a nota');
    expect(await itens(bob, alice)).toEqual(['oi', 'oi, alice', 'expirou']);
    expect(bob.eventos).toContainEqual({ tipo: 'expirada', conversa: alice.id, pedido: false });
    expect((await bob.agenda.buscar('segredo')).mensagens).toEqual([]);
    const guardadas = await bob.banco.banco.consultar(
      'SELECT count(*) AS n FROM mensagens WHERE id = ?',
      [id],
    );
    expect(guardadas).toEqual([{ n: 0 }]);
  });

  it('a recebida que vence sem ser lida também deixa a nota; a lida, não', async () => {
    const [alice, bob] = await conversa();
    bob.temporarias.iniciar();
    await bob.agenda.marcarLidas(alice.id);
    const enviada = relogio.agora();
    await alice.correio.enviarTexto(bob.id, 'lida a tempo', 30);
    await recebe(bob, alice, 'lida a tempo');
    await bob.agenda.marcarLidas(alice.id);
    await alice.correio.enviarTexto(bob.id, 'ninguém leu', 30);
    await recebe(bob, alice, 'ninguém leu');
    await andarAte(enviada + 30_000);
    await ate(async () => (await textos(bob, alice)).length === 2, 'as duas somem');
    expect(await itens(bob, alice)).toEqual(['oi', 'oi, alice', 'expirou']);
  });
});

describe('timer padrão das conversas novas (RF-50)', () => {
  it('o contato adicionado começa com o timer padrão; ele só fica sabendo com a primeira mensagem', async () => {
    const [alice, bob] = [await pessoa(), await pessoa()];
    await online(alice, bob);
    await alice.agenda.mudarTimerPadrao(86_400);
    expect(await alice.agenda.ajustesDoTimer()).toEqual({ timerPadrao: 86_400, timerDaNota: 0 });
    await alice.correio.iniciarConversa(bob.id);
    expect(await timerDe(alice, bob)).toBe(86_400);
    expect(await itens(alice, bob)).toEqual(['timer 86400']);
    // Adicionar não mandou nada ao Bob.
    await redeParada();
    expect(depositos(alice)).toBe(0);

    await alice.correio.enviarTexto(bob.id, 'oi');
    await ate(async () => (await bob.agenda.pedidos()).length === 1, 'pedido');
    await recebe(bob, alice, 'oi');
    expect(await timerDe(bob, alice)).toBe(86_400);
    expect(await itens(bob, alice)).toEqual(['timer 86400', 'oi']);
    expect((await mensagem(bob, alice, 'oi')).ttl).toBe(86_400);
  });

  it('o pedido aceito começa com o padrão, e o contato passa a usar o mesmo; as conversas que já existem não mudam', async () => {
    const [alice, bob] = await conversa();
    const carol = await pessoa();
    await online(carol);
    await bob.agenda.mudarTimerPadrao(3600);
    expect(await timerDe(bob, alice)).toBe(0);

    await carol.correio.iniciarConversa(bob.id);
    await carol.correio.enviarTexto(bob.id, 'oi, bob');
    await recebe(bob, carol, 'oi, bob');
    await bob.agenda.aceitar(carol.id);
    expect(await timerDe(bob, carol)).toBe(3600);
    expect(await itens(bob, carol)).toEqual(['oi, bob', 'timer 3600']);
    await bob.correio.enviarTexto(carol.id, 'oi, carol');
    await recebe(carol, bob, 'oi, carol');
    expect(await timerDe(carol, bob)).toBe(3600);
    expect((await mensagem(carol, bob, 'oi, carol')).ttl).toBe(3600);
  });

  it('se quem escreveu escolheu um timer, aceitar o pedido não troca pelo padrão', async () => {
    const [carol, bob] = [await pessoa(), await pessoa()];
    await online(carol, bob);
    await bob.agenda.mudarTimerPadrao(3600);
    await carol.correio.iniciarConversa(bob.id);
    await carol.correio.mudarTimer(bob.id, 86_400, false);
    await carol.correio.enviarTexto(bob.id, 'oi, bob');
    await recebe(bob, carol, 'oi, bob');
    await bob.agenda.aceitar(carol.id);
    expect(await timerDe(bob, carol)).toBe(86_400);
  });

  it('o timer padrão vai de 10 s a 7 dias, ou desligado', async () => {
    const alice = await pessoa();
    expect(await codigo(alice.agenda.mudarTimerPadrao(5))).toBe('timer-invalido');
    expect(await codigo(alice.agenda.mudarTimerPadrao(604_801))).toBe('timer-invalido');
    expect(await codigo(alice.agenda.mudarTimerPadrao(0))).toBe('aceito');
  });
});

describe('timer da nota pessoal', () => {
  it('fica só neste aparelho e vale como o de uma conversa', async () => {
    const alice = await pessoa();
    await online(alice);
    alice.temporarias.iniciar();
    await alice.agenda.escreverNota('sem timer');
    expect(await alice.agenda.mudarTimerDaNota(10, false)).toBe(true);
    const escrita = relogio.agora();
    await alice.agenda.escreverNota('dez segundos');
    expect(await codigo(alice.agenda.escreverNota('maior que a nota', 600))).toBe('timer-invalido');
    expect((await alice.agenda.conversa(alice.id))?.timer).toBe(10);
    const notas = await alice.agenda.mensagens(alice.id);
    expect(notas.map((m) => [m.texto, m.expiraEm])).toEqual([
      ['sem timer', null],
      ['dez segundos', escrita + 10_000],
    ]);
    await andarAte(escrita + 10_000);
    await ate(async () => (await alice.agenda.mensagens(alice.id)).length === 1, 'some');
    // Nada saiu do aparelho.
    expect(depositos(alice)).toBe(0);
    expect(caixaAberta(alice)).toBe(true);
  });
});
