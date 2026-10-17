# Verificação final

Os 12 testes da seção "Testes e verificação" do SPEC, rodados no APK de release, e o que foi corrigido no caminho. Como rodar de novo está no fim.

## Resumo

| Teste | Resultado |
| --- | --- |
| 1. Perícia no aparelho | passou: com o app bloqueado, nenhum texto, apelido, ID ou anexo legível no `/data` inteiro; o IPED não achou nenhum dos marcadores em 36.576 itens |
| 2. Conversas ocultas | passou: com o app desbloqueado e o cofre fechado, nenhum rastro do contato oculto (ID, apelido, mensagens, código); o IPED não achou nada em 36.489 itens |
| 3. Captura de rede | passou: só conexões com relays do Tor saem do aparelho, sem DNS; com o Orbot desligado, só tentativas recusadas no 127.0.0.1:9050 |
| 4. Tamanho dos pacotes | passou: todo depósito e toda entrega com 4096 bytes; os anexos sobem em tamanhos da faixa |
| 5. Dump do relay | passou: nenhum conteúdo, remetente ou IP; datas na hora cheia, menos os cartões publicados antes da correção da data (abaixo) |
| 6. Metadados de anexo | passou depois da correção: o vídeo levava a versão do Android e a hora da limpeza |
| 7. Protocolo | passou: vetores e conversa no aparelho, pela verificação técnica, e no Node |
| 8. Fila de saída | passou: com o relay parado, "pendente"; ao voltar, "enviada", e chegou uma vez |
| 9. Timer curto | passou: "a message expired before you opened it" |
| 10. Apagar pra todos | passou: a mensagem não aparece quando o app volta; o marcador não está no aparelho |
| 11. Pânico | passou: nenhuma chave do app no Keystore, nenhum marcador no `/data`; o relay apagou o cartão e a caixa; o IPED não achou nada em 36.461 itens |
| 12. Restauração | passou: mesmo ID, contatos, verificação e ajustes do backup; a cópia anterior recebeu "a identidade está em outro aparelho" |

## Corrigido na verificação

- **Data do cartão com minuto e segundo.** O relay guardava o instante exato de cada publicação (a data vem assinada dentro do cartão). Agora o app publica com a hora cheia; a seguinte na mesma hora anda 1 ms.
- **Vídeo enviado com a versão do Android e a hora da limpeza.** O MediaMuxer grava `com.android.version` e as datas do filme e das trilhas. Agora os metadados viram `free` e as datas, zero, no próprio arquivo (`apps/mobile/src/mp4.ts`).
- **Timer cancelado que rodava.** No Android, o cancelamento podia chegar ao módulo nativo antes da espera, e a tarefa rodava mesmo cancelada (a verificação técnica acusou). O adaptador do relógio guarda o cancelamento também do lado do JS.
- **Contraste do tema claro.** Secundário e perigo ficavam abaixo de 4,5:1 sobre alguns fundos: passaram a `#64675F` e `#BF321D`, com teste.
- **Toque e leitura de tela.** O clipe do campo ganhou área de 44 dp, e o campo, altura de 44. As 12 palavras viraram duas colunas na árvore de acessibilidade (antes, 1, 7, 2, 8…).
- **Pânico.** Passa a apagar todo o cache do app e a tirar da área de transferência o que o Cifra copiou.
- **Multitarefa.** Sem imagem guardada pelo sistema, mesmo com o print liberado (Android 13 ou mais novo).
- **Tor do relay.** `SafeLogging 1` e só avisos; o Docker não guarda log do relay.
- **Verificação técnica.** O teste do cofre gravava no lugar da chave mestra do app e, com uma identidade no aparelho, apagava os dados dela: agora recusa. A conversa de teste aceita o pedido antes de responder (RF-07).

## Como foi feito

**Ambiente:** emulador Android 16 (x86_64, Google APIs, com root pelo `adb root`), APK de release gerado no container (`apps/mobile/release`), Orbot em "Power User Mode", relay e Tor no Docker deste PC, contato de teste no PC (`apps/mobile/spike/contato`).

**Cenário:** textos únicos (marcadores) em cada coisa que não pode sobrar: mensagens enviadas e recebidas, uma apagada só neste celular, uma apagada pra todos com o app sem Tor, uma de 10 s que venceu com o app sem Tor, uma que esperou o relay voltar, nota pessoal, legenda de foto, dois apelidos trocados, e uma conversa oculta com mensagens, apelido e o código secreto. Os IDs dos três entram como marcadores também.

**Perícia (1, 2 e 11):** como quem tem o aparelho com root, a extração do `/data` inteiro (`tar`, que inclui o armazenamento compartilhado) e do logcat, em três momentos: app bloqueado; app desbloqueado com o cofre fechado; depois do pânico. Em cada uma:

- `varredura.ts` procura cada marcador em UTF-8, UTF-16 e base64, arquivo por arquivo: 0 achados nas três.
- O IPED 4.3.1 processa a mesma extração, com os marcadores na lista de palavras-chave, e abre o `.tar` sozinho: nenhum acerto nas três. Como controle, um caso com o logcat junto achou os marcadores que estão nele (ver abaixo), e só eles: a busca funciona, inclusive com os IDs com hífen.
- Trechos binários do vídeo e da foto como o app os gerou (o `mvhd` com a hora da limpeza e um pedaço do JPEG recodificado), procurados como `hex:`, não estão nas extrações: nem o MP4 temporário da limpeza nem cache de imagem guardaram cópia. Os mesmos trechos aparecem nos arquivos que o contato salvou.
- O logcat, numa sessão inteira de uso do release, só tem linhas do sistema. Os apelidos e IDs que aparecem nele vêm do `AccessibilityNodeInfoDumper`, isto é, do `uiautomator dump` que a própria verificação usa para ler a tela; num aparelho sem essa ferramenta, não existem.
- A imagem do multitarefa do Cifra é uma tela em branco.

Depois do pânico, sobram na pasta do app: o arquivo do keychain com 0 byte, o marcador de perfil do Android e o estado dos pedidos de permissão do Expo (sem dado da pessoa). Num aparelho que rodou o build de desenvolvimento, sobram também os arquivos dele (bundle de desenvolvimento, WebView).

**Rede (3):** `tcpdump -i any` no próprio aparelho (o `emulator -tcpdump` não vê a interface Wi-Fi do Android 16), com uma identidade nova publicando, um vídeo enviado e um minuto com o Orbot desligado, e o `rede.ts` para ler a captura. O tráfego do Cifra pelo sistema (`dumpsys netstats`, por UID) ficou em zero byte fora do loopback durante todo o uso do release.

**Pacotes (4):** `tcpdump` dentro da rede do Tor do relay, na porta 8080, durante o cenário, e o `tamanhos.ts`, que lê cada pedido e cada mensagem com o `@cifra/protocol`: 8 depósitos e 6 entregas, todos de 4096 bytes; 2 anexos com tamanho da faixa.

**Relay (5):** cópia do `relay.sqlite` do volume, com o `dump.ts`. Os cartões publicados antes da correção da data (o do contato de teste e os de testes anteriores) ainda estão com minuto; somem ou se acertam na próxima renovação.

**Anexos (6):** foto e vídeo de amostra com GPS, marca, modelo, data, autor, descrição e miniatura, feitos com o exiftool e o ffmpeg num container descartável e postos na galeria do emulador. Enviados pelo app, o contato de teste salva decifrados e o exiftool confere: sem nada disso. No vídeo, sem versão do Android e com as datas zeradas, e ele ainda decodifica.

**Memória do SQLCipher:** o `cipher_memory_security` custou uns 30% num trabalho de 2000 mensagens com busca (emulador, build de desenvolvimento) e ficou desligado; o SPEC registra o risco.

## Fora do alcance do emulador

- Ouvir com o TalkBack a ordem das palavras e o pânico (o `uiautomator` não mostra o foco de acessibilidade). A árvore está na ordem certa.
- Medir em aparelho real o Argon2id e o `cipher_memory_security`.
- Chave em hardware (TEE ou StrongBox): o emulador não tem.

## Como rodar de novo

Os scripts ficam em `apps/mobile/spike/verificacao/` e `apps/relay/scripts/dump.ts`, sem dependência nova, com testes em `apps/mobile/test/verificacao.test.ts` e `apps/relay/test/dump-real.test.ts`. Comandos em `docs/DESENVOLVIMENTO.md` ("Verificação final").
