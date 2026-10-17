import {
  capacidadeDoConteudo,
  codificarConteudo,
  codificarInterior,
  CONTEXTOS_DE_DERIVACAO,
  Escritor,
  idDaChave,
  juntar,
} from '@cifra/protocol';
import { describe, expect, it } from 'vitest';
import {
  cenarioDosVetores,
  parFixo,
  textoDoVetor,
  verificarProtocolo,
  VETORES,
} from '../src/conformidade/protocolo.ts';
import type { Cripto } from '../src/index.ts';
import {
  cifrarNaSessao,
  decifrarNaSessao,
  sessaoDeQuemAbre,
  sessaoDeQuemResponde,
} from '../src/sessao/sessao.ts';
import { cripto } from './adaptadores/sodium-node.ts';

// RNF-02: X3DH e Double Ratchet como nas especificações do Signal. Os vetores do Cifra (o Signal
// não publica vetores para BLAKE2b e XChaCha20-Poly1305) são refeitos aqui por uma segunda conta,
// com chamadas diretas à libsodium e os bytes montados à mão, passo a passo como nas
// especificações. Se a implementação mudar a derivação, os dois lados deixam de bater.

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const resumo = (bytes: Uint8Array) => hex(cripto.crypto_generichash(32, bytes, null));
const falhas = async (c: Cripto) =>
  (await verificarProtocolo(c)).filter(({ ok }) => !ok).map(({ nome }) => nome);

const { x3dh, raiz, cadeia, mensagem } = CONTEXTOS_DE_DERIVACAO;
const kdf = (tamanho: number, numero: number, contexto: string, chave: Uint8Array) =>
  cripto.crypto_kdf_derive_from_key(tamanho, numero, contexto, chave);

/** HKDF com BLAKE2b, como a especificação do X3DH pede com F = 32 bytes 0xFF. */
function segredoDoX3dh(saidas: Uint8Array[]): Uint8Array {
  const prk = cripto.crypto_generichash(32, juntar(new Uint8Array(32).fill(0xff), ...saidas), null);
  return kdf(32, 1, x3dh, prk);
}

/** KDF_RK(rk, dh_out). */
function kdfRk(rk: Uint8Array, saidaDoDh: Uint8Array) {
  const prk = cripto.crypto_generichash(32, saidaDoDh, rk);
  return { rk: kdf(32, 1, raiz, prk), ck: kdf(32, 2, raiz, prk) };
}

/** ENCRYPT(mk, conteúdo, AD ‖ cabeçalho) com XChaCha20-Poly1305. */
function cifrarMensagem(
  ck: Uint8Array,
  conteudo: Uint8Array,
  ad: Uint8Array,
  cabecalho: Uint8Array,
) {
  const mk = kdf(32, 1, cadeia, ck);
  return cripto.crypto_aead_xchacha20poly1305_ietf_encrypt(
    conteudo,
    juntar(ad, cabecalho),
    null,
    kdf(24, 2, mensagem, mk),
    kdf(32, 1, mensagem, mk),
  );
}

const cabecalho = (chave: Uint8Array, pn: number, n: number) =>
  new Escritor().bytes(chave).uint32(pn).uint32(n).resultado();

describe('vetores do protocolo (RNF-02)', () => {
  it('a libsodium de referência passa em todos', async () => {
    expect(await falhas(cripto)).toEqual([]);
  });

  it('segunda conta do X3DH: SK = KDF(F ‖ DH1 ‖ DH2 ‖ DH3 ‖ DH4), com e sem one-time prekey', () => {
    const c = cenarioDosVetores(cripto);
    const efemera = parFixo(cripto, 0x80);
    const identidadeDoBob = cripto.crypto_sign_ed25519_pk_to_curve25519(c.bob.assinatura.publicKey);
    const spk = c.prekeyAssinada.publicKey;
    const dh = (privada: Uint8Array, publica: Uint8Array) =>
      cripto.crypto_scalarmult(privada, publica);
    const tres = () => [
      dh(c.alice.acordo.privateKey, spk),
      dh(efemera.privateKey, identidadeDoBob),
      dh(efemera.privateKey, spk),
    ];
    expect(hex(segredoDoX3dh([...tres(), dh(efemera.privateKey, c.avulsa.publicKey)]))).toBe(
      VETORES.segredoComAvulsa,
    );
    expect(hex(segredoDoX3dh(tres()))).toBe(VETORES.segredoSemAvulsa);
  });

  it('segunda conta da catraca: a primeira mensagem, a resposta e a primeira da cadeia nova', () => {
    const c = cenarioDosVetores(cripto);
    const alice = c.alice.assinatura.publicKey;
    const bob = c.bob.assinatura.publicKey;
    const ad = juntar(alice, bob);
    const sk = Buffer.from(VETORES.segredoComAvulsa, 'hex');
    const efemera = parFixo(cripto, 0x80);
    const [a1, a2, b1] = [parFixo(cripto, 0xa0), parFixo(cripto, 0xa1), parFixo(cripto, 0xc0)];
    const dh = (privada: Uint8Array, publica: Uint8Array) =>
      cripto.crypto_scalarmult(privada, publica);
    const conteudo = (numero: number, tipo: 'inicial' | 'sessao') =>
      codificarConteudo(textoDoVetor(numero, `vetor ${numero}`), capacidadeDoConteudo(tipo));

    // RatchetInitAlice: a primeira cadeia de envio sai de DH(A1, SPKb).
    const primeiro = kdfRk(sk, dh(a1.privateKey, c.prekeyAssinada.publicKey));
    const h1 = cabecalho(a1.publicKey, 0, 0);
    const inicial = new Escritor()
      .uint8(1)
      .uint8(1)
      .bytes(alice)
      .bytes(efemera.publicKey)
      .uint32(1)
      .uint8(1)
      .uint32(7)
      .bytes(h1)
      .bytes(cifrarMensagem(primeiro.ck, conteudo(1, 'inicial'), ad, h1))
      .resultado();
    expect(resumo(inicial)).toBe(VETORES.primeiraMensagem);

    // O Bob faz o passo de DH ao receber: a mesma raiz, e a cadeia de envio dele sai de DH(B1, A1).
    const doBob = kdfRk(primeiro.rk, dh(b1.privateKey, a1.publicKey));
    const h2 = cabecalho(b1.publicKey, 0, 0);
    const resposta = new Escritor()
      .uint8(1)
      .uint8(2)
      .bytes(idDaChave(cripto, bob))
      .bytes(h2)
      .bytes(cifrarMensagem(doBob.ck, conteudo(2, 'sessao'), ad, h2))
      .resultado();
    expect(resumo(resposta)).toBe(VETORES.resposta);

    // A Alice faz o passo de DH com B1 e manda na cadeia nova, com PN = 1.
    const daAlice = kdfRk(doBob.rk, dh(a2.privateKey, b1.publicKey));
    const h3 = cabecalho(a2.publicKey, 1, 0);
    const terceira = new Escritor()
      .uint8(1)
      .uint8(2)
      .bytes(idDaChave(cripto, alice))
      .bytes(h3)
      .bytes(cifrarMensagem(daAlice.ck, conteudo(3, 'sessao'), ad, h3))
      .resultado();
    expect(resumo(terceira)).toBe(VETORES.segundaCadeia);
  });

  it('a implementação monta exatamente os bytes da segunda conta', () => {
    const c = cenarioDosVetores(cripto);
    const abre = sessaoDeQuemAbre(cripto, c.alice, c.cartaoDoBob, c.prekeyAvulsa, c.paresDaAlice);
    const responde = sessaoDeQuemResponde(
      cripto,
      c.bob,
      {
        chaveDeIdentidade: c.alice.assinatura.publicKey,
        chaveEfemera: abre.base,
        prekeyAssinada: 1,
        prekeyAvulsa: 7,
      },
      c.prekeyAssinada,
      c.avulsa.privateKey,
    );
    const m1 = cifrarNaSessao(cripto, c.alice, abre, textoDoVetor(1, 'vetor 1'));
    expect(resumo(codificarInterior(m1.interior))).toBe(VETORES.primeiraMensagem);
    const r1 = decifrarNaSessao(cripto, responde, m1.interior, c.paresDoBob);
    expect(r1?.conteudo).toEqual(textoDoVetor(1, 'vetor 1'));
  });

  describe('acusa implementação que foge da especificação', () => {
    const sabotar = (troca: Partial<Record<keyof Cripto, unknown>>) =>
      Object.assign(Object.create(cripto) as Cripto, troca);

    it('derivação com outro contexto', async () => {
      const outroContexto = sabotar({
        crypto_kdf_derive_from_key: (t: number, n: number, _c: string, k: Uint8Array) =>
          cripto.crypto_kdf_derive_from_key(t, n, 'Outro-KD', k),
      });
      expect(await falhas(outroContexto)).toEqual(
        expect.arrayContaining([
          'protocolo.x3dh-com-one-time-prekey',
          'protocolo.x3dh-sem-one-time-prekey',
        ]),
      );
    });

    it('decifração que não confere a etiqueta', async () => {
      const semEtiqueta = sabotar({
        crypto_aead_xchacha20poly1305_ietf_decrypt: (
          _n: null,
          cifrado: Uint8Array,
          _a: Uint8Array | null,
          nonce: Uint8Array,
          chave: Uint8Array,
        ) =>
          cripto
            .crypto_aead_xchacha20poly1305_ietf_encrypt(
              cifrado.subarray(0, cifrado.length - 16),
              null,
              null,
              nonce,
              chave,
            )
            .subarray(0, cifrado.length - 16),
      });
      expect(await falhas(semEtiqueta)).toContain('protocolo.repetida-e-adulterada-recusadas');
    });
  });
});
