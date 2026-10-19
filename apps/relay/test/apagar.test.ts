import { FECHAMENTOS, mensagemDoApagarCaixa, mensagemDoApagarTudo, TAXAS } from '@cifra/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClienteDoRelay } from '../scripts/cliente.ts';
import type { LimitesDoRelay } from '../src/relay.ts';
import {
  abrir,
  codigo,
  contem,
  marcaDeTeste,
  novaIdentidade,
  novoPar,
  pacoteAleatorio,
  publicacaoDe,
  subirRelay,
  TAXAS_LIVRES,
  type IdentidadeDeTeste,
  type ParDeTeste,
  type RelayDeTeste,
} from './ajuda.ts';

// O pânico no relay (RF-48, operação `apagarTudo`): o dono do ID apaga o cartão, as one-time prekeys,
// a caixa principal do cartão e o que esperava nela. Só a chave de identidade assina, e a assinatura
// cobre o desafio da conexão.

let relay: RelayDeTeste;

async function subir(limites: Partial<LimitesDoRelay> = TAXAS_LIVRES) {
  relay = await subirRelay(limites);
  return relay;
}

afterEach(async () => {
  await relay.fechar();
});

/** Uma identidade com o cartão publicado, a caixa criada e dois pacotes esperando nela. */
async function comCartaoECaixa(cliente: ClienteDoRelay) {
  const dono = novaIdentidade();
  const publicacao = publicacaoDe(dono, { prekeys: [1, 2, 3] });
  expect((await cliente.pedir({ tipo: 'publicar-cartao', publicacao })).tipo).toBe(
    'cartao-publicado',
  );
  expect(codigo(await cliente.pedir({ tipo: 'criar-caixa', caixa: dono.caixa.publicKey }))).toBe(
    'ok',
  );
  const pacotes = [pacoteAleatorio(), pacoteAleatorio()];
  for (const pacote of pacotes) {
    const resposta = await cliente.pedir({
      tipo: 'depositar',
      caixa: dono.caixa.publicKey,
      pacote,
      marca: marcaDeTeste(),
    });
    expect(codigo(resposta)).toBe('ok');
  }
  return { dono, cartao: publicacao.cartao.bytes, pacotes };
}

/**
 * Pede para apagar tudo, assinando o desafio desta conexão: o cartão com a chave de `quemAssina`, e
 * a caixa principal do dono com a chave de `quemAssinaACaixa`.
 */
function apagarTudo(
  cliente: ClienteDoRelay,
  dono: IdentidadeDeTeste,
  quemAssina: ParDeTeste = dono,
  quemAssinaACaixa: ParDeTeste = dono.caixa,
) {
  return cliente.pedir({
    tipo: 'apagar-tudo',
    chave: dono.publicKey,
    assinatura: quemAssina.assinar(mensagemDoApagarTudo(cliente.desafio, dono.publicKey)),
    caixa: dono.caixa.publicKey,
    assinaturaDaCaixa: quemAssinaACaixa.assinar(
      mensagemDoApagarCaixa(cliente.desafio, dono.caixa.publicKey),
    ),
  });
}

const contar = (tabela: string) =>
  relay.consultar(`SELECT count(*) AS n FROM ${tabela}`)[0]?.['n'] as number;

describe('apagar tudo no relay (pânico, RF-48)', () => {
  it('o dono apaga o cartão, as prekeys, a caixa principal e os pacotes', async () => {
    await subir();
    const cliente = await relay.conectar();
    const { dono } = await comCartaoECaixa(cliente);
    // Outra pessoa, com cartão e caixa no mesmo relay, não é tocada.
    const outro = await comCartaoECaixa(cliente);
    const antes = {
      cartoes: contar('cartoes'),
      prekeys: contar('prekeys'),
      caixas: contar('caixas'),
      pacotes: contar('pacotes'),
    };

    const panico = await relay.conectar();
    expect(codigo(await apagarTudo(panico, dono))).toBe('ok');

    expect(contar('cartoes')).toBe(antes.cartoes - 1);
    expect(contar('prekeys')).toBe(antes.prekeys - 3);
    expect(contar('caixas')).toBe(antes.caixas - 1);
    expect(contar('pacotes')).toBe(antes.pacotes - 2);
    // Quem busca o cartão não acha; quem deposita na caixa, também não.
    expect(codigo(await cliente.pedir({ tipo: 'buscar-cartao', id: dono.id }))).toBe(
      'cartao-inexistente',
    );
    const deposito = await cliente.pedir({
      tipo: 'depositar',
      caixa: dono.caixa.publicKey,
      pacote: pacoteAleatorio(),
      marca: marcaDeTeste(),
    });
    expect(codigo(deposito)).toBe('caixa-inexistente');
    expect((await cliente.pedir({ tipo: 'buscar-cartao', id: outro.dono.id })).tipo).toBe(
      'cartao-encontrado',
    );
    // Pedir de novo não muda nada: não há mais o que apagar.
    expect(codigo(await apagarTudo(panico, dono))).toBe('ok');
  });

  it('o que foi apagado some do arquivo do relay', async () => {
    await subir();
    const cliente = await relay.conectar();
    const { dono, cartao, pacotes } = await comCartaoECaixa(cliente);
    expect(contem(relay.bytesDoBanco(), cartao)).toBe(true);
    expect(codigo(await apagarTudo(await relay.conectar(), dono))).toBe('ok');
    const arquivo = relay.bytesDoBanco();
    expect(contem(arquivo, cartao)).toBe(false);
    expect(contem(arquivo, dono.publicKey)).toBe(false);
    expect(contem(arquivo, dono.caixa.publicKey)).toBe(false);
    for (const pacote of pacotes) expect(contem(arquivo, pacote)).toBe(false);
  });

  it('com o cartão já vencido, a caixa principal nomeada e os pacotes dela também saem', async () => {
    await subir();
    const cliente = await relay.conectar();
    const { dono } = await comCartaoECaixa(cliente);
    // O cartão vence; a caixa, aberta de vez em quando (o vigia do app bloqueado), não.
    relay.relogio.avancar(89 * 24 * 3_600_000);
    const vigia = await relay.conectar();
    expect(codigo(await abrir(vigia, dono.caixa))).toBe('ok');
    relay.relogio.avancar(2 * 24 * 3_600_000);
    relay.relay.limpar();
    const deposito = await cliente.pedir({
      tipo: 'depositar',
      caixa: dono.caixa.publicKey,
      pacote: pacoteAleatorio(),
      marca: marcaDeTeste(),
    });
    expect(codigo(deposito)).toBe('ok');
    expect([contar('cartoes'), contar('caixas'), contar('pacotes')]).toEqual([0, 1, 1]);

    const outra = await relay.conectar();
    expect(codigo(await apagarTudo(outra, dono))).toBe('ok');
    expect([contar('caixas'), contar('pacotes')]).toEqual([0, 0]);
    expect(await vigia.fechamento).toBe(FECHAMENTOS.caixaApagada);
  });

  it('a conexão que estava com a caixa aberta cai', async () => {
    await subir();
    const cliente = await relay.conectar();
    const { dono } = await comCartaoECaixa(cliente);
    const comACaixa = await relay.conectar();
    expect(codigo(await abrir(comACaixa, dono.caixa))).toBe('ok');

    expect(codigo(await apagarTudo(await relay.conectar(), dono))).toBe('ok');
    expect(await comACaixa.fechamento).toBe(FECHAMENTOS.caixaApagada);
  });

  it('só a chave de identidade do dono, sobre o desafio desta conexão: senão recusa e fecha', async () => {
    await subir();
    const cliente = await relay.conectar();
    const { dono } = await comCartaoECaixa(cliente);

    // Outra chave assina pelo dono.
    const intruso = await relay.conectar();
    expect(codigo(await apagarTudo(intruso, dono, novoPar()))).toBe('assinatura-invalida');
    expect(await intruso.fechamento).toBe(FECHAMENTOS.assinaturaInvalida);

    // A assinatura certa, mas do desafio de outra conexão: não serve aqui.
    const primeira = await relay.conectar();
    const assinatura = dono.assinar(mensagemDoApagarTudo(primeira.desafio, dono.publicKey));
    const segunda = await relay.conectar();
    const repetida = await segunda.pedir({
      tipo: 'apagar-tudo',
      chave: dono.publicKey,
      assinatura,
      caixa: dono.caixa.publicKey,
      assinaturaDaCaixa: dono.caixa.assinar(
        mensagemDoApagarCaixa(segunda.desafio, dono.caixa.publicKey),
      ),
    });
    expect(codigo(repetida)).toBe('assinatura-invalida');
    expect(await segunda.fechamento).toBe(FECHAMENTOS.assinaturaInvalida);

    // A chave da caixa não assina pelo cartão, e outra chave não assina pela caixa.
    const comACaixa = await relay.conectar();
    expect(codigo(await apagarTudo(comACaixa, dono, dono.caixa))).toBe('assinatura-invalida');
    const semACaixa = await relay.conectar();
    expect(codigo(await apagarTudo(semACaixa, dono, dono, novoPar()))).toBe('assinatura-invalida');

    expect(contar('cartoes')).toBe(1);
    expect(contar('caixas')).toBe(1);
    expect(contar('pacotes')).toBe(2);
  });

  it('taxa por conexão: 3 de uma vez, depois 1 por minuto', async () => {
    const taxas = TAXAS_LIVRES.taxas ?? TAXAS;
    await subir({ ...TAXAS_LIVRES, taxas: { ...taxas, apagarTudo: TAXAS.apagarTudo } });
    const cliente = await relay.conectar();
    const semCartao = novaIdentidade();
    // Sem cartão nem caixa, não há o que apagar, e a resposta é a mesma.
    for (let i = 0; i < 3; i++) {
      expect(codigo(await apagarTudo(cliente, semCartao))).toBe('ok');
    }
    expect(codigo(await apagarTudo(cliente, semCartao))).toBe('taxa-excedida');
    relay.relogio.avancar(60_000);
    expect(codigo(await apagarTudo(cliente, semCartao))).toBe('ok');
  });
});
