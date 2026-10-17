import { describe, expect, it } from 'vitest';
import { marcaAvisa, selarMarca, Vigia } from '../src/index.ts';
import { cripto } from './adaptadores/sodium-node.ts';
import {
  ate,
  avancarAte,
  conversa,
  online,
  pessoa,
  redeParada,
  RELAY,
  relay,
  relogio,
  textos,
  transporte,
  type Pessoa,
} from './correio-de-teste.ts';

// Notificações cegas (RF-42): com o app bloqueado, o vigia abre a caixa principal só com a chave
// da caixa e avisa de cada mensagem nova, sem saber de quem nem o quê, e sem confirmar nada: o relay
// guarda tudo até o desbloqueio. Confirmação de leitura, digitação e controles não avisam.

function vigiaDe(p: Pessoa) {
  const avisos = { n: 0 };
  const vigia = new Vigia({
    cripto,
    transporte: transporte(),
    relogio,
    relay: RELAY,
    sementeDaCaixa: p.sementeDaCaixa,
  });
  vigia.aoChegar(() => avisos.n++);
  return { vigia, avisos };
}

const pacotesNaCaixa = (p: Pessoa) =>
  relay.consultar('SELECT count(*) AS n FROM pacotes WHERE caixa = ?', p.caixa)[0]?.['n'];

/** O Bob bloqueia o app: o correio para e o vigia abre a caixa dele. */
async function bobBloqueado(bob: Pessoa) {
  await bob.correio.parar();
  const vigiado = vigiaDe(bob);
  vigiado.vigia.iniciar();
  await ate(() => vigiado.vigia.aberta, 'o vigia abre a caixa');
  return vigiado;
}

describe('marca de aviso (RF-42)', () => {
  it('só a dona da caixa abre; só a marca que abre e diz não deixa de avisar', () => {
    const semente = cripto.randombytes_buf(32);
    const caixa = cripto.crypto_sign_seed_keypair(semente).publicKey;
    const outra = cripto.crypto_sign_seed_keypair(cripto.randombytes_buf(32)).publicKey;
    expect(marcaAvisa(cripto, selarMarca(cripto, caixa, true), semente)).toBe(true);
    expect(marcaAvisa(cripto, selarMarca(cripto, caixa, false), semente)).toBe(false);
    // Marca de outra caixa, adulterada, de zeros ou do tamanho errado: na dúvida, avisa.
    expect(marcaAvisa(cripto, selarMarca(cripto, outra, false), semente)).toBe(true);
    const adulterada = selarMarca(cripto, caixa, false);
    adulterada[40] = (adulterada[40] ?? 0) ^ 1;
    expect(marcaAvisa(cripto, adulterada, semente)).toBe(true);
    expect(marcaAvisa(cripto, new Uint8Array(49), semente)).toBe(true);
    expect(marcaAvisa(cripto, new Uint8Array(48), semente)).toBe(true);
    // Duas marcas iguais não saem iguais: o relay não separa mensagem de controle pela marca.
    expect(selarMarca(cripto, caixa, false)).not.toEqual(selarMarca(cripto, caixa, false));
    expect(selarMarca(cripto, caixa, true)).toHaveLength(49);
  });
});

describe('vigia do app bloqueado (RF-42)', () => {
  it('avisa uma vez por mensagem e não confirma nada: no desbloqueio, o correio recebe tudo', async () => {
    const [alice, bob] = await conversa();
    const { vigia, avisos } = await bobBloqueado(bob);

    await alice.correio.enviarTexto(bob.id, 'um');
    await alice.correio.enviarTexto(bob.id, 'dois');
    await ate(() => avisos.n === 2, 'dois avisos');
    expect(pacotesNaCaixa(bob)).toBe(2);

    await vigia.parar();
    bob.correio.iniciar();
    await ate(async () => (await textos(bob, alice)).length === 4, 'o bob recebe as duas');
    expect(await textos(bob, alice)).toEqual(['oi', 'oi, alice', 'um', 'dois']);
    await ate(() => pacotesNaCaixa(bob) === 0, 'o correio confirma');
    expect(avisos.n).toBe(2);
  });

  it('confirmação de leitura e mudança do timer não avisam; a mensagem avisa', async () => {
    const [alice, bob] = await conversa();
    const { avisos } = await bobBloqueado(bob);

    await alice.correio.marcarLidas(bob.id, true);
    await alice.correio.mudarTimer(bob.id, 3600, false);
    await ate(() => pacotesNaCaixa(bob) === 2, 'leitura e timer chegam à caixa');
    await alice.correio.enviarTexto(bob.id, 'agora sim');
    await ate(() => avisos.n === 1, 'um aviso, da mensagem');
    await ate(() => pacotesNaCaixa(bob) === 3, 'a mensagem chega à caixa');
    expect(avisos.n).toBe(1);
  });

  it('a entrega de novo depois de uma reconexão não repete o aviso', async () => {
    const [alice, bob] = await conversa();
    const { vigia, avisos } = await bobBloqueado(bob);
    await alice.correio.enviarTexto(bob.id, 'uma vez');
    await ate(() => avisos.n === 1, 'o aviso');

    // Outra conexão abre a mesma caixa e derruba a do vigia; quando ela sai, o vigia volta, e o
    // relay entrega de novo o que não foi confirmado.
    const intruso = vigiaDe(bob);
    intruso.vigia.iniciar();
    await ate(() => intruso.vigia.aberta && !vigia.aberta, 'a caixa muda de conexão');
    await intruso.vigia.parar();
    await avancarAte(() => vigia.aberta, 'o vigia reabre a caixa');
    await ate(() => intruso.avisos.n === 1, 'o intruso recebeu o mesmo pacote');
    expect(avisos.n).toBe(1);
    expect(pacotesNaCaixa(bob)).toBe(1);
    await vigia.parar();
  });

  it('parado, não reabre a caixa: o correio fica com ela', async () => {
    const [, bob] = await conversa();
    const { vigia } = await bobBloqueado(bob);
    await vigia.parar();
    bob.eventos.length = 0;
    bob.correio.iniciar();
    await ate(() => bob.eventos.some((e) => e.tipo === 'caixa' && e.aberta), 'o correio abre');
    // Mais que o maior intervalo de reconexão: o vigia parado não volta.
    for (let i = 0; i < 70; i++) {
      await redeParada();
      relogio.avancar(1000);
    }
    await redeParada();
    expect(bob.eventos.filter((e) => e.tipo === 'caixa' && !e.aberta)).toEqual([]);
    expect(vigia.aberta).toBe(false);
  });

  it('a identidade restaurada em outro aparelho: a caixa some, e o vigia para de tentar (RF-05)', async () => {
    const [, bob] = await conversa();
    const { vigia } = await bobBloqueado(bob);
    const outroAparelho = await pessoa(bob.identidade);
    await online(outroAparelho);
    await avancarAte(() => !vigia.aberta, 'o vigia perde a caixa');
    // Nem com o tempo passando ele volta: a caixa não existe mais.
    for (let i = 0; i < 5; i++) relogio.avancar(60_000);
    await new Promise((pronto) => setTimeout(pronto, 50));
    expect(vigia.aberta).toBe(false);
  });
});
