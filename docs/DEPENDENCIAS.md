# Dependências

Cada dependência entra com versão exata e justificativa (RNF-16). O teste `tests/versoes.test.ts` falha se algum `package.json` tiver dependência fora desta tabela ou com outra versão, e também se sobrar linha aqui.

Para adicionar uma dependência:

1. Confirme que ela é mesmo necessária e que nenhuma já instalada resolve.
2. Instale com `pnpm add`. O pnpm grava a versão exata e só aceita versões publicadas há pelo menos 7 dias.
3. Acrescente a linha na tabela, no mesmo commit.

"Usado em" é `raiz` ou o nome do pacote, separados por vírgula.

| Pacote | Versão | Usado em | Por quê |
| --- | --- | --- | --- |
| `@eslint/js` | 10.0.1 | raiz | regras recomendadas do ESLint |
| `@op-engineering/op-sqlite` | 18.2.5 | `@cifra/mobile` | SQLCipher 4.19 (SQLite 3.53.4) com FTS5 no Android (RNF-07, RNF-08); candidata do SPEC, aprovada no spike. No Android, o OpenSSL dele é o compilado do fonte (ver abaixo) |
| `@types/node` | 24.13.6 | raiz | tipos do Node para configs e testes; nunca entram no `src/` dos pacotes |
| `@types/react` | 19.2.18 | `@cifra/mobile` | tipos do React 19.2 |
| `@types/ws` | 8.18.1 | `@cifra/relay` | tipos do ws. A 8.18.2 tinha 2 dias quando o relay entrou, abaixo da idade mínima de 7 |
| `eslint` | 10.11.0 | raiz | lint; `no-console` é erro (RNF-05) |
| `expo` | 57.0.24 | `@cifra/mobile` | SDK 57 (React Native 0.86): build de desenvolvimento, config plugins e módulos nativos locais; candidata do SPEC |
| `expo-file-system` | 57.0.7 | `@cifra/mobile` | ler os bytes do banco no spike (arquivo ilegível, exclusão real). Os anexos não usam: ficam dentro do banco cifrado, e o vídeo toca da memória |
| `i18next` | 26.4.2 | `@cifra/i18n` | textos em pt-BR e en com troca de idioma na hora (RF-49, RNF-22); candidata do SPEC, sem dependências |
| `libsodium-wrappers-sumo` | 0.8.4 | `@cifra/core`, `@cifra/protocol`, `@cifra/relay` | libsodium de referência no Node (RNF-01). No core, os testes de conformidade conferem os vetores contra ela; no protocol, os testes assinam e conferem cartões; no relay, confere assinaturas Ed25519, calcula BLAKE2b e sorteia os desafios. Candidata do SPEC para web e relay; traz os próprios tipos |
| `prettier` | 3.9.9 | raiz | formatação; sem dependências |
| `react` | 19.2.3 | `@cifra/mobile` | versão que o Expo SDK 57 exige |
| `react-native` | 0.86.3 | `@cifra/mobile` | versão que o Expo SDK 57 exige; New Architecture e Hermes |
| `react-native-keychain` | 10.0.0 | `@cifra/mobile` | Keystore com biometria ou senha do aparelho (RF-40); candidata do SPEC. O expo-secure-store ficou de fora no spike: só aceita biometria, sem a senha do aparelho |
| `react-native-safe-area-context` | 5.7.0 | `@cifra/mobile` | margens das barras do sistema (status, recorte da câmera e navegação): no Android 16 o app ocupa a tela inteira, e o React Native não informa essas margens. Atualiza quando elas mudam e tem a mesma API no iOS e na web. Versão que o Expo SDK 57 indica; sem dependências, sem permissões e sem log no que o app usa (o único `Log.w` fica no `SafeAreaView`, que o app não usa) |
| `react-native-libsodium` | 1.7.0 | `@cifra/mobile` | libsodium no Android pela JSI (RNF-01); candidata do SPEC, com patch (ver abaixo) |
| `typescript` | 6.0.3 | raiz | tipagem estrita; o 7 fica para quando o typescript-eslint suportar |
| `typescript-eslint` | 8.70.1 | raiz | lint com informação de tipos |
| `vite` | 8.3.0 | raiz | exigido pelo vitest 5 como dependência de par |
| `vitest` | 5.0.1 | raiz | testes |
| `ws` | 8.21.3 | `@cifra/relay` | WebSocket do relay: sem dependências, `maxPayload` recusa mensagem grande antes de ler e a compressão fica desligada. Candidata do SPEC; o Fastify ficou de fora, porque traz o pino (log) e dezenas de dependências para uma rota só. Os opcionais `bufferutil` e `utf-8-validate` não entram. É a mesma versão que o Expo já trazia; a 8.22.0 tinha 5 dias |

## Patches

Cada patch em `patches/` está em `patchedDependencies` no `pnpm-workspace.yaml` e é aplicado na instalação. O teste `tests/versoes.test.ts` exige que todo patch esteja listado aqui.

- `patches/react-native-libsodium@1.7.0.patch`. Só ligações JSI para funções da libsodium; nenhuma primitiva própria (RNF-01). Sai quando o PR com estas mudanças entrar no projeto original (material em `docs/upstream/react-native-libsodium.md`).
  - Liga `crypto_scalarmult`, `crypto_sign_ed25519_sk_to_curve25519` e `crypto_secretstream_xchacha20poly1305_*`, mais as constantes que faltavam. Sem elas não há X3DH, Double Ratchet nem anexos.
  - Liga `crypto_hash_sha256`: o checksum das 12 palavras (BIP39) é SHA-256, e assim ele também vem da libsodium.
  - `memzero` em JS, igual ao da libsodium.js.
  - Os dados adicionais do AEAD aceitam bytes e `null`; antes, só texto.
  - Confere o tamanho antes de ler a memória em `crypto_box_seal_open`, `crypto_aead_xchacha20poly1305_ietf_decrypt` e `crypto_sign_ed25519_pk_to_curve25519`.
  - Tira o `console.log` que rodava ao carregar (RNF-05).
  - Corrige o caminho com contrabarra que quebrava o CMake no Windows.

## Scripts de instalação liberados

O pnpm bloqueia os scripts de instalação das dependências. Cada liberação em `allowBuilds` (`pnpm-workspace.yaml`) aparece aqui com o motivo.

- `react-native-libsodium`: o `postinstall` só extrai `libsodium/build.tgz`, a libsodium 1.0.21 pré-compilada que vem no pacote. Compilar do fonte vai junto com o build reproduzível, na fase 3.

## Fora do npm

Não passam pelo teste acima, mas seguem a mesma regra: versão exata e motivo.

- OpenSSL 3.5.9, a versão de suporte longo (LTS), com correções até 08/04/2030. O SQLCipher usa o libcrypto dele para cifrar as páginas do banco no Android. É compilado do fonte oficial na imagem do release (`apps/mobile/release/openssl.sh`), no lugar do `io.github.ronickg:openssl:3.3.2-1` que o op-sqlite pede ao Maven Central, publicado por uma conta pessoal. O plugin `plugins/openssl.js` faz a troca.
  - Fonte: o tarball do release `openssl-3.5.9` em github.com/openssl/openssl, com SHA-256 `603f5602e2eef00d77fbd429d34dcd5822bb301757a1bc9cdb24c670f1eb859a`.
  - Assinatura: precisa ser da chave principal do OpenSSL, com a impressão digital `B146 647E 45A7 B339 47AB 226B 2A2C 87D1 6169 2D40` publicada em openssl-library.org/source. A chave fica em `apps/mobile/release/openssl-chave.asc`.
  - Build: só o `libcrypto.so`, para as 4 ABIs, com o NDK 27.1 e a API 29, sem ler `openssl.cnf` (`no-autoload-config`) e com páginas de 16 KB. A data do build é a do release, e os caminhos são fixos: o mesmo fonte gera os mesmos binários.
  - A cada correção de segurança da 3.5, sobem juntos a versão e o SHA-256 no Dockerfile, a versão no plugin e na verificação técnica, e esta linha. O teste `apps/mobile/test/openssl.test.ts` confere que batem.
- Fontes Geist e Geist Mono 1.7.2 (github.com/vercel/geist-font, release v1.7.2): as fontes do design. O zip do release tem SHA-256 `7fc800d2ac6b92844895196e5041aca55d814c15db70c44f79b3b83ab82b04e2`, igual ao que o GitHub publica para ele. Licença OFL 1.1, que permite empacotar com o app; o texto vai junto em `apps/mobile/assets/fontes/OFL.txt`. O plugin `plugins/fontes.js` copia os arquivos para o Android. O teste `tests/fontes.test.ts` confere o SHA-256 de cada um:
  - `Geist-Regular.ttf`: `5c8968eafb98a4c4f47033daf29e38e284a6f2a82eb017d171ab040fe7c4b615`
  - `Geist-Medium.ttf`: `0090e004725f6f64b841715b4167920580f883fcf9b67fc6d744089103fec101`
  - `Geist-SemiBold.ttf`: `612ec98df33935354f39e81e54101656961ab6e5549f64b63eb57868ba7bab8d`
  - `GeistMono-Regular.ttf`: `42d8ad2e610238e64e8abfcde3037c63f7850a73928742b7ab7229d897bcb155`
- OkHttp 4.9.2: vem dentro do React Native 0.86. O módulo `cifra-plataforma` usa para o WebSocket via Orbot, sem dependência nova.
- Build de release (`apps/mobile/release`): imagem `node:24-bookworm` travada pelo digest, `openjdk-17-jdk-headless` 17.0.20.1+1-1~deb12u1 do Debian, ferramentas de linha de comando do Android 13114758 conferidas pelo SHA-256, e SDK 36, build-tools 36.0.0, NDK 27.1.12297006 e CMake 3.22.1.
- Imagens Docker do servidor .onion de teste (`apps/mobile/spike/onion`): `alpine:3.22` e `node:24-alpine`, travadas pelo digest, com `tor` 0.4.9.14-r0 do Alpine.
- Imagens Docker do relay (`apps/relay`): `node:24-alpine` (Alpine 3.24) e `alpine:3.24`, travadas pelo digest do índice, que vale para amd64 e arm64, com `tor` 0.4.9.14-r0 do Alpine. Dentro da imagem, o pnpm é o do `packageManager`, via corepack, e as dependências saem do lockfile. O teste `tests/docker.test.ts` exige digest em todo `FROM` e todo `image:`.
  - O Alpine só guarda a última versão de cada pacote: quando sai uma correção do Tor, a versão travada some e a imagem deixa de sair. O CI gera as imagens do zero toda semana para avisar; aí sobem juntas a versão no Dockerfile e esta linha, e o servidor recebe a imagem nova.
- Banco do relay: o `node:sqlite`, que vem no Node 24 (SQLite 3.53), no lugar do better-sqlite3, candidata do SPEC. Não é dependência: não compila nada, não precisa liberar script de instalação e funciona igual no arm64. A API ainda não é estável no Node 24; a imagem do relay fica travada pelo digest.
- CI: `tonistiigi/binfmt`, travada pelo digest, registra a emulação do arm64 para gerar e testar a imagem do relay como no Raspberry Pi (RNF-19).
