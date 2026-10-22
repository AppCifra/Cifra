import { codificarMensagemDoRelay, lerMensagemDoRelay } from '@cifra/protocol';
import { describe, expect, it } from 'vitest';
import { Correio, ErroDoCorreio, type EventoDoCorreio } from '../src/index.ts';
import { cripto } from './adaptadores/sodium-node.ts';
import {
  ate,
  avancarAte,
  caixaAberta,
  conversa,
  DIA,
  online,
  pedidos,
  pessoa,
  redeParada,
  relay,
  RELAY,
  relogio,
  textos,
  transporte,
  type Pessoa,
} from './correio-de-teste.ts';

// Um aparelho por ID (RF-05): restaurar a identidade em outro aparelho desconecta o anterior, com
// aviso. Contra o relay de verdade, com a mesma identidade em dois bancos e duas caixas.

const substituido = (p: Pessoa) => p.eventos.some((e) => e.tipo === 'substituido');

const codigo = (promessa: Promise<unknown>) =>
  promessa.then(
    () => 'aceito',
    (erro: unknown) => (erro instanceof ErroDoCorreio ? erro.codigo : 'outro'),
  );

const caixasNoRelay = (caixa: Uint8Array) =>
  relay.consultar('SELECT count(*) AS n FROM caixas WHERE chave = ?', caixa)[0]?.['n'];

describe('um aparelho por ID (RF-05)', () => {
  it('o aparelho anterior, conectado, é avisado na hora e para de vez', async () => {
    const [alice, bob] = await conversa();
    const aliceNova = await pessoa(alice.identidade);
    await online(aliceNova);
    await ate(() => substituido(alice), 'aviso no aparelho antigo');
    expect(caixasNoRelay(alice.caixa)).toBe(0);

    // Não reconecta com o tempo, e nada mais sai dele.
    await redeParada();
    const conexoes = alice.transporte.conexoes.length;
    for (let i = 0; i < 5; i++) {
      relogio.avancar(60_000);
      await redeParada();
    }
    expect(alice.transporte.conexoes).toHaveLength(conexoes);
    expect(await codigo(alice.correio.enviarTexto(bob.id, 'ainda aqui'))).toBe('substituido');
    expect(await codigo(alice.correio.iniciarConversa(bob.id))).toBe('substituido');

    // Nem depois de reiniciar: o banco guarda que este aparelho foi substituído.
    expect(await alice.banco.banco.consultar('SELECT substituido FROM cartao')).toEqual([
      { substituido: 1 },
    ]);
    await alice.correio.parar();
    const outroTransporte = transporte();
    const reiniciado = new Correio({
      cripto,
      banco: alice.banco.banco,
      transporte: outroTransporte,
      relogio,
      identidade: alice.identidade,
      sementeDaCaixa: cripto.randombytes_buf(32),
      relay: RELAY,
    });
    const eventos: EventoDoCorreio[] = [];
    reiniciado.aoMudar((evento) => eventos.push(evento));
    reiniciado.iniciar();
    await ate(() => eventos.some((e) => e.tipo === 'substituido'), 'aviso ao reiniciar');
    await redeParada();
    expect(outroTransporte.conexoes).toEqual([]);
    await reiniciado.parar();
  }, 30_000);

  it('desligado durante a restauração, descobre ao voltar: a caixa sumiu e o cartão aponta outra', async () => {
    const alice = await pessoa();
    await online(alice);
    await alice.correio.parar();
    const aliceNova = await pessoa(alice.identidade);
    await online(aliceNova);

    // Menos de 24 h depois: não renova o cartão, e a caixa não existe mais. Ela não volta.
    const criacoes = () =>
      pedidos(alice).filter(({ pedido }) => pedido.tipo === 'criar-caixa').length;
    const antes = criacoes();
    alice.eventos.length = 0;
    alice.correio.iniciar();
    await ate(() => substituido(alice), 'aviso ao voltar');
    await redeParada();
    expect(criacoes()).toBe(antes);
    expect(caixasNoRelay(alice.caixa)).toBe(0);
    expect(caixasNoRelay(aliceNova.caixa)).toBe(1);
    // O aparelho novo continua com a caixa aberta.
    expect(substituido(aliceNova)).toBe(false);
  }, 30_000);

  it('desligado por mais de um dia, descobre ao renovar o cartão: a renovação é recusada', async () => {
    const alice = await pessoa();
    await online(alice);
    await alice.correio.parar();
    const aliceNova = await pessoa(alice.identidade);
    await online(aliceNova);
    await aliceNova.correio.parar();
    relogio.avancar(2 * DIA);

    const contar = (tipo: string) =>
      pedidos(alice).filter(({ pedido }) => pedido.tipo === tipo).length;
    const [publicacoes, aberturas] = [contar('publicar-cartao'), contar('abrir-caixa')];
    alice.eventos.length = 0;
    alice.correio.iniciar();
    await ate(() => substituido(alice), 'aviso ao renovar');
    await redeParada();
    // Tentou renovar, o relay recusou, e a caixa nem chegou a ser aberta.
    expect(contar('publicar-cartao')).toBe(publicacoes + 1);
    expect(contar('abrir-caixa')).toBe(aberturas);
    expect(alice.eventos.filter((e) => e.tipo === 'cartao')).toEqual([]);
    expect(caixasNoRelay(alice.caixa)).toBe(0);

    // O aparelho novo segue: o cartão no relay ainda é o dele.
    await online(aliceNova);
    expect(substituido(aliceNova)).toBe(false);
  }, 30_000);

  it('o contato que escreve primeiro também chega ao aparelho novo', async () => {
    const [alice, bob] = await conversa();
    await alice.correio.parar();
    const aliceNova = await pessoa(alice.identidade);
    await online(aliceNova);

    await bob.correio.enviarTexto(alice.id, 'para o aparelho novo');
    await avancarAte(
      async () => (await textos(aliceNova, bob)).includes('para o aparelho novo'),
      'chega ao aparelho novo',
    );
    // O aparelho novo ainda não tem os contatos (voltam com o backup, RF-47): chega como pedido.
    expect((await aliceNova.agenda.pedidos()).map(({ id }) => id)).toEqual([bob.id]);
    await aliceNova.correio.iniciarConversa(bob.id);
    await aliceNova.correio.enviarTexto(bob.id, 'recebi aqui');
    await avancarAte(async () => (await textos(bob, alice)).includes('recebi aqui'), 'bob recebe');
  }, 30_000);

  it('o timer da conversa vai de novo para o aparelho novo (RF-25)', async () => {
    const [alice, bob] = await conversa();
    await bob.correio.mudarTimer(alice.id, 3600, false);
    await ate(async () => (await alice.agenda.conversa(bob.id))?.timer === 3600, 'alice recebe');
    await alice.correio.parar();
    const aliceNova = await pessoa(alice.identidade);
    await online(aliceNova);

    // O Bob escreve, acha a caixa nova, recomeça a sessão e manda o timer da conversa de novo.
    await bob.correio.enviarTexto(alice.id, 'para o aparelho novo');
    await avancarAte(
      async () => (await aliceNova.agenda.conversa(bob.id))?.timer === 3600,
      'o aparelho novo usa o mesmo timer',
    );
    expect(await textos(aliceNova, bob)).toEqual(['para o aparelho novo']);
    const [mensagem] = await aliceNova.agenda.mensagens(bob.id);
    expect(mensagem?.ttl).toBe(3600);
  }, 30_000);

  it('o que esperava para sair ao contato é cifrado de novo para o aparelho novo, na ordem', async () => {
    const [alice, bob] = await conversa();
    await alice.correio.parar();
    await relay.derrubar();
    await bob.correio.enviarTexto(alice.id, 'pendente 1');
    await bob.correio.enviarTexto(alice.id, 'pendente 2');

    // O relay volta, e a Alice restaura antes de o Bob reconectar.
    await relay.voltar();
    const aliceNova = await pessoa(alice.identidade);
    await online(aliceNova);
    await avancarAte(
      async () => (await textos(aliceNova, bob)).length === 2,
      'as duas chegam ao aparelho novo',
    );
    expect(await textos(aliceNova, bob)).toEqual(['pendente 1', 'pendente 2']);
    // Nada ficou na fila do Bob.
    await avancarAte(
      async () =>
        (await bob.banco.banco.consultar('SELECT count(*) AS n FROM fila'))[0]?.['n'] === 0,
      'fila vazia',
    );
  }, 30_000);
});

// O aviso `caixa-substituida` e a resposta de mesmo código não vêm assinados: um relay modificado
// mandaria qualquer um deles e pararia o app de vez. A prova é o próprio cartão, assinado pela
// identidade, apontar outra caixa e ser mais novo que o último publicado por este aparelho.
describe('substituição sem prova (RF-05)', () => {
  const contar = (p: Pessoa, tipo: string) =>
    pedidos(p).filter(({ pedido }) => pedido.tipo === tipo).length;
  const substituidoNoBanco = (p: Pessoa) =>
    p.banco.banco.consultar('SELECT substituido FROM cartao');

  it('o aviso que o próprio cartão desmente não para o aparelho: a caixa cai e abre de novo na hora', async () => {
    const [alice, bob] = await conversa();
    const aberturas = contar(alice, 'abrir-caixa');
    alice.eventos.length = 0;
    // O relay manda o aviso forjado antes do próximo pacote da caixa.
    let forjado = false;
    alice.transporte.trocarAoReceber = (dados) => {
      if (forjado || lerMensagemDoRelay(dados)?.tipo !== 'pacote') return null;
      forjado = true;
      return [codificarMensagemDoRelay({ tipo: 'caixa-substituida' }), dados];
    };
    await bob.correio.enviarTexto(alice.id, 'depois do aviso');
    // Sem andar o relógio: a reconexão depois do aviso é imediata.
    await ate(() => contar(alice, 'abrir-caixa') === aberturas + 1, 'a caixa abre de novo');
    await ate(
      async () => (await textos(alice, bob)).includes('depois do aviso'),
      'o pacote chega pela caixa reaberta',
    );
    expect(substituido(alice)).toBe(false);
    expect(await substituidoNoBanco(alice)).toEqual([{ substituido: 0 }]);
    expect(caixasNoRelay(alice.caixa)).toBe(1);
    expect(alice.eventos.filter((e) => e.tipo === 'caixa').map((e) => e.aberta)).toEqual([
      false,
      true,
    ]);
  }, 30_000);

  it('o aviso repetido logo depois espera o intervalo de reconexão', async () => {
    const alice = await pessoa();
    await online(alice);
    const aberturas = contar(alice, 'abrir-caixa');
    // Todo `em-dia` vem com o aviso forjado: a primeira reconexão é na hora, a segunda espera.
    alice.transporte.trocarAoReceber = (dados) =>
      lerMensagemDoRelay(dados)?.tipo === 'em-dia'
        ? [codificarMensagemDoRelay({ tipo: 'caixa-substituida' }), dados]
        : null;
    await alice.correio.parar();
    alice.eventos.length = 0;
    alice.correio.iniciar();
    await ate(() => contar(alice, 'abrir-caixa') === aberturas + 2, 'abre, cai e abre de novo');
    await redeParada();
    expect(contar(alice, 'abrir-caixa')).toBe(aberturas + 2);
    alice.transporte.trocarAoReceber = null;
    await avancarAte(
      () => contar(alice, 'abrir-caixa') === aberturas + 3,
      'a terceira, no intervalo',
    );
    await ate(() => caixaAberta(alice), 'a caixa fica aberta');
    expect(substituido(alice)).toBe(false);
  }, 30_000);

  it('a resposta `caixa-substituida` ao cartão, sem o cartão apontar outra caixa, só derruba a conexão', async () => {
    const alice = await pessoa();
    await online(alice);
    await alice.correio.parar();
    relogio.avancar(2 * DIA);
    const [publicacoes, buscas] = [
      contar(alice, 'publicar-cartao'),
      contar(alice, 'buscar-cartao'),
    ];
    // O relay aceita a renovação, mas responde como se outro aparelho tivesse o cartão.
    let forjado = false;
    alice.transporte.trocarAoReceber = (dados) => {
      const mensagem = lerMensagemDoRelay(dados);
      if (forjado || mensagem?.tipo !== 'cartao-publicado') return null;
      forjado = true;
      return [
        codificarMensagemDoRelay({
          tipo: 'resposta',
          numero: mensagem.numero,
          codigo: 'caixa-substituida',
        }),
      ];
    };
    alice.eventos.length = 0;
    alice.correio.iniciar();
    await avancarAte(() => caixaAberta(alice), 'a caixa abre depois da queda');
    expect(substituido(alice)).toBe(false);
    expect(await substituidoNoBanco(alice)).toEqual([{ substituido: 0 }]);
    // Conferiu o próprio cartão uma vez, caiu, e na volta tentou publicar de novo. O relay já tinha
    // aceitado a primeira: a segunda recebe `cartao-antigo`, e a conferência da hora seguinte acerta.
    expect(contar(alice, 'buscar-cartao')).toBe(buscas + 1);
    expect(contar(alice, 'publicar-cartao')).toBe(publicacoes + 2);
  }, 30_000);

  it('um cartão antigo apontando outra caixa não prova nada: o aparelho novo não para', async () => {
    const alice = await pessoa();
    await online(alice);
    const publicacao = pedidos(alice).find(({ pedido }) => pedido.tipo === 'publicar-cartao');
    if (!publicacao || publicacao.pedido.tipo !== 'publicar-cartao') throw new Error('sem cartão');
    const cartaoAntigo = publicacao.pedido.publicacao.cartao;
    await alice.correio.parar();
    const aliceNova = await pessoa(alice.identidade);
    await online(aliceNova);

    // A caixa do aparelho novo some do relay e, quando ele busca o próprio cartão para entender,
    // o relay devolve o cartão do aparelho antigo, que valeu um dia.
    relay.adulterar('DELETE FROM caixas WHERE chave = ?', aliceNova.caixa);
    aliceNova.transporte.trocarAoReceber = (dados) => {
      const mensagem = lerMensagemDoRelay(dados);
      if (mensagem?.tipo !== 'cartao-encontrado') return null;
      return [
        codificarMensagemDoRelay({
          tipo: 'cartao-encontrado',
          numero: mensagem.numero,
          cartao: cartaoAntigo,
          prekey: null,
        }),
      ];
    };
    await relay.derrubar();
    await relay.voltar();
    aliceNova.eventos.length = 0;
    await avancarAte(() => caixaAberta(aliceNova), 'a caixa volta');
    await redeParada();
    expect(substituido(aliceNova)).toBe(false);
    expect(await substituidoNoBanco(aliceNova)).toEqual([{ substituido: 0 }]);
    expect(caixasNoRelay(aliceNova.caixa)).toBe(1);
    expect(contar(aliceNova, 'buscar-cartao')).toBeGreaterThan(0);
  }, 30_000);
});
