import { describe, expect, it } from 'vitest';
import {
  ate,
  conversa,
  pessoa,
  redeParada,
  status,
  textos,
  type Pessoa,
} from '../../../packages/core/test/correio-de-teste.ts';
import { ConversasDoApp, type MidiaDoApp, type TelaDoApp } from '../src/conversas.ts';

// Ajustes e privacidade pela tela, sobre o núcleo de verdade e o relay no mesmo processo: copiar o
// próprio ID e o número de segurança (RF-45), o bloqueio de prints (RF-41) e os ajustes de
// privacidade guardados no banco.

interface TelaDeTeste extends TelaDoApp {
  readonly pedidos: boolean[];
}

function telaDeTeste(): TelaDeTeste {
  const tela: TelaDeTeste = {
    pedidos: [],
    definirSegura(segura) {
      tela.pedidos.push(segura);
      return Promise.resolve();
    },
  };
  return tela;
}

function midiaQueCopia(copiados: string[]): MidiaDoApp {
  const nada = () => Promise.reject(new Error('fora do teste'));
  return {
    escolherMidia: nada,
    escolherArquivos: nada,
    preparar: nada,
    salvar: nada,
    salvarArquivo: nada,
    copiar(texto) {
      copiados.push(texto);
      return Promise.resolve();
    },
    esquecerImagens: () => undefined,
  };
}

function appDe(p: Pessoa, opcoes: { tela?: TelaDoApp; copiados?: string[] } = {}) {
  return new ConversasDoApp({
    agenda: p.agenda,
    correio: p.correio,
    temporarias: p.temporarias,
    identidade: p.identidade,
    aoSubstituir: () => undefined,
    ...(opcoes.copiados ? { midia: midiaQueCopia(opcoes.copiados) } : {}),
    ...(opcoes.tela ? { tela: opcoes.tela } : {}),
  });
}

describe('copiar o próprio ID e o número de segurança (RF-45)', () => {
  it('copia o texto como veio, marcado como sensível pela plataforma', async () => {
    const [alice, bob] = await conversa();
    const copiados: string[] = [];
    const app = appDe(alice, { copiados });
    expect(await app.copiarTexto(app.meuId)).toBe(true);
    const numero = await alice.agenda.numeroDeSeguranca(bob.id);
    expect(await app.copiarTexto(numero.join(' '))).toBe(true);
    expect(copiados).toEqual([alice.id, numero.join(' ')]);
    // O número copiado tem 12 grupos de 5 dígitos, separados por espaço, iguais nos dois lados.
    expect(copiados[1]).toMatch(/^\d{5}( \d{5}){11}$/);
    expect(await bob.agenda.numeroDeSeguranca(alice.id)).toEqual(numero);
  });

  it('sem a área de transferência, ou sem texto, não copia', async () => {
    const alice = await pessoa();
    expect(await appDe(alice).copiarTexto(alice.id)).toBe(false);
    expect(await appDe(alice, { copiados: [] }).copiarTexto('')).toBe(false);
  });
});

describe('bloqueio de prints (RF-41)', () => {
  it('ligado por padrão; desligado, vale com a sessão aberta e religa ao fechar', async () => {
    const alice = await pessoa();
    const tela = telaDeTeste();
    const app = appDe(alice, { tela });
    app.iniciar();
    await ate(() => tela.pedidos.length === 1, 'a janela segue o ajuste');
    expect(tela.pedidos).toEqual([true]);
    expect(app.privacidade).toEqual({
      confirmacoesDeLeitura: false,
      indicadorDeDigitacao: false,
      bloquearSozinho: 300,
      bloquearCapturas: true,
    });

    await app.mudarPrivacidade({ bloquearCapturas: false });
    expect(tela.pedidos.at(-1)).toBe(false);
    await app.parar();
    // Ao fechar a sessão, o primeiro pedido é deixar os prints em branco de novo.
    expect(tela.pedidos.at(-1)).toBe(true);

    // A próxima sessão começa com o ajuste guardado.
    const depois = telaDeTeste();
    const outra = appDe(alice, { tela: depois });
    outra.iniciar();
    await ate(() => depois.pedidos.length === 1, 'a janela segue o ajuste guardado');
    expect(depois.pedidos).toEqual([false]);
    expect(outra.privacidade.bloquearCapturas).toBe(false);
    await outra.parar();
    expect(depois.pedidos).toEqual([false, true]);
  });

  it('mudança que chega depois de fechar não abre a janela', async () => {
    const alice = await pessoa();
    await alice.agenda.mudarAjustesDePrivacidade({ bloquearCapturas: false });
    const tela = telaDeTeste();
    const app = appDe(alice, { tela });
    app.iniciar();
    await app.parar();
    // A leitura do ajuste pode terminar depois de fechar: a janela continua segura.
    await new Promise((pronto) => setTimeout(pronto, 50));
    expect(tela.pedidos.at(-1)).toBe(true);
    expect(tela.pedidos).not.toContain(false);
  });
});

describe('prints bloqueados na conversa (RF-58) e apagar para os dois (RF-59)', () => {
  it('a tela da conversa protegida fica sem print, mesmo com o ajuste geral desligado', async () => {
    const [alice, bob] = await conversa();
    await alice.agenda.mudarAjustesDePrivacidade({ bloquearCapturas: false });
    const tela = telaDeTeste();
    const app = appDe(alice, { tela });
    app.iniciar();
    await ate(() => tela.pedidos.length === 1, 'a janela segue o ajuste');
    expect(tela.pedidos).toEqual([false]);

    expect(await app.mudarPrints(bob.id, true)).toBe(true);
    expect((await app.agenda.conversa(bob.id))?.printsBloqueados).toBe(true);
    // A conversa e a segurança do contato abertas ao mesmo tempo: só libera quando as duas fecham.
    const soltarConversa = app.protegerTela();
    const soltarSeguranca = app.protegerTela();
    await ate(() => tela.pedidos.at(-1) === true, 'protege');
    soltarConversa();
    soltarConversa();
    await new Promise((pronto) => setTimeout(pronto, 10));
    expect(tela.pedidos.at(-1)).toBe(true);
    soltarSeguranca();
    await ate(() => tela.pedidos.at(-1) === false, 'volta ao ajuste geral');
    // A nota pessoal não tem prints da conversa.
    expect(await app.mudarPrints(app.meuId, true)).toBe(false);
    await app.parar();
  });

  it('apagar para os dois esvazia a conversa nos dois celulares', async () => {
    const [alice, bob] = await conversa();
    const app = appDe(alice);
    app.iniciar();
    expect(await app.apagarConversaParaOsDois(bob.id)).toBe(true);
    expect(await textos(alice, bob)).toEqual([]);
    await ate(async () => (await textos(bob, alice)).length === 0, 'some do Bob');
    expect(await app.apagarConversaParaOsDois(app.meuId)).toBe(false);
    await app.parar();
  });
});

describe('confirmação de leitura (RF-17)', () => {
  it('desligada por padrão: ler não avisa o contato; ligada, ele vê "lida"', async () => {
    const [alice, bob] = await conversa();
    const app = appDe(bob);
    app.iniciar();
    await ate(() => !app.privacidade.confirmacoesDeLeitura, 'os ajustes lidos');
    const primeira = await alice.correio.enviarTexto(bob.id, 'você leu?');
    await ate(async () => (await textos(bob, alice)).includes('você leu?'), 'o bob recebe');
    await app.ler(alice.id);
    await redeParada();
    expect(await status(alice, bob, primeira)).toBe('enviada');

    await app.mudarPrivacidade({ confirmacoesDeLeitura: true });
    const segunda = await alice.correio.enviarTexto(bob.id, 'e agora?');
    await ate(async () => (await textos(bob, alice)).includes('e agora?'), 'o bob recebe');
    await app.ler(alice.id);
    await ate(async () => (await status(alice, bob, segunda)) === 'lida', 'a alice vê lida');
    await app.parar();
  });

  it('pedido de conversa nunca recebe a confirmação, mesmo ligada (RF-07)', async () => {
    const [alice, bob] = [await pessoa(), await pessoa()];
    alice.correio.iniciar();
    bob.correio.iniciar();
    await ate(() => alice.eventos.some((e) => e.tipo === 'caixa' && e.aberta), 'alice online');
    await ate(() => bob.eventos.some((e) => e.tipo === 'caixa' && e.aberta), 'bob online');
    await alice.correio.iniciarConversa(bob.id);
    const id = await alice.correio.enviarTexto(bob.id, 'oi, sou a alice');
    await ate(async () => (await bob.agenda.conversa(alice.id))?.naoLidas === 1, 'o pedido chega');
    const app = appDe(bob);
    await app.mudarPrivacidade({ confirmacoesDeLeitura: true });
    await app.ler(alice.id);
    await redeParada();
    expect(await status(alice, bob, id)).toBe('enviada');
  });
});

describe('indicador de digitação (RF-18)', () => {
  it('desligado por padrão: nada sai; ligado nos dois, o outro vê e para de ver', async () => {
    const [alice, bob] = await conversa();
    const daAlice = appDe(alice);
    const doBob = appDe(bob);
    daAlice.iniciar();
    doBob.iniciar();
    await ate(() => !daAlice.privacidade.indicadorDeDigitacao, 'os ajustes lidos');
    bob.eventos.length = 0;
    daAlice.escrevendo(bob.id, 'o');
    await redeParada();
    expect(bob.eventos.filter((e) => e.tipo === 'digitando')).toEqual([]);

    await daAlice.mudarPrivacidade({ indicadorDeDigitacao: true });
    await doBob.mudarPrivacidade({ indicadorDeDigitacao: true });
    daAlice.escrevendo(bob.id, 'oi');
    await ate(() => doBob.digitando(alice.id), 'o bob vê a alice escrevendo');
    daAlice.escrevendo(bob.id, '');
    await ate(() => !doBob.digitando(alice.id), 'o bob vê que parou');
    // Na nota pessoal, nada sai.
    daAlice.escrevendo(alice.id, 'só para mim');
    await daAlice.parar();
    await doBob.parar();
  });
});
