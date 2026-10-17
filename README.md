# Cifra

Mensageiro para Android em que a identidade é um par de chaves gerado no aparelho, sem número nem e-mail. As conversas são cifradas de ponta a ponta e passam pelo Tor até um relay que não sabe quem fala com quem.

## Recursos

- Identidade sem número, e-mail nem conta, com 12 palavras para recuperar.
- Conversa 1:1 com texto, foto, vídeo e documento. Fotos e vídeos saem sem localização, modelo do aparelho nem data.
- Mensagens temporárias, por conversa ou por mensagem, e apagar para todos.
- Conversas ocultas, que só aparecem com o código secreto digitado na busca.
- Número de segurança, para conferir a identidade do contato.
- Confirmação de leitura e indicador de digitação, desligados por padrão.
- Bloqueio do app, bloqueio de print e botão de pânico, que apaga tudo do aparelho.
- Backup dos contatos e dos ajustes, cifrado com as 12 palavras.
- Em português e inglês.

## Como funciona

- **Identidade:** um par de chaves Ed25519 que sai das 12 palavras. O ID, de 16 caracteres, vem do hash da chave pública.
- **Mensagens:** X3DH e Double Ratchet, com as primitivas da libsodium, dentro de um envelope selado: o relay não sabe quem enviou. Toda mensagem vai num pacote de 4 KB.
- **Rede:** o app só conecta pelo Tor, via Orbot, e o relay é um onion service. Cada pacote é apagado do relay depois da entrega.
- **No aparelho:** banco cifrado com SQLCipher, com a chave guardada no Keystore, e exclusão real, sem sobra da mensagem apagada no banco.

O que o Cifra protege e contra quem está no [modelo de ameaça](docs/SPEC.md#modelo-de-ameaça). Os testes de aceite, com perícia pelo IPED, captura de rede e cópia do banco do relay, estão em [`docs/VERIFICACAO.md`](docs/VERIFICACAO.md).

## Para usar

- Android 10 ou mais novo, com bloqueio de tela (PIN, padrão ou senha).
- O [Orbot](https://orbot.app) ligado: o Cifra só conecta pelo Tor.

Antes de instalar, confira a assinatura do APK. Rode `apksigner verify --print-certs cifra.apk`, do Android SDK. A linha `certificate SHA-256 digest` precisa mostrar:

```
c5c99c2a3dd459547f1c303bdaa94d85926bd10c654ba51501219b73095d7053
```

É a impressão digital do certificado do Cifra (`C5:C9:9C:2A:3D:D4:59:54:7F:1C:30:3B:DA:A9:4D:85:92:6B:D1:0C:65:4B:A5:15:01:21:9B:73:09:5D:70:53`), a mesma em todas as versões.

## Doações

Em Monero, neste endereço:

```
86QtU9BtiGzRdwNZo5yd9eTbH4EHVd8xd1Cr2DpHLeBJe7Kqiz4JrzzDjq9F79XuTcGuFGi1TnouYX7deAkS7Zr4K1Hmxak
```

É o mesmo endereço do app, no coração no alto da lista de conversas, e de [`apps/mobile/src/doacao.ts`](apps/mobile/src/doacao.ts).

## Desenvolvimento

| Pasta | O que tem |
| --- | --- |
| `packages/protocol` | formatos e validação dos pacotes, os mesmos no app e no relay |
| `packages/core` | identidade, sessão, fila de saída, mensagens temporárias, conversas ocultas, backup e pânico, sem dependência de plataforma |
| `packages/i18n` | textos da interface em português e inglês |
| `apps/mobile` | app Android em React Native (Expo), com módulos nativos em Kotlin |
| `apps/relay` | relay em Node.js com SQLite, em Docker com um onion service |
| `tests` | testes de política do repositório: versões travadas, licença e pacotes sem plataforma |

Com Node 24 e pnpm 11:

```sh
pnpm install
pnpm check
```

O `pnpm check` roda formatação, lint, tipos e testes, como no CI.

- [`docs/SPEC.md`](docs/SPEC.md): a especificação, com requisitos, protocolo, relay, modelo de ameaça e riscos.
- [`docs/DESENVOLVIMENTO.md`](docs/DESENVOLVIMENTO.md): como rodar, testar e gerar o app e o relay.
- [`docs/DEPENDENCIAS.md`](docs/DEPENDENCIAS.md): cada dependência, com a versão exata e o motivo.
- [`docs/SPIKE.md`](docs/SPIKE.md): a prova das bibliotecas nativas no Android.

## Licença

[GPL-3.0-only](LICENSE).
