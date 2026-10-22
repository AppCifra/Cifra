// Ponto de entrada do relay. Configuração pelo ambiente:
//   CIFRA_PORTA     porta do HTTP e do WebSocket (padrão 8080)
//   CIFRA_ENDERECO  interface de escuta (padrão 127.0.0.1; no Docker, 0.0.0.0)
//   CIFRA_BANCO     arquivo do banco SQLite (padrão relay.sqlite)
//   CIFRA_ESPACO_DOS_ANEXOS  espaço dos anexos, em MB (padrão 4096)
//   CIFRA_ESPACO_DOS_PACOTES espaço dos pacotes guardados, em MB (padrão 4096)
//   CIFRA_MAXIMO_DE_CARTOES  cartões guardados (padrão 250000)
//   CIFRA_MAXIMO_DE_CAIXAS   caixas (padrão 1000000)
//
// O processo não escreve nada em stdout nem em stderr, nem quando falha (RNF-05). O motivo de uma
// saída fica no código: 2 para configuração inválida, 3 quando não abre a porta e 1 para erro
// inesperado.
import {
  ANEXOS_SUBINDO,
  CAIXAS_NO_RELAY,
  CARTOES_NO_RELAY,
  ESPACO_DOS_ANEXOS_EM_MB,
  DURACAO_MAXIMA_DO_ANEXO_EM_MINUTOS,
  ESPACO_DOS_PACOTES_EM_MB,
  INTERVALO_DO_PING_EM_SEGUNDOS,
  JANELA_DO_RITMO_DO_ANEXO_EM_SEGUNDOS,
  PACOTES_POR_CAIXA,
  PARADA_DO_ANEXO_EM_SEGUNDOS,
  RITMO_MINIMO_DO_ANEXO_EM_BYTES,
  TAMANHO_DO_PACOTE,
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
const pacotes =
  (Number(ambiente['CIFRA_ESPACO_DOS_PACOTES'] ?? ESPACO_DOS_PACOTES_EM_MB) * 1024 * 1024) /
  TAMANHO_DO_PACOTE;
const cartoes = Number(ambiente['CIFRA_MAXIMO_DE_CARTOES'] ?? CARTOES_NO_RELAY);
const caixas = Number(ambiente['CIFRA_MAXIMO_DE_CAIXAS'] ?? CAIXAS_NO_RELAY);

if (
  !Number.isInteger(porta) ||
  porta < 1 ||
  porta > 65535 ||
  endereco === '' ||
  caminho === '' ||
  !Number.isSafeInteger(espaco) ||
  espaco < TAMANHO_MAXIMO_DO_ANEXO ||
  // No mínimo uma caixa cheia.
  !Number.isSafeInteger(pacotes) ||
  pacotes < PACOTES_POR_CAIXA ||
  !Number.isSafeInteger(cartoes) ||
  cartoes < 1 ||
  !Number.isSafeInteger(caixas) ||
  caixas < 1
) {
  process.exit(SAIDAS.configuracao);
}

const banco = abrirBanco(caminho);
const relay = criarRelay({
  banco,
  sodium: libsodium,
  agora: Date.now,
  limites: {
    pacotes,
    cartoes,
    caixas,
    anexos: {
      subindo: ANEXOS_SUBINDO,
      transferencias: TRANSFERENCIAS_DE_ANEXOS,
      espaco,
      parada: PARADA_DO_ANEXO_EM_SEGUNDOS * 1000,
      janelaDoRitmo: JANELA_DO_RITMO_DO_ANEXO_EM_SEGUNDOS * 1000,
      ritmoMinimo: RITMO_MINIMO_DO_ANEXO_EM_BYTES,
      duracao: DURACAO_MAXIMA_DO_ANEXO_EM_MINUTOS * 60_000,
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
