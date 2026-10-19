# Cifra — Especificação

Versão 0.1.0, o MVP.

## Visão geral

O Cifra é um mensageiro mobile de conversa 1:1, open source, em que a identidade é só um par de chaves gerado no aparelho: sem número, sem e-mail, sem foto. A meta de longo prazo é funcionar mesmo que o operador suma; o MVP prova o núcleo.

**Princípios**

- **O operador é irrelevante.** O relay não sabe quem fala com quem, nunca vê conteúdo e apaga tudo depois da entrega.
- **Matemática, não segredo.** A segurança vem da criptografia, não de o código ser fechado (princípio de Kerckhoffs).
- **Nada inventado.** Protocolos publicados (X3DH, Double Ratchet) e primitivas da libsodium.
- **Texto honesto.** O app diz o que acontece de fato. Nada de "100% seguro".
- **Projetar pra permitir, não construir agora.** O que é de fase 2 não entra no MVP, mas o MVP não pode impedir.

**Garantias e cortesias**

| Tipo | Inclui | Vale contra um app modificado? |
| --- | --- | --- |
| Garantia | sigilo do conteúdo, autenticidade de quem enviou, relay sem acesso ao conteúdo, chave que o relay não consegue trocar | Sim |
| Cortesia | mensagens temporárias, apagar pra todos, bloqueio de print, confirmações de leitura desligadas | Não: depende do app do outro lado ser o oficial |

Um app modificado só consegue trair o que o próprio usuário dele recebe. O texto do app trata cada recurso pelo que ele é.

## Escopo do MVP

O MVP é conversa 1:1 com texto e anexos no Android, sobre um relay oficial e Tor via Orbot. O código já nasce multiplataforma: iOS e web entram depois sem reescrever o núcleo.

**Entra no MVP**

- Identidade gerada no aparelho, com 12 palavras de recuperação e restauração.
- Contatos por ID colado, pedidos de conversa, bloquear e renomear.
- Conversa 1:1 com texto, imagem, vídeo e documento, com limpeza de metadados.
- Nota pessoal: conversa consigo mesmo, só no aparelho.
- Mensagens temporárias por conversa e por mensagem, com timer padrão para as conversas novas; apagar pra todos.
- Confirmação de leitura e indicador de digitação, opcionais e desligados por padrão.
- Conversas ocultas, reveladas só pelo código secreto digitado na busca.
- Número de segurança e verificação manual.
- Armazenamento cifrado, bloqueio do app, bloqueio de print e botão de pânico.
- Backup de contatos e ajustes, cifrado com as palavras.
- Relay oficial (onion), open source, em Docker.
- Tor via Orbot, padding fixo e fila de saída com reenvio.
- Interface em português e inglês, trocável nos ajustes a qualquer momento.

**Plataformas**

| Plataforma | Quando | Observação |
| --- | --- | --- |
| Android | MVP | primeira entrega, do Android 10 em diante |
| iOS | fase 2 | mesmo código; notificação e print têm limites próprios |
| Web | fase 3 | mesmo núcleo; exige cuidado com quem entrega o código (ver riscos) |

**Fora do MVP (não implementar)**

- Grupos e chamadas.
- Vários aparelhos ao mesmo tempo.
- Histórico de mensagens no backup ou na troca de celular.
- Relays da comunidade e troca automática de relay (fase 2). O modelo de dados já nasce com `relays: string[]`.
- Tor embutido, tráfego de cobertura, transferência direta entre celulares e build reproduzível (fase 3).
- Notificação via Google (FCM).
- Mensagens pulando entre relays, relays conversando entre si, token ou staking e P2P.

## Modelo de ameaça

O Cifra protege o conteúdo e a identidade das conversas contra o relay, a rede e a perícia no aparelho bloqueado. Ele não esconde que você usa o app, nem protege contra quem já recebeu a mensagem.

| Adversário | O que tenta | Defesa no Cifra | Limite |
| --- | --- | --- | --- |
| Operador do relay (curioso ou coagido) | ler mensagens, mapear quem fala com quem, trocar chaves | cifra de ponta a ponta; remetente só dentro do envelope selado; ID = hash da chave; sem logs; apaga após a entrega | sabe que um ID existe e quando a caixa dele recebe algo |
| Observador de rede (provedor, Wi-Fi) | ver IP, com quem e quando você fala | Tor via Orbot; relay como onion service; pacotes de tamanho fixo | vê que você usa Tor e quando o app está ativo |
| Censor (ordem judicial, operadora) | bloquear o servidor ou o app | onion service; pontes do Tor; APK fora da loja | internet inteira fora do ar; no iOS, depende da App Store |
| Perícia no aparelho | ler mensagens, recuperar as apagadas | SQLCipher com bloqueio criptográfico; exclusão real; anexos cifrados; fora de backups; contatos fora da agenda | registros do sistema de quando o app abriu; celular pego com o app aberto |
| Alguém com o app desbloqueado nas mãos | ver conversas sensíveis | conversas ocultas sem nenhum rastro; bloqueio automático | se obrigar a digitar o código secreto, vê |
| Contato ou app modificado | guardar mensagens, ignorar timer e "apagar pra todos" | nenhuma: é quem recebeu a mensagem | cortesias dependem do app oficial |
| App falso com backdoor | roubar chaves de quem instala | APK assinado com impressão digital publicada; F-Droid; registro da marca | quem instalar o app falso está comprometido |
| Spam em ID público | inundar a caixa de alguém | pedido de conversa; bloqueio; limite de taxa no relay | prova de trabalho só na fase 2 |

## Arquitetura

**Fluxo de uma mensagem (Alice → Bob)**

1. O app da Alice busca o cartão do Bob no relay. O cartão é assinado, e o hash da chave confere com o ID.
2. O app da Alice cifra (X3DH, Double Ratchet, envelope selado) e deposita um pacote de 4 KB na caixa do Bob. O relay guarda cifrado e não sabe quem enviou.
3. O relay entrega quando o Bob abre a caixa. O app do Bob decifra; só aqui aparece quem enviou.
4. O app do Bob confirma o recebimento, e o relay apaga o pacote.

Tudo passa pelo Tor (Orbot): o relay nunca vê IP, conteúdo nem remetente.

São três peças: o app, onde vivem as chaves, as conversas e toda a criptografia; o relay, que guarda cartões, caixas e anexos cifrados sem saber quem é quem; e o Tor via Orbot, que esconde o IP dos dois lados. O app só conecta pelo Tor (RF-44): sem ele, o relay ligaria pelo IP quem deposita a quem abre a caixa, e entregaria quem fala com quem, inclusive de quem usa Tor do outro lado.

- **Endereço:** é só o ID de 16 caracteres. O cartão assinado diz as chaves, a caixa principal e os relays da pessoa.
- **Lista de relays:** o contato guarda `relays: string[]`, com um item só no MVP. A troca automática da fase 2 entra sem mudar o protocolo.
- **Remetente oculto:** o ID de quem enviou só existe dentro do envelope selado, que só o destinatário abre.
- **Conversas ocultas:** usam caixas separadas, criadas anonimamente, que só o cofre conhece.

## Identidade e criptografia

Toda a criptografia usa libsodium, com uma exceção: o SQLCipher usa OpenSSL por dentro para cifrar as páginas do banco. O Cifra só combina primitivas conhecidas, seguindo protocolos publicados.

### Primitivas

| Uso | Primitiva | libsodium |
| --- | --- | --- |
| Identidade e assinaturas | Ed25519 | `crypto_sign_*` |
| Acordo de chaves | X25519 | `crypto_scalarmult`, `crypto_box_keypair` |
| Cifra das mensagens | XChaCha20-Poly1305 | `crypto_aead_xchacha20poly1305_ietf_*` |
| Hash e derivação de chaves | BLAKE2b | `crypto_generichash`, `crypto_kdf_*` |
| Checksum das 12 palavras (BIP39) | SHA-256 | `crypto_hash_sha256` |
| Envelope selado (esconde o remetente) | X25519 + XSalsa20-Poly1305 | `crypto_box_seal` |
| Anexos | XChaCha20-Poly1305 em fluxo | `crypto_secretstream_xchacha20poly1305_*` |
| Código secreto e senha | Argon2id | `crypto_pwhash` |

### Identidade

- 12 palavras BIP39 (128 bits) geram a semente. A identidade sai da entropia das palavras (os 128 bits), não do texto delas: a mesma identidade aparece em português ou em inglês, e a restauração aceita as duas listas. As listas são as oficiais do BIP39, que não têm palavra em comum; as palavras de uma identidade nova saem no idioma da interface.
- A chave de identidade é Ed25519; a chave X25519 de acordo é derivada dela.
- ID = primeiros 80 bits do BLAKE2b da chave pública, em base32 Crockford (sem letras ambíguas): 16 caracteres, `XXXX-XXXX-XXXX-XXXX`.
- Identicon: grade espelhada gerada a partir do ID. É só visual: quem confere a identidade é o número de segurança.
- A semente fica só dentro do banco cifrado, porque é ela que cifra o backup. As palavras não ficam guardadas: aparecem uma vez, depois de gerar.

```ts
const seed = sodium.crypto_generichash(32, mnemonicToEntropy(palavras, listaDoIdioma));
const { publicKey, privateKey } = sodium.crypto_sign_seed_keypair(seed);
const id = base32(sodium.crypto_generichash(32, publicKey).slice(0, 10)); // 16 caracteres
```

### Cartão de identidade

O cartão fica publicado no relay, assinado pela chave de identidade. Ele traz versão, chave de identidade, *signed prekey* X25519 com assinatura, a caixa principal, a lista de relays (de 1 a 3; o MVP usa 1) e a data. Quem busca confere o hash contra o ID e as assinaturas; entre dois cartões válidos, vale o mais novo. O formato fica em `packages/protocol`, igual no app e no relay.

- **One-time prekeys:** vão junto na publicação, não no cartão. O relay entrega uma por busca e a apaga; quando acabam, o cartão sai sem nenhuma. Como no X3DH, elas não têm assinatura própria, mas a publicação inteira é assinada pela chave de identidade: só o dono acrescenta ou troca prekeys.
- **Publicação:** acrescenta prekeys às que o relay já tem ou substitui todas (na restauração em outro aparelho). O relay responde ao dono quantas prekeys guardou, para ele repor quando acabam.
- **Data:** o relay só aceita data estritamente mais nova que a guardada, até 24 h à frente do relógio dele e não tão velha que o cartão já teria vencido. Assim uma publicação repetida não volta, nem depois de apagada por prazo.
- Cada assinatura cobre um contexto próprio antes dos bytes assinados: a do cartão nunca vale como a de uma publicação ou de uma abertura de caixa.
- **No app:** a primeira publicação num relay é `substituir`, com 100 *one-time prekeys*; antes dela, o app busca o próprio cartão, e a data do novo vem depois da do que estiver lá (o de outro aparelho, numa restauração, pode ter data mais nova que o relógio deste). Ao conectar, e a cada hora com a caixa aberta, o app publica de novo se a última publicação tem mais de 24 h; se o relay disser que guarda menos de 50 prekeys, uma segunda publicação completa até 100. A prekey assinada muda a cada 7 dias; a substituída fica 30 dias, para a mensagem inicial atrasada, e depois sai. A data do cartão é a maior entre agora e a última aceita mais 1 ms.

### Sessão e mensagens

- Abertura da sessão: X3DH com o cartão do destinatário, conferido antes (hash e assinaturas). Quem abre manda os dados do X3DH em toda mensagem até receber a primeira resposta, como no libsignal: se a primeira se perder, qualquer uma das seguintes abre a sessão do outro lado.
- Conversa: Double Ratchet, com XChaCha20-Poly1305 e derivação por BLAKE2b.
- Os dois seguem as especificações publicadas do Signal. A versão pós-quântica (PQXDH) fica pra uma fase futura.
- **Derivação:** HKDF com BLAKE2b no lugar do HMAC: `crypto_generichash` com chave extrai, e `crypto_kdf_derive_from_key` expande em subchaves numeradas, cada uso com um contexto próprio. No X3DH, SK = KDF(F ‖ DH1 ‖ DH2 ‖ DH3 [‖ DH4]), com F de 32 bytes 0xFF; no KDF_CK, a subchave 1 é a da mensagem e a 2, a da próxima cadeia. Cada mensagem cifra com chave e nonce derivados da chave dela. O AD é a chave de identidade de quem abriu seguida da de quem respondeu (as Ed25519 do cartão), mais o cabeçalho da catraca.
- **Vetores:** o Signal não publica vetores para estes parâmetros. Os vetores são do Cifra, com chaves fixas; os testes refazem cada valor com chamadas diretas à libsodium, e a mesma lista roda no aparelho.
- **Sessões por contato:** a atual e até 4 anteriores, para abertura simultânea e reinstalação; decifrar com uma anterior a torna atual. A chave efêmera de cada X3DH aceito fica registrada enquanto existir a prekey assinada dela: o relay não reabre uma sessão reenviando uma mensagem inicial guardada. Uma mensagem pode mandar pular até 25 mil chaves numa cadeia, como no Signal: numa caixa sem leitura, o relay apaga os pacotes de 14 dias e aceita os novos. A sessão guarda as 2 mil chaves puladas mais novas.
- **Resposta:** quem recebe a primeira mensagem busca o cartão de quem escreveu na hora de responder, e é dele que vem a caixa. Quando o contato abre uma sessão nova, o próximo envio busca o cartão de novo.
- **Aparelho trocado:** quando o cartão buscado de novo traz outra caixa principal, o contato restaurou a identidade em outro aparelho, que não tem as sessões de antes. O próximo envio abre uma sessão nova (X3DH) com esse cartão e cifra de novo, nela, os textos que esperavam na fila; as confirmações de leitura que esperavam saem.
- Conteúdo interno, sempre cifrado: `id` (16 bytes, sorteado por quem escreve), `tipo`, `enviadaEm`, `ttl` e `corpo`, seguido de zeros até o tamanho fixo. A mensagem repetida é descartada pelo `id`.
- Tipos de conteúdo: texto (1); leitura (2); apagar (3), com até 100 IDs; timer (4), com os segundos e se vale para as mensagens anteriores; anexo (5); texto em resposta (6), que leva só o ID da mensagem respondida (o anexo tem o próprio campo de resposta); digitando (7), com 1 byte: começou ou parou; prints (8), com 1 byte: bloqueados ou liberados, e vale a mudança mais nova, como no timer; apagar a conversa (9), com 8 bytes: o `enviadaEm` mais novo, no relógio de quem recebe o pedido, entre as mensagens dele que já tinham chegado a quem apagou; e caixa da conversa (10), com 8 bytes do `enviadaEm` mais novo, no relógio de quem recebe, entre as mensagens dele que já tinham chegado, seguidos da chave da caixa de uma conversa oculta (32 bytes) ou de nada, e aí é a caixa do cartão. Cada tipo novo entra com o próximo número.
- **Digitando (RF-18):** sai na hora pela conexão de depósito do contato (abre se preciso), fora da fila e sem reenvio (atrasado não serve, e na fila seguraria as mensagens), no máximo um a cada 15 s enquanto a pessoa escreve, e "parou" quando o campo esvazia ou ela sai da conversa. Só para contato aceito. Quem recebe ignora o que chega antes do `em-dia` da caixa (velho) e apaga o sinal em 20 s, no "parou" ou quando a mensagem chega. Nada fica no banco.
- **Caixa da conversa:** quem oculta ou reexibe uma conversa avisa o contato para qual caixa ela vai daqui em diante. Vale o aviso mais novo, pelo relógio de quem avisou. Quem recebe guarda a caixa (também de um ID bloqueado, mas sem mandar nada) e manda de novo, para ela, o que já tinha saído depois do `ate` do aviso: cifrado na sessão atual, com o mesmo ID, o mesmo `enviadaEm` e o mesmo timer (o anexo vai com a mesma mensagem, e o blob não sobe de novo), mais o timer e os prints da conversa. Do outro lado, a cópia repetida é descartada pelo ID (RF-16), e a mudança mais nova do timer e dos prints vale: repetir não muda nada. O pacote que ia para a caixa antiga quando o aviso chegou vai de novo, para a nova. A caixa pedida é esquecida quando o contato abre uma sessão nova ou troca de aparelho. O "digitando" vai para a mesma caixa das mensagens.
- **Fila de saída:** guarda o pacote pronto e reenvia os mesmos bytes até o relay aceitar, então um reenvio do que já tinha chegado não duplica. Cada contato tem a sua ordem; as tentativas se espaçam em 1 s, 2 s, 4 s… até 1 min, e recomeçam na hora quando a conexão com o relay volta. Com `caixa-inexistente`, o cartão do contato é buscado de novo; na caixa de uma conversa oculta do contato, não: a mensagem espera, e a caixa volta quando o cofre dele abrir. A mensagem fica pendente até sair; só some se vencer ou for apagada antes, e aí não sai mais. A fila de cada contato só sai depois que a caixa por onde ele escreve ficou em dia nesta conexão (a principal; no cofre, a da conversa oculta): um aviso de caixa nova que esperava no relay é lido antes, e o que sai vai para a caixa certa. Com a caixa fora do ar, a fila espera ela voltar.

### Envelope, padding e remetente oculto

- Todo pacote de mensagem tem exatamente 4096 bytes. O texto fica limitado a 3.500 bytes (valor inicial, ajustável).
- A mensagem do Double Ratchet e o ID de quem enviou vão dentro de um `crypto_box_seal` para a chave X25519 de identidade do destinatário, como no *sealed sender* do Signal. O relay só vê a caixa de destino e um blob de 4 KB.
- O interior selado tem 4048 bytes: versão, tipo, os dados do X3DH (na mensagem inicial) ou o ID de quem envia, o cabeçalho da catraca (chave, PN e N) e o conteúdo cifrado, de tamanho fixo em cada tipo. O formato fica em `packages/protocol`.
- **Marca de aviso:** cada depósito leva, junto com o pacote, 1 byte selado (`crypto_box_seal`, 49 bytes) para a chave X25519 que sai da chave da caixa: 1 na mensagem (texto e anexo), 0 no resto (leitura, digitando, timer, apagar). O relay guarda e repassa sem abrir, e todo depósito tem o mesmo tamanho. O vigia do app bloqueado (RF-42), que só tem a chave da caixa, abre a marca para avisar só de mensagem; a marca que não abre avisa.
- O app deposita por uma conexão sem caixa aberta e, com Tor, por outro circuito. Na conexão ou no circuito em que abriu a própria caixa, o relay ligaria quem deposita a quem recebe. Cada contato tem a sua conexão de depósito, num circuito só dele: o relay também não liga duas conversas da mesma pessoa. O circuito separado vem da credencial SOCKS, que o Tor usa para isolar (`IsolateSOCKSAuth`, ligado por padrão). A conexão da caixa também publica o próprio cartão, que já liga a caixa ao ID.

### Anexos

Cada arquivo tem uma chave aleatória própria e é cifrado em fluxo antes de subir. A mensagem leva ponteiro, chave, hash, tipo e tamanho. O tamanho enviado é arredondado para faixas fixas, para não revelar o tamanho exato.

- **Blob:** `crypto_secretstream_xchacha20poly1305` em pedaços de 64 KiB, completado com bytes aleatórios até a faixa do Padmé (de 4096 bytes a 25 MiB). O BLAKE2b-256 do blob inteiro vai na mensagem: quem recebe confere tamanho, hash e a etiqueta final antes de guardar. O texto claro é a capa (só no vídeo) seguida do arquivo; a capa cabe no primeiro pedaço e abre sozinha.
- **Ponteiro:** um token aleatório de 32 bytes; o relay guarda só o BLAKE2b dele. No MVP, o relay é o configurado no app.
- **Mensagem do anexo:** o tipo (foto, vídeo, documento), o tipo MIME, o tamanho, as medidas, a duração, o token, a chave, o hash, a miniatura (JPEG de até 1536 bytes, desfocada até baixar) e a legenda (até 2000 bytes, que entra na busca).
- **Limpeza (RF-32 a RF-34):** a foto é recodificada em JPEG 85 (PNG, se tiver transparência), até 2048 px no lado maior, em sRGB e de pé, sem nada do arquivo original; GIF vira foto parada. O vídeo vai para um MP4 novo sem recodificar, só com as trilhas de vídeo e áudio; a capa é um quadro em JPEG de até 60 KB. O documento vai como está, sem nome nem datas: chega como "documento.<ext>". Foto ou vídeo escolhido como arquivo passa pela limpeza de foto ou vídeo.
- **Caminho:** o blob sobe por HTTP, no circuito de depósito do contato, antes de a mensagem que o abre sair, um envio por vez e fora da rodada de entrega. Quem recebe baixa num circuito só dos anexos (nunca o de depósito de quem enviou, que ligaria as duas conversas), confere e pede ao relay para apagar. A pessoa pode cancelar: o download para e espera ela tocar; o envio cancelado apaga a mensagem.

### Número de segurança

São 60 dígitos (12 grupos de 5), derivados das duas chaves de identidade em ordem fixa, com hash iterado. A verificação é manual: comparar pessoalmente ou por outro canal.

- Segue o do Signal, com o BLAKE2b-512 no lugar do SHA-512. Para cada lado: `h = versão (2 bytes, zero) ‖ chave Ed25519 ‖ ID`; 5200 vezes, `h = BLAKE2b-512(h ‖ chave)`; os primeiros 30 bytes, em 6 pedaços de 5, cada um como inteiro big-endian módulo 100000, dão 30 dígitos. Os dois lados vão em ordem, o menor primeiro.
- O vetor fica na lista de vetores do protocolo, que roda no Node e no aparelho, e é refeito nos testes com o BLAKE2b do OpenSSL.
- A verificação é do contato neste aparelho: a chave por trás de um ID não muda, porque o ID é o hash dela.
- **Copiar, colar e comparar:** a tela de segurança copia o número (12 grupos separados por espaço, sensível, sai da área de transferência em 60 s) e tem um campo para colar o que a outra pessoa mandou por outro canal. O app compara os 60 dígitos, sem contar espaços e quebras de linha, e só quando batem oferece marcar como verificado. O texto da tela diz que o número tem de chegar por fora do Cifra: pela própria conversa, quem estivesse no meio trocaria o número também.

### Contatos

Os contatos só existem no banco cifrado do app (RF-10): ID, apelido, aceito, bloqueado e verificado. O manifesto do Android bloqueia as permissões da agenda do sistema.

- **Adicionar (RF-06):** pelo ID colado ou digitado. O cartão é buscado e conferido (hash e assinaturas) antes da primeira mensagem; sem conexão, nada é adicionado.
- **Pedido de conversa (RF-07):** a mensagem de quem não é contato abre uma sessão e fica numa área separada. Para responder, é preciso aceitar; até lá, nenhuma confirmação de leitura sai. Recusar apaga as mensagens com `apagarDeVerdade()`; se a pessoa escrever de novo, é outro pedido. A busca não mostra pedidos.
- **Bloqueio (RF-08):** o que chega de um ID bloqueado é decifrado só para a sessão continuar em dia e é descartado: nada é guardado e nada volta para quem enviou, que vê a mensagem como enviada. Nada sai para um ID bloqueado: bloquear tira da fila o que esperava para ele, e as mensagens para ele que ainda não tinham saído são apagadas de verdade. Bloquear um pedido apaga as mensagens dele; um contato bloqueado fica na lista, com o histórico. Os IDs bloqueados que vieram de pedidos ficam na tela de pedidos, para desbloquear.
- **Apelido (RF-09):** até 40 caracteres, só no banco deste aparelho. Sem apelido, o nome é "anon·" e o primeiro grupo do ID.
- **Nota pessoal (RF-19):** a conversa com o próprio ID. Fica só no banco: nada entra na fila de saída.
- **Busca (RF-12):** pelo nome que a lista mostra (o apelido; sem apelido, "anon·" e o começo do ID; a nota pessoal pelo nome dela), sem diferença de acento, espaço ou pontuação; pelo ID (a partir de 4 caracteres); e pelo conteúdo, no índice de busca do banco, sem rede. Só nos contatos aceitos e na nota pessoal.
- **Um aparelho por ID (RF-05):** quando a identidade é restaurada em outro aparelho, o relay apaga a caixa deste (ver "Especificação do relay"). Este aparelho fica sabendo pelo aviso do relay, pela renovação recusada ou pela caixa que sumiu com o próprio cartão apontando outra. Ele para de vez, guarda isso no banco e mostra o aviso; daí só resta começar de novo, gerando ou restaurando uma identidade. Os dados ficam até uma identidade nova ser guardada.
- **Contato restaurado (RF-47):** o contato que volta do backup entra aceito, com o cartão conferido de antes marcado como desatualizado, e sem sessão. O primeiro envio para ele (texto, anexo, timer, prints ou apagar a conversa) busca o cartão e abre a sessão na hora, como em "Nova conversa"; sem conexão, não sai nem fica pendente. Quando é ele quem escreve primeiro, a mensagem chega como conversa, não como pedido.

### Mensagens temporárias e apagar pra todos

- **Prazo (RF-27):** a mensagem some em `enviadaEm + ttl`, nos dois aparelhos, com o relógio de quem escreveu. Quem recebe usa o menor entre o envio e a chegada: um relógio adiantado do outro lado não faz a mensagem durar mais. O timer vai de 10 s a 7 dias.
- **Teto:** nenhuma mensagem com timer dura mais que o timer da conversa. O timer de uma mensagem (RF-26) pode ser menor, e quem recebe corta o que vier maior; mensagem nova sem timer numa conversa com timer recebe o dela.
- **Mudança do timer (RF-25):** o limite novo conta a partir da mudança: as mensagens que passariam dele são cortadas, e as de timer menor não mudam. Ao ligar o timer numa conversa com mensagens sem timer, a pessoa escolhe se só as novas usam o timer ou se as anteriores também somem, nos dois aparelhos. Aumentar ou desligar não muda nenhuma mensagem. Entre duas mudanças, vale a mais nova pelo relógio de quem mudou; no empate, o timer maior: os dois lados acabam no mesmo timer. Quando o contato troca de aparelho, o timer vai de novo para o aparelho novo.
- **Timer padrão (RF-50):** nos ajustes. A conversa nova (contato adicionado ou pedido aceito) começa com ele, se ninguém escolheu timer nela; o contato só fica sabendo junto com a primeira mensagem, então adicionar alguém não manda nada. As conversas que já existem não mudam. A nota pessoal tem o próprio timer, só local.
- **Vencida (RF-28):** o que chega vencido não é guardado e deixa a nota "uma mensagem expirou antes de você abrir"; a recebida que vence sem ter sido lida também. Várias seguidas aparecem numa nota só.
- **Notas de sistema:** a mudança do timer e a mensagem expirada. Ficam numa tabela própria, fora da busca, com o texto montado na hora, no idioma da tela.
- **Apagar pra todos (RF-30):** qualquer mensagem, das duas pessoas, sem limite de tempo e sem nota no lugar. O pedido de apagar só alcança mensagens da própria conversa; nada sai para pedido nem para bloqueado, e o pedido de um bloqueado é ignorado.
- **Apagar só neste celular:** a mensagem some na hora e fica 5 s escondida, para o desfazer; depois sai de verdade, ou antes, se o app bloquear.
- **Apagar a conversa para os dois (RF-59):** no painel de apagar a conversa, ao lado de "só neste celular". Aqui sai tudo, como no RF-31; do outro lado saem as mensagens recebidas de quem apagou, as notas e as mensagens dele que já tinham chegado a quem apagou (pelo `enviadaEm` que vai no pedido, no relógio dele). O que ele mandou depois do pedido não some: chega a quem apagou e fica nos dois. Sem aviso nem nota, como no RF-30. Contato, sessão, timer e prints ficam. Nada sai para pedido nem bloqueado.
- **Prints bloqueados na conversa (RF-58):** um interruptor na segurança do contato. Qualquer um dos dois liga ou desliga; vale a mudança mais nova (no empate, bloqueado), com nota de sistema nos dois lados ("prints bloqueados nesta conversa", "prints liberados nesta conversa"). Nos dois celulares, a conversa, a segurança do contato e as fotos e vídeos abertos dela ficam sem print, mesmo com o ajuste geral desligado; na lista e na busca, o texto da prévia dela vira "prints bloqueados". O resto do app segue o ajuste geral (RF-41). Não impede foto da tela com outro aparelho, nem um app modificado do outro lado: o texto do interruptor diz isso.

### Chaves no aparelho

Uma chave mestra aleatória de 256 bits cifra o banco. Ela fica embrulhada no Keystore (Android) ou no Keychain (iOS) e só sai quando o app é desbloqueado.

- A chave nasce no fim do onboarding, junto com o banco. Antes disso, nada é gravado.
- A chave da caixa principal é um par Ed25519 sorteado, que não sai das palavras. Fica no Keystore/Keychain sem pedir desbloqueio, porque o serviço de notificação precisa abrir a caixa com o app bloqueado. Ela só abre a caixa no relay; o conteúdo continua cifrado para a identidade.
- O app exige bloqueio de tela no aparelho (PIN, padrão ou senha). Sem ele, o Keystore não protege a chave com o desbloqueio, e o app não guarda a identidade: pede para configurar um.
- **Segredo do cofre:** o que, com o código secreto, abre o cofre das conversas ocultas sai da chave mestra (BLAKE2b com chave, num contexto próprio), na mesma biometria do desbloqueio. Fica só na memória, com o app aberto, e é zerado no bloqueio: não é um item do Keystore.
- **Preferências:** o que vale com o banco fechado (tema, idioma, notificações) fica num item do Keystore com proteção `aparelho`: cifrado, lido sem biometria. A tela de bloqueio já sai no tema e no idioma escolhidos, e o vigia sabe se deve avisar. O resto dos ajustes fica no banco.

## Requisitos funcionais

São 60 requisitos em 9 grupos. Cada um tem um critério de aceite que vira teste.

### Identidade

| ID | Requisito | Critério de aceite |
| --- | --- | --- |
| RF-01 | Gerar identidade no aparelho: chaves, ID e identicon, sem número nem e-mail. | Nenhum dado pessoal é pedido; o ID e o identicon não mudam entre aberturas. |
| RF-02 | Mostrar as 12 palavras depois de gerar, com opção de pular. | Pular pede confirmação com o aviso de que perder o celular é perder a identidade. |
| RF-03 | Restaurar a identidade digitando as 12 palavras. | O ID restaurado é igual ao original. |
| RF-04 | Publicar e renovar o cartão no relay. | Cartão válido no relay; *one-time prekeys* repostas quando acabam. |
| RF-05 | Manter um aparelho ativo por ID. | Restaurar em outro aparelho desconecta o anterior, com aviso. |

### Contatos

| ID | Requisito | Critério de aceite |
| --- | --- | --- |
| RF-06 | Adicionar contato colando ou digitando o ID. | Cartão buscado e conferido (hash e assinatura) antes da primeira mensagem. |
| RF-07 | Pedido de conversa para mensagem de ID desconhecido. | Fica numa área separada, com aceitar, recusar e bloquear; sem leitura nem "digitando" até aceitar. |
| RF-08 | Bloquear e desbloquear um ID. | Mensagens de ID bloqueado são descartadas sem aviso a quem enviou. |
| RF-09 | Renomear contato com apelido local. | O apelido nunca sai do aparelho. |
| RF-10 | Guardar contatos só no Cifra. | Nada vai para a agenda do sistema. |

### Conversas e mensagens

| ID | Requisito | Critério de aceite |
| --- | --- | --- |
| RF-11 | Lista de conversas com identicon, apelido, selo de verificado, horário, prévia, timer e não lidas. | Igual ao design. |
| RF-12 | Busca local por apelido e conteúdo. | Funciona sem rede; nunca encontra conversa oculta sem o código. |
| RF-13 | Enviar e receber texto cifrado de ponta a ponta. | O relay só vê pacotes de 4 KB. |
| RF-14 | Status da mensagem: pendente, enviada e, com confirmação ligada, lida. | Fica pendente até o relay confirmar o recebimento. |
| RF-15 | Fila de saída com reenvio em intervalos crescentes. | Com o relay fora do ar, a mensagem sai sozinha quando ele volta. |
| RF-16 | Descartar mensagens repetidas pelo ID. | Um reenvio nunca aparece duas vezes. |
| RF-17 | Confirmação de leitura, opcional. | Desligada por padrão; o ajuste avisa que ela revela quando você está online. |
| RF-18 | Indicador de digitação, opcional. | Desligado por padrão. |
| RF-19 | Nota pessoal: conversa consigo mesmo. | Nada dela sai do aparelho. |
| RF-51 | Selecionar várias mensagens: segurar seleciona; tocar em outras soma ou tira. | A barra do alto mostra a contagem e as ações: responder (com uma só), copiar, encaminhar, salvar e apagar (para todos ou só neste celular). |
| RF-52 | Copiar textos e legendas. | Um por linha, sem nome nem hora; marcado como sensível, sai da área de transferência em 60 s. |
| RF-53 | Salvar o anexo no celular. | Só por ação da pessoa: foto e vídeo na galeria (álbum Cifra), documento em Download/Cifra, com nome neutro e a data do salvamento. |
| RF-54 | Encaminhar para até 5 conversas. | Chega como mensagem nova, sem marca de encaminhada, com o timer do destino; o anexo é cifrado de novo, com chave nova, e sobe de novo. |
| RF-55 | Responder a uma mensagem, pela seleção ou arrastando o balão para a direita. | Só o ID da original vai; cada lado cita a própria cópia, e a que sumiu aparece como "mensagem apagada". |
| RF-56 | Prévia antes de enviar anexos, com legenda e miniatura. | A prévia mostra a versão já limpa, até 10 itens, cada um uma mensagem; a miniatura vai dentro da mensagem, desfocada até baixar. |
| RF-57 | Baixar anexos sozinho, com opção nos ajustes. | Ligado por padrão; desligado, o anexo só baixa quando a pessoa toca. Pedido de conversa nunca baixa nem mostra a miniatura antes de aceito. |

### Conversas ocultas

| ID | Requisito | Critério de aceite |
| --- | --- | --- |
| RF-20 | Ocultar e reexibir uma conversa. | Some da lista, da busca, das não lidas e das notificações. |
| RF-21 | Código secreto definido pelo usuário. | Nunca é guardado; só a derivação que abre o cofre. |
| RF-22 | Revelar as ocultas digitando o código no campo de busca. | Código certo mostra as ocultas; qualquer outro texto age como busca comum, sem erro e sem diferença de tempo. |
| RF-23 | Nenhum rastro das ocultas sem o código. | Buscar o apelido de um contato oculto não mostra nada, nem um aviso de "conversas ocultas". |
| RF-24 | Fechar as ocultas automaticamente. | Fecham quando o app bloqueia ou vai para o segundo plano. |

### Temporárias e exclusão

| ID | Requisito | Critério de aceite |
| --- | --- | --- |
| RF-25 | Timer por conversa: desligado, 10 s, 5 min, 30 min, 1 h, 12 h, 24 h, 1 semana ou personalizado (de 10 s a 7 dias). | Os dois lados passam a usar o mesmo timer, com nota de sistema; ao ligar, a pessoa escolhe se as mensagens anteriores também somem. |
| RF-26 | Timer por mensagem, com tempo personalizado (um número e a unidade). | Nunca maior que o da conversa. |
| RF-27 | Contagem a partir do envio; quando o timer da conversa muda, o limite novo conta da mudança. | A mensagem some dos dois aparelhos no mesmo horário. |
| RF-28 | Mensagem que chega vencida. | Conteúdo descartado; aparece "uma mensagem expirou antes de você abrir". |
| RF-29 | Aviso nos timers curtos. | O seletor avisa que só chega se a outra pessoa estiver com a conversa aberta. |
| RF-30 | Apagar pra todos, como no Telegram. | Qualquer mensagem, sem limite de tempo e sem rastro; com o outro offline, some quando ele reconecta. |
| RF-59 | Apagar a conversa nos dois celulares. | Some de verdade dos dois, sem aviso nem nota; o que o outro mandou depois do pedido fica. Com o outro fora do ar, some quando ele reconecta. |
| RF-31 | Apagar conversa deste aparelho. | Usa a mesma exclusão real das temporárias. |
| RF-50 | Timer padrão para as conversas novas, nos ajustes. | A conversa nova começa com ele, e dá para mudar ou desligar em cada uma; as que já existem não mudam. |

### Anexos

| ID | Requisito | Critério de aceite |
| --- | --- | --- |
| RF-32 | Enviar imagem. | Recodificada; o exiftool não encontra GPS, modelo, data nem miniatura. |
| RF-33 | Enviar vídeo. | Metadados removidos sem recodificar; o exiftool não encontra GPS nem modelo. |
| RF-34 | Enviar documento. | Limpeza básica e o aviso "documentos podem conter informações do autor". |
| RF-35 | Cifrar o anexo no aparelho antes de subir. | O relay só guarda blob cifrado, apagado depois do download. |
| RF-36 | Manter anexos fora da galeria. | Nada vai para a galeria sem a pessoa pedir; dentro do Cifra, o arquivo só é decifrado em memória. |

### Segurança do contato

| ID | Requisito | Critério de aceite |
| --- | --- | --- |
| RF-37 | Tela de segurança com identicon, ID e número de segurança. | 12 grupos de 5 dígitos, iguais nos dois aparelhos. |
| RF-38 | Marcar e remover verificação. | O selo aparece na lista e na conversa. |

### Ajustes e privacidade

| ID | Requisito | Critério de aceite |
| --- | --- | --- |
| RF-39 | Tema escuro e claro. | Escuro por padrão. |
| RF-40 | Bloqueio do app por biometria ou senha. | Bloqueia sozinho após 5 minutos parado (ajustável). |
| RF-41 | Bloquear prints e gravações de tela. | Android: FLAG_SECURE; iOS: a tela sai em branco; app oculto no multitarefa. |
| RF-42 | Notificações cegas. | Só "nova mensagem", sem remetente. Android: serviço em primeiro plano, sem Google. iOS: desligadas por padrão, com aviso. |
| RF-43 | Teclado incógnito. | O app pede ao teclado para não aprender o que é digitado. |
| RF-44 | Rotear via Tor (Orbot), sempre: o app não tem modo sem Tor. | Status "tor · conectado"; com o Orbot fora, o app não conecta e mostra "tor · indisponível". |
| RF-58 | Bloquear prints numa conversa, para os dois. | Qualquer um liga ou desliga, com nota de sistema; nos dois celulares, a conversa e o que se abre dela ficam sem print, e a prévia dela na lista e na busca vira "prints bloqueados". |
| RF-45 | Mostrar e copiar o próprio ID. | O texto copiado expira da área de transferência. |
| RF-49 | Idioma do app: português ou inglês. | Na primeira abertura segue o idioma do sistema (em qualquer outro idioma, abre em inglês); trocar nos ajustes muda a interface na hora, sem reiniciar. |
| RF-60 | Apoiar o projeto: o coração da lista abre o painel com o endereço Monero das doações, que copia. | O endereço é o mesmo deste documento; o texto copiado expira da área de transferência. |

### Backup e pânico

| ID | Requisito | Critério de aceite |
| --- | --- | --- |
| RF-46 | Exportar backup cifrado com as palavras. | Contém contatos, bloqueados, timers e ajustes; nunca mensagens nem conversas ocultas. |
| RF-47 | Importar o backup na restauração. | Contatos e verificações voltam. |
| RF-48 | Pânico: segurar 1,6 s para apagar tudo. | Chave mestra e cofre destruídos; o IPED não recupera nada depois. |

## Requisitos não funcionais

São 22 requisitos. Os de segurança e anti-forense são verificados com as ferramentas da seção de testes.

### Segurança e privacidade

| ID | Requisito | Como verificar |
| --- | --- | --- |
| RNF-01 | Toda a criptografia via libsodium, exceto o SQLCipher, que usa OpenSSL por dentro para cifrar o banco; nenhuma primitiva própria. | Revisão de código e de dependências; vetores de conformidade em cada plataforma. |
| RNF-02 | X3DH e Double Ratchet seguem as especificações do Signal. | Testes com vetores e com mensagens fora de ordem ou perdidas. |
| RNF-03 | O relay nunca recebe conteúdo em claro, nem quem enviou. | Dump do banco do relay. |
| RNF-04 | Todo pacote de mensagem tem 4096 bytes. | Captura de tráfego. |
| RNF-05 | Nenhum log de conteúdo, chave, ID ou IP, no app e no relay; sem analytics nem relatório de erro. | Busca no código e na configuração do servidor. |
| RNF-06 | Com Tor ligado, nenhuma conexão direta. | Captura com o Orbot desligado: zero pacotes para o relay. |

### Anti-forense

| ID | Requisito | Como verificar |
| --- | --- | --- |
| RNF-07 | Banco em SQLCipher; chave liberada só no desbloqueio do app. | Extração com o app bloqueado: banco ilegível. |
| RNF-08 | Exclusão real (`secure_delete`, journal DELETE, índice de busca). | O IPED não encontra mensagem apagada. |
| RNF-09 | Dados do app fora dos backups do sistema. | Backup do aparelho sem dados do Cifra. |
| RNF-10 | iOS: proteção Complete em todos os arquivos. | Inspeção dos atributos dos arquivos. |
| RNF-11 | Sem o código, o cofre das conversas ocultas é indistinguível de um cofre vazio. | Perícia com o app desbloqueado e sem o código não acha rastro. |

### Confiabilidade

| ID | Requisito | Como verificar |
| --- | --- | --- |
| RNF-12 | Nenhuma mensagem se perde em silêncio. | Relay derrubado no envio: a mensagem fica pendente e sai depois. |
| RNF-13 | O relay não confia no cliente: recusa tamanho errado e limita a taxa. | Teste com um cliente modificado. |
| RNF-14 | O relay apaga após a confirmação; pacotes não entregues somem em 14 dias. | Inspeção do banco do relay. |

### Qualidade e manutenção

| ID | Requisito | Como verificar |
| --- | --- | --- |
| RNF-15 | Núcleo sem dependência de plataforma: protocolo e regras rodam em Node, Android, iOS e web. | Os testes do núcleo rodam em Node. |
| RNF-16 | Dependências mínimas, com versões travadas. | Lockfile; revisão a cada dependência nova. |
| RNF-17 | Textos honestos: nenhuma promessa que o sistema não cumpre. | Revisão contra a lista de textos da seção de design. |
| RNF-18 | Acessibilidade: toque ≥ 44 px, contraste 4,5:1 e modo de movimento reduzido. | Revisão de interface. |
| RNF-19 | O relay roda em Raspberry Pi 4 (ARM64) via Docker. | Build de imagem multi-arquitetura. |
| RNF-20 | Licença GPLv3 no app e no relay. | Arquivo LICENSE nos dois. |
| RNF-21 | Entrega em até 5 s com os dois online via Tor (meta inicial). | Medição no app, pelo Tor. |
| RNF-22 | Nenhum texto de interface fixo no código: tudo em arquivos de tradução (pt-BR e en). | Teste que falha se faltar alguma chave em um dos idiomas. |

## Especificação do relay

O relay guarda cartões, caixas e anexos cifrados, entrega e esquece. Ele não tem cadastro, não sabe quem enviou e não confia em nenhum app.

### Operações

Cada caixa tem um par de chaves próprio: quem tem a chave da caixa lê a caixa. A caixa principal de um usuário aparece no cartão dele; as caixas das conversas ocultas são criadas anonimamente e não se ligam a nenhum ID.

| Operação | Quem chama | Autenticação | O que faz |
| --- | --- | --- | --- |
| `publicarCartao` | dono do ID | cartão e publicação assinados; hash da chave = ID | guarda o cartão e as *one-time prekeys*; vale o mais novo; só `substituir` troca a caixa principal; um ID novo acima do teto de cartões recebe `relay-cheio` |
| `buscarCartao` | qualquer um | nenhuma; limite de taxa | devolve o cartão e consome uma *one-time prekey*, até a cota do ID; acima dela, o cartão vai sem prekey |
| `criarCaixa` | qualquer um | chave pública da caixa; limite de taxa | cria uma caixa vazia; criar de novo não muda nada; acima do teto de caixas, `relay-cheio` |
| `depositar` | qualquer um | nenhuma; limite de taxa | guarda um pacote de 4096 bytes na caixa, com a marca de aviso (49 bytes, selada para a chave da caixa) |
| `abrirCaixa` | dono da caixa | desafio da conexão assinado com a chave da caixa | entrega os pacotes pendentes por WebSocket |
| `vigiarCaixa` | dono da caixa | a mesma da abertura | como abrir a caixa, mas manda só a marca de aviso de cada pacote, os que esperam e os que chegam; nada é confirmado |
| `confirmar` | dono da caixa | caixa aberta na conexão | apaga os pacotes confirmados |
| `PUT`, `GET` e `DELETE /anexos/<token>` | remetente / destinatário | token aleatório do anexo; o relay guarda só o hash dele | guarda o blob cifrado (409 se ele já subiu inteiro, 503 se outro envio dele ainda sobe), entrega e apaga; quem recebe apaga depois de conferir |
| `apagarTudo` | dono do ID | desafio da conexão assinado com a chave de identidade e com a da caixa principal | pânico: remove cartão, *one-time prekeys*, caixa principal e os pacotes dela; a caixa sai mesmo se o cartão já venceu |

- **Apagar tudo:** o pedido leva a chave de identidade e a assinatura dela sobre um contexto próprio, o desafio da conexão e a própria chave, e a caixa principal com a assinatura da chave dela sobre outro contexto e o mesmo desafio: não serve em outra conexão, e só o dono apaga. A caixa sai mesmo sem cartão (o cartão pode vencer antes dela). Assinatura errada recebe `assinatura-invalida` e fecha a conexão, como na abertura de caixa. Com as assinaturas certas, a resposta é `ok`, também quando não há mais o que apagar. A conexão que estava com a caixa aberta é fechada (4007); quem depositar nela depois recebe `caixa-inexistente`, e quem buscar o cartão, `cartao-inexistente`. O app manda pela conexão no circuito da caixa, que já publicava o cartão.
- **Desafio:** ao conectar, o relay manda um desafio aleatório de 32 bytes. A assinatura que abre a caixa cobre o desafio daquela conexão, então não serve em outra. Uma chave de caixa vale para um relay só.
- **Uma caixa por conexão:** abrir a mesma caixa em outra conexão fecha a anterior. Vale a abertura mais nova, e a reconexão não espera a conexão velha cair.
- **Entrega:** em ordem de chegada, até 100 pacotes sem confirmação por vez. Quando os pendentes acabam, o relay avisa que a caixa está em dia; o que chega depois vai na hora.
- **Pacote que não entra no app:** o app confirma cada pacote depois de guardá-lo. Se não consegue guardar (um erro do banco, como o disco cheio), ele fecha a conexão, e o relay entrega o pacote de novo na abertura seguinte; na terceira falha do mesmo pacote, o app confirma e ele se perde, para não ocupar a janela para sempre.
- **Vigia (RF-42):** com o app bloqueado, o aparelho vigia a caixa principal em vez de abri-la. O relay manda o ID e a marca de aviso de cada pacote, sem o pacote e sem a janela de 100: o vigia não confirma nada, e a caixa fica inteira para o desbloqueio. Como na abertura, vale a conexão mais nova.
- **Pacote repetido:** o ID do pacote no relay é o BLAKE2b de 16 bytes do próprio pacote. Um reenvio idêntico não duplica.
- **Formato inválido:** o relay responde `formato-invalido` e fecha a conexão. Assinatura errada na abertura também fecha.
- **Erro ao atender:** um erro do relay ao atender um pedido (no banco, com o disco cheio, por exemplo) fecha só a conexão daquele pedido (4008), sem atender; nos anexos, a resposta é 500. As outras conexões continuam.
- **Um aparelho por ID (RF-05):** a publicação `acrescentar` com outra caixa principal é recusada com `caixa-substituida`. A `substituir` com outra caixa, que é a restauração em outro aparelho, apaga a caixa anterior com os pacotes (o aparelho novo não decifraria nenhum); a conexão que estava com ela aberta recebe o aviso `caixa-substituida` e é fechada. Quem depositar nela recebe `caixa-inexistente` e busca o cartão de novo.

### Limites e retenção

| Item | Valor inicial |
| --- | --- |
| Pacote de mensagem | exatamente 4096 bytes |
| Anexo | até 25 MB |
| Pacote não entregue | apagado após 14 dias |
| Anexo não baixado | apagado após 14 dias |
| Anexos subindo ao mesmo tempo | 16; acima disso, 503, e o app tenta depois |
| Transferências de anexo ao mesmo tempo | 64 |
| Espaço dos anexos | 4 GB, ajustável por quem opera (`CIFRA_ESPACO_DOS_ANEXOS`, em MB); cheio, 507 |
| Transferência de anexo parada | cai depois de 60 s sem receber nem mandar nada |
| Pedido HTTP | no máximo 30 min |
| Cartão sem renovação | apagado após 90 dias |
| Caixa sem abertura | apagada após 90 dias, com o que houver nela; vale também para as caixas das conversas ocultas |
| Pacotes à espera por caixa | 1000 (4 MB); acima disso, `caixa-cheia`, e o remetente tenta depois |
| *One-time prekeys* por ID | até 100 |
| Data do cartão | até 24 h à frente do relógio do relay |
| Taxa de envio | por conexão: depositar, 20 de uma vez e depois 60 por minuto; buscar cartão, 10 e depois 10 por minuto; publicar cartão, criar caixa e apagar tudo, 3 e depois 1 por minuto. Acima disso, `taxa-excedida`. Prova de trabalho no primeiro contato na fase 2 |
| Taxas do relay inteiro | o que uma conexão nova não recomeça: depósitos numa mesma caixa, 100 de uma vez e depois 60 por minuto (acima disso, `taxa-excedida`); *one-time prekeys* entregues de um mesmo ID, 10 de uma vez e depois 10 por hora (acima disso, o cartão vai sem prekey) |
| Espaço dos pacotes | 4 GB no relay inteiro, ajustável por quem opera (`CIFRA_ESPACO_DOS_PACOTES`, em MB); cheio, `caixa-cheia` |
| Cartões guardados | 250 mil, ajustável (`CIFRA_MAXIMO_DE_CARTOES`); cheio, o cartão de um ID novo recebe `relay-cheio` |
| Caixas | 1 milhão, ajustável (`CIFRA_MAXIMO_DE_CAIXAS`); cheio, criar caixa recebe `relay-cheio` |
| Mensagens por conexão | 100 de uma vez e depois 1200 por minuto; acima disso, a conexão fecha |
| Conexões simultâneas | 1000 |
| Saída por conexão | 1 MiB esperando para sair (quem não lê o que o relay manda); acima disso, a conexão cai |
| Conexão ociosa | sem caixa aberta e sem mensagem por 5 min, fecha |
| Conexão morta | ping a cada 30 s; dois seguidos sem resposta derrubam a conexão |

As datas ficam no banco do relay só na hora cheia, sem minuto nem segundo. A data do cartão, que vem assinada pelo app, também: o app publica com a hora cheia, e uma publicação seguinte na mesma hora anda 1 ms.

### Registros

Nenhum log de acesso, IP ou conteúdo. O processo do relay não escreve nada, nem quando falha: o motivo de uma saída fica no código de saída. O código do relay não lê o endereço de quem conecta nem cabeçalho de proxy. Métricas, se houver, são só agregadas, como contagens por hora. No compose, o Docker não guarda log do relay, e o Tor só escreve avisos, com `SafeLogging`.

### Protocolo

WebSocket com mensagens binárias, sem compressão. Os anexos vão por HTTP no mesmo servidor (`PUT`, `GET` e `DELETE /anexos/<token>`); o `PUT` precisa de `Content-Length` com um tamanho de faixa válido, e o que sobe pela metade não fica. Os formatos vêm do pacote `protocol`, o mesmo que o app usa, e todo pacote é validado na entrada: tamanho exato, tipo conhecido e nada sobrando. Mensagem maior que o maior pedido possível é recusada antes de ser lida.

### Implantação

Docker Compose com dois serviços, o relay e o Tor, no mesmo namespace de rede. O Tor publica o relay como onion service:

```
HiddenServiceDir /var/lib/tor/cifra-relay/
HiddenServicePort 80 127.0.0.1:8080
```

O app só conecta pelo Tor (RF-44), e o relay oficial é só onion, como os da comunidade (fase 2). O compose expõe o relay em 127.0.0.1:8080 só para quem opera, no próprio host (testes e a sonda). As imagens saem para amd64 e arm64, travadas pelo digest.

## Armazenamento local e anti-forense

Com o app bloqueado, o conteúdo do Cifra é inútil para a perícia, e o que é apagado some de verdade.

### Banco e chaves

- SQLCipher com a chave mestra de 256 bits, embrulhada no Keystore/Keychain e liberada só no desbloqueio do app.
- No bloqueio, o app para o correio, fecha o banco e zera a semente e as chaves privadas que estavam na memória. Ao fechar, o SQLCipher apaga a cópia da chave que guardou na memória nativa. A cópia que passa pelo JS não dá para zerar, porque o Keystore e o op-sqlite só aceitam a chave como texto: ela fica na memória do Hermes até o coletor de lixo passar. Desbloquear pede a biometria ou a senha de novo.
- **Bloquear sozinho (RF-40):** depois do prazo parado (ao sair do app, 1, 5, 15 minutos ou 1 hora; 5 por padrão): sem tocar nem digitar com o app na frente, ou fora dele (outro app, tela apagada). Na frente, um timer confere; fora, um alarme do sistema (AlarmManager, sem permissão de alarme exato) acorda o aparelho no prazo, e a volta confere o tempo (que conta o aparelho dormindo) antes de qualquer tela: com o prazo vencido, uma capa da cor do fundo cobre a janela antes do primeiro quadro. Parado na frente, o bloqueio não pede a biometria sozinho; vencido fora, a volta pede uma vez. O seletor de fotos e arquivos do próprio app conta o prazo (5 minutos com "ao sair"). Os timers do núcleo são do módulo nativo, que anda com o app fora da frente.
- Quando a abertura falha: cancelar a biometria volta à tela de bloqueio, e outro erro também, com um aviso para tentar de novo. Se o Android apagou a chave mestra (o que acontece quando o bloqueio de tela do aparelho é removido) ou o banco não abre com ela, o app avisa que os dados deste aparelho foram perdidos e volta ao onboarding: a identidade volta com as 12 palavras. Nada é apagado antes de a identidade nova ser guardada. O app confere a chave no Keystore antes de pedir a biometria; sem isso, a react-native-keychain criaria outra chave em silêncio e só falharia depois do pedido.
- iOS: proteção Complete nos arquivos e tela coberta ao ir para o segundo plano.

### Exclusão real

Toda exclusão de mensagem (temporária, apagar pra todos, apagar conversa) passa por uma única rotina, `apagarDeVerdade()`: linha, índice de busca, pacote que ainda esperava na fila, anexo e chave do anexo, que ficam no mesmo banco. Depois das limpezas, o banco devolve as páginas livres ao sistema (`auto_vacuum` incremental): o tamanho do arquivo não guarda quanto já esteve nele. Mensagem apagada antes de sair não sai; se o pacote já estava a caminho do relay, chega. A prévia da lista sai da própria mensagem: não há cópia para apagar.

```ts
db.execute("PRAGMA secure_delete = ON");
db.execute("PRAGMA journal_mode = DELETE");
db.execute("PRAGMA temp_store = MEMORY");
db.execute("INSERT INTO busca(busca, rank) VALUES('secure-delete', 1)");
```

- O núcleo confere essas pragmas ao abrir o banco e recusa o banco sem elas. As exclusões internas (pacote entregue, prekeys usadas, sessões trocadas) também são reais, pelo mesmo `secure_delete` da conexão.
- O índice de busca é FTS5 de conteúdo externo: guarda os termos de cada mensagem, não uma cópia do texto, e os gatilhos da tabela o mantêm em dia. O tipo sem conteúdo (`contentless_delete`) ficou de fora: mesmo com `secure-delete`, ele deixa os termos apagados no arquivo até a próxima fusão do índice.
- As vencidas são limpas ao abrir o app, antes de mostrar qualquer coisa, e a cada poucos segundos com ele aberto.
- **Pânico (RF-48):** segurar 1,6 s em Ajustes > Pânico. A tela volta na hora ao começo do app, como numa instalação nova; tema e idioma voltam ao padrão. Depois, nesta ordem: os três itens do Keystore (chave mestra, chave da caixa e preferências) são destruídos, o que leva junto o segredo do cofre, que sai da chave mestra; o correio, as ocultas e a limpeza param; o banco fecha e a memória é zerada; os arquivos do banco e do cofre, com os diários, e tudo o que estiver no cache do app (o MP4 temporário da limpeza do vídeo e o que as bibliotecas guardem ali) são apagados, e o texto que o Cifra copiou sai da área de transferência. O que sobrar no chip vira ruído: as chaves que o abririam não existem mais. Por último, em segundo plano, o app pede ao relay para apagar o cartão, as *one-time prekeys*, a caixa principal e o que esperava nela (`apagarTudo`), com uma cópia do par de assinatura e da semente da caixa, zeradas quando o pedido termina; ele tenta 3 vezes. Sem conexão, o cartão e a caixa somem do relay pelo prazo (90 dias). O que a pessoa salvou fora do Cifra (galeria, Download, o arquivo do backup) fica, e o texto diz isso.

### Conversas ocultas

- Ficam num cofre separado: um segundo banco SQLCipher (`cofre.sqlite`, na mesma pasta do principal e com o mesmo esquema), com chave derivada do código secreto (Argon2id, nível INTERACTIVE, com um sal que sai do segredo do cofre) combinada por BLAKE2b com o segredo do cofre, que sai da chave mestra. Sem o aparelho, não dá para testar códigos por força bruta. O código tem de 6 a 64 caracteres, sem espaço nas pontas, e nunca é guardado (RF-21).
- O cofre existe desde a instalação: nasce no fim do onboarding (ou na primeira abertura de uma instalação anterior), com uma chave sorteada e jogada fora, num bloco de 16 MiB, e só cresce de 16 em 16 MiB, na mesma transação da gravação: sem espaço para o bloco, nada entra. O que é apagado deixa páginas livres, zeradas e cifradas; sem `auto_vacuum`, o arquivo nunca encolhe. O diário fica no lugar, com 0 byte (TRUNCATE). A data dos arquivos do cofre é tocada no desbloqueio, no bloqueio, ao ir para o segundo plano e ao fechar as ocultas. Ninguém consegue provar que ele está em uso.
- **Abrir (RF-22):** o texto da busca com 6 ou mais caracteres, parado por 0,8 s, passa pela derivação, com o mesmo custo para qualquer texto, e tenta abrir o cofre. Abriu: a busca é limpa e a seção "ocultas" aparece no topo da lista; a busca passa a olhar os dois bancos. Não abriu: nada muda, sem erro.
- **Código (Ajustes):** com as ocultas fechadas, definir um código zera o arquivo no lugar (o mesmo arquivo, com 0 byte) e cria ali um cofre novo, já aberto: as ocultas de um código anterior somem, e o texto avisa. Com elas abertas, trocar o código troca a chave do cofre (`PRAGMA rekey`), e as ocultas continuam.
- **Ocultar e reexibir (RF-20):** na segurança do contato, só com as ocultas abertas e com conexão, e só de contato aceito e não bloqueado. O aviso de caixa precisa chegar ao relay antes; se não chegar, nada muda (e um aviso de volta sai pela fila, caso a resposta do relay é que tenha se perdido). A conversa muda de banco inteira (contato, sessões, cartão, mensagens, anexos, notas e fila), e nada dela fica na origem. Se o app parar no meio, a marca da mudança faz a próxima abertura do cofre terminar ou desfazer. Se ele parou depois da cópia para o cofre e a conversa continuou no principal, ela pode ter andado lá (mensagens novas e a sessão, que não volta atrás): o cofre troca a cópia por uma nova antes de tirar a conversa do principal.
- **Fecham (RF-24)** no bloqueio, ao ir para o segundo plano (fora quando o seletor de fotos ou arquivos do próprio app está aberto) e na linha "Fechar ocultas". Ao fechar, o correio e a limpeza do cofre param, o bloco é completado, o arquivo fecha, e as telas das ocultas saem da pilha; a busca é limpa.
- Cada conversa oculta ganha uma caixa própria no relay, criada anonimamente, num circuito do Tor só para isso. O app avisa o contato, por mensagem cifrada, que aquela conversa agora vai para essa caixa. O correio do cofre não publica cartão, abre cada caixa num circuito só dela (os circuitos dele nunca são os do principal) e nunca gera aviso de mensagem nova.
- Com o cofre fechado, as mensagens das ocultas esperam no relay, cifradas, e nada delas chega ao aparelho.
- O banco principal não guarda nenhum rastro das ocultas: nem contato, nem sessão, nem contagem.
- Limite: com o cofre aberto, quem olha a tela vê. E mensagens de conversa oculta não abertas em 14 dias somem do relay.

### Backup

- **O que leva (RF-46):** os contatos aceitos (apelido, verificado, bloqueado, a data em que entraram, o timer e os prints da conversa com a data da mudança, até onde as mensagens deles já tinham chegado e o cartão conferido de cada um), os IDs bloqueados que vieram de pedidos, a linha dos ajustes, o tema e o idioma. Nunca leva mensagem, nota, anexo, pedido, sessão, prekey, a caixa que o contato pediu para a conversa, o próprio ID, nem nada do cofre: ele sai só do banco principal. As notificações ficam de fora (dependem da permissão do sistema).
- **Arquivo:** um nonce de 24 bytes e o texto claro cifrado com XChaCha20-Poly1305, com uma chave que sai da semente da identidade (BLAKE2b com chave, num contexto próprio): só abre com as 12 palavras da mesma identidade. Nada fica em claro, nem um cabeçalho; o texto claro é completado com zeros até a faixa do Padmé, com no mínimo 4096 bytes, para o tamanho não dizer quantos contatos há. O app lê no máximo 16 MiB.
- **Exportar:** em Ajustes > Backup, pelo "salvar como" do sistema (sem permissão de armazenamento): a pessoa escolhe a pasta e o nome; o sugerido é "Cifra backup AAAA-MM-DD". O app não bloqueia enquanto o "salvar como" está na frente, como nos seletores de fotos e arquivos. O backup é um retrato: o que mudar depois não está nele.
- **Restaurar (RF-47):** na tela da identidade restaurada, "Usar um backup" abre o seletor de arquivos do sistema. O arquivo de outra identidade, ou mexido, não abre, e a tela avisa. O próprio ID, se estiver entre os contatos do arquivo, fica de fora. Ao entrar, os contatos e os ajustes vão para o banco novo junto com a identidade, e o tema e o idioma do backup passam a valer.

### Anexos

Cada anexo fica cifrado com chave própria dentro do banco cifrado (o blob como passou pelo relay), e nada fora do banco diz quantos anexos há nem quando chegaram. Só vai para a galeria ou para Download quando a pessoa pede (RF-53); dentro do Cifra, só é decifrado em memória. A miniatura fica no banco, que é cifrado. O vídeo toca da memória, e as fotos abertas saem da memória (inclusive do cache de imagens) quando o app bloqueia. O único arquivo fora do banco é o MP4 temporário da limpeza do vídeo, zerado e apagado logo depois.

### Rastros no sistema

| Rastro | Como o Cifra reduz |
| --- | --- |
| Backup do sistema | Android: `allowBackup="false"` e regras de extração de dados; iOS: `isExcludedFromBackup` em tudo |
| Agenda | contatos nunca saem do Cifra; as permissões da agenda ficam bloqueadas no manifesto |
| Prints e multitarefa | FLAG_SECURE no Android; campo seguro no iOS; tela coberta no multitarefa. Numa conversa com prints bloqueados (RF-58), as telas dela ficam seguras nos dois celulares, mesmo com o ajuste geral desligado. No Android 13 ou mais novo, o sistema não guarda imagem da tela para o multitarefa nem com o print liberado |
| Notificações | só "nova mensagem", sem remetente nem contagem; com o app bloqueado, quem avisa é o vigia, que não abre o pacote |
| Teclado | `IME_FLAG_NO_PERSONALIZED_LEARNING` no Android; autocorreção desligada no iOS |
| Preenchimento automático | ao tocar num campo, o Android monta a estrutura da tela para o serviço de preenchimento e para o de sugestões do sistema, mesmo com o FLAG_SECURE, e os rótulos de acessibilidade dos balões levam o texto das mensagens. O Cifra tira a tela do preenchimento (vão só a raiz e os campos, sem o texto) e desliga a captura de conteúdo |
| Área de transferência | texto copiado expira (iOS: `expirationDate`; Android 13+: marcado como sensível); o pânico tira na hora o que o Cifra copiou |
| Cofre das conversas ocultas | existe desde a instalação, num bloco de 16 MiB, e só cresce de bloco em bloco; o diário fica com 0 byte; as datas dos arquivos mudam a cada desbloqueio, bloqueio e ida ao segundo plano, com ou sem uso |
| Backup | só existe se a pessoa exportar, onde ela salvar; o nome sugerido diz "Cifra", mas o conteúdo não tem nada em claro e só abre com as 12 palavras. O pânico não apaga o arquivo |
| Logs | nenhum log em produção: no release, o `console` fica mudo e o R8 tira o `android.util.Log` do app e das bibliotecas; SQLCipher com o log desligado (`cipher_log_level`) |

Fora do alcance do app: os registros do sistema de quando o app abriu e fechou, o celular pego desbloqueado com o app aberto e o aparelho da outra pessoa.

## Design e interface

A interface segue o design system do Cifra: os tokens e a voz abaixo, e os ícones do design (os que faltam vêm do Lucide), refeitos com Views nas mesmas coordenadas, sem biblioteca de SVG. Escolhas curtas e confirmações ficam em painéis inferiores; não há modal no meio da tela.

### Telas

- **Onboarding:** gerar a identidade, com o cartão do ID; as 12 palavras, com pular sempre confirmado num painel; restaurar com as palavras. Na identidade restaurada, "Usar um backup", abaixo de "Entrar", e uma linha em mono com o resumo do backup escolhido ("backup de 15/10/2026 · 12 contatos"), o aviso de que o arquivo não abre com estas palavras ou a dica de que os contatos voltam com um backup. Depois do pânico, a abertura mostra o recado "tudo apagado.".
- **Conversas:** o estado da conexão, a busca só neste aparelho, a linha dos pedidos de conversa com a contagem, a lista e o "+", que abre o painel "Nova conversa" (colar o ID e, embaixo, o próprio ID, que copia). No alto, o coração das doações, o sol ou a lua do tema e os ajustes. O código secreto vai no mesmo campo da busca: abriu, a busca é limpa e a seção "ocultas" aparece no topo, com as conversas ocultas, o texto de vazia ("nenhuma conversa oculta. para ocultar, abra a segurança do contato.") e a linha "Fechar ocultas"; com elas abertas, a busca mostra os resultados delas sob "ocultas".
- **Pedidos de conversa:** a linha da lista abre a tela de pedidos, onde também ficam os IDs bloqueados que vieram de pedidos. O pedido abre como conversa, com aceitar, recusar e bloquear no lugar do campo.
- **Conversa:** no cabeçalho, o nome, o selo de verificado e, embaixo, o estado da conexão ou "digitando…"; sem o Orbot, "tor · indisponível. abra o orbot". A pílula do timer abre o painel "Mensagens temporárias", com o aviso de "só chega com a conversa aberta" nos timers de até 5 min e o "Personalizado" (um número e a unidade); ao ligar numa conversa com mensagens sem timer, o painel pergunta se as anteriores também somem. Balões com o status em mono depois da hora ("pendente", "enviada" ou "lida"), notas de sistema no meio da conversa e o balão "digitando…" no fim. O balão temporário mostra o anel e quanto falta, e se desfaz (desfoque, escala e esmaecer) nos últimos 600 ms. No campo de escrever, a versão discreta da pílula mostra o timer da próxima mensagem, e o clipe abre o painel "Anexar" ("Foto ou vídeo" e "Arquivo", com o aviso de que documentos podem conter informações do autor); os seletores são os do sistema, sem permissão de fotos nem de arquivos.
- **Anexos:** foto com a miniatura desfocada até baixar, moldura de 4 px e a meta embaixo; vídeo com a capa, o tocar e a duração; arquivo com a extensão, "documento.<ext>", o tamanho e o SHA-256 curto. O botão de transferência mostra o progresso e cancela. Num pedido de conversa, nem miniatura nem baixar. Foto e vídeo abrem em tela cheia, com "Salvar no celular"; o documento abre um painel com o salvar.
- **Prévia:** tela cheia com a versão limpa, a legenda, o timer e o enviar; com vários itens, uma faixa embaixo para trocar.
- **Seleção:** segurar o balão seleciona; a barra do alto troca o cabeçalho pela contagem e pelas ações (responder, copiar, encaminhar, salvar e apagar). Apagar oferece "para todos" ou "só neste celular", que mostra um recado com "desfazer" por 5 s.
- **Responder:** a citação fica acima do campo e no alto do balão. Arrastar o balão para a direita também responde: ele segue o dedo até um limite, o ícone de responder aparece onde ele estava e, solto depois do limiar, ele volta ao lugar com a citação no campo. Só onde dá para responder (nem em pedido, nem em bloqueado, nem com a seleção aberta) e sem vibrar, para não pedir permissão. Com movimento reduzido, o balão fica parado e só o ícone aparece ao lado dele.
- **Encaminhar:** tela com as conversas (contatos e nota pessoal), até 5.
- **Segurança do contato:** identicon, ID e número de segurança, com "Copiar o número", o texto de colar e o campo: "os números batem.", com o "Marcar como verificado" ali mesmo, ou "os números não batem.". Em linhas, como nos ajustes: apelido, mensagens temporárias, bloquear prints nesta conversa, bloquear (confirmado num painel), "Ocultar conversa" ou "Reexibir conversa" (com um painel que confirma; com as ocultas fechadas, o painel diz para digitar o código na busca ou criar um em Ajustes) e "Apagar conversa".
- **Ajustes:** o cartão "seu id · toque para copiar"; Aparência (Escuro/Claro) e Idioma (Português/English) em segmentos; Privacidade com "Bloquear sozinho ›" (painel com as opções), "Código secreto", "Notificações cegas", "Bloquear capturas de tela", "Confirmações de leitura" e "Indicador de digitação"; Mensagens temporárias, com o timer padrão; Fotos, vídeos e arquivos, com "Baixar sozinho"; Backup, com "Exportar backup" e o que ele leva; e, no fim, Pânico. No pé, "cifra 0.1.0 · GPLv3". Leitura e digitação valem só entre quem liga: desligadas, você também não vê as dos outros. O bloqueio do app é criptográfico e não desliga; o ajuste é o prazo.
- **Pânico:** o rótulo na cor de perigo e o botão de segurar ("Segure para apagar tudo", "continue segurando…", 1,6 s): o fundo enche da esquerda para a direita, e o texto fica branco depois de 45%. Com movimento reduzido, o enchimento continua, porque é ele que mostra quanto falta. Sem vibrar.
- **Código secreto:** o texto (diferente com as ocultas abertas ou fechadas), dois campos em mono ("Código" e "Repita o código") e "Definir código" ou "Trocar código".
- **Doações (RF-60):** o coração abre o painel "Apoiar o Cifra": o texto, o endereço Monero inteiro em mono, numa caixa com o rótulo "endereço monero", e "Copiar endereço", que copia como o ID (sensível, sai da área de transferência em 60 s), fecha o painel e mostra o recado "endereço copiado". Sem QR: o próprio celular não lê a própria tela, e o print fica bloqueado.
- **Avisos:** dados perdidos e outro aparelho, que levam ao onboarding.
- **Notificações:** o aviso fixo do serviço ("Pronto para avisar de mensagem nova.", canal de importância mínima) e "Nova mensagem"; o ícone é o quadrado do wordmark, em branco, com o fósforo de destaque.
- **Tema (RF-39):** escuro por padrão; o sol ou a lua da lista troca na hora, sem remontar as telas, com o véu do fundo anterior esmaecendo em 500 ms (200 ms com movimento reduzido). No claro, o identicon inverte, e os ícones da barra de navegação ficam escuros. O ícone de tocar, sobre o véu escuro do vídeo, fica claro nos dois temas.

### Tokens

| Token | Escuro | Claro |
| --- | --- | --- |
| Fundo | #0B0C0B | #F2F1EB |
| Superfície | #151715 | #FFFFFF |
| Superfície 2 | #1D201D | #E9E8E1 |
| Linha | #262A26 | #DEDCD3 |
| Texto | #E9EBE4 | #131412 |
| Texto secundário | #8D9289 | #64675F |
| Perigo | #FF5A43 | #BF321D |

- Acento: fósforo #C6F432 (alternativas #7CF2D0, #FF7A45, #B9A6FF); texto sobre o acento é sempre #0B0C0B.
- Fontes: Geist na interface; Geist Mono em IDs, chaves, horários e status.
- Raios: 3, 12, 15, 18, 22 e 34.
- Movimento: `cubic-bezier(.22,.9,.24,1)`, 500 ms nas telas, 450 ms nos painéis e 300 ms na volta do balão arrastado, com modo reduzido.

### Voz

Português e inglês, com a mesma voz: em português, tratando por "você"; nos dois, sem emoji e sem exclamação. Status e metadados em minúsculas, em fonte mono. Toda descrição de ajuste diz a consequência de ligar.

### Textos a evitar

Promessas e textos imprecisos que o app não usa (RNF-17), e o que vai no lugar.

| Evitar | Usar |
| --- | --- |
| "Sem número. Sem e-mail. Sem metadados." | "Sem número. Sem e-mail." |
| "…gerado neste aparelho — e só existe aqui." | "…gerado neste aparelho — e só volta com as suas palavras." |
| "nada é guardado em servidor." | "o servidor só guarda, cifrado, o que ainda não foi entregue." |
| "Irreversível — não há backup em lugar nenhum." | "Só volta com as suas palavras de recuperação." |
| "cifra 0.1.0 · GPLv3 · build reproduzível" | "cifra 0.1.0 · GPLv3" |
| "Também oculta o app no multitarefa" | "Prints e gravações saem em branco. Também oculta o app no multitarefa." |
| Notificações cegas, no iPhone | acrescentar: "No iPhone, passam pelos servidores da Apple, que registram quando cada uma chega." |
| Timers de 10 s e 5 min | acrescentar: "Só chega se a outra pessoa estiver com a conversa aberta." |

## Stack e estrutura do projeto

TypeScript de ponta a ponta, num monorepo (pnpm workspaces) com um núcleo que não conhece plataforma. É isso que deixa iOS e web entrarem depois sem bagunçar o código.

### Por que essa escolha

- **Uma linguagem só:** app, relay e protocolo compartilham tipos, testes e um repositório só.
- **Núcleo isolado (portas e adaptadores):** protocolo, criptografia, sessão, fila, timers e regras ficam em `packages/core` e só falam com interfaces. Cada plataforma entrega os próprios adaptadores.
- **React Native + Expo (dev build):** um código de interface para Android e iOS, e web depois via react-native-web.
- **Node.js + TypeScript no relay:** o relay é simples (guarda e entrega blobs), e o formato dos pacotes vem do mesmo pacote que o app usa. Um formato, uma validação.
- **O que fica para depois:** núcleo em Rust com bindings, o caminho do Signal. É o mais duradouro em escala, mas multiplica o trabalho de um dev solo. Com o núcleo atrás de interfaces, a troca continua possível.

### Estrutura

```
cifra/
  packages/
    protocol/   # formatos, tamanhos, codificação e validação (app + relay)
    core/       # identidade, X3DH, Double Ratchet, fila, timers, regras; sem plataforma
    i18n/       # textos da interface em pt-BR e en (mobile e web)
  apps/
    mobile/     # Expo: telas + adaptadores Android/iOS
    relay/      # Node.js: servidor, SQLite, Docker + Tor
    web/        # fase 3: adaptadores web
  tests/        # testes de política do repositório: versões, licença, pacotes sem plataforma
  patches/      # patches revisados de dependências, aplicados pelo pnpm (ver docs/DEPENDENCIAS.md)
  docs/SPEC.md  # este documento, exportado em Markdown
  docs/DEPENDENCIAS.md  # cada dependência, com versão exata e justificativa
```

### Interfaces do núcleo

```ts
interface Cripto { /* subconjunto da libsodium, com os nomes da libsodium-wrappers: mesma API no celular, na web e no Node */ }
interface Armazenamento { /* SQL assíncrono: SQLCipher no celular; SQLite em WASM sobre IndexedDB cifrado na web */ }
interface CofreDeChaves { /* Keystore/Keychain; chave não extraível na web */ }
interface Transporte { /* WebSocket até o relay, via Tor; cada conexão pede o seu circuito */ }
interface Relogio { agora(): number; agendar(atraso: number, tarefa: () => void): () => void }
```

O `Armazenamento` fala SQL porque a exclusão real depende de recursos do SQLite (`secure_delete`, `journal_mode` e o `secure-delete` do FTS5). As assinaturas ficam em `packages/core/src/portas/`.

### Ferramentas

| Uso | Escolha |
| --- | --- |
| Node.js | 24 LTS, no desenvolvimento e no CI |
| Gerenciador de pacotes | pnpm 11, travado no `packageManager`; só instala versões publicadas há 7 dias ou mais |
| Tipos | TypeScript 6 estrito; o 7 entra quando o typescript-eslint suportar |
| Testes | Vitest |
| Lint e formatação | ESLint com typescript-eslint; Prettier |
| Android | JDK 17, NDK 27.1 e SDK 36; no Windows, CMake 3.31 (o ninja do 3.22 não aceita caminho longo); release gerado num container Linux |
| CI | GitHub Actions, com cada action travada pelo commit |
| Licença | GPL-3.0-only |

### Bibliotecas

Todas passam por um spike técnico antes de entrar; o resultado está em `docs/SPIKE.md`. O que ainda não passou continua candidata.

| Necessidade | Escolha | Situação |
| --- | --- | --- |
| libsodium no celular | react-native-libsodium 1.7.0, com patch | aprovada no spike. O patch liga X25519, secretstream, SHA-256 e a conversão da chave privada, e aceita bytes como dados adicionais do AEAD; PR para o projeto original |
| libsodium na web e no relay | libsodium-wrappers-sumo | referência dos testes de conformidade no Node |
| Banco cifrado com busca | op-sqlite com SQLCipher e FTS5 | aprovada no spike. No Android, o SQLCipher usa o OpenSSL 3.5 compilado do fonte oficial, no lugar do pré-compilado que o op-sqlite pede ao Maven Central |
| Keystore/Keychain com biometria | react-native-keychain | aprovada no spike; o expo-secure-store ficou de fora porque não aceita a senha do aparelho. Um módulo próprio confere no Keystore, antes de cada leitura, se a chave ainda vale |
| WebSocket pelo Orbot | módulo próprio em Kotlin, com o OkHttp do React Native e SOCKS do Orbot | aprovado no spike; o SOCKS5 fica no módulo, com usuário e senha por circuito, porque o SOCKS do Java só aceita uma credencial para o app inteiro |
| Bloqueio de print (Android) | FLAG_SECURE no `MainActivity.onCreate` (config plugin) e módulo próprio para desligar | aprovado no spike; o expo-screen-capture ficou de fora porque pede permissão de galeria para detectar print |
| Palavras BIP39 | codificação própria no núcleo, com o SHA-256 da libsodium e as listas oficiais do BIP39 | o @scure/bip39 ficou de fora: calcula o SHA-256 em JS, fora da libsodium (RNF-01) |
| Fontes | Geist e Geist Mono 1.7.2 (OFL), embutidas no app | em uso |
| Margens das barras do sistema | react-native-safe-area-context 5.7.0 | o Android 16 obriga o app a ocupar a tela inteira |
| Limpar foto e vídeo, seletores, salvar no celular | módulo próprio em Kotlin, só com APIs do Android (BitmapFactory e Bitmap.compress; MediaExtractor e MediaMuxer; MediaStore; seletor de fotos do sistema) | o expo-image-manipulator e o Media3 ficaram de fora, sem dependência nova. O mesmo módulo faz o "salvar como" do backup (ACTION_CREATE_DOCUMENT). A versão do Android e as datas que o MediaMuxer grava no MP4 saem no próprio arquivo, sem mudar tamanhos (`src/mp4.ts`) |
| Bloqueio de print (iOS) | módulo com campo seguro | candidata (fase 2) |
| Vídeo sem metadados (iOS) | AVAssetExportSession | candidata (fase 2) |
| Relay: HTTP e WebSocket | ws 8.21.3, sobre o `node:http` | o Fastify ficou de fora: traz o pino (log) e dezenas de dependências para uma rota só |
| Relay: banco | `node:sqlite`, que vem no Node 24 | no lugar do better-sqlite3: sem dependência, sem compilar e igual no arm64. A API ainda não é estável no Node 24; a imagem fica travada |
| Validação de pacotes | leitor binário estrito em `packages/protocol` | o zod ficou de fora: valida objetos JS, e o protocolo é binário |
| Tradução (pt-BR e en) | i18next + react-i18next, com expo-localization | i18next em uso; o resto, candidata |

## Roadmap

| Fase | Foco | Entra |
| --- | --- | --- |
| 1 · MVP | Android; prova o núcleo | identidade e 12 palavras; conversa 1:1 cifrada; anexos sem metadados; temporárias e apagar pra todos; conversas ocultas; relay oficial + Orbot; armazenamento blindado; pânico e backup de contatos |
| 2 · Resiliência | iOS e rede que aguenta queda | iOS; relays da comunidade (lista curada); 2 a 3 caixas e troca automática; prova de trabalho contra spam |
| 3 · Maturidade | web e endurecimento | web (mesmo núcleo); Tor embutido no app; build reproduzível; transferência entre celulares; tráfego de cobertura opcional; pago por conveniência |

- **Portão da fase 1 para a 2:** testes de aceite passam (IPED, captura de rede, dump do relay) e há gente usando.
- **Portão da fase 2 para a 3:** relays da comunidade estáveis e iOS no ar.
- **Sem data:** grupos, chamadas, vários aparelhos.
- **Nunca:** relays conversando entre si, mensagem pulando entre relays, token ou staking, P2P, notificação via Google.

Cada fase só começa quando o portão anterior é cumprido.

### Distribuição

- **ID do pacote:** `org.cifra.app`. Mudar depois quebraria a atualização de quem já instalou.
- **Assinatura:** chave própria do Cifra (RSA de 4096 bits, válida por 30 anos), a mesma em todas as versões, também no pacote da Play Store, para as duas instalações se atualizarem entre si. Impressão digital SHA-256 do certificado: `C5:C9:9C:2A:3D:D4:59:54:7F:1C:30:3B:DA:A9:4D:85:92:6B:D1:0C:65:4B:A5:15:01:21:9B:73:09:5D:70:53`.
- **Doações:** em Monero, no endereço `86QtU9BtiGzRdwNZo5yd9eTbH4EHVd8xd1Cr2DpHLeBJe7Kqiz4JrzzDjq9F79XuTcGuFGi1TnouYX7deAkS7Zr4K1Hmxak` (RF-60).

## Testes e verificação

O MVP só está pronto quando passa nestes 12 testes. Os de perícia usam o IPED, a ferramenta open source da Polícia Federal.

| Teste | Como | Passa se |
| --- | --- | --- |
| Perícia no aparelho | extrair um Android de teste (com root) com o app bloqueado, depois de trocar, apagar e deixar vencer mensagens; rodar o IPED | nenhuma mensagem, apelido ou anexo legível |
| Conversas ocultas | mesma extração, com o app desbloqueado e o cofre fechado | nenhum rastro de contato oculto |
| Captura de rede | Wireshark ou tcpdump no roteador | só tráfego Tor; com o Orbot desligado, nenhuma conexão com o relay |
| Tamanho dos pacotes | captura no relay | todo pacote de mensagem tem 4096 bytes |
| Dump do relay | copiar o banco SQLite do relay | nenhum conteúdo em claro, nenhum remetente, nenhum IP |
| Metadados de anexo | exiftool antes e depois do envio | nada de GPS, modelo, data ou miniatura |
| Protocolo | testes unitários com vetores (ID, X3DH, Double Ratchet, número de segurança) | vetores batem; mensagens fora de ordem e perdidas são tratadas |
| Fila de saída | derrubar o relay durante o envio | a mensagem fica pendente e sai depois, sem duplicar |
| Timer curto | timer de 10 s com o destinatário offline | aparece "uma mensagem expirou antes de você abrir" |
| Apagar pra todos | apagar com o outro lado offline | some quando ele reconecta; o IPED não encontra |
| Pânico | segurar o botão e extrair o aparelho | nada recuperável |
| Restauração | restaurar com as palavras em outro aparelho | mesmo ID; contatos voltam do backup; aparelho antigo desconectado |

Os 12 passaram no emulador, com o APK de release. O resultado de cada um, o que foi corrigido e como repetir estão em `docs/VERIFICACAO.md`; a perícia num celular de verdade está nos riscos.

## Decisões pendentes e riscos

Quatro decisões ainda abertas e setenta e três riscos com mitigação. O maior risco técnico é implementar X3DH e Double Ratchet por conta própria.

### Decisões pendentes

- [ ] Valores iniciais: pacote de 4 KB, texto até 3.500 bytes, anexo até 25 MB, retenção de 14 dias, bloqueio automático em 5 minutos, timer de 10 s a 7 dias, 5 s para desfazer o apagar só neste celular, e as taxas e tetos do relay (seção "Limites e retenção").
- [ ] Registro da marca "Cifra", que é uma palavra comum.
- [ ] Exigir chave em hardware (TEE ou StrongBox) no Keystore. O spike só rodou em emulador, que não tem.
- [ ] Parâmetros do Argon2id do código secreto. Hoje, o nível INTERACTIVE (64 MB): no emulador, de 0,2 a 0,3 s por tentativa no release; o MODERATE (256 MB) levou de 4,5 s a 11 s. Medir em aparelho real.

### Riscos

| Risco | Mitigação |
| --- | --- |
| Falha na implementação própria de X3DH e Double Ratchet | seguir as especificações à risca, testes com vetores. A revisão externa ainda não foi feita: o código é aberto, e o texto do app não promete auditoria |
| React Native falhar ao falar com o Orbot, ou vazar conexão | provado no spike técnico; regra de não conectar sem Tor; teste de captura |
| Bloqueio de print no iOS depende de um truque não oficial | testar a cada versão do iOS; texto honesto |
| Tamanho do cofre das ocultas indicar uso | o cofre nasce com um bloco de 16 MiB e cresce de 16 em 16, com as datas tocadas a cada abertura e bloqueio; passar de um bloco (muitas mensagens ou anexos ocultos) mostra que há uso. Limite documentado |
| Spam contra IDs públicos | pedidos de conversa e bloqueio; prova de trabalho na fase 2 |
| Quem busca muitas vezes o cartão de um ID gasta a cota de prekeys dele: quem buscar em seguida recebe o cartão sem prekey, e a primeira mensagem tem menos proteção | a cota é de 10 por hora por ID, e o app repõe as prekeys de hora em hora; prova de trabalho na fase 2 |
| Cartões, caixas e pacotes criados em massa enchem os tetos do relay, e ele recusa o novo até o prazo do que entrou vencer | tetos ajustáveis por quem opera, taxas por conexão e por caixa; prova de trabalho na fase 2 |
| Relay único no MVP | fila de saída; relays da comunidade na fase 2 |
| Orbot configurado sem isolamento por credencial SOCKS juntaria os circuitos da caixa e dos depósitos | o Tor isola por padrão (`IsolateSOCKSAuth`); a tela de verificação técnica mede o tempo de circuito novo, reaproveitado e de outra credencial |
| Contato que reinstala ou restaura sem escrever primeiro não recebe o que foi mandado para a caixa antiga | a restauração apaga a caixa antiga: quem escreve depois acha a caixa nova no cartão, abre sessão nova e cifra de novo o que esperava na fila. O que já estava na caixa antiga se perde (linha seguinte) |
| O que esperava na caixa do aparelho antigo some na restauração, e quem enviou continua vendo "enviada" | o aparelho novo não tem as sessões para decifrar. Quem enviou não é avisado: risco aceito |
| Quem tem as 12 palavras pode restaurar a identidade de volta, e o outro aparelho é que fica desconectado | o aviso diz para criar uma identidade nova se não foi a pessoa; uma trava de restauração, como o PIN de registro do Signal, fica para a fase 2 |
| Se o contato restaurar a identidade antes de você aceitar o pedido dele, a primeira resposta vai na sessão do aparelho antigo e não é lida | caso raro: a conversa volta quando ele escrever de novo. Sem um cartão anterior para comparar, este aparelho não tem como perceber a troca; um reinício de sessão automático fica para a fase 2 |
| Em "Nova conversa", o circuito novo do Tor para o contato pode falhar na primeira tentativa, e o painel diz "sem conexão agora" com a lista em "tor · conectado" | o correio tenta 3 vezes, num circuito novo a cada vez, antes de mostrar "não foi possível falar com o servidor agora" |
| App falso com backdoor | APK assinado com impressão digital publicada, F-Droid, marca registrada |
| Dependência npm comprometida | poucas dependências, versões travadas, revisão a cada entrada |
| O OpenSSL do SQLCipher precisa acompanhar as correções de segurança | compilado do fonte oficial na imagem do release, na versão de suporte longo (3.5, até 04/2030), conferido pelo SHA-256 e pela assinatura do OpenSSL; a versão sobe a cada correção (`docs/DEPENDENCIAS.md`) |
| libsodium do celular é binário pré-compilado pelo mantenedor da react-native-libsodium | conformidade com vetores a cada atualização; compilar do fonte junto com o build reproduzível (fase 3) |
| Patch próprio na react-native-libsodium | patch pequeno e revisado, conformidade no aparelho; PR para o projeto original e o patch sai quando entrar |
| react-native-keychain sem versão nova desde março de 2025 | adaptador atrás da porta `CofreDeChaves`; se quebrar, troca por módulo próprio sobre o Keystore |
| Chave mestra passa pelo JS como texto, que não dá para zerar | menor tempo de vida possível; fechar o banco no bloqueio; limite documentado no texto do app |
| O Keystore invalida a chave mestra quando a pessoa tira o bloqueio de tela do aparelho | o banco fica ilegível e a identidade só volta com as palavras; o app confere a chave antes de pedir a biometria, avisa que os dados deste aparelho foram perdidos e leva à restauração |
| Na tela das 12 palavras, o leitor de tela do Android pode ler as duas colunas intercaladas (1, 7, 2, 8…), e quem não enxerga anotaria as palavras fora de ordem | cada coluna é um grupo na árvore de acessibilidade, que vai de 1 a 6 e depois de 7 a 12 (conferido pelo `uiautomator`); falta ouvir com o TalkBack num aparelho |
| Com o seletor do sistema (foto, arquivo) aberto pelo app, sair do app não bloqueia na hora | o prazo do bloqueio sozinho conta com o seletor aberto (5 minutos quando o ajuste é "ao sair do app") |
| Ao fechar o banco no bloqueio, as páginas decifradas que o SQLite usou ficam na memória liberada até serem reaproveitadas | `PRAGMA cipher_memory_security` apaga essa memória, mas o ganho é parcial, porque o JS guarda os mesmos textos. Medido no emulador (build de desenvolvimento, 2000 mensagens com busca): uns 30% mais lento, e fica desligado. Medir de novo em aparelho real |
| Os timers do JS param com o app em segundo plano no Android | os timers do núcleo vêm de um módulo nativo, e o prazo do RF-40 usa o AlarmManager. Os timers nativos não contam o aparelho dormindo: a volta confere o tempo de novo |
| Bibliotecas nativas escrevem no logcat (react-native-keychain, Expo) | o R8 tira o `android.util.Log` do release (com o otimizador ligado, sem ofuscar); o que a máquina virtual do Android escreve sozinha (coleta de lixo, por exemplo) fica fora do alcance do app. Na verificação, o logcat do release, numa sessão inteira de uso, só tinha linhas do sistema (máquina virtual, janelas, teclado, o MPEG4Writer sem caminho de arquivo) e nenhum texto, apelido ou ID |
| O R8 do release quebra o que o Kotlin resolve por reflexão: um `Record` sem a anotação não converte, e o que depende dele falha só no release | `@OptimizedRecord` em todo `Record` do módulo nativo (o teste falha sem ela), e o release conferido no emulador quando muda código nativo |
| Na web, quem entrega o código pode trocá-lo | cliente web hospedado separado do relay e versão instalável; definir na fase 3 |
| Cobrança como empresa exige guardar registro de acesso (Marco Civil, art. 15) | consultar um advogado antes de cobrar |
| A limpeza do vídeo passa por um MP4 temporário no cache do app; apagar não garante que o chip não guarde cópia | o arquivo é zerado e apagado logo depois; o banco cifrado guarda o resto. Na verificação, nem a varredura nem o IPED acharam, na extração do aparelho, trechos do vídeo ou da foto como o app os gerou. Blocos livres do chip não aparecem numa extração lógica e, com a criptografia por arquivo do Android, ficam cifrados; limite documentado |
| Anexo só sobe e desce com o app aberto: bloqueou, a transferência recomeça do zero | com o serviço de notificação ligado, a transferência continua fora da frente até o prazo do bloqueio; bloqueou, o banco fecha e ela para. Uma transferência longa vista sem tocar na tela também é cortada pelo prazo parado |
| Mensagem que some antes do download (timer, apagar pra todos, apagar conversa) deixa o blob no relay até 14 dias | o blob é cifrado e sem dono para o relay; quem baixa um blob órfão pede para apagar na hora |
| Fotos abertas ficam na memória do JS e no cache de imagens enquanto o app está aberto | saem no bloqueio (o cache de imagens é limpo); o texto do JS não dá para zerar, como a chave do banco |
| GIF vira foto parada | limite documentado; animação fica para depois |
| Documento vai como está e pode ter dados do autor | o painel "Anexar" avisa (RF-34); limpar documentos fica para depois |
| A área de transferência só é limpa com o Cifra na frente e com a janela dele em foco: desde o Android 10, só assim o app consegue conferir o que está copiado | o texto vai marcado como sensível; se a pessoa saiu antes dos 60 s, ele sai quando ela volta ao Cifra, e nunca o texto que outro app copiou depois |
| Tocar vídeo em tela cheia, salvar documento em Download e cancelar no meio de uma transferência só passaram pelos testes, sem conferência num aparelho | a lógica tem testes, e a seção "Anexos" da verificação técnica passou; conferir num celular de verdade |
| Depois de reiniciar o celular (ou de o sistema fechar o app), as notificações só voltam quando a pessoa abre o Cifra | o serviço não liga junto com o sistema: ele precisaria da chave da caixa e das preferências antes de qualquer abertura. Texto dos ajustes e rever na fase 2 |
| A economia de bateria do Android (Doze) atrasa o aviso de mensagem nova e o alarme do bloqueio sozinho | o alarme é inexato para não pedir permissão de alarme exato; a volta ao app confere o prazo. Pedir para tirar o Cifra da economia de bateria fica para depois |
| Com o app bloqueado, a mensagem de um ID bloqueado também gera "Nova mensagem" | o vigia não abre o pacote e não sabe quem escreveu; ao abrir, nada aparece. Aceito no MVP |
| O "digitando" para quem está fora do ar ocupa a caixa dele (no máximo um a cada 15 s) e, se o depósito falha depois de cifrar, deixa uma chave pulada do outro lado | só sai com a conexão de depósito aberta; a próxima mensagem decifra com a chave pulada |
| Com o tema claro, a janela nativa abre escura e o JS pinta o claro em seguida | a cor da janela vem do app.json, antes de ler as preferências; aceito |
| Confirmação de leitura e pedido de apagar (pra todos ou a conversa) que o contato manda nos segundos da troca de caixa, antes de ler o aviso, não valem deste lado: o banco que lê a caixa antiga não tem mais a sessão | as mensagens cruzam pelo reenvio; o app do contato não guarda o que já apagou, então não há o que mandar de novo. Aceito |
| Contato de uma conversa oculta que troca de aparelho e escreve primeiro chega como pedido na lista comum: o cofre não responde a uma sessão nova, porque as prekeys ficam no principal | caso raro; quando este aparelho escreve primeiro, o cofre recomeça a sessão e avisa a caixa oculta ao aparelho novo. Rever na fase 2 |
| Adicionar pelo "+" o ID de uma conversa oculta, com as ocultas fechadas, cria uma segunda conversa no principal; reexibir fica recusado enquanto ela existir | o painel diz que não foi possível; aceito no MVP |
| O aparelho do contato fica sabendo que a conversa foi para outra caixa: não mostra nada na tela, mas um app modificado vê | é cortesia, como as outras (contato ou app modificado): o conteúdo continua cifrado e o relay não liga a caixa a ninguém |
| Restaurar a identidade perde as ocultas (o cofre nasce vazio), e o contato segue mandando para a caixa oculta até a pessoa escrever para ele | o aviso de restauração já diz que os dados deste aparelho não voltam; quando a pessoa escreve, o contato abre sessão nova e esquece a caixa oculta |
| Download e envio de anexo de uma conversa oculta param quando as ocultas fecham | recomeçam quando o código abre o cofre de novo; aceito |
| Mensagem temporária de uma conversa oculta que vence com o cofre fechado só sai quando ele abre (até lá fica cifrada no cofre) | a limpeza roda na abertura, antes de mostrar qualquer coisa; aceito |
| O Argon2id roda no JS e trava a tela por uns 0,3 s a cada código tentado na busca | só com o texto parado por 0,8 s e de 6 caracteres ou mais; medir em aparelho real (decisão pendente) |
| Depois de restaurar com o backup, a primeira mensagem para cada contato precisa de conexão: sem ela, não sai nem fica pendente (a sessão nova só abre com o cartão do contato) | o painel avisa que não deu para enviar; com conexão, sai na hora. Guardar o texto até a sessão abrir fica para depois |
| O backup é um retrato: contatos e ajustes que mudaram depois de exportar não estão nele, e o app não lembra a pessoa de exportar de novo | o texto dos ajustes diz o que ele leva; um lembrete fica para depois |
| O backup só entra na restauração: quem restaurou sem ele e acha o arquivo depois precisa restaurar de novo, e o que chegou no meio-tempo se perde | caso raro; importar pelos ajustes, sem apagar o que já está no aparelho, fica para depois |
| Quem tiver o arquivo do backup e as 12 palavras tem os contatos; o nome sugerido do arquivo mostra que a pessoa usa o Cifra | as palavras já dão a identidade inteira; a pessoa pode mudar o nome no "salvar como", e o conteúdo é ruído sem as palavras |
| Sem conexão na hora do pânico, o cartão e a caixa principal ficam no relay até vencer (90 dias), e as caixas das conversas ocultas também | o que está no relay é cifrado e não diz quem fala com quem; quem escreve para a pessoa recebe `caixa-inexistente` só depois. Repetir o pedido numa próxima abertura não dá: o aparelho não guarda mais nada |
| Durante o pedido do pânico ao relay (até 3 tentativas pelo Tor), uma cópia do par de assinatura da identidade e da semente da caixa principal fica na memória | é zerada quando o pedido termina; o banco e as chaves do Keystore já saíram antes. Como a chave mestra que passa pelo JS, é limite documentado |
| Com o TalkBack, segurar o botão do pânico é tocar duas vezes e segurar, e não há outro caminho | o emulador não deixa conferir o foco do TalkBack; conferir num aparelho |
| A perícia (IPED) só rodou no emulador: um celular de verdade tem chip de memória, Keystore em hardware e sistema do fabricante | o emulador roda o Android oficial, e a cifra não depende do aparelho; repetir num celular de verdade |
| Perder a chave de assinatura impede atualizar o app de quem já instalou; vazar deixa outra pessoa publicar uma atualização falsa | a chave fica fora do repositório e do projeto gerado, com cópia guardada em outro lugar e senha num gerenciador; o build lê do ambiente. A Play Store recebe a mesma chave, para o APK baixado fora da loja e o da loja se atualizarem entre si |
| Depois do pânico, ficam na pasta do app o arquivo do keychain com 0 byte, o marcador de perfil do Android e o estado dos pedidos de permissão do Expo | nenhum tem dado da pessoa; mostram só que o app está instalado, o que já se vê |
| Alguém divulgar fora do app um endereço de doação falso | o app assinado e o código mostram o endereço certo (RF-60) |
| O botão de doação pode fazer a Play recusar o app ou tirá-lo da loja: a política de pagamentos dela proíbe botão ou link para pagar fora da cobrança da Play, e a única exceção de doação é a de quem tem isenção de imposto | se ela recusar ou pedir a retirada, o pacote da loja passa a sair sem o botão, e o APK de fora da loja continua com ele |
| Mais de 25 mil mensagens seguidas perdidas numa cadeia do Double Ratchet (meses de caixa sem leitura, como a de uma conversa oculta com o cofre fechado, e um contato que escreve muito) fazem as seguintes não abrirem até uma sessão nova | o teto é o do Signal; um reinício de sessão automático fica para a fase 2 |
| Um pacote forjado em nome de um contato faz o app derivar até 25 mil chaves (50 mil com passo DH) em cada sessão do contato antes de recusar: num computador, até uns 90 ms por sessão | quem forja precisa do ID da pessoa e do de um contato dela; os depósitos numa caixa têm taxa no relay inteiro; prova de trabalho na fase 2 |
| A conexão com o relay não tem prazo para abrir: um relay que aceita e não responde deixa o app em "conectando", e o vigia para de avisar | correção: prazo de 60 s para abrir, como nos pedidos de anexo |
| Uma conexão fechada pelo próprio app não avisa o fechamento ao JS, e os ouvintes dela se acumulam | correção: o módulo avisa todo fechamento |
| Um erro ao parar as conversas no bloqueio deixa o vigia desligado, e o desbloqueio seguinte falha | correção: o bloqueio segue mesmo com erro, como o pânico |
| A numeração dos pedidos de anexo recomeça a cada desbloqueio, e um cancelamento antigo pode cancelar outro envio | correção: numeração única no processo |
| Um vídeo muito acima do limite de 25 MB é copiado inteiro e zerado antes de ser recusado | correção: parar a cópia ao passar do limite |
| A busca exportada pelo núcleo (`buscarMensagens`) devolve mensagens escondidas por "apagar só neste celular" e as de pedidos | o app usa a busca da agenda, que filtra; correção: filtrar também ou deixar de exportar |
| Um endereço de relay com `?` ou `#` passa na validação do cartão e quebra o endereço dos anexos | correção: recusar `?` e `#` no endereço |
| Tipos de arquivo com maiúscula, como o do `.xlsm`, são recusados no anexo | correção: passar o tipo para minúsculas antes de validar |
