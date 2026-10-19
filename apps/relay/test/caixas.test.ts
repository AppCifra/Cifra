import { FECHAMENTOS, idDoPacote, type MensagemDoRelay } from '@cifra/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { Aviso, ClienteDoRelay } from '../scripts/cliente.ts';
import type { LimitesDoRelay } from '../src/relay.ts';
import {
  abrir,
  codigo,
  mensagemDaAberturaDe,
  novoPar,
  pacoteAleatorio,
  sodium,
  subirRelay,
  TAXAS_LIVRES,
  type ParDeTeste,
  type RelayDeTeste,
  marcaDeTeste,
} from './ajuda.ts';

let relay: RelayDeTeste;

async function subir(limites: Partial<LimitesDoRelay> = {}) {
  relay = await subirRelay({ ...TAXAS_LIVRES, ...limites });
  return relay;
}

afterEach(async () => {
  await relay.fechar();
});

async function criar(cliente: ClienteDoRelay, caixa: ParDeTeste) {
  return codigo(await cliente.pedir({ tipo: 'criar-caixa', caixa: caixa.publicKey }));
}

async function depositar(cliente: ClienteDoRelay, caixa: ParDeTeste, pacote = pacoteAleatorio()) {
  return codigo(
    await cliente.pedir({
      tipo: 'depositar',
      caixa: caixa.publicKey,
      pacote,
      marca: marcaDeTeste(),
    }),
  );
}

/** Lê avisos até o `em-dia` e devolve os pacotes recebidos antes dele. */
async function ateEmDia(cliente: ClienteDoRelay): Promise<Uint8Array[]> {
  const pacotes: Uint8Array[] = [];
  for (;;) {
    const aviso = await cliente.proximoAviso();
    if (aviso.tipo === 'em-dia') return pacotes;
    pacotes.push(pacoteDe(aviso).pacote);
  }
}

function pacoteDe(aviso: Aviso): Extract<MensagemDoRelay, { tipo: 'pacote' }> {
  if (aviso.tipo !== 'pacote') throw new Error('esperava um pacote');
  return aviso;
}

/** Dá tempo para o relay mandar o que fosse mandar. */
const pausa = () => new Promise((pronto) => setTimeout(pronto, 50));

describe('vigiar a caixa (RF-42)', () => {
  it('só a marca de cada pacote, os que esperam e os que chegam, sem janela e sem confirmar', async () => {
    await subir({ janelaDeEntrega: 2 });
    const cliente = await relay.conectar();
    const caixa = novoPar();
    await criar(cliente, caixa);
    const depositarCom = (marca: Uint8Array) =>
      cliente.pedir({
        tipo: 'depositar',
        caixa: caixa.publicKey,
        pacote: pacoteAleatorio(),
        marca,
      });
    const marcas = [marcaDeTeste(), marcaDeTeste(), marcaDeTeste()];
    for (const marca of marcas) await depositarCom(marca);

    const vigia = await relay.conectar();
    const assinatura = caixa.assinar(mensagemDaAberturaDe(vigia, caixa));
    const resposta = await vigia.pedir({
      tipo: 'vigiar-caixa',
      caixa: caixa.publicKey,
      assinatura,
    });
    expect(codigo(resposta)).toBe('ok');
    const recebidas = [];
    for (let i = 0; i < 3; i++) recebidas.push(await vigia.proximoAviso());
    expect(recebidas.map((aviso) => aviso.tipo === 'marca' && aviso.marca)).toEqual(marcas);

    const nova = marcaDeTeste();
    await depositarCom(nova);
    const aviso = await vigia.proximoAviso();
    if (aviso.tipo !== 'marca') throw new Error('esperava uma marca');
    expect(aviso.marca).toEqual(nova);
    expect(codigo(await vigia.pedir({ tipo: 'confirmar', ids: [aviso.id] }))).toBe('caixa-fechada');
    expect(relay.consultar('SELECT count(*) AS n FROM pacotes')).toEqual([{ n: 4 }]);
  });
});

describe('caixas: criar, depositar, abrir com desafio e confirmar', () => {
  it('cria a caixa; criar de novo responde ok e não muda nada', async () => {
    await subir();
    const cliente = await relay.conectar();
    const caixa = novoPar();
    expect(await criar(cliente, caixa)).toBe('ok');
    const [antes] = relay.consultar('SELECT expira_em FROM caixas');
    relay.relogio.avancar(10 * 24 * 3_600_000);
    expect(await criar(cliente, caixa)).toBe('ok');
    expect(relay.consultar('SELECT expira_em FROM caixas')).toEqual([antes]);
  });

  it('não deposita em caixa que não existe', async () => {
    await subir();
    const cliente = await relay.conectar();
    expect(await depositar(cliente, novoPar())).toBe('caixa-inexistente');
    expect(relay.consultar('SELECT count(*) AS n FROM pacotes')).toEqual([{ n: 0 }]);
  });

  it('o dono abre com o desafio e recebe tudo na ordem de chegada, depois o em-dia', async () => {
    await subir();
    const [alice, bob] = [await relay.conectar(), await relay.conectar()];
    const caixa = novoPar();
    await criar(bob, caixa);
    const enviados = [pacoteAleatorio(), pacoteAleatorio(), pacoteAleatorio()];
    for (const pacote of enviados) expect(await depositar(alice, caixa, pacote)).toBe('ok');

    expect(codigo(await abrir(bob, caixa))).toBe('ok');
    expect(await ateEmDia(bob)).toEqual(enviados);
  });

  it('cada pacote chega com o ID que o confirma: o BLAKE2b de 16 bytes do pacote', async () => {
    await subir();
    const [alice, bob] = [await relay.conectar(), await relay.conectar()];
    const caixa = novoPar();
    await criar(bob, caixa);
    const pacote = pacoteAleatorio();
    await depositar(alice, caixa, pacote);
    await abrir(bob, caixa);
    expect(pacoteDe(await bob.proximoAviso()).id).toEqual(idDoPacote(sodium, pacote));
  });

  it('com a caixa aberta, o pacote chega na hora', async () => {
    await subir();
    const [alice, bob] = [await relay.conectar(), await relay.conectar()];
    const caixa = novoPar();
    await criar(bob, caixa);
    await abrir(bob, caixa);
    expect(await ateEmDia(bob)).toEqual([]);
    const pacote = pacoteAleatorio();
    await depositar(alice, caixa, pacote);
    expect(pacoteDe(await bob.proximoAviso()).pacote).toEqual(pacote);
  });

  it('o pacote fica até ser confirmado: sem confirmação, volta na próxima abertura', async () => {
    await subir();
    const alice = await relay.conectar();
    const caixa = novoPar();
    await criar(alice, caixa);
    const pacote = pacoteAleatorio();
    await depositar(alice, caixa, pacote);

    const primeira = await relay.conectar();
    await abrir(primeira, caixa);
    const entregue = pacoteDe(await primeira.proximoAviso());
    await primeira.fechar();

    const segunda = await relay.conectar();
    await abrir(segunda, caixa);
    expect(await ateEmDia(segunda)).toEqual([pacote]);
    expect(codigo(await segunda.pedir({ tipo: 'confirmar', ids: [entregue.id] }))).toBe('ok');
    await segunda.fechar();

    const terceira = await relay.conectar();
    await abrir(terceira, caixa);
    expect(await ateEmDia(terceira)).toEqual([]);
    expect(relay.consultar('SELECT count(*) AS n FROM pacotes')).toEqual([{ n: 0 }]);
  });

  it('um reenvio idêntico não duplica: o pacote chega uma vez', async () => {
    await subir();
    const [alice, bob] = [await relay.conectar(), await relay.conectar()];
    const caixa = novoPar();
    await criar(bob, caixa);
    const pacote = pacoteAleatorio();
    expect(await depositar(alice, caixa, pacote)).toBe('ok');
    expect(await depositar(alice, caixa, pacote)).toBe('ok');
    await abrir(bob, caixa);
    expect(await ateEmDia(bob)).toEqual([pacote]);
  });

  it('entrega em janelas: o próximo pacote só sai depois de uma confirmação', async () => {
    await subir({ janelaDeEntrega: 2 });
    const [alice, bob] = [await relay.conectar(), await relay.conectar()];
    const caixa = novoPar();
    await criar(bob, caixa);
    const enviados = [pacoteAleatorio(), pacoteAleatorio(), pacoteAleatorio()];
    for (const pacote of enviados) await depositar(alice, caixa, pacote);

    await abrir(bob, caixa);
    const [primeiro, segundo] = [
      pacoteDe(await bob.proximoAviso()),
      pacoteDe(await bob.proximoAviso()),
    ];
    await pausa();
    expect(bob.avisosRecebidos()).toEqual([]);

    await bob.pedir({ tipo: 'confirmar', ids: [segundo.id] });
    expect(pacoteDe(await bob.proximoAviso()).pacote).toEqual(enviados[2]);
    expect((await bob.proximoAviso()).tipo).toBe('em-dia');
    expect([primeiro.pacote, segundo.pacote]).toEqual(enviados.slice(0, 2));
  });

  it('a assinatura do desafio de outra conexão não abre a caixa e fecha a conexão', async () => {
    await subir();
    const [dono, intruso] = [await relay.conectar(), await relay.conectar()];
    const caixa = novoPar();
    await criar(dono, caixa);
    await depositar(dono, caixa);
    // O intruso reaproveita uma assinatura válida, mas feita para o desafio do dono.
    const assinatura = caixa.assinar(mensagemDaAberturaDe(dono, caixa));
    const resposta = await intruso.pedir({
      tipo: 'abrir-caixa',
      caixa: caixa.publicKey,
      assinatura,
    });
    expect(codigo(resposta)).toBe('assinatura-invalida');
    expect(await intruso.fechamento).toBe(FECHAMENTOS.assinaturaInvalida);
    expect(intruso.avisosRecebidos()).toEqual([]);
  });

  it('outra chave não abre a caixa', async () => {
    await subir();
    const cliente = await relay.conectar();
    const caixa = novoPar();
    await criar(cliente, caixa);
    const impostor = { ...novoPar(), publicKey: caixa.publicKey };
    expect(codigo(await abrir(cliente, impostor))).toBe('assinatura-invalida');
  });

  it('abrir a mesma caixa em outra conexão fecha a anterior: vale a abertura mais nova', async () => {
    await subir();
    const [alice, antiga, nova] = [
      await relay.conectar(),
      await relay.conectar(),
      await relay.conectar(),
    ];
    const caixa = novoPar();
    await criar(alice, caixa);
    await abrir(antiga, caixa);
    expect(codigo(await abrir(nova, caixa))).toBe('ok');
    expect(await antiga.fechamento).toBe(FECHAMENTOS.caixaEmOutraConexao);

    const pacote = pacoteAleatorio();
    await depositar(alice, caixa, pacote);
    expect(await ateEmDia(nova)).toEqual([]);
    expect(pacoteDe(await nova.proximoAviso()).pacote).toEqual(pacote);
  });

  it('uma caixa por conexão', async () => {
    await subir();
    const cliente = await relay.conectar();
    const [primeira, segunda] = [novoPar(), novoPar()];
    await criar(cliente, primeira);
    await criar(cliente, segunda);
    expect(codigo(await abrir(cliente, primeira))).toBe('ok');
    expect(codigo(await abrir(cliente, segunda))).toBe('caixa-ja-aberta');
  });

  it('abrir caixa que não existe: caixa-inexistente', async () => {
    await subir();
    const cliente = await relay.conectar();
    expect(codigo(await abrir(cliente, novoPar()))).toBe('caixa-inexistente');
  });

  it('confirmar sem caixa aberta: caixa-fechada, e nada é apagado', async () => {
    await subir();
    const cliente = await relay.conectar();
    const caixa = novoPar();
    await criar(cliente, caixa);
    const pacote = pacoteAleatorio();
    await depositar(cliente, caixa, pacote);
    const ids = [idDoPacote(sodium, pacote)];
    expect(codigo(await cliente.pedir({ tipo: 'confirmar', ids }))).toBe('caixa-fechada');
    expect(relay.consultar('SELECT count(*) AS n FROM pacotes')).toEqual([{ n: 1 }]);
  });

  it('o dono só apaga da própria caixa', async () => {
    await subir();
    const [alice, bob] = [await relay.conectar(), await relay.conectar()];
    const [deAlice, deBob] = [novoPar(), novoPar()];
    await criar(alice, deAlice);
    await criar(bob, deBob);
    const pacote = pacoteAleatorio();
    await depositar(bob, deAlice, pacote);
    await abrir(bob, deBob);
    const ids = [idDoPacote(sodium, pacote)];
    expect(codigo(await bob.pedir({ tipo: 'confirmar', ids }))).toBe('ok');
    expect(relay.consultar('SELECT count(*) AS n FROM pacotes')).toEqual([{ n: 1 }]);
  });

  it('caixa cheia recusa o depósito, e volta a aceitar depois da confirmação', async () => {
    await subir({ pacotesPorCaixa: 2 });
    const [alice, bob] = [await relay.conectar(), await relay.conectar()];
    const caixa = novoPar();
    await criar(bob, caixa);
    expect(await depositar(alice, caixa)).toBe('ok');
    expect(await depositar(alice, caixa)).toBe('ok');
    expect(await depositar(alice, caixa)).toBe('caixa-cheia');

    await abrir(bob, caixa);
    const entregue = pacoteDe(await bob.proximoAviso());
    await bob.pedir({ tipo: 'confirmar', ids: [entregue.id] });
    expect(await depositar(alice, caixa)).toBe('ok');
  });
});
