import { describe, expect, it } from 'vitest';
import {
  BYTES_DA_MARCA,
  aberturaAutentica,
  apagarCaixaAutentico,
  apagarTudoAutentico,
  BYTES_DO_DESAFIO,
  BYTES_DO_ID_DO_PACOTE,
  CODIGOS,
  codificarMensagemDoRelay,
  codificarPedido,
  CONTEXTOS,
  criarCartao,
  criarPublicacao,
  Escritor,
  idDoPacote,
  JANELA_DE_ENTREGA,
  lerMensagemDoRelay,
  lerPedido,
  mensagemDaAbertura,
  mensagemDoApagarCaixa,
  mensagemDoApagarTudo,
  TAMANHO_DO_PACOTE,
  TAMANHO_MAXIMO_DA_MENSAGEM_DO_RELAY,
  TAMANHO_MAXIMO_DA_PUBLICACAO,
  TAMANHO_MAXIMO_DO_PEDIDO,
  type MensagemDoRelay,
  type PedidoAoRelay,
} from '../src/index.ts';
import { novoPar, sodium } from './sodium.ts';

const ONION = 'ws://' + 'a'.repeat(56) + '.onion';
const aleatorio = (tamanho: number) => sodium.randombytes_buf(tamanho);

function cartaoDeTeste() {
  const identidade = novoPar();
  const cartao = criarCartao(
    {
      chaveDeIdentidade: identidade.publicKey,
      prekeyAssinada: { numero: 1, chave: aleatorio(32) },
      caixaPrincipal: aleatorio(32),
      data: Date.UTC(2026, 9, 1),
      relays: [ONION],
    },
    identidade.assinar,
  );
  return { identidade, cartao };
}

function pedidosDeTeste(): PedidoAoRelay[] {
  const { identidade, cartao } = cartaoDeTeste();
  const publicacao = criarPublicacao(
    'acrescentar',
    cartao,
    [{ numero: 2, chave: aleatorio(32) }],
    identidade.assinar,
  );
  return [
    { tipo: 'publicar-cartao', numero: 1, publicacao },
    { tipo: 'buscar-cartao', numero: 2, id: aleatorio(10) },
    { tipo: 'criar-caixa', numero: 3, caixa: aleatorio(32) },
    {
      tipo: 'depositar',
      numero: 4,
      caixa: aleatorio(32),
      pacote: aleatorio(TAMANHO_DO_PACOTE),
      marca: aleatorio(BYTES_DA_MARCA),
    },
    { tipo: 'abrir-caixa', numero: 5, caixa: aleatorio(32), assinatura: aleatorio(64) },
    { tipo: 'confirmar', numero: 0xffffffff, ids: [aleatorio(16), aleatorio(16)] },
    {
      tipo: 'apagar-tudo',
      numero: 7,
      chave: aleatorio(32),
      assinatura: aleatorio(64),
      caixa: aleatorio(32),
      assinaturaDaCaixa: aleatorio(64),
    },
  ];
}

/** Pedido montado à mão, como faria um cliente modificado. */
function pedidoCru(tipo: number, numero: number, ...campos: Uint8Array[]): Uint8Array {
  const escritor = new Escritor().uint8(tipo).uint32(numero);
  for (const campo of campos) escritor.bytes(campo);
  return escritor.resultado();
}

describe('pedidos do app ao relay (RNF-13)', () => {
  it('ida e volta de todos os tipos', () => {
    for (const pedido of pedidosDeTeste()) {
      expect(lerPedido(codificarPedido(pedido)), pedido.tipo).toEqual({ ok: true, pedido });
    }
  });

  it('depósito só com pacote de exatamente 4096 bytes e marca de 49', () => {
    const caixa = aleatorio(32);
    const marca = aleatorio(BYTES_DA_MARCA);
    for (const tamanho of [0, 1, TAMANHO_DO_PACOTE - 1, TAMANHO_DO_PACOTE + 1]) {
      expect(lerPedido(pedidoCru(0x04, 9, caixa, aleatorio(tamanho), marca)), `${tamanho}`).toEqual(
        { ok: false, numero: 9 },
      );
    }
    for (const tamanho of [0, 48, 50]) {
      expect(
        lerPedido(pedidoCru(0x04, 9, caixa, aleatorio(TAMANHO_DO_PACOTE), aleatorio(tamanho))),
        `marca de ${tamanho}`,
      ).toEqual({ ok: false, numero: 9 });
    }
    expect(lerPedido(pedidoCru(0x04, 9, caixa, aleatorio(TAMANHO_DO_PACOTE), marca)).ok).toBe(true);
    expect(BYTES_DA_MARCA).toBe(49);
    expect(() =>
      codificarPedido({ tipo: 'depositar', numero: 1, caixa, pacote: aleatorio(4095), marca }),
    ).toThrow(RangeError);
    expect(() =>
      codificarPedido({
        tipo: 'depositar',
        numero: 1,
        caixa,
        pacote: aleatorio(TAMANHO_DO_PACOTE),
        marca: aleatorio(48),
      }),
    ).toThrow(RangeError);
  });

  it('qualquer falta ou sobra de byte é recusada, em todos os tipos', () => {
    for (const pedido of pedidosDeTeste()) {
      const bytes = codificarPedido(pedido);
      for (let tamanho = 0; tamanho < bytes.length; tamanho++) {
        expect(lerPedido(bytes.subarray(0, tamanho)).ok, `${pedido.tipo} com ${tamanho}`).toBe(
          false,
        );
      }
      const comSobra = new Uint8Array(bytes.length + 1);
      comSobra.set(bytes);
      expect(lerPedido(comSobra).ok, pedido.tipo).toBe(false);
    }
  });

  it('devolve o número do pedido quando dá para ler, para a resposta de formato inválido', () => {
    expect(lerPedido(new Uint8Array(0))).toEqual({ ok: false, numero: null });
    expect(lerPedido(new Uint8Array([0x04, 0, 0]))).toEqual({ ok: false, numero: null });
    expect(lerPedido(pedidoCru(0x04, 77))).toEqual({ ok: false, numero: 77 });
  });

  it('recusa tipo desconhecido, inclusive os tipos que só o relay manda', () => {
    for (const tipo of [0x00, 0x08, 0x80, 0x81, 0x86, 0xff]) {
      expect(lerPedido(pedidoCru(tipo, 1, aleatorio(32))), `${tipo}`).toEqual({
        ok: false,
        numero: 1,
      });
    }
  });

  it(`confirmar leva de 1 a ${JANELA_DE_ENTREGA} IDs, sem repetir`, () => {
    const ids = (n: number) => Array.from({ length: n }, () => aleatorio(BYTES_DO_ID_DO_PACOTE));
    const confirmar = (lista: Uint8Array[]) =>
      pedidoCru(0x06, 1, new Uint8Array([lista.length]), ...lista);
    expect(lerPedido(confirmar(ids(1))).ok).toBe(true);
    expect(lerPedido(confirmar(ids(JANELA_DE_ENTREGA))).ok).toBe(true);
    expect(lerPedido(confirmar([])).ok).toBe(false);
    expect(lerPedido(confirmar(ids(JANELA_DE_ENTREGA + 1))).ok).toBe(false);
    const repetido = aleatorio(BYTES_DO_ID_DO_PACOTE);
    expect(lerPedido(confirmar([repetido, repetido])).ok).toBe(false);
  });

  it('recusa publicação com cartão fora do formato', () => {
    const { identidade, cartao } = cartaoDeTeste();
    const { bytes } = criarPublicacao('acrescentar', cartao, [], identidade.assinar);
    const versaoErrada = bytes.slice();
    versaoErrada[1] = 9; // primeiro byte do cartão, logo depois do modo
    expect(lerPedido(pedidoCru(0x01, 3, versaoErrada))).toEqual({ ok: false, numero: 3 });
  });

  it('o maior pedido possível é uma publicação cheia, e nada maior é lido', () => {
    expect(TAMANHO_MAXIMO_DO_PEDIDO).toBe(1 + 4 + TAMANHO_MAXIMO_DA_PUBLICACAO);
    expect(lerPedido(new Uint8Array(TAMANHO_MAXIMO_DO_PEDIDO + 1))).toEqual({
      ok: false,
      numero: null,
    });
  });
});

describe('mensagens do relay ao app', () => {
  function mensagensDeTeste(): MensagemDoRelay[] {
    const { cartao } = cartaoDeTeste();
    return [
      { tipo: 'ola', versao: 1, desafio: aleatorio(BYTES_DO_DESAFIO) },
      ...CODIGOS.map((codigo, i) => ({ tipo: 'resposta' as const, numero: i, codigo })),
      { tipo: 'cartao-publicado', numero: 8, prekeys: 100 },
      { tipo: 'cartao-encontrado', numero: 9, cartao, prekey: { numero: 3, chave: aleatorio(32) } },
      { tipo: 'cartao-encontrado', numero: 10, cartao, prekey: null },
      {
        tipo: 'pacote',
        id: aleatorio(16),
        pacote: aleatorio(TAMANHO_DO_PACOTE),
        marca: aleatorio(BYTES_DA_MARCA),
      },
      { tipo: 'em-dia' },
      { tipo: 'caixa-substituida' },
    ];
  }

  it('código publicado não muda de byte: o novo entra no fim', () => {
    const byte = (codigo: (typeof CODIGOS)[number]) =>
      codificarMensagemDoRelay({ tipo: 'resposta', numero: 1, codigo }).at(-1);
    expect(byte('ok')).toBe(0);
    expect(byte('caixa-fechada')).toBe(11);
    expect(byte('caixa-substituida')).toBe(12);
    expect(codificarMensagemDoRelay({ tipo: 'caixa-substituida' })).toEqual(new Uint8Array([0x86]));
  });

  it('ida e volta de todos os tipos e códigos', () => {
    for (const mensagem of mensagensDeTeste()) {
      expect(lerMensagemDoRelay(codificarMensagemDoRelay(mensagem)), mensagem.tipo).toEqual(
        mensagem,
      );
    }
  });

  it('o app também não confia no relay: falta, sobra e valores fora do formato', () => {
    for (const mensagem of mensagensDeTeste()) {
      const bytes = codificarMensagemDoRelay(mensagem);
      for (let tamanho = 0; tamanho < bytes.length; tamanho++) {
        expect(lerMensagemDoRelay(bytes.subarray(0, tamanho)), mensagem.tipo).toBeNull();
      }
      const comSobra = new Uint8Array(bytes.length + 1);
      comSobra.set(bytes);
      expect(lerMensagemDoRelay(comSobra), mensagem.tipo).toBeNull();
    }
    expect(lerMensagemDoRelay(new Uint8Array([0x81, 0, 0, 0, 1, CODIGOS.length]))).toBeNull();
    expect(lerMensagemDoRelay(new Uint8Array([0x82, 0, 0, 0, 1, 101]))).toBeNull();
    expect(lerMensagemDoRelay(new Uint8Array([0x01]))).toBeNull();
    const encontrado = codificarMensagemDoRelay({
      tipo: 'cartao-encontrado',
      numero: 1,
      cartao: cartaoDeTeste().cartao,
      prekey: null,
    });
    const marcaInvalida = encontrado.slice();
    marcaInvalida[marcaInvalida.length - 1] = 2;
    expect(lerMensagemDoRelay(marcaInvalida)).toBeNull();
    expect(lerMensagemDoRelay(new Uint8Array(TAMANHO_MAXIMO_DA_MENSAGEM_DO_RELAY + 1))).toBeNull();
  });
});

describe('ID do pacote', () => {
  it('é o BLAKE2b de 16 bytes do pacote: igual para o mesmo pacote, diferente para outro', () => {
    const pacote = aleatorio(TAMANHO_DO_PACOTE);
    const id = idDoPacote(sodium, pacote);
    expect(id).toHaveLength(BYTES_DO_ID_DO_PACOTE);
    expect(id).toEqual(sodium.crypto_generichash(16, pacote, null));
    expect(idDoPacote(sodium, pacote.slice())).toEqual(id);
    expect(idDoPacote(sodium, aleatorio(TAMANHO_DO_PACOTE))).not.toEqual(id);
  });
});

describe('abertura de caixa com desafio', () => {
  it('vale só a assinatura da chave da caixa sobre o contexto, o desafio e a própria caixa', () => {
    const caixa = novoPar();
    const desafio = aleatorio(BYTES_DO_DESAFIO);
    const assinatura = caixa.assinar(mensagemDaAbertura(desafio, caixa.publicKey));
    expect(aberturaAutentica(sodium, desafio, caixa.publicKey, assinatura)).toBe(true);

    // Desafio de outra conexão, outra caixa, outra chave ou sem o contexto: não abre.
    const outra = novoPar();
    expect(aberturaAutentica(sodium, aleatorio(32), caixa.publicKey, assinatura)).toBe(false);
    expect(aberturaAutentica(sodium, desafio, outra.publicKey, assinatura)).toBe(false);
    const deOutraChave = outra.assinar(mensagemDaAbertura(desafio, caixa.publicKey));
    expect(aberturaAutentica(sodium, desafio, caixa.publicKey, deOutraChave)).toBe(false);
    const semContexto = caixa.assinar(new Uint8Array([...desafio, ...caixa.publicKey]));
    expect(aberturaAutentica(sodium, desafio, caixa.publicKey, semContexto)).toBe(false);
    expect(aberturaAutentica(sodium, desafio, caixa.publicKey, assinatura.subarray(1))).toBe(false);
  });
});

describe('apagar tudo com desafio (pânico)', () => {
  it('vale só a assinatura da chave de identidade sobre o contexto, o desafio e a própria chave', () => {
    const identidade = novoPar();
    const desafio = aleatorio(BYTES_DO_DESAFIO);
    const assinatura = identidade.assinar(mensagemDoApagarTudo(desafio, identidade.publicKey));
    expect(apagarTudoAutentico(sodium, desafio, identidade.publicKey, assinatura)).toBe(true);

    // Desafio de outra conexão, outra chave, a assinatura de outra pessoa ou a de abrir caixa: não.
    const outra = novoPar();
    expect(apagarTudoAutentico(sodium, aleatorio(32), identidade.publicKey, assinatura)).toBe(
      false,
    );
    expect(apagarTudoAutentico(sodium, desafio, outra.publicKey, assinatura)).toBe(false);
    const deOutraChave = outra.assinar(mensagemDoApagarTudo(desafio, identidade.publicKey));
    expect(apagarTudoAutentico(sodium, desafio, identidade.publicKey, deOutraChave)).toBe(false);
    const daAbertura = identidade.assinar(mensagemDaAbertura(desafio, identidade.publicKey));
    expect(apagarTudoAutentico(sodium, desafio, identidade.publicKey, daAbertura)).toBe(false);
    expect(apagarTudoAutentico(sodium, desafio, identidade.publicKey, assinatura.subarray(1))).toBe(
      false,
    );
  });

  it('a caixa principal vale só com a assinatura da chave dela, sobre o contexto próprio', () => {
    const caixa = novoPar();
    const desafio = aleatorio(BYTES_DO_DESAFIO);
    const assinatura = caixa.assinar(mensagemDoApagarCaixa(desafio, caixa.publicKey));
    expect(apagarCaixaAutentico(sodium, desafio, caixa.publicKey, assinatura)).toBe(true);
    expect(apagarCaixaAutentico(sodium, aleatorio(32), caixa.publicKey, assinatura)).toBe(false);
    expect(apagarCaixaAutentico(sodium, desafio, novoPar().publicKey, assinatura)).toBe(false);
    // A de abrir a caixa, no mesmo desafio, não apaga.
    const daAbertura = caixa.assinar(mensagemDaAbertura(desafio, caixa.publicKey));
    expect(apagarCaixaAutentico(sodium, desafio, caixa.publicKey, daAbertura)).toBe(false);
  });

  it('o pedido leva a chave, a caixa e as duas assinaturas, nada mais', () => {
    const pedido = {
      tipo: 'apagar-tudo',
      numero: 3,
      chave: aleatorio(32),
      assinatura: aleatorio(64),
      caixa: aleatorio(32),
      assinaturaDaCaixa: aleatorio(64),
    } as const;
    const bytes = codificarPedido(pedido);
    expect(bytes).toHaveLength(1 + 4 + 32 + 64 + 32 + 64);
    expect(bytes[0]).toBe(0x07);
    expect(() => codificarPedido({ ...pedido, chave: aleatorio(31) })).toThrow(RangeError);
    expect(() => codificarPedido({ ...pedido, caixa: aleatorio(31) })).toThrow(RangeError);
  });
});

describe('contextos das assinaturas', () => {
  it('nenhum contexto é o começo de outro', () => {
    const lista = Object.values(CONTEXTOS);
    for (const [i, a] of lista.entries()) {
      for (const [j, b] of lista.entries()) {
        if (i === j) continue;
        const prefixo = a.length <= b.length && a.every((byte, k) => byte === b[k]);
        expect(prefixo).toBe(false);
      }
    }
  });
});
