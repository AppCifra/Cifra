import { describe, expect, it } from 'vitest';
import {
  BYTES_DA_ASSINATURA,
  cartaoAutentico,
  CONTEXTOS,
  criarCartao,
  criarPublicacao,
  formatarId,
  idDaChave,
  idDoCartao,
  lerCartao,
  lerPublicacao,
  MAXIMO_DE_PREKEYS,
  MAXIMO_DE_RELAYS,
  publicacaoAutentica,
  TAMANHO_MAXIMO_DA_PUBLICACAO,
  TAMANHO_MAXIMO_DO_CARTAO,
  VERSAO_DO_CARTAO,
  type Assinar,
  type DadosDoCartao,
  type Prekey,
} from '../src/index.ts';
import { novoPar, sodium, type ParDeTeste } from './sodium.ts';

const ONION = 'ws://' + 'a'.repeat(56) + '.onion';
const DATA = Date.UTC(2026, 9, 1);

function dadosDe(identidade: ParDeTeste, mudancas: Partial<DadosDoCartao> = {}): DadosDoCartao {
  return {
    chaveDeIdentidade: identidade.publicKey,
    prekeyAssinada: { numero: 7, chave: sodium.crypto_box_keypair().publicKey },
    caixaPrincipal: novoPar().publicKey,
    data: DATA,
    relays: [ONION],
    ...mudancas,
  };
}

function prekeys(quantidade: number, primeiro = 1): Prekey[] {
  return Array.from({ length: quantidade }, (_, i) => ({
    numero: primeiro + i,
    chave: sodium.crypto_box_keypair().publicKey,
  }));
}

/** Cópia com um bit trocado na posição. */
function adulterar(bytes: Uint8Array, posicao: number): Uint8Array {
  const copia = bytes.slice();
  copia[posicao] = (copia[posicao] ?? 0) ^ 1;
  return copia;
}

describe('cartão de identidade (RF-04, RF-06)', () => {
  it('cria, lê e confere: os campos voltam iguais e as duas assinaturas valem', () => {
    const identidade = novoPar();
    const dados = dadosDe(identidade);
    const cartao = criarCartao(dados, identidade.assinar);

    expect(cartao.versao).toBe(VERSAO_DO_CARTAO);
    expect(cartao.chaveDeIdentidade).toEqual(dados.chaveDeIdentidade);
    expect(cartao.prekeyAssinada.numero).toBe(7);
    expect(cartao.prekeyAssinada.chave).toEqual(dados.prekeyAssinada.chave);
    expect(cartao.caixaPrincipal).toEqual(dados.caixaPrincipal);
    expect(cartao.data).toBe(DATA);
    expect(cartao.relays).toEqual([ONION]);
    expect(lerCartao(cartao.bytes)).toEqual(cartao);
    expect(cartaoAutentico(sodium, cartao)).toBe(true);
  });

  it('o ID do cartão sai da chave de identidade, com a mesma derivação do núcleo', () => {
    const identidade = novoPar();
    const cartao = criarCartao(dadosDe(identidade), identidade.assinar);
    expect(idDoCartao(sodium, cartao)).toEqual(idDaChave(sodium, identidade.publicKey));
    expect(formatarId(idDoCartao(sodium, cartao))).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
  });

  it('qualquer bit trocado invalida o cartão: formato recusado ou assinatura que não confere', () => {
    const identidade = novoPar();
    const cartao = criarCartao(dadosDe(identidade), identidade.assinar);
    for (let posicao = 0; posicao < cartao.bytes.length; posicao++) {
      const lido = lerCartao(adulterar(cartao.bytes, posicao));
      expect(lido === null || !cartaoAutentico(sodium, lido), `posição ${posicao}`).toBe(true);
    }
  });

  it('só a chave de identidade do próprio cartão assina', () => {
    const identidade = novoPar();
    const impostor = novoPar();
    const cartao = criarCartao(dadosDe(identidade), impostor.assinar);
    expect(cartaoAutentico(sodium, cartao)).toBe(false);
  });

  it('cada assinatura cobre o próprio contexto: sem ele, não confere', () => {
    const identidade = novoPar();
    const recebidas: Uint8Array[] = [];
    const registrar: Assinar = (mensagem) => {
      recebidas.push(mensagem);
      return identidade.assinar(mensagem);
    };
    criarCartao(dadosDe(identidade), registrar);
    expect(recebidas.map((m) => m.subarray(0, CONTEXTOS.prekeyAssinada.length))).toContainEqual(
      CONTEXTOS.prekeyAssinada,
    );
    expect(recebidas.map((m) => m.subarray(0, CONTEXTOS.cartao.length))).toContainEqual(
      CONTEXTOS.cartao,
    );

    // Assinando os mesmos bytes sem o contexto, o cartão não vale.
    const semContexto: Assinar = (mensagem) => {
      const contexto = [CONTEXTOS.prekeyAssinada, CONTEXTOS.cartao].find((c) =>
        c.every((byte, i) => mensagem[i] === byte),
      );
      return identidade.assinar(mensagem.subarray(contexto?.length ?? 0));
    };
    expect(cartaoAutentico(sodium, criarCartao(dadosDe(identidade), semContexto))).toBe(false);
  });

  it('confere os bytes do cartão, não os campos do objeto', () => {
    const identidade = novoPar();
    const cartao = criarCartao(dadosDe(identidade), identidade.assinar);
    const outra = criarCartao(dadosDe(novoPar()), identidade.assinar);
    expect(cartaoAutentico(sodium, { ...cartao, bytes: outra.bytes })).toBe(false);
  });

  it('recusa versão desconhecida, falta e sobra de bytes', () => {
    const identidade = novoPar();
    const { bytes } = criarCartao(dadosDe(identidade), identidade.assinar);
    const outraVersao = bytes.slice();
    outraVersao[0] = VERSAO_DO_CARTAO + 1;
    expect(lerCartao(outraVersao)).toBeNull();
    for (let tamanho = 0; tamanho < bytes.length; tamanho++) {
      expect(lerCartao(bytes.subarray(0, tamanho)), `tamanho ${tamanho}`).toBeNull();
    }
    const comSobra = new Uint8Array(bytes.length + 1);
    comSobra.set(bytes);
    expect(lerCartao(comSobra)).toBeNull();
  });

  it('recusa data que não cabe exata em JS', () => {
    const identidade = novoPar();
    const { bytes } = criarCartao(dadosDe(identidade), identidade.assinar);
    // A data fica logo antes da quantidade de relays: versão, chave, prekey assinada e caixa.
    const posicao = 1 + 32 + 4 + 32 + BYTES_DA_ASSINATURA + 32;
    const grande = bytes.slice();
    grande[posicao] = 0xff;
    expect(lerCartao(grande)).toBeNull();
  });

  it(`aceita de 1 a ${MAXIMO_DE_RELAYS} relays válidos e diferentes`, () => {
    const identidade = novoPar();
    const tres = [ONION, 'wss://relay.cifra.example', 'wss://outro.example'];
    expect(criarCartao(dadosDe(identidade, { relays: tres }), identidade.assinar).relays).toEqual(
      tres,
    );
    for (const relays of [
      [],
      [...tres, 'wss://quarto.example'],
      [ONION, ONION],
      ['ws://relay.cifra.example'],
    ]) {
      expect(() => criarCartao(dadosDe(identidade, { relays }), identidade.assinar)).toThrow(
        RangeError,
      );
    }
  });

  it('recusa chave sem 32 bytes e assinatura sem 64', () => {
    const identidade = novoPar();
    expect(() =>
      criarCartao(dadosDe(identidade, { caixaPrincipal: new Uint8Array(31) }), identidade.assinar),
    ).toThrow(RangeError);
    expect(() => criarCartao(dadosDe(identidade), () => new Uint8Array(63))).toThrow(RangeError);
  });

  it('o maior cartão possível tem o tamanho máximo calculado', () => {
    const identidade = novoPar();
    const relays = ['b', 'c', 'd'].map((letra) => `wss://${letra}.example/${'x'.repeat(239)}`);
    expect(relays.every((relay) => relay.length === 255)).toBe(true);
    const cartao = criarCartao(dadosDe(identidade, { relays }), identidade.assinar);
    expect(cartao.bytes.length).toBe(TAMANHO_MAXIMO_DO_CARTAO);
  });
});

describe('publicação do cartão no relay (RF-04)', () => {
  it('cria, lê e confere, nos dois modos', () => {
    const identidade = novoPar();
    const cartao = criarCartao(dadosDe(identidade), identidade.assinar);
    for (const modo of ['acrescentar', 'substituir'] as const) {
      const lote = prekeys(3);
      const publicacao = criarPublicacao(modo, cartao, lote, identidade.assinar);
      expect(publicacao.modo).toBe(modo);
      expect(publicacao.cartao).toEqual(cartao);
      expect(publicacao.prekeys).toEqual(lote);
      expect(lerPublicacao(publicacao.bytes)).toEqual(publicacao);
      expect(publicacaoAutentica(sodium, publicacao)).toBe(true);
    }
  });

  it('ninguém além do dono publica: o cartão alheio com prekeys de outra chave não vale', () => {
    const vitima = novoPar();
    const atacante = novoPar();
    const cartaoDaVitima = criarCartao(dadosDe(vitima), vitima.assinar);
    expect(cartaoAutentico(sodium, cartaoDaVitima)).toBe(true);
    const injetada = criarPublicacao('acrescentar', cartaoDaVitima, prekeys(5), atacante.assinar);
    expect(publicacaoAutentica(sodium, injetada)).toBe(false);
  });

  it('qualquer bit trocado invalida a publicação', () => {
    const identidade = novoPar();
    const cartao = criarCartao(dadosDe(identidade), identidade.assinar);
    const { bytes } = criarPublicacao('acrescentar', cartao, prekeys(2), identidade.assinar);
    for (let posicao = 0; posicao < bytes.length; posicao++) {
      const lida = lerPublicacao(adulterar(bytes, posicao));
      expect(lida === null || !publicacaoAutentica(sodium, lida), `posição ${posicao}`).toBe(true);
    }
  });

  it(`aceita de 0 a ${MAXIMO_DE_PREKEYS} prekeys, sem número repetido`, () => {
    const identidade = novoPar();
    const cartao = criarCartao(dadosDe(identidade), identidade.assinar);
    for (const quantidade of [0, MAXIMO_DE_PREKEYS]) {
      const publicacao = criarPublicacao(
        'acrescentar',
        cartao,
        prekeys(quantidade),
        identidade.assinar,
      );
      expect(publicacao.prekeys).toHaveLength(quantidade);
    }
    expect(() =>
      criarPublicacao('acrescentar', cartao, prekeys(MAXIMO_DE_PREKEYS + 1), identidade.assinar),
    ).toThrow(RangeError);
    const repetidas = [...prekeys(2, 1), ...prekeys(1, 2)];
    expect(() => criarPublicacao('acrescentar', cartao, repetidas, identidade.assinar)).toThrow(
      RangeError,
    );
  });

  it('recusa modo desconhecido, falta e sobra de bytes', () => {
    const identidade = novoPar();
    const cartao = criarCartao(dadosDe(identidade), identidade.assinar);
    const { bytes } = criarPublicacao('acrescentar', cartao, prekeys(1), identidade.assinar);
    const outroModo = bytes.slice();
    outroModo[0] = 2;
    expect(lerPublicacao(outroModo)).toBeNull();
    for (let tamanho = 0; tamanho < bytes.length; tamanho++) {
      expect(lerPublicacao(bytes.subarray(0, tamanho)), `tamanho ${tamanho}`).toBeNull();
    }
    const comSobra = new Uint8Array(bytes.length + 1);
    comSobra.set(bytes);
    expect(lerPublicacao(comSobra)).toBeNull();
  });

  it('a maior publicação possível tem o tamanho máximo calculado', () => {
    const identidade = novoPar();
    const relays = ['b', 'c', 'd'].map((letra) => `wss://${letra}.example/${'x'.repeat(239)}`);
    const cartao = criarCartao(dadosDe(identidade, { relays }), identidade.assinar);
    const publicacao = criarPublicacao(
      'substituir',
      cartao,
      prekeys(MAXIMO_DE_PREKEYS),
      identidade.assinar,
    );
    expect(publicacao.bytes.length).toBe(TAMANHO_MAXIMO_DA_PUBLICACAO);
  });
});
