# PR para serenity-kit/react-native-libsodium

Material para abrir o PR com as mudanças de `patches/react-native-libsodium@1.7.0.patch`. Quando o PR entrar e sair uma versão com ele, o patch some daqui e de `docs/DEPENDENCIAS.md`.

Para montar o branch no repositório deles, aplique os trechos de `cpp/`, `src/` e `android/build.gradle` do patch. O trecho de `lib/typescript/` não entra: lá ele é gerado pelo `bob build`.

Talvez eles prefiram dividir em PRs menores: (1) funções novas, (2) dados adicionais binários no AEAD, (3) checagens de tamanho, (4) caminho no Windows e `console.log`.

---

## Title

Add X25519 scalar multiplication, secretstream, SHA-256 and Ed25519 secret key conversion; accept binary additional data in AEAD

## Body

### Summary

This brings the native API closer to `libsodium-wrappers` for protocols that need raw X25519 and streaming encryption (X3DH, Double Ratchet, encrypted attachments). All new functions are thin JSI bindings to libsodium; no cryptography is implemented in the bindings.

### New functions and constants

- `crypto_scalarmult(privateKey, publicKey)`, plus `crypto_scalarmult_BYTES` and `crypto_scalarmult_SCALARBYTES`
- `crypto_sign_ed25519_sk_to_curve25519(privateKey)`
- `crypto_hash_sha256(message)`, plus `crypto_hash_sha256_BYTES`. Needed, for example, for the BIP39 mnemonic checksum.
- `crypto_secretstream_xchacha20poly1305_init_push`, `_push`, `_init_pull`, `_pull`, plus `KEYBYTES`, `HEADERBYTES`, `ABYTES`, `TAG_MESSAGE` and `TAG_FINAL`. The stream state is an opaque object holding an `ArrayBuffer` that the native side updates in place. `_pull` returns `false` for a forged, reordered or truncated chunk, like libsodium.js.
- `memzero(bytes)`, with the same behavior as libsodium.js: it wipes the view in place.
- Constants: `crypto_sign_PUBLICKEYBYTES`, `crypto_sign_SECRETKEYBYTES`, `crypto_sign_BYTES`, `crypto_aead_xchacha20poly1305_ietf_ABYTES`, `crypto_box_SEALBYTES`, `crypto_pwhash_OPSLIMIT_MODERATE` and `crypto_pwhash_MEMLIMIT_MODERATE`.

### Fixes

- `crypto_aead_xchacha20poly1305_ietf_encrypt` and `_decrypt` accept `Uint8Array` and `null` as additional data, as `libsodium-wrappers` does. Before, anything but a string threw "input type not yet implemented".
- Length checks before reading memory:
  - `crypto_box_seal_open` and the AEAD decrypt: a ciphertext shorter than the MAC made the output length wrap around.
  - `crypto_sign_ed25519_pk_to_curve25519`: the input length was not checked.
- The new bindings check the argument count before reading `arguments[i]`.
- `NODE_MODULES_DIR` is passed to CMake with forward slashes. On Windows, the backslashes made CMake fail with "Invalid character escape".
- Removed the `console.log` and `console.warn` calls that ran when the module loaded. Apps that forbid logging can now use the library as is.

### Testing

Tested with known-answer vectors on an Android emulator (API 36, x86_64) with React Native 0.86.3 (New Architecture, Hermes). The same vectors pass against `libsodium-wrappers-sumo` 0.8.4 in Node.

- RFC 8032 (Ed25519, tests 1 and 2), RFC 7748 (X25519, section 6.1) and RFC 7693 (BLAKE2b).
- FIPS 180-2, appendix B (SHA-256, one block and two blocks), and the empty message from NIST CAVP.
- draft-irtf-cfrg-xchacha-03, A.3.1, and AEAD with `null` additional data.
- libsodium 1.0.21 test vectors for `crypto_kdf`, `ed25519_convert` and `pwhash_argon2id`.
- Round trips and tamper detection for `crypto_box_seal`, and for secretstream with a forged, reordered and truncated stream.

iOS was not built. The bindings are in the shared C++ file, so they should compile there, but this is untested.
