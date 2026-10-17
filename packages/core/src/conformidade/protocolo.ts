// Vetores do protocolo: X3DH, Double Ratchet e número de segurança com chaves fixas (RNF-02,
// RF-37). O Signal não publica vetores para estes parâmetros (BLAKE2b e XChaCha20-Poly1305), então
// os valores esperados são do Cifra. O teste do núcleo (test/protocolo.test.ts) refaz cada um com chamadas diretas à
// libsodium, passo a passo como nas especificações. A mesma lista roda no aparelho, com a
// libsodium de lá: bytes iguais nos dois lados.
import {
  codificarInterior,
  criarCartao,
  iguais,
  type Cartao,
  type Conteudo,
  type Interior,
  type Prekey,
} from '@cifra/protocol';
import { numeroDeSeguranca } from '../contatos/numero-de-seguranca.ts';
import { identidadeDaSemente, type Identidade } from '../identidade/identidade.ts';
import type { Cripto, ParDeChaves } from '../portas/cripto.ts';
import {
  cifrarNaSessao,
  codificarSessao,
  decifrarNaSessao,
  lerSessao,
  sessaoDeQuemAbre,
  sessaoDeQuemResponde,
  type Sessao,
} from '../sessao/sessao.ts';
import { hex, rodar, type ResultadoDaVerificacao } from './resultado.ts';

/** Ponto base da curva 25519: `crypto_scalarmult(privada, BASE)` dá a chave pública. */
const BASE_X25519 = hex('09' + '00'.repeat(31));

/** Valores esperados, em hex. Os de mensagem são o BLAKE2b-256 do interior de 4048 bytes. */
export const VETORES = {
  segredoComAvulsa: 'c45dde4fe4c2137ebc3b25191fb022732c91666420aaa3be48bc7676f8385e38',
  segredoSemAvulsa: 'fe9dcf5f0f8c2d9a87ff9fd5011a01e2ed9da25240d95b3255856bf87251876b',
  primeiraMensagem: '7f8a6e6acf34e3fd38cd970a8936457d025f7e177d5c682d09e8b235462c622e',
  resposta: '3ed44d7081f79f1b3080c325709aa01875ad891bea5a44b43a6d8954a024d28d',
  segundaCadeia: '03e93b282d3baa36bd81ee3781cc586966ad4f7eaebff7e39398817fd344745c',
  /** Os 60 dígitos do número de segurança entre a Alice e o Bob (RF-37). */
  numeroDeSeguranca: '192840404654973432695681568697408895113785007792607400676403',
} as const;

/** Bytes fixos dos vetores: `inicio`, `inicio + 1`, … */
export function sequencia(inicio: number, tamanho = 32): Uint8Array {
  return Uint8Array.from({ length: tamanho }, (_, i) => (inicio + i) & 0xff);
}

/** Par X25519 com a chave privada fixa. */
export function parFixo(cripto: Cripto, inicio: number): ParDeChaves {
  const privateKey = sequencia(inicio);
  return { privateKey, publicKey: cripto.crypto_scalarmult(privateKey, BASE_X25519) };
}

/** Entrega os pares da lista em ordem, como o sorteio da catraca faria. */
function pares(cripto: Cripto, inicios: readonly number[]): () => ParDeChaves {
  const fila = inicios.map((inicio) => parFixo(cripto, inicio));
  return () => {
    const par = fila.shift();
    if (!par) throw new Error('vetor sem par sobrando');
    return par;
  };
}

/** As entradas fixas dos vetores. */
export interface CenarioDosVetores {
  readonly alice: Identidade;
  readonly bob: Identidade;
  readonly prekeyAssinada: ParDeChaves;
  readonly avulsa: ParDeChaves;
  readonly cartaoDoBob: Cartao;
  readonly prekeyAvulsa: Prekey;
  /** A chave efêmera e as chaves da catraca da Alice, na ordem em que saem. */
  readonly paresDaAlice: () => ParDeChaves;
  /** As chaves da catraca do Bob, na ordem em que saem. */
  readonly paresDoBob: () => ParDeChaves;
}

export function cenarioDosVetores(cripto: Cripto): CenarioDosVetores {
  const bob = identidadeDaSemente(cripto, sequencia(0x20));
  const prekeyAssinada = parFixo(cripto, 0x40);
  const avulsa = parFixo(cripto, 0x60);
  const cartaoDoBob = criarCartao(
    {
      chaveDeIdentidade: bob.assinatura.publicKey,
      prekeyAssinada: { numero: 1, chave: prekeyAssinada.publicKey },
      caixaPrincipal: cripto.crypto_sign_seed_keypair(sequencia(0xe0)).publicKey,
      data: Date.UTC(2026, 9, 1),
      relays: ['ws://' + 'a'.repeat(56) + '.onion'],
    },
    (mensagem) => cripto.crypto_sign_detached(mensagem, bob.assinatura.privateKey),
  );
  return {
    alice: identidadeDaSemente(cripto, sequencia(0x00)),
    bob,
    prekeyAssinada,
    avulsa,
    cartaoDoBob,
    prekeyAvulsa: { numero: 7, chave: avulsa.publicKey },
    paresDaAlice: pares(cripto, [0x80, 0xa0, 0xa1, 0xa2]),
    paresDoBob: pares(cripto, [0xc0, 0xc1, 0xc2]),
  };
}

/** Conteúdo de texto fixo, com ID e data que não mudam. */
export function textoDoVetor(numero: number, texto: string): Conteudo {
  return {
    tipo: 'texto',
    id: sequencia(numero, 16),
    enviadaEm: Date.UTC(2026, 9, 1, numero),
    ttl: 0,
    texto,
  };
}

function resumo(cripto: Cripto, interior: Interior): string {
  return Array.from(cripto.crypto_generichash(32, codificarInterior(interior), null), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function texto(conteudo: Conteudo | null | undefined): string | null {
  return conteudo?.tipo === 'texto' ? conteudo.texto : null;
}

export function verificarProtocolo(cripto: Cripto): Promise<ResultadoDaVerificacao[]> {
  // As mensagens passam de uma verificação para a outra, como numa conversa.
  let deAlice: Sessao | undefined;
  let doBob: Sessao | undefined;
  let cenario: CenarioDosVetores | undefined;
  const exigir = <T>(valor: T | undefined): T => {
    if (valor === undefined) throw new Error('vetor anterior falhou');
    return valor;
  };

  return rodar({
    'protocolo.x3dh-com-one-time-prekey': () => {
      cenario = cenarioDosVetores(cripto);
      const { alice, bob, cartaoDoBob, prekeyAvulsa, prekeyAssinada, avulsa } = cenario;
      deAlice = sessaoDeQuemAbre(cripto, alice, cartaoDoBob, prekeyAvulsa, cenario.paresDaAlice);
      const abertura = {
        chaveDeIdentidade: alice.assinatura.publicKey,
        chaveEfemera: deAlice.base,
        prekeyAssinada: 1,
        prekeyAvulsa: 7,
      };
      doBob = sessaoDeQuemResponde(cripto, bob, abertura, prekeyAssinada, avulsa.privateKey);
      return (
        iguais(doBob.catraca.raiz, hex(VETORES.segredoComAvulsa)) &&
        iguais(deAlice.dadosAssociados, doBob.dadosAssociados)
      );
    },

    'protocolo.x3dh-sem-one-time-prekey': () => {
      const sem = cenarioDosVetores(cripto);
      const abre = sessaoDeQuemAbre(cripto, sem.alice, sem.cartaoDoBob, null, sem.paresDaAlice);
      const responde = sessaoDeQuemResponde(
        cripto,
        sem.bob,
        {
          chaveDeIdentidade: sem.alice.assinatura.publicKey,
          chaveEfemera: abre.base,
          prekeyAssinada: 1,
          prekeyAvulsa: null,
        },
        sem.prekeyAssinada,
        null,
      );
      return iguais(responde.catraca.raiz, hex(VETORES.segredoSemAvulsa));
    },

    'protocolo.primeira-mensagem': () => {
      const { alice } = exigir(cenario);
      const enviada = cifrarNaSessao(cripto, alice, exigir(deAlice), textoDoVetor(1, 'vetor 1'));
      deAlice = enviada.sessao;
      const recebida = decifrarNaSessao(
        cripto,
        exigir(doBob),
        enviada.interior,
        exigir(cenario).paresDoBob,
      );
      if (!recebida) return false;
      doBob = recebida.sessao;
      return (
        enviada.interior.tipo === 'inicial' &&
        resumo(cripto, enviada.interior) === VETORES.primeiraMensagem &&
        texto(recebida.conteudo) === 'vetor 1'
      );
    },

    'protocolo.resposta-fecha-a-abertura': () => {
      const { bob, paresDaAlice } = exigir(cenario);
      const enviada = cifrarNaSessao(cripto, bob, exigir(doBob), textoDoVetor(2, 'vetor 2'));
      doBob = enviada.sessao;
      const recebida = decifrarNaSessao(cripto, exigir(deAlice), enviada.interior, paresDaAlice);
      if (!recebida) return false;
      deAlice = recebida.sessao;
      return (
        enviada.interior.tipo === 'sessao' &&
        resumo(cripto, enviada.interior) === VETORES.resposta &&
        texto(recebida.conteudo) === 'vetor 2' &&
        deAlice.abertura === null
      );
    },

    'protocolo.fora-de-ordem-e-perdida': () => {
      const { alice, paresDoBob } = exigir(cenario);
      const enviadas: Interior[] = [];
      for (const numero of [3, 4, 5]) {
        const enviada = cifrarNaSessao(
          cripto,
          alice,
          exigir(deAlice),
          textoDoVetor(numero, `vetor ${numero}`),
        );
        deAlice = enviada.sessao;
        enviadas.push(enviada.interior);
      }
      const [terceira, quarta, quinta] = enviadas;
      if (!terceira || !quarta || !quinta) return false;
      // A quinta chega primeiro, a terceira depois; a quarta atrasa e chega por último.
      const recebidas: (string | null)[] = [];
      for (const interior of [quinta, terceira, quarta]) {
        const recebida = decifrarNaSessao(cripto, exigir(doBob), interior, paresDoBob);
        if (!recebida) return false;
        doBob = recebida.sessao;
        recebidas.push(texto(recebida.conteudo));
      }
      return (
        resumo(cripto, terceira) === VETORES.segundaCadeia &&
        recebidas.join() === 'vetor 5,vetor 3,vetor 4' &&
        exigir(doBob).catraca.puladas.length === 0
      );
    },

    'protocolo.repetida-e-adulterada-recusadas': () => {
      const { alice, paresDoBob } = exigir(cenario);
      const enviada = cifrarNaSessao(cripto, alice, exigir(deAlice), textoDoVetor(6, 'vetor 6'));
      deAlice = enviada.sessao;
      const antes = codificarSessao(exigir(doBob));
      const adulterado = enviada.interior.cifrado.slice();
      adulterado[0] = (adulterado[0] ?? 0) ^ 1;
      const recusada = decifrarNaSessao(
        cripto,
        exigir(doBob),
        { ...enviada.interior, cifrado: adulterado },
        paresDoBob,
      );
      const intacta = iguais(codificarSessao(exigir(doBob)), antes);
      const recebida = decifrarNaSessao(cripto, exigir(doBob), enviada.interior, paresDoBob);
      if (!recebida) return false;
      const repetida = decifrarNaSessao(cripto, recebida.sessao, enviada.interior, paresDoBob);
      doBob = recebida.sessao;
      return (
        recusada === null && intacta && texto(recebida.conteudo) === 'vetor 6' && repetida === null
      );
    },

    // Os dois lados calculam o mesmo número, cada um com as chaves na sua ordem.
    'protocolo.numero-de-seguranca': () => {
      const { alice, bob } = exigir(cenario);
      const daAlice = numeroDeSeguranca(
        cripto,
        alice.assinatura.publicKey,
        bob.assinatura.publicKey,
      );
      const doBob = numeroDeSeguranca(cripto, bob.assinatura.publicKey, alice.assinatura.publicKey);
      return (
        daAlice.length === 12 &&
        daAlice.join('') === VETORES.numeroDeSeguranca &&
        doBob.join('') === daAlice.join('')
      );
    },

    'protocolo.sessao-guardada-continua': () => {
      const { bob, paresDaAlice } = exigir(cenario);
      const relida = lerSessao(codificarSessao(exigir(doBob)));
      const enviada = cifrarNaSessao(cripto, bob, relida, textoDoVetor(7, 'vetor 7'));
      const recebida = decifrarNaSessao(
        cripto,
        lerSessao(codificarSessao(exigir(deAlice))),
        enviada.interior,
        paresDaAlice,
      );
      return texto(recebida?.conteudo) === 'vetor 7';
    },
  });
}
