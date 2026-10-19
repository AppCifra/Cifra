import {
  criarCartao,
  Escritor,
  iguais,
  Leitor,
  type CabecalhoDaCatraca,
  type Conteudo,
  type Interior,
} from '@cifra/protocol';
import { describe, expect, it } from 'vitest';
import { gerarIdentidade, type Identidade } from '../src/index.ts';
import {
  CHAVES_PULADAS_GUARDADAS,
  cifrar,
  decifrar,
  escreverCatraca,
  iniciarQuemAbre,
  iniciarQuemResponde,
  lerCatraca,
  SALTO_MAXIMO,
  type EstadoDaCatraca,
} from '../src/sessao/catraca.ts';
import {
  cifrarNaSessao,
  codificarSessao,
  decifrarNaSessao,
  lerSessao,
  sessaoDeQuemAbre,
  sessaoDeQuemResponde,
  type Sessao,
} from '../src/sessao/sessao.ts';
import { iniciarX3dh } from '../src/sessao/x3dh.ts';
import { cripto } from './adaptadores/sodium-node.ts';

// Double Ratchet (RNF-02): mensagens fora de ordem, perdidas, repetidas e adulteradas, e o estado
// que nunca muda quando a mensagem não decifra.

const gerarPar = () => cripto.crypto_box_keypair();
const AD = cripto.randombytes_buf(64);
const bytes = (texto: string) => new TextEncoder().encode(texto);
const texto = (b: Uint8Array) => new TextDecoder().decode(b);

interface Mensagem {
  readonly cabecalho: CabecalhoDaCatraca;
  readonly cifrado: Uint8Array;
}

/** Alice abriu a sessão com a prekey do Bob; o Bob ainda não recebeu nada. */
function par(): { alice: EstadoDaCatraca; bob: EstadoDaCatraca } {
  const sk = cripto.randombytes_buf(32);
  const prekey = gerarPar();
  return {
    alice: iniciarQuemAbre(cripto, sk, prekey.publicKey, gerarPar),
    bob: iniciarQuemResponde(sk, prekey),
  };
}

class Lado {
  estado: EstadoDaCatraca;

  constructor(estado: EstadoDaCatraca) {
    this.estado = estado;
  }

  enviar(conteudo: string): Mensagem {
    const r = cifrar(cripto, this.estado, bytes(conteudo), AD);
    this.estado = r.estado;
    return r;
  }

  receber(m: Mensagem): string | null {
    const r = decifrar(cripto, this.estado, m.cabecalho, m.cifrado, AD, gerarPar);
    if (!r) return null;
    this.estado = r.estado;
    return texto(r.texto);
  }
}

function conversa() {
  const { alice, bob } = par();
  return { alice: new Lado(alice), bob: new Lado(bob) };
}

const serializado = (estado: EstadoDaCatraca) => {
  const escritor = new Escritor();
  escreverCatraca(escritor, estado);
  return escritor.resultado();
};

describe('Double Ratchet (RNF-02)', () => {
  it('vai e volta muitas vezes, com passo de DH a cada troca de quem fala', () => {
    const { alice, bob } = conversa();
    for (let rodada = 0; rodada < 20; rodada++) {
      const [fala, ouve] = rodada % 2 === 0 ? [alice, bob] : [bob, alice];
      for (let i = 0; i <= rodada % 3; i++) {
        expect(ouve.receber(fala.enviar(`r${rodada} m${i}`))).toBe(`r${rodada} m${i}`);
      }
    }
  });

  it('quem respondeu não envia antes de receber', () => {
    const { bob } = conversa();
    expect(() => bob.enviar('cedo')).toThrow();
  });

  it('fora de ordem dentro da mesma cadeia', () => {
    const { alice, bob } = conversa();
    const enviadas = ['um', 'dois', 'três', 'quatro'].map((m) => alice.enviar(m));
    const ordem = [3, 0, 2, 1];
    expect(ordem.map((i) => bob.receber(enviadas[i] as Mensagem))).toEqual([
      'quatro',
      'um',
      'três',
      'dois',
    ]);
    expect(bob.estado.puladas).toEqual([]);
  });

  it('fora de ordem atravessando passos de DH: a cadeia antiga fica guardada em chaves puladas', () => {
    const { alice, bob } = conversa();
    const antigas = [alice.enviar('a1'), alice.enviar('a2')];
    expect(bob.receber(antigas[0] as Mensagem)).toBe('a1');
    expect(alice.receber(bob.enviar('b1'))).toBe('b1');
    // A Alice muda de cadeia; o a2 da cadeia anterior ainda não chegou.
    const nova = alice.enviar('a3');
    expect(bob.receber(nova)).toBe('a3');
    expect(bob.estado.puladas).toHaveLength(1);
    expect(bob.receber(antigas[1] as Mensagem)).toBe('a2');
    expect(bob.estado.puladas).toHaveLength(0);
  });

  it('mensagens perdidas não impedem as seguintes', () => {
    const { alice, bob } = conversa();
    alice.enviar('perdida 1');
    alice.enviar('perdida 2');
    expect(bob.receber(alice.enviar('chegou'))).toBe('chegou');
    expect(alice.receber(bob.enviar('resposta'))).toBe('resposta');
    alice.enviar('perdida 3');
    expect(bob.receber(alice.enviar('chegou também'))).toBe('chegou também');
  });

  it('a mesma mensagem duas vezes: a segunda é recusada', () => {
    const { alice, bob } = conversa();
    const m = alice.enviar('uma vez');
    expect(bob.receber(m)).toBe('uma vez');
    expect(bob.receber(m)).toBeNull();
    const fora = [alice.enviar('x'), alice.enviar('y')];
    expect(bob.receber(fora[1] as Mensagem)).toBe('y');
    expect(bob.receber(fora[0] as Mensagem)).toBe('x');
    expect(bob.receber(fora[0] as Mensagem)).toBeNull();
  });

  it('adulterada, com cabeçalho trocado ou com outro AD: recusada e o estado não muda', () => {
    const { alice, bob } = conversa();
    bob.receber(alice.enviar('abre'));
    alice.receber(bob.enviar('ok'));
    const m = alice.enviar('alvo');
    const antes = serializado(bob.estado);

    const cifrado = m.cifrado.slice();
    cifrado[5] = (cifrado[5] ?? 0) ^ 1;
    const tentativas: Mensagem[] = [
      { ...m, cifrado },
      { ...m, cabecalho: { ...m.cabecalho, numero: m.cabecalho.numero + 1 } },
      { ...m, cabecalho: { ...m.cabecalho, anteriores: m.cabecalho.anteriores + 1 } },
      { ...m, cabecalho: { ...m.cabecalho, chave: gerarPar().publicKey } },
    ];
    for (const tentativa of tentativas) expect(bob.receber(tentativa)).toBeNull();
    expect(
      decifrar(cripto, bob.estado, m.cabecalho, m.cifrado, cripto.randombytes_buf(64), gerarPar),
    ).toBeNull();
    expect(serializado(bob.estado)).toEqual(antes);
    expect(bob.receber(m)).toBe('alvo');
  });

  it('decifrar nunca muda o estado recebido, nem quando dá certo', () => {
    const { alice, bob } = conversa();
    const m = alice.enviar('m');
    const antes = serializado(bob.estado);
    const r = decifrar(cripto, bob.estado, m.cabecalho, m.cifrado, AD, gerarPar);
    expect(r).not.toBeNull();
    expect(serializado(bob.estado)).toEqual(antes);
  });

  // Numa caixa sem leitura por mais de 14 dias, o relay apaga os pacotes velhos e aceita os novos:
  // a distância passa do teto de pacotes da caixa.
  it('1500 mensagens perdidas na mesma cadeia: a seguinte abre', () => {
    const { alice, bob } = conversa();
    bob.receber(alice.enviar('abre'));
    for (let i = 0; i < 1500; i++) alice.enviar('apagada pelo relay');
    expect(bob.receber(alice.enviar('depois'))).toBe('depois');
  });

  it('1500 mensagens perdidas antes do passo DH: a primeira da cadeia nova abre', () => {
    const { alice, bob } = conversa();
    bob.receber(alice.enviar('abre'));
    for (let i = 0; i < 1500; i++) alice.enviar('apagada pelo relay');
    expect(alice.receber(bob.enviar('resposta'))).toBe('resposta');
    expect(bob.receber(alice.enviar('cadeia nova'))).toBe('cadeia nova');
  });

  it(`pula até ${SALTO_MAXIMO} chaves e guarda as mais novas; um salto maior é recusado`, () => {
    const { alice, bob } = conversa();
    bob.receber(alice.enviar('abre'));
    // Salto exatamente no limite.
    const perdidas: Mensagem[] = [];
    for (let i = 0; i < SALTO_MAXIMO; i++) perdidas.push(alice.enviar(`perdida ${i}`));
    expect(bob.receber(alice.enviar('no limite'))).toBe('no limite');
    expect(bob.estado.puladas).toHaveLength(CHAVES_PULADAS_GUARDADAS);
    expect(bob.receber(perdidas.at(-1) as Mensagem)).toBe(`perdida ${SALTO_MAXIMO - 1}`);
    expect(bob.receber(perdidas.at(-CHAVES_PULADAS_GUARDADAS - 1) as Mensagem)).toBeNull();
    // Um a mais que o limite, na mesma cadeia: recusada.
    for (let i = 0; i <= SALTO_MAXIMO; i++) alice.enviar(`perdida ${i}`);
    expect(bob.receber(alice.enviar('além'))).toBeNull();
  });

  it(`guarda no máximo ${CHAVES_PULADAS_GUARDADAS} chaves puladas; as mais antigas saem`, () => {
    const { alice, bob } = conversa();
    bob.receber(alice.enviar('abre'));
    const primeira = alice.enviar('primeira pulada');
    for (let rodada = 0; rodada < 3; rodada++) {
      for (let i = 0; i < CHAVES_PULADAS_GUARDADAS / 2 - 1; i++) alice.enviar('perdida');
      expect(bob.receber(alice.enviar(`rodada ${rodada}`))).toBe(`rodada ${rodada}`);
    }
    expect(bob.estado.puladas).toHaveLength(CHAVES_PULADAS_GUARDADAS);
    expect(bob.receber(primeira)).toBeNull();
  });

  it('o estado guardado e relido continua a conversa', () => {
    const { alice, bob } = conversa();
    bob.receber(alice.enviar('a'));
    alice.receber(bob.enviar('b'));
    alice.enviar('pulada');
    bob.receber(alice.enviar('c'));
    const relido = lerCatraca(new Leitor(serializado(bob.estado)));
    expect(relido).toEqual(bob.estado);
    bob.estado = relido;
    expect(alice.receber(bob.enviar('d'))).toBe('d');
  });
});

describe('sessão: X3DH e a catraca juntos', () => {
  const ONION = 'ws://' + 'b'.repeat(56) + '.onion';

  function cartaoDe(identidade: Identidade, prekey = gerarPar()) {
    return {
      prekey,
      cartao: criarCartao(
        {
          chaveDeIdentidade: identidade.assinatura.publicKey,
          prekeyAssinada: { numero: 3, chave: prekey.publicKey },
          caixaPrincipal: cripto.crypto_sign_seed_keypair(cripto.randombytes_buf(32)).publicKey,
          data: Date.UTC(2026, 9, 1),
          relays: [ONION],
        },
        (m) => cripto.crypto_sign_detached(m, identidade.assinatura.privateKey),
      ),
    };
  }

  /** A Alice abre a sessão com o cartão do Bob e uma one-time prekey dele. */
  function abrir() {
    const alice = gerarIdentidade(cripto, 'portugues').identidade;
    const bob = gerarIdentidade(cripto, 'ingles').identidade;
    const { cartao, prekey } = cartaoDe(bob);
    const avulsa = gerarPar();
    const deAlice = sessaoDeQuemAbre(
      cripto,
      alice,
      cartao,
      { numero: 9, chave: avulsa.publicKey },
      gerarPar,
    );
    return { alice, bob, prekey, avulsa, cartao, deAlice };
  }

  const textoDe = (numero: number, mensagem: string): Conteudo => ({
    tipo: 'texto',
    id: new Uint8Array(16).fill(numero),
    enviadaEm: 1,
    ttl: 0,
    texto: mensagem,
  });

  function responder(
    alice: Identidade,
    bob: Identidade,
    interior: Interior,
    prekey = gerarPar(),
    avulsa = gerarPar(),
  ) {
    if (interior.tipo !== 'inicial') throw new Error('esperava inicial');
    expect(iguais(interior.abertura.chaveDeIdentidade, alice.assinatura.publicKey)).toBe(true);
    return sessaoDeQuemResponde(cripto, bob, interior.abertura, prekey, avulsa.privateKey);
  }

  it('quem abre manda os dados do X3DH em toda mensagem até a primeira resposta', () => {
    const { alice, bob, prekey, avulsa, deAlice } = abrir();
    const primeira = cifrarNaSessao(cripto, alice, deAlice, textoDe(1, 'primeira'));
    const segunda = cifrarNaSessao(cripto, alice, primeira.sessao, textoDe(2, 'segunda'));
    expect([primeira.interior.tipo, segunda.interior.tipo]).toEqual(['inicial', 'inicial']);

    // A primeira se perdeu: a segunda abre a sessão do lado do Bob do mesmo jeito.
    const recebida = decifrarNaSessao(
      cripto,
      responder(alice, bob, segunda.interior, prekey, avulsa),
      segunda.interior,
      gerarPar,
    );
    expect(recebida?.conteudo).toEqual(textoDe(2, 'segunda'));
    const doBob: Sessao = recebida?.sessao ?? deAlice;

    const resposta = cifrarNaSessao(cripto, bob, doBob, textoDe(3, 'resposta'));
    expect(resposta.interior.tipo).toBe('sessao');
    const naAlice = decifrarNaSessao(cripto, segunda.sessao, resposta.interior, gerarPar);
    expect(naAlice?.sessao.abertura).toBeNull();
    const depois = cifrarNaSessao(cripto, alice, naAlice?.sessao ?? deAlice, textoDe(4, 'depois'));
    expect(depois.interior.tipo).toBe('sessao');
    expect(decifrarNaSessao(cripto, resposta.sessao, depois.interior, gerarPar)?.conteudo).toEqual(
      textoDe(4, 'depois'),
    );
  });

  it('com a one-time prekey errada, a mensagem inicial não decifra', () => {
    const { alice, bob, prekey, avulsa, deAlice } = abrir();
    const { interior } = cifrarNaSessao(cripto, alice, deAlice, textoDe(1, 'oi'));
    const errada = responder(alice, bob, interior, prekey, gerarPar());
    expect(decifrarNaSessao(cripto, errada, interior, gerarPar)).toBeNull();
    const certa = responder(alice, bob, interior, prekey, avulsa);
    expect(decifrarNaSessao(cripto, certa, interior, gerarPar)?.conteudo).toEqual(textoDe(1, 'oi'));
  });

  it('cartão com assinatura que não confere não abre sessão', () => {
    const alice = gerarIdentidade(cripto, 'portugues').identidade;
    const bob = gerarIdentidade(cripto, 'portugues').identidade;
    const impostor = gerarIdentidade(cripto, 'portugues').identidade;
    const prekey = gerarPar();
    const falso = criarCartao(
      {
        chaveDeIdentidade: bob.assinatura.publicKey,
        prekeyAssinada: { numero: 1, chave: prekey.publicKey },
        caixaPrincipal: cripto.crypto_sign_seed_keypair(cripto.randombytes_buf(32)).publicKey,
        data: 1,
        relays: [ONION],
      },
      (m) => cripto.crypto_sign_detached(m, impostor.assinatura.privateKey),
    );
    expect(() => iniciarX3dh(cripto, alice, falso, null, gerarPar())).toThrow();
  });

  it('conteúdo que decifra mas não segue o formato: a catraca anda e o conteúdo vem nulo', () => {
    const { alice, bob, prekey, avulsa, deAlice } = abrir();
    const valida = cifrarNaSessao(cripto, alice, deAlice, textoDe(1, 'oi'));
    // Mesmo cabeçalho e chaves, mas o conteúdo cifrado é lixo do tamanho certo.
    const lixo = cifrar(
      cripto,
      deAlice.catraca,
      cripto.randombytes_buf(3917),
      deAlice.dadosAssociados,
    );
    const interior = { ...valida.interior, cifrado: lixo.cifrado } as Interior;
    const doBob = responder(alice, bob, interior, prekey, avulsa);
    const recebida = decifrarNaSessao(cripto, doBob, interior, gerarPar);
    expect(recebida).not.toBeNull();
    expect(recebida?.conteudo).toBeNull();
    expect(recebida?.sessao.catraca.recebidas).toBe(1);
  });

  it('a sessão guardada e relida é a mesma', () => {
    const { deAlice } = abrir();
    expect(lerSessao(codificarSessao(deAlice))).toEqual(deAlice);
    expect(() => lerSessao(codificarSessao(deAlice).subarray(1))).toThrow();
  });
});
