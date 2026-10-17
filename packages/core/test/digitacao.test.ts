import { describe, expect, it } from 'vitest';
import {
  ate,
  conversa,
  online,
  pessoa,
  redeParada,
  relay,
  type Pessoa,
} from './correio-de-teste.ts';

// O "digitando" (RF-18): sai na hora, fora da fila, só para contato aceito, e só aparece do outro
// lado quando chega com a caixa em dia; o que esperava no relay é velho e não aparece.

const sinais = (p: Pessoa) =>
  p.eventos.flatMap((e) => (e.tipo === 'digitando' ? [e.digitando] : []));

describe('digitando (RF-18)', () => {
  it('chega ao contato na hora, começou e parou, sem entrar na fila nem no banco', async () => {
    const [alice, bob] = await conversa();
    bob.eventos.length = 0;
    await alice.correio.sinalizarDigitacao(bob.id, true);
    await ate(() => sinais(bob).length === 1, 'o bob vê');
    await alice.correio.sinalizarDigitacao(bob.id, false);
    await ate(() => sinais(bob).length === 2, 'o bob vê parar');
    expect(sinais(bob)).toEqual([true, false]);
    expect(await alice.banco.banco.consultar('SELECT count(*) AS n FROM fila')).toEqual([{ n: 0 }]);
    expect((await bob.agenda.mensagens(alice.id)).map((m) => m.texto)).toEqual(['oi', 'oi, alice']);
  });

  it('o que esperava no relay com o contato fora do ar é velho: não aparece', async () => {
    const [alice, bob] = await conversa();
    await bob.correio.parar();
    await alice.correio.sinalizarDigitacao(bob.id, true);
    await ate(
      () =>
        relay.consultar('SELECT count(*) AS n FROM pacotes WHERE caixa = ?', bob.caixa)[0]?.[
          'n'
        ] === 1,
      'o sinal espera na caixa',
    );
    await alice.correio.enviarTexto(bob.id, 'depois');
    await online(bob);
    await ate(async () => (await bob.agenda.mensagens(alice.id)).length === 3, 'a mensagem chega');
    await redeParada();
    expect(sinais(bob)).toEqual([]);
  });

  it('nunca sai para pedido de conversa nem sem sessão com o contato', async () => {
    const [alice, bob] = [await pessoa(), await pessoa()];
    await online(alice, bob);
    await alice.correio.iniciarConversa(bob.id);
    await alice.correio.enviarTexto(bob.id, 'oi');
    await ate(async () => (await bob.agenda.mensagens(alice.id)).length === 1, 'o pedido chega');
    alice.eventos.length = 0;
    // O Bob não aceitou: ele não manda "digitando" para a Alice.
    await bob.correio.sinalizarDigitacao(alice.id, true);
    // A Carol nunca falou com a Alice: sem sessão, nada sai.
    const carol = await pessoa();
    await online(carol);
    await carol.correio.sinalizarDigitacao(alice.id, true);
    await redeParada();
    expect(sinais(alice)).toEqual([]);
  });
});
