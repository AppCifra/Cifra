// Porta de criptografia: um subconjunto da libsodium com os mesmos nomes e a mesma ordem de
// parâmetros da libsodium-wrappers. A react-native-libsodium segue a mesma API, então o
// adaptador de cada plataforma é a própria biblioteca. Os nomes originais deixam a revisão
// comparar cada chamada 1:1 com a documentação da libsodium (RNF-01).
//
// Só entra aqui o que a tabela "Primitivas" do SPEC usa. Nunca implemente uma primitiva:
// se faltar alguma, ela entra nesta interface e vem da libsodium.

/** Par de chaves no formato da libsodium. */
export interface ParDeChaves {
  readonly publicKey: Uint8Array;
  readonly privateKey: Uint8Array;
}

/** Estado de um fluxo `crypto_secretstream`. Opaco: só a implementação sabe o que tem dentro. */
export type EstadoDoFluxo = unknown;

/** Um pedaço decifrado de um fluxo `crypto_secretstream`, com a etiqueta que veio junto. */
export interface PedacoDoFluxo {
  readonly message: Uint8Array;
  readonly tag: number;
}

export interface Cripto {
  // Aleatoriedade e limpeza de memória
  randombytes_buf(tamanho: number): Uint8Array;
  memzero(bytes: Uint8Array): void;

  // Identidade e assinaturas: Ed25519
  readonly crypto_sign_SEEDBYTES: number;
  readonly crypto_sign_PUBLICKEYBYTES: number;
  readonly crypto_sign_SECRETKEYBYTES: number;
  readonly crypto_sign_BYTES: number;
  crypto_sign_seed_keypair(semente: Uint8Array): ParDeChaves;
  crypto_sign_detached(mensagem: Uint8Array, chavePrivada: Uint8Array): Uint8Array;
  crypto_sign_verify_detached(
    assinatura: Uint8Array,
    mensagem: Uint8Array,
    chavePublica: Uint8Array,
  ): boolean;
  crypto_sign_ed25519_pk_to_curve25519(chavePublicaEd25519: Uint8Array): Uint8Array;
  crypto_sign_ed25519_sk_to_curve25519(chavePrivadaEd25519: Uint8Array): Uint8Array;

  // Acordo de chaves: X25519. Os pares avulsos (prekeys, catraca) saem de crypto_box_keypair;
  // o par da identidade sai da conversão da chave Ed25519.
  readonly crypto_box_PUBLICKEYBYTES: number;
  readonly crypto_box_SECRETKEYBYTES: number;
  readonly crypto_scalarmult_BYTES: number;
  readonly crypto_scalarmult_SCALARBYTES: number;
  crypto_box_keypair(): ParDeChaves;
  crypto_scalarmult(chavePrivada: Uint8Array, chavePublica: Uint8Array): Uint8Array;

  // Hash e derivação de chaves: BLAKE2b
  readonly crypto_generichash_BYTES: number;
  readonly crypto_generichash_BYTES_MIN: number;
  readonly crypto_generichash_BYTES_MAX: number;
  readonly crypto_generichash_KEYBYTES: number;
  readonly crypto_kdf_KEYBYTES: number;
  readonly crypto_kdf_CONTEXTBYTES: number;
  /** Sem chave, passe `null`. */
  crypto_generichash(tamanho: number, mensagem: Uint8Array, chave: Uint8Array | null): Uint8Array;
  crypto_kdf_derive_from_key(
    tamanho: number,
    idDaSubchave: number,
    contexto: string,
    chave: Uint8Array,
  ): Uint8Array;

  // Checksum das 12 palavras: o BIP39 exige SHA-256
  readonly crypto_hash_sha256_BYTES: number;
  crypto_hash_sha256(mensagem: Uint8Array): Uint8Array;

  // Cifra das mensagens: XChaCha20-Poly1305
  readonly crypto_aead_xchacha20poly1305_ietf_KEYBYTES: number;
  readonly crypto_aead_xchacha20poly1305_ietf_NPUBBYTES: number;
  readonly crypto_aead_xchacha20poly1305_ietf_ABYTES: number;
  crypto_aead_xchacha20poly1305_ietf_encrypt(
    mensagem: Uint8Array,
    dadosAdicionais: Uint8Array | null,
    nonceSecreto: null,
    nonce: Uint8Array,
    chave: Uint8Array,
  ): Uint8Array;
  /** Lança erro se o texto cifrado ou os dados adicionais foram adulterados. */
  crypto_aead_xchacha20poly1305_ietf_decrypt(
    nonceSecreto: null,
    cifrado: Uint8Array,
    dadosAdicionais: Uint8Array | null,
    nonce: Uint8Array,
    chave: Uint8Array,
  ): Uint8Array;

  // Envelope selado, que esconde o remetente: X25519 + XSalsa20-Poly1305
  readonly crypto_box_SEALBYTES: number;
  crypto_box_seal(mensagem: Uint8Array, chavePublica: Uint8Array): Uint8Array;
  /** Lança erro se o envelope não foi selado para este par de chaves ou foi adulterado. */
  crypto_box_seal_open(
    cifrado: Uint8Array,
    chavePublica: Uint8Array,
    chavePrivada: Uint8Array,
  ): Uint8Array;

  // Anexos: XChaCha20-Poly1305 em fluxo
  readonly crypto_secretstream_xchacha20poly1305_KEYBYTES: number;
  readonly crypto_secretstream_xchacha20poly1305_HEADERBYTES: number;
  readonly crypto_secretstream_xchacha20poly1305_ABYTES: number;
  readonly crypto_secretstream_xchacha20poly1305_TAG_MESSAGE: number;
  readonly crypto_secretstream_xchacha20poly1305_TAG_FINAL: number;
  crypto_secretstream_xchacha20poly1305_init_push(chave: Uint8Array): {
    state: EstadoDoFluxo;
    header: Uint8Array;
  };
  crypto_secretstream_xchacha20poly1305_push(
    estado: EstadoDoFluxo,
    pedaco: Uint8Array,
    dadosAdicionais: Uint8Array | null,
    etiqueta: number,
  ): Uint8Array;
  crypto_secretstream_xchacha20poly1305_init_pull(
    cabecalho: Uint8Array,
    chave: Uint8Array,
  ): EstadoDoFluxo;
  /** Devolve `false` se o pedaço foi adulterado. */
  crypto_secretstream_xchacha20poly1305_pull(
    estado: EstadoDoFluxo,
    cifrado: Uint8Array,
    dadosAdicionais: Uint8Array | null,
  ): PedacoDoFluxo | false;

  // Código secreto e senha: Argon2id
  readonly crypto_pwhash_ALG_ARGON2ID13: number;
  readonly crypto_pwhash_SALTBYTES: number;
  readonly crypto_pwhash_OPSLIMIT_INTERACTIVE: number;
  readonly crypto_pwhash_MEMLIMIT_INTERACTIVE: number;
  readonly crypto_pwhash_OPSLIMIT_MODERATE: number;
  readonly crypto_pwhash_MEMLIMIT_MODERATE: number;
  crypto_pwhash(
    tamanho: number,
    senha: Uint8Array,
    sal: Uint8Array,
    limiteDeOperacoes: number,
    limiteDeMemoria: number,
    algoritmo: number,
  ): Uint8Array;
}
