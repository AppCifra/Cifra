// As funções da libsodium que o protocolo usa para validar o que chega: conferir assinatura Ed25519
// e calcular BLAKE2b. O protocolo não importa nada (RNF-15): quem valida entrega estas funções. A
// porta Cripto do núcleo e a libsodium-wrappers do relay já cumprem esta interface, com os nomes e a
// ordem de parâmetros da libsodium (RNF-01).

export interface Verificador {
  crypto_sign_verify_detached(
    assinatura: Uint8Array,
    mensagem: Uint8Array,
    chavePublica: Uint8Array,
  ): boolean;
  /** Sem chave, passe `null`. */
  crypto_generichash(tamanho: number, mensagem: Uint8Array, chave: Uint8Array | null): Uint8Array;
}

/** Só o hash: basta para derivar IDs. */
export type Hash = Pick<Verificador, 'crypto_generichash'>;

/**
 * Assina com a chave privada de identidade. Na libsodium:
 * `(mensagem) => crypto_sign_detached(mensagem, chavePrivada)`. A chave privada não entra no
 * protocolo.
 */
export type Assinar = (mensagem: Uint8Array) => Uint8Array;
