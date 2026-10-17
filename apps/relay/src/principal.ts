// Ponto de entrada do relay. Configuração pelo ambiente:
//   CIFRA_PORTA     porta do HTTP e do WebSocket (padrão 8080)
//   CIFRA_ENDERECO  interface de escuta (padrão 127.0.0.1; no Docker, 0.0.0.0)
//   CIFRA_BANCO     arquivo do banco SQLite (padrão relay.sqlite)
//   CIFRA_ESPACO_DOS_ANEXOS  espaço dos anexos, em MB (padrão 4096)
//
// O processo não escreve nada em stdout nem em stderr, nem quando falha (RNF-05). O motivo de uma
// saída fica no código: 2 para configuração inválida, 3 quando não abre a porta e 1 para erro
// inesperado.
import {
  ANEXOS_SUBINDO,
  ESPACO_DOS_ANEXOS_EM_MB,
  INTERVALO_DO_PING_EM_SEGUNDOS,
  PARADA_DO_ANEXO_EM_SEGUNDOS,
  TAMANHO_MAXIMO_DO_ANEXO,
  TRANSFERENCIAS_DE_ANEXOS,
} from '@cifra/protocol';
import { abrirBanco } from './banco.ts';
import { criarRelay } from './relay.ts';
import { libsodium } from './sodium.ts';

const SAIDAS = { erro: 1, configuracao: 2, porta: 3 } as const;

// Erro sem tratamento sairia com a pilha no stderr; aviso do Node também. Nada disso sai.
process.removeAllListeners('warning');
process.on('uncaughtException', () => process.exit(SAIDAS.erro));
process.on('unhandledRejection', () => process.exit(SAIDAS.erro));

const ambiente = process.env;
const porta = Number(ambiente['CIFRA_PORTA'] ?? 8080);
const endereco = ambiente['CIFRA_ENDERECO'] ?? '127.0.0.1';
const caminho = ambiente['CIFRA_BANCO'] ?? 'relay.sqlite';
const espaco = Number(ambiente['CIFRA_ESPACO_DOS_ANEXOS'] ?? ESPACO_DOS_ANEXOS_EM_MB) * 1024 * 1024;

if (
  !Number.isInteger(porta) ||
  porta < 1 ||
  porta > 65535 ||
  endereco === '' ||
  caminho === '' ||
  !Number.isSafeInteger(espaco) ||
  espaco < TAMANHO_MAXIMO_DO_ANEXO
) {
  process.exit(SAIDAS.configuracao);
}

const banco = abrirBanco(caminho);
const relay = criarRelay({
  banco,
  sodium: libsodium,
  agora: Date.now,
  limites: {
    anexos: {
      subindo: ANEXOS_SUBINDO,
      transferencias: TRANSFERENCIAS_DE_ANEXOS,
      espaco,
      parada: PARADA_DO_ANEXO_EM_SEGUNDOS * 1000,
    },
  },
});

relay.limpar();
const limpeza = setInterval(() => {
  relay.limpar();
}, 3_600_000);
const vigia = setInterval(() => {
  relay.vigiar();
}, INTERVALO_DO_PING_EM_SEGUNDOS * 1000);

relay.servidor.once('error', () => process.exit(SAIDAS.porta));
relay.servidor.listen(porta, endereco);

async function encerrar(): Promise<void> {
  clearInterval(limpeza);
  clearInterval(vigia);
  await relay.fechar();
  banco.fechar();
  process.exit(0);
}

for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sinal, () => {
    void encerrar();
  });
}
