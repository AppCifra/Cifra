# Spike técnico

A prova, no Android, das bibliotecas de que o Cifra depende: a libsodium, o SQLCipher com FTS5, o WebSocket até um .onion pelo Orbot, o FLAG_SECURE e o Keystore com biometria. O que falhou foi corrigido ou trocado antes de entrar no app.

## Resumo

| Item | Escolha | Resultado no emulador |
| --- | --- | --- |
| libsodium | react-native-libsodium 1.7.0, com patch | aprovada: 16 de 16 verificações de conformidade, bytes iguais aos do Node |
| Banco cifrado com busca | op-sqlite 18.2.5 (SQLCipher 4.19, SQLite 3.53.4, FTS5) | aprovado: 12 de 12 |
| Exclusão real | `secure_delete`, journal DELETE e o `secure-delete` do FTS5 | aprovada: o texto apagado some do arquivo; sem os ajustes, fica |
| Keystore com biometria | react-native-keychain 10.0.0 | aprovado: digital, PIN, cancelar, dedo errado, destruir e chave sem autenticação |
| Bloqueio de print | FLAG_SECURE no `onCreate` + módulo próprio | aprovado: print, Modal e multitarefa saem pretos |
| WebSocket até .onion | módulo próprio (Kotlin, OkHttp do RN, SOCKS do Orbot) | aprovado: pacote de 4096 bytes íntegro; sem Orbot, não conecta |
| Páginas de 16 KB | todas as bibliotecas nativas | aprovado: 19 de 19 no APK, nas ABIs arm64 e x86_64, e a libsodium nas 4 ABIs |
| Build de release | container Linux (Docker) | aprovado: o APK de produção repete tudo acima sem o Metro |

Trocas feitas no spike:

- **expo-screen-capture.** Pede `READ_MEDIA_IMAGES`, `READ_EXTERNAL_STORAGE` e `DETECT_SCREEN_CAPTURE` para detectar print, o que é acesso à galeria. Também só liga o FLAG_SECURE depois que o JS carrega. Foi trocado por um config plugin e um módulo de 20 linhas.
- **expo-secure-store.** O pedido dele só aceita biometria, sem a senha do aparelho, e ele loga nomes de chave. Ficou o react-native-keychain.

## Ambiente

- **Emulador:** "Medium Phone", Android 16 (API 36), x86_64, imagem Google APIs, com PIN e digital simulada (`adb emu finger touch`). O Keystore dele é software (`SECURE_SOFTWARE`).
- **Orbot:** 17.9.5-RC-4 (Tor 0.4.9.11), APK oficial do GitHub do Guardian Project.
  - Assinatura PGP conferida (chave `BBE20FD6DA48A3DD4CC7DF41A801183E69B37AA9`, Nathan of Guardian).
  - Certificado do APK: SHA-256 `a454b87a1847a89ed7f5e70fba6bba96f3ef29c26e0981204fe347bf231dfd5b`.
  - Rodou em "Power User Mode", sem VPN.
- **Servidor .onion de teste:** `apps/mobile/spike/onion`, Docker neste PC. Tor 0.4.9.13 no Alpine 3.22 e eco WebSocket em Node 24.
- **Ferramentas:** Node 24.16, pnpm 11.27.1, Expo SDK 57 (57.0.24), React Native 0.86.3 (New Architecture, Hermes), JDK 17.0.20 (Temurin), NDK 27.1.12297006, CMake 3.31.6. Build de debug no Windows; build de release num container Linux (`apps/mobile/release`).

## 1. libsodium

A react-native-libsodium 1.7.0 não cumpria a porta `Cripto`. Faltavam:

- `crypto_scalarmult`, o X25519 puro de que X3DH e Double Ratchet dependem;
- `crypto_sign_ed25519_sk_to_curve25519`;
- todo o `crypto_secretstream_xchacha20poly1305_*`;
- várias constantes.

A libsodium compilada dentro do pacote tem tudo; faltavam só as ligações. O patch `patches/react-native-libsodium@1.7.0.patch` acrescenta as ligações em C++, que chamam a libsodium e não implementam primitiva nenhuma, e corrige o que o próprio spike achou:

- O AEAD só aceitava dados adicionais como **texto**. Bytes e `null` lançavam "input type not yet implemented", e o Double Ratchet passa o cabeçalho em bytes. O aparelho acusou isso no vetor do draft XChaCha20-Poly1305.
- Faltava conferir tamanho antes de ler a memória em `crypto_box_seal_open`, no decrypt do AEAD (o tamanho dava a volta com texto menor que a etiqueta) e em `crypto_sign_ed25519_pk_to_curve25519`.
- Um `console.log` rodava ao carregar.
- O caminho com contrabarra quebrava o CMake no Windows.

Antes das ligações, a porta perdeu o que o protocolo não usa: `crypto_kx_keypair` (o par X25519 sai de `crypto_box_keypair`), `crypto_scalarmult_base` e as constantes SENSITIVE do Argon2id.

As verificações de conformidade ficam em `packages/core/src/conformidade/cripto.ts`. São vetores de RFC 8032, RFC 7748, RFC 7693, do draft XChaCha20-Poly1305 e da libsodium 1.0.21 (kdf, Ed25519→X25519, Argon2id), além de ida e volta e detecção de adulteração no AEAD, no envelope selado e no secretstream (pedaço adulterado, fora de ordem e fluxo truncado). As mesmas 16 passam no Node, com a libsodium-wrappers-sumo, e no Android. Com o `crypto_hash_sha256`, que faz o checksum das 12 palavras, e os vetores do FIPS 180-2, são 17 verificações, que passam no Node e no emulador.

Tempo do Argon2id no emulador, só como referência, porque não vale para celular:

| Nível | 1ª execução | 2ª execução |
| --- | --- | --- |
| INTERACTIVE (64 MB) | 1157 ms | 172 ms |
| MODERATE (256 MB) | 10894 ms | 4489 ms |

## 2. SQLCipher com FTS5

O op-sqlite abre o banco com a chave crua de 256 bits no formato `x'<64 hex>'`, sem PBKDF2. No aparelho:

- `PRAGMA cipher_version` responde;
- o arquivo não começa com `SQLite format 3` e o marcador gravado não aparece nos bytes;
- chave errada e falta de chave falham, e a chave certa reabre e lê;
- passa na conformidade de `Armazenamento`: parâmetros e BLOB, transação que confirma e desfaz, `secure_delete` = 1, `journal_mode` = delete, e FTS5 com `secure-delete` achando "nao", "CAFE" e "estação" em "Não há café na estação".

No Android, o SQLCipher cifra com o OpenSSL 3.5, compilado do fonte oficial na imagem do release (`docs/DEPENDENCIAS.md`). O RNF-01 registra essa exceção.

## 3. Exclusão real

Num banco de teste em claro, para enxergar os bytes, um marcador vai para a tabela e para o índice FTS5 no meio de 50 linhas, e depois a linha é apagada:

- com `secure_delete` e o `secure-delete` do FTS5, o marcador aparece no arquivo antes e some depois, sem journal sobrando;
- no controle, com os dois desligados, o marcador continua no arquivo depois de apagar.

O controle mostra que a verificação distingue de fato. É o mecanismo do `apagarDeVerdade()`.

A verificação técnica repete o teste com o esquema do app: `prepararBanco()`, 50 mensagens guardadas pelo núcleo, índice de busca de conteúdo externo e `apagarDeVerdade()`. No emulador, 8 de 8: o marcador some do arquivo e da busca, sem journal sobrando. A conformidade do banco cifrado ganhou os temporários na memória, o índice de conteúdo externo e o log do SQLCipher desligado: 15 de 15.

## 4. Keystore com biometria ou senha

| Caso | Resultado |
| --- | --- |
| Guardar 32 bytes com proteção `desbloqueio` | pede biometria; título vem da tradução |
| Ler com o dedo cadastrado | devolve os mesmos 32 bytes |
| Ler só com o PIN ("Use PIN") | devolve os mesmos 32 bytes (RF-40: biometria ou senha) |
| Dedo não cadastrado | o pedido continua aberto e nada sai |
| Cancelar | a leitura é recusada (código 13) e nenhuma chave sai |
| Destruir e ler | `null`, sem pedido |
| Guardar e ler com proteção `aparelho` | sem pedido nenhum, para o serviço de notificação |

Achados:

- A react-native-keychain monta o pedido da **leitura** pelo `accessControl` passado na leitura. Sem ele, só aceita digital e esconde o PIN. O adaptador passa sempre.
- AES-GCM no Keystore com `BIOMETRIC_STRONG | DEVICE_CREDENTIAL` e janela de 5 s depois da autenticação.
- A biblioteca loga no logcat o nome do serviço quando o segredo não existe (`No entry found for service: org.cifra.app.chave-mestra`): nenhum conteúdo nem chave. O build de produção sai sem essas linhas (seção 8).
- Quando a chave do Keystore some, a biblioteca cria outra na leitura seguinte, pede a biometria e só então falha. O módulo `cifra-plataforma` confere antes, sem pedido, se a chave existe e vale. No emulador: válida depois de guardar e ausente depois de destruir. Sem o PIN do aparelho, o app foi direto para a tela de dados perdidos, sem pedido; com o PIN de volta, também. A identidade voltou pelas 12 palavras, com o mesmo ID.

**Limite da chave como texto.** A biblioteca só aceita texto, então a chave mestra atravessa o JS em base64. O `encryptionKey` do op-sqlite também é texto (`x'…'`). Essas cópias não dão para zerar: ficam na memória do Hermes até o coletor de lixo passar. No bloqueio, o app fecha o banco (o SQLCipher apaga a cópia nativa) e descarta as referências. O SPEC registra esse limite.

## 5. Bloqueio de print

- O config plugin `apps/mobile/plugins/tela-segura.js` liga o FLAG_SECURE no `MainActivity.onCreate`, antes do JS. O JS só desliga se a pessoa escolher (`src/adaptadores/tela.ts`).
- Com a tela segura: `dumpsys window` mostra `SECURE` nas janelas do app e o screencap sai preto. Só a barra de status e a barra de gestos do sistema têm pixel.
- Com um `Modal` aberto: a janela do Modal também leva `SECURE` (o React Native copia o flag da Activity ao criar o diálogo) e o print sai preto.
- Controle: "Permitir print" mostra a tela inteira no screencap; "Bloquear print" volta ao preto.
- Multitarefa: a miniatura do Cifra fica preta.

Limite: o Modal copia o flag ao abrir. Se o ajuste mudar com um Modal aberto, aquele Modal mantém o estado anterior até fechar.

## 6. WebSocket até .onion pelo Orbot

O módulo `apps/mobile/modules/cifra-plataforma` abre o WebSocket com o OkHttp do próprio React Native e proxy SOCKS em 127.0.0.1:9050.

- O nome do host vai sem resolver para o Orbot, e um `Dns` que sempre falha garante que nunca há consulta DNS local.
- Antes de conectar, o módulo testa a porta SOCKS: se ela não responde, rejeita com `tor-indisponivel` e nunca tenta o caminho direto.
- A política de rede do Android (`plugins/rede-onion.js`) só permite texto claro (`ws://`) para `*.onion`. No build de debug, permite também o Metro local.

| Medida | 1ª | 2ª | 3ª |
| --- | --- | --- | --- |
| Conectar ao .onion | 4499 ms | 1398 ms | 1900 ms |
| Ida e volta de 4096 bytes | 1124 ms | 1084 ms | 1151 ms |

O pacote de 4096 bytes volta idêntico (RNF-04), e a primeira medida de RNF-21 fica bem abaixo de 5 s. Com o Orbot parado (sem processo, porta 9050 fechada), o app recusa com `tor-indisponivel`. Com o Tor desligado no app, recusa `ws://` com `texto-claro-fora-do-tor`.

**Achado do Orbot.** Em modo VPN, sem app escolhido, a VPN cobre todos os apps, inclusive o Cifra. O SOCKS em 127.0.0.1 continua funcionando, mas o app de debug deixa de alcançar o Metro no PC. Para desenvolver, use "Power User Mode" (sem VPN). Para o usuário final, a VPN do Orbot não atrapalha o Cifra.

## 7. Páginas de 16 KB

Todas as 19 bibliotecas nativas do APK têm segmentos `LOAD` alinhados a 16 KB (`0x4000`), e o `zipalign -c -P 16` passa. A libsodium pré-compilada da react-native-libsodium também está alinhada nas 4 ABIs (armv7, arm64, x86, x86_64). Inclui o `libcrypto.so` (OpenSSL) e o `libop-sqlite.so`.

## 8. Build de release

O Windows bloqueia o compilador do Hermes, então o release sai de um container Linux (`apps/mobile/release`, imagem e ferramentas travadas).

- **Build:** 8 min, para arm64-v8a e x86_64.
- **Assinatura:** chave de depuração do template (`CN=Android Debug`), que serve para testar e não para distribuir. O app instalado não é depurável (sem a flag `DEBUGGABLE`) e roda sem o Metro.

No emulador, com o APK de produção:

| Verificação | Resultado |
| --- | --- |
| libsodium | 16 de 16; Argon2id em 287 ms (INTERACTIVE) e 3365 ms (MODERATE) |
| SQLCipher + FTS5 | 12 de 12 |
| Exclusão real | 4 de 4, com o controle |
| Keystore | guardar e ler com a digital, destruir |
| FLAG_SECURE | ligado desde o `onCreate`, sem o JS mexer; print preto |
| Tor | conectar em 7444 ms a frio (o .onion tinha acabado de voltar) e 1650 ms; ida e volta de 4096 bytes em 1508 ms e 1462 ms |
| Tor indisponível | Orbot parado: `tor-indisponivel`; sem Tor: `texto-claro-fora-do-tor` |
| Páginas de 16 KB | 19 de 19 em arm64-v8a e 19 de 19 em x86_64; `zipalign -P 16` passa |

**Logcat de produção.** Todas as linhas do UID do app: 304.

- Nenhuma tem o endereço .onion, chave, `x'…'` ou conteúdo.
- Quem mais escreve é a react-native-keychain: sondagem do Keystore, "User not authenticated" com pilha de erro (o fluxo normal antes do pedido de biometria) e "No entry found for service: org.cifra.app.chave-mestra".
- O plugin `release-sem-log` tira essas chamadas do `android.util.Log` do build de produção: no release, o logcat não mostra nada do Cifra.
- O pacote sai sem backup do sistema (RNF-09): `allowBackup` falso e regras de extração que excluem os 9 lugares de dados da nuvem e da transferência entre aparelhos. No emulador, as flags do pacote não têm `ALLOW_BACKUP` e o `bmgr backupnow` responde "Backup is not allowed".

## Achados do ambiente Windows

- O ninja que vem com o CMake 3.22.1, padrão do Android Gradle Plugin, não aceita caminho acima de 260 caracteres, mesmo com `LongPathsEnabled`, e os caminhos do pnpm passam disso. Com `CIFRA_CMAKE_DIR` apontando para o CMake 3.31.6 (ninja 1.12), o plugin `cmake-local.js` grava `cmake.dir` no `local.properties`.
- O Controle Inteligente de Aplicativos do Windows (Device Guard) bloqueia executáveis sem assinatura vindos do npm e do SDK: o `hermesc.exe` do build release e o `sdkmanager` novo. O build release saiu de um container Linux (seção 8), que também é o caminho do build reproduzível. Desligar o Controle Inteligente de Aplicativos não tem volta sem reinstalar o Windows.

## Pendente

Depende de aparelho Android real:

- nível do Keystore em hardware (TEE ou StrongBox) e a decisão de exigir hardware;
- tempo real do Argon2id, para escolher os parâmetros do código secreto;
- biometria com sensor de verdade;
- aparelho com páginas de 16 KB ligadas (Pixel 8 ou mais novo, Android 15+);
- tempos do Tor em rede móvel.

## Como repetir

1. Suba o .onion de teste: `docker compose up -d --build` em `apps/mobile/spike/onion`. O endereço sai de `docker compose exec tor cat /var/lib/tor/cifra-eco/hostname`.
2. No emulador ou aparelho: instale o Orbot, ligue o "Power User Mode" e conecte. No emulador, configure PIN e digital (`adb shell locksettings set-pin 1234` e, durante o cadastro, `adb emu finger touch 1`).
3. Gere e instale o app: veja "App Android" em `docs/DESENVOLVIMENTO.md`. No emulador, rode `adb reverse tcp:8081 tcp:8081` e deixe o Metro rodando.
4. A tela "Verificação técnica" só existe no build de desenvolvimento: inicie o Metro com `EXPO_PUBLIC_CIFRA_VERIFICACAO=1` (veja `docs/DESENVOLVIMENTO.md`). Rode cada seção; no Tor, cole o endereço `ws://<endereço>.onion`. No emulador, o dedo é `adb emu finger touch 1`; um dedo não cadastrado é o 2.
5. Para print e multitarefa: `adb exec-out screencap -p` e `adb shell dumpsys window windows`.
