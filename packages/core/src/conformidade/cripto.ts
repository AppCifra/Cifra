// Conformidade da porta Cripto. Os vetores vêm de fontes publicadas (RFCs, FIPS 180-2 e os testes
// da própria libsodium 1.0.21) e foram conferidos contra a libsodium-wrappers-sumo. Um adaptador
// que passa aqui devolve, byte a byte, o mesmo que a libsodium de referência (RNF-01, RNF-15).
import type { Cripto } from '../portas/cripto.ts';
import { ascii, hex, iguais, lanca, rodar, type ResultadoDaVerificacao } from './resultado.ts';

/** Ponto base da curva 25519 (u = 9): `crypto_scalarmult(sk, BASE)` dá a chave pública. */
const BASE_X25519 = hex('09' + '00'.repeat(31));

// RFC 8032, seção 7.1, TEST 1 e TEST 2.
const ED25519 = [
  {
    nome: 'ed25519.rfc8032-1',
    semente: '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
    publica: 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
    mensagem: '',
    assinatura:
      'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
  },
  {
    nome: 'ed25519.rfc8032-2',
    semente: '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb',
    publica: '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c',
    mensagem: '72',
    assinatura:
      '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00',
  },
] as const;

// RFC 7748, seção 6.1.
const X25519 = {
  privadaA: '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a',
  publicaA: '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a',
  privadaB: '5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb',
  publicaB: 'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f',
  compartilhado: '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742',
} as const;

// libsodium 1.0.21, test/default/ed25519_convert.
const CONVERSAO = {
  semente: '421151a459faeade3d247115f94aedae42318124095afabe4d1451a559faedee',
  publica: 'f1814f0e8ff1043d8a44d25babff3cedcae6c22c3edaa48f857ae70de2baae50',
  privada: '8052030376d47112be7f73ed7a019293dd12ad910b654455798b4667d73de166',
} as const;

// draft-irtf-cfrg-xchacha-03, apêndice A.3.1 (texto cifrado seguido da etiqueta).
const XCHACHA = {
  mensagem:
    "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.",
  adicionais: '50515253c0c1c2c3c4c5c6c7',
  nonce: '404142434445464748494a4b4c4d4e4f5051525354555657',
  cifrado:
    'bd6d179d3e83d43b9576579493c0e939572a1700252bfaccbed2902c21396cbb731c7f1b0b4aa6440bf3a82f4eda7e39ae64c6708c54c216cb96b72e1213b4522f8c9ba40db5d945b11b69b982c1bb9e3f3fac2bc369488f76b2383565d3fff921f9664c97637da9768812f615c68b13b52e' +
    'c0875924c1c7987947deafd8780acf49',
} as const;

// libsodium 1.0.21, test/default/pwhash_argon2id, primeiro vetor de tv(): 127 bytes de senha,
// sal de 16 bytes, 155 bytes de saída, opslimit 5 e memlimit 7256678.
const ARGON2ID = {
  senha:
    'a347ae92bce9f80f6f595a4480fc9c2fe7e7d7148d371e9487d75f5c23008ffae065577a928febd9b1973a5a95073acdbeb6a030cfc0d79caa2dc5cd011cef02c08da232d76d52dfbca38ca8dcbd665b17d1665f7cf5fe59772ec909733b24de97d6f58d220b20c60d7c07ec1fd93c52c31020300c6c1facd77937a597c7a6',
  sal: '5541fbc995d5c197ba290346d2c559de',
  saida:
    '18acec5d6507739f203d1f5d9f1d862f7c2cdac4f19d2bdff64487e60d969e3ced615337b9eec6ac4461c6ca07f0939741e57c24d0005c7ea171a0ee1e7348249d135b38f222e4dad7b9a033ed83f5ca27277393e316582033c74affe2566a2bea47f91f0fd9fe49ece7e1f79f3ad6e9b23e0277c8ecc4b313225748dd2a80f5679534a0700e246a79a49b3f74eb89ec6205fe1eeb941c73b1fcf1',
} as const;

/** Valores fixos das constantes na libsodium 1.0.21. */
const CONSTANTES: ReadonlyArray<readonly [keyof Cripto, number]> = [
  ['crypto_sign_SEEDBYTES', 32],
  ['crypto_sign_PUBLICKEYBYTES', 32],
  ['crypto_sign_SECRETKEYBYTES', 64],
  ['crypto_sign_BYTES', 64],
  ['crypto_box_PUBLICKEYBYTES', 32],
  ['crypto_box_SECRETKEYBYTES', 32],
  ['crypto_scalarmult_BYTES', 32],
  ['crypto_scalarmult_SCALARBYTES', 32],
  ['crypto_generichash_BYTES', 32],
  ['crypto_generichash_BYTES_MIN', 16],
  ['crypto_generichash_BYTES_MAX', 64],
  ['crypto_generichash_KEYBYTES', 32],
  ['crypto_kdf_KEYBYTES', 32],
  ['crypto_kdf_CONTEXTBYTES', 8],
  ['crypto_hash_sha256_BYTES', 32],
  ['crypto_aead_xchacha20poly1305_ietf_KEYBYTES', 32],
  ['crypto_aead_xchacha20poly1305_ietf_NPUBBYTES', 24],
  ['crypto_aead_xchacha20poly1305_ietf_ABYTES', 16],
  ['crypto_box_SEALBYTES', 48],
  ['crypto_secretstream_xchacha20poly1305_KEYBYTES', 32],
  ['crypto_secretstream_xchacha20poly1305_HEADERBYTES', 24],
  ['crypto_secretstream_xchacha20poly1305_ABYTES', 17],
  ['crypto_secretstream_xchacha20poly1305_TAG_MESSAGE', 0],
  ['crypto_secretstream_xchacha20poly1305_TAG_FINAL', 3],
  ['crypto_pwhash_ALG_ARGON2ID13', 2],
  ['crypto_pwhash_SALTBYTES', 16],
  ['crypto_pwhash_OPSLIMIT_INTERACTIVE', 2],
  ['crypto_pwhash_MEMLIMIT_INTERACTIVE', 67108864],
  ['crypto_pwhash_OPSLIMIT_MODERATE', 3],
  ['crypto_pwhash_MEMLIMIT_MODERATE', 268435456],
];

/** Cópia com um bit trocado: simula adulteração no caminho. */
function adulterar(bytes: Uint8Array, posicao = 0): Uint8Array {
  const copia = bytes.slice();
  copia[posicao] = (copia[posicao] ?? 0) ^ 1;
  return copia;
}

export function verificarCripto(c: Cripto): Promise<ResultadoDaVerificacao[]> {
  return rodar({
    constantes: () => {
      const erradas = CONSTANTES.filter(([nome, valor]) => c[nome] !== valor);
      if (erradas.length > 0) throw new Error(erradas.map(([nome]) => nome).join(', '));
      return true;
    },

    'aleatorio.tamanho-e-variacao': () => {
      const a = c.randombytes_buf(32);
      const b = c.randombytes_buf(32);
      return a.length === 32 && b.length === 32 && !iguais(a, b);
    },

    // Zera o próprio buffer, inclusive quando recebe só um trecho dele.
    'memzero.zera-no-lugar': () => {
      const buffer = new Uint8Array([1, 2, 3, 4, 5, 6]);
      c.memzero(buffer.subarray(1, 4));
      const inteiro = new Uint8Array([7, 7, 7]);
      c.memzero(inteiro);
      return iguais(buffer, new Uint8Array([1, 0, 0, 0, 5, 6])) && inteiro.every((b) => b === 0);
    },

    ...Object.fromEntries(
      ED25519.map((vetor) => [
        vetor.nome,
        () => {
          const par = c.crypto_sign_seed_keypair(hex(vetor.semente));
          const mensagem = hex(vetor.mensagem);
          const assinatura = c.crypto_sign_detached(mensagem, par.privateKey);
          return (
            iguais(par.publicKey, hex(vetor.publica)) &&
            iguais(assinatura, hex(vetor.assinatura)) &&
            c.crypto_sign_verify_detached(assinatura, mensagem, par.publicKey) &&
            !c.crypto_sign_verify_detached(adulterar(assinatura), mensagem, par.publicKey) &&
            !c.crypto_sign_verify_detached(assinatura, ascii('outra'), par.publicKey)
          );
        },
      ]),
    ),

    'ed25519-para-x25519.libsodium': () => {
      const par = c.crypto_sign_seed_keypair(hex(CONVERSAO.semente));
      const publica = c.crypto_sign_ed25519_pk_to_curve25519(par.publicKey);
      const privada = c.crypto_sign_ed25519_sk_to_curve25519(par.privateKey);
      return (
        iguais(publica, hex(CONVERSAO.publica)) &&
        iguais(privada, hex(CONVERSAO.privada)) &&
        iguais(c.crypto_scalarmult(privada, BASE_X25519), publica)
      );
    },

    'x25519.rfc7748': () => {
      const a = hex(X25519.privadaA);
      const b = hex(X25519.privadaB);
      const segredo = hex(X25519.compartilhado);
      return (
        iguais(c.crypto_scalarmult(a, BASE_X25519), hex(X25519.publicaA)) &&
        iguais(c.crypto_scalarmult(b, BASE_X25519), hex(X25519.publicaB)) &&
        iguais(c.crypto_scalarmult(a, hex(X25519.publicaB)), segredo) &&
        iguais(c.crypto_scalarmult(b, hex(X25519.publicaA)), segredo)
      );
    },

    'x25519.box-keypair': () => {
      const a = c.crypto_box_keypair();
      const b = c.crypto_box_keypair();
      return (
        a.publicKey.length === 32 &&
        a.privateKey.length === 32 &&
        iguais(c.crypto_scalarmult(a.privateKey, BASE_X25519), a.publicKey) &&
        iguais(
          c.crypto_scalarmult(a.privateKey, b.publicKey),
          c.crypto_scalarmult(b.privateKey, a.publicKey),
        )
      );
    },

    'blake2b.rfc7693': () =>
      iguais(
        c.crypto_generichash(64, ascii('abc'), null),
        hex(
          'ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923',
        ),
      ),

    // Vetor oficial do BLAKE2 com chave (blake2b-kat), entrada vazia e chave 00..3f.
    'blake2b.com-chave': () =>
      iguais(
        c.crypto_generichash(
          64,
          new Uint8Array(0),
          Uint8Array.from({ length: 64 }, (_, i) => i),
        ),
        hex(
          '10ebb67700b1868efb4417987acf4690ae9d972fb7a590c2f02871799aaa4786b5e996e8f0f4eb981fc214b005f42d2ff4233499391653df7aefcbc13fc51568',
        ),
      ),

    'kdf.libsodium': () =>
      iguais(
        c.crypto_kdf_derive_from_key(
          64,
          0,
          'KDF test',
          Uint8Array.from({ length: 32 }, (_, i) => i),
        ),
        hex(
          'a0c724404728c8bb95e5433eb6a9716171144d61efb23e74b873fcbeda51d8071b5d70aae12066dfc94ce943f145aa176c055040c3dd73b0a15e36254d450614',
        ),
      ),

    // FIPS 180-2, apêndice B (um bloco e dois blocos), e a mensagem vazia do NIST CAVP (SHAVS).
    'sha256.fips180-2': () =>
      iguais(
        c.crypto_hash_sha256(ascii('abc')),
        hex('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'),
      ) &&
      iguais(
        c.crypto_hash_sha256(ascii('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')),
        hex('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'),
      ) &&
      iguais(
        c.crypto_hash_sha256(new Uint8Array(0)),
        hex('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
      ),

    'xchacha20poly1305.draft-a31': () => {
      const chave = Uint8Array.from({ length: 32 }, (_, i) => 0x80 + i);
      const nonce = hex(XCHACHA.nonce);
      const adicionais = hex(XCHACHA.adicionais);
      const mensagem = ascii(XCHACHA.mensagem);
      const cifrado = c.crypto_aead_xchacha20poly1305_ietf_encrypt(
        mensagem,
        adicionais,
        null,
        nonce,
        chave,
      );
      const aberto = c.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        cifrado,
        adicionais,
        nonce,
        chave,
      );
      return (
        iguais(cifrado, hex(XCHACHA.cifrado)) &&
        iguais(aberto, mensagem) &&
        lanca(() =>
          c.crypto_aead_xchacha20poly1305_ietf_decrypt(
            null,
            adulterar(cifrado),
            adicionais,
            nonce,
            chave,
          ),
        ) &&
        lanca(() =>
          c.crypto_aead_xchacha20poly1305_ietf_decrypt(
            null,
            cifrado,
            adulterar(adicionais),
            nonce,
            chave,
          ),
        )
      );
    },

    // Sem dados adicionais (null): a etiqueta continua protegendo o texto cifrado.
    'xchacha20poly1305.sem-adicionais': () => {
      const chave = c.randombytes_buf(32);
      const nonce = c.randombytes_buf(24);
      const mensagem = ascii('sem dados adicionais');
      const cifrado = c.crypto_aead_xchacha20poly1305_ietf_encrypt(
        mensagem,
        null,
        null,
        nonce,
        chave,
      );
      return (
        cifrado.length === mensagem.length + 16 &&
        iguais(
          c.crypto_aead_xchacha20poly1305_ietf_decrypt(null, cifrado, null, nonce, chave),
          mensagem,
        ) &&
        lanca(() =>
          c.crypto_aead_xchacha20poly1305_ietf_decrypt(null, cifrado, ascii('extra'), nonce, chave),
        )
      );
    },

    'box-seal.ida-volta-e-adulteracao': () => {
      const par = c.crypto_box_keypair();
      const outro = c.crypto_box_keypair();
      const mensagem = ascii('envelope selado');
      const selado = c.crypto_box_seal(mensagem, par.publicKey);
      return (
        selado.length === mensagem.length + 48 &&
        iguais(c.crypto_box_seal_open(selado, par.publicKey, par.privateKey), mensagem) &&
        lanca(() => c.crypto_box_seal_open(adulterar(selado, 60), par.publicKey, par.privateKey)) &&
        lanca(() => c.crypto_box_seal_open(selado, outro.publicKey, outro.privateKey))
      );
    },

    'secretstream.ida-volta-ordem-e-fim': () => {
      const chave = c.randombytes_buf(32);
      const pedacos = ['primeiro', 'segundo', 'ultimo'].map((p) => ascii(p));
      const { state, header } = c.crypto_secretstream_xchacha20poly1305_init_push(chave);
      const cifrados = pedacos.map((pedaco, i) =>
        c.crypto_secretstream_xchacha20poly1305_push(
          state,
          pedaco,
          null,
          i === pedacos.length - 1
            ? c.crypto_secretstream_xchacha20poly1305_TAG_FINAL
            : c.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE,
        ),
      );

      const abrir = (lista: readonly Uint8Array[]) => {
        const leitura = c.crypto_secretstream_xchacha20poly1305_init_pull(header, chave);
        return lista.map((cifrado) =>
          c.crypto_secretstream_xchacha20poly1305_pull(leitura, cifrado, null),
        );
      };

      const abertos = abrir(cifrados);
      const [primeiro, segundo, terceiro] = cifrados;
      if (!primeiro || !segundo || !terceiro) return false;
      const ultimo = abertos[2];
      return (
        abertos.every(
          (aberto, i) => aberto !== false && iguais(aberto.message, pedacos[i] ?? new Uint8Array()),
        ) &&
        ultimo !== false &&
        ultimo !== undefined &&
        ultimo.tag === c.crypto_secretstream_xchacha20poly1305_TAG_FINAL &&
        // Pedaço adulterado ou fora de ordem é recusado.
        abrir([adulterar(primeiro)])[0] === false &&
        abrir([segundo])[0] === false &&
        // Fluxo truncado: sem o último pedaço, nenhum chega com a etiqueta de fim.
        abrir([primeiro, segundo]).every(
          (aberto) =>
            aberto !== false && aberto.tag !== c.crypto_secretstream_xchacha20poly1305_TAG_FINAL,
        )
      );
    },

    'argon2id.libsodium': () =>
      iguais(
        c.crypto_pwhash(
          155,
          hex(ARGON2ID.senha),
          hex(ARGON2ID.sal),
          5,
          7256678,
          c.crypto_pwhash_ALG_ARGON2ID13,
        ),
        hex(ARGON2ID.saida),
      ),
  });
}
