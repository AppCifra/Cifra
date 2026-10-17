// Raiz do app. Ao abrir, lê a chave mestra (biometria ou senha) e a identidade guardada; sem
// identidade, mostra o onboarding. O estado e o bloqueio ficam no controle (controle.ts): depois do
// prazo parado (RF-40), o app bloqueia, para as conversas e fecha o banco; ao voltar, pede a
// biometria de novo. Com a identidade aberta, a pilha de telas começa na lista de conversas.
//
// Notificações cegas (RF-42): com as notificações ligadas, o serviço em primeiro plano mantém o app
// vivo fora da frente. Aberto, o aviso de mensagem nova sai do correio; bloqueado, do vigia.
//
// Antes de tudo, o app lê as preferências que valem com ele bloqueado (tema e idioma): a tela de
// bloqueio e o pedido de biometria já aparecem como a pessoa escolheu.
//
// Pânico (RF-48): o controle destrói as chaves e apaga os arquivos; aqui, as preferências voltam ao
// padrão, o aviso some e o relay recebe o pedido de apagar o cartão e a caixa.
import { apagarTudoNoRelay, type ConteudoDoBackup, type Identidade } from '@cifra/core';
import { enderecoDeRelayValido } from '@cifra/protocol';
import { lazy, Suspense, useEffect, useSyncExternalStore } from 'react';
import { AppState, StatusBar, View, type AppStateStatus } from 'react-native';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';
import { ANDROID_DATABASE_PATH } from '@op-engineering/op-sqlite';
import { areaDeTransferenciaNativa, cofreNativo } from '../modules/cifra-plataforma/index.ts';
import { abrirBanco, abrirCofre, apagarBanco } from './adaptadores/armazenamento.ts';
import { criarCofreDeChaves } from './adaptadores/cofre-de-chaves.ts';
import { avisosDoAndroid } from './adaptadores/avisos.ts';
import { cripto } from './adaptadores/cripto.ts';
import { alarmeDoBloqueio, relogio } from './adaptadores/relogio.ts';
import { criarTransporte, PORTA_SOCKS_DO_ORBOT } from './adaptadores/transporte.ts';
import { AvisosDoApp } from './avisos.ts';
import { ControleDoApp } from './controle.ts';
import type { ConversasDoApp } from './conversas.ts';
import { ENDERECO_DO_RELAY, iniciarConversas, iniciarVigia } from './correio.ts';
import { TrocaDeTema } from './componentes/TrocaDeTema.tsx';
import { aplicarIdioma, i18n } from './i18n.ts';
import { Onboarding } from './onboarding/Onboarding.tsx';
import { PreferenciasDoApp } from './preferencias.ts';
import type { Plataforma } from './sessao.ts';
import { Bloqueado } from './telas/Bloqueado.tsx';
import { DadosPerdidos } from './telas/DadosPerdidos.tsx';
import { Principal } from './telas/Principal.tsx';
import { Substituido } from './telas/Substituido.tsx';
import { definirBarrasDoTema } from './adaptadores/tela.ts';
import { aplicarTema, coresDo, criarEstilos, temaAtual, useTema } from './tema.ts';
import { aoUsar } from './uso.ts';

const BANCO_PRINCIPAL = 'cifra.sqlite';

/** O cofre das conversas ocultas, na mesma pasta do principal. */
const COFRE = 'cofre.sqlite';
const PASTA_DOS_BANCOS = (ANDROID_DATABASE_PATH as string).replace(/\/$/, '');
const CAMINHO_DO_BANCO = `${PASTA_DOS_BANCOS}/${BANCO_PRINCIPAL}`;
const CAMINHO_DO_COFRE = `${PASTA_DOS_BANCOS}/${COFRE}`;

const plataforma: Plataforma = {
  cripto,
  cofre: criarCofreDeChaves({
    // Exigir chave em hardware é decisão pendente: o emulador não tem.
    exigirHardware: false,
    textos: (operacao) => ({
      titulo: i18n.t(operacao === 'guardar' ? 'cofre.guardar' : 'cofre.ler'),
      cancelar: i18n.t('cofre.cancelar'),
    }),
  }),
  abrirBanco: (chave) => abrirBanco(BANCO_PRINCIPAL, chave),
  apagarBanco: () =>
    Promise.resolve().then(() => {
      apagarBanco(BANCO_PRINCIPAL);
    }),
  abrirCofre: (chave) => abrirCofre(COFRE, chave),
  truncarCofre: () => cofreNativo.truncar(CAMINHO_DO_COFRE),
  tocarCofre: () => cofreNativo.tocar([CAMINHO_DO_COFRE, `${CAMINHO_DO_COFRE}-journal`]),
  apagarArquivos: () =>
    cofreNativo.apagar([
      CAMINHO_DO_BANCO,
      `${CAMINHO_DO_BANCO}-journal`,
      CAMINHO_DO_COFRE,
      `${CAMINHO_DO_COFRE}-journal`,
    ]),
};

const preferencias = new PreferenciasDoApp(plataforma.cofre);

/** O tema e o idioma escolhidos valem na hora, em todas as telas. */
function aplicarPreferencias(): void {
  const { tema, idioma } = preferencias.atual;
  aplicarTema(tema);
  aplicarIdioma(idioma);
}
preferencias.aoMudar(aplicarPreferencias);

const avisos = new AvisosDoApp(avisosDoAndroid, i18n.t.bind(i18n));

const controle: ControleDoApp<ConversasDoApp> = new ControleDoApp<ConversasDoApp>({
  plataforma,
  // Com a identidade aberta, o correio publica o cartão e abre a caixa no relay (RF-04). O seletor
  // de fotos e arquivos não bloqueia o app na hora.
  iniciar: (sessao, aoSubstituir) =>
    iniciarConversas(sessao, aoSubstituir, (acao) => controle.semBloquear(acao), plataforma),
  emPrimeiroPlano: () => AppState.currentState === 'active',
  bloqueio: {
    decorrido: alarmeDoBloqueio.decorrido,
    agendar: (atraso, tarefa) => relogio.agendar(atraso, tarefa),
    armar: (ms) => {
      alarmeDoBloqueio.armar(ms, coresDo(temaAtual()).fundo);
    },
    desarmar: alarmeDoBloqueio.desarmar,
  },
  vigiar: () =>
    preferencias.atual.notificacoes
      ? iniciarVigia(plataforma.cofre, () => {
          void avisos.novaMensagem();
        })
      : Promise.resolve(null),
  // Pânico: o pedido ao relay sai pelo Tor, como tudo, depois de o aparelho já estar limpo.
  apagarNoRelay: (assinatura) =>
    enderecoDeRelayValido(ENDERECO_DO_RELAY)
      ? apagarTudoNoRelay({
          cripto,
          transporte: criarTransporte({ portaSocks: PORTA_SOCKS_DO_ORBOT }),
          relogio,
          relay: ENDERECO_DO_RELAY,
          assinatura,
        })
      : Promise.resolve(false),
  aoApagar: () => {
    preferencias.esquecer();
    void avisos.limpar();
    void areaDeTransferenciaNativa.esquecer();
  },
});

alarmeDoBloqueio.aoVencer(() => {
  void controle.prazoVenceu();
});
aoUsar(() => {
  controle.usar();
});

/** Liga ou desliga o serviço das notificações conforme o estado, o ajuste e a frente. */
function sincronizarAvisos(frente: AppStateStatus = AppState.currentState): void {
  const { tipo } = controle.estado;
  void avisos.sincronizar({
    naFrente: frente === 'active',
    temIdentidade: tipo === 'pronto' || tipo === 'bloqueado' || tipo === 'abrindo',
    ligadas: preferencias.atual.notificacoes,
  });
}
controle.aoMudar(() => {
  sincronizarAvisos();
});
preferencias.aoMudar(() => {
  sincronizarAvisos();
});
i18n.on('languageChanged', () => {
  sincronizarAvisos();
});

/**
 * Ligar as notificações pede a permissão do sistema (Android 13+). Sem ela, o ajuste fica
 * desligado. Devolve se ficaram ligadas.
 */
async function mudarNotificacoes(ligar: boolean): Promise<boolean> {
  const permitidas = ligar ? await avisos.pedirPermissao() : false;
  await preferencias
    .mudar({ notificacoes: permitidas, avisosPedidos: true })
    .catch(() => undefined);
  return permitidas;
}

const estadoAtual = () => controle.estado;

// Verificação técnica do spike: só no build de desenvolvimento, com EXPO_PUBLIC_CIFRA_VERIFICACAO=1.
// No build de release, a condição vira `false` e o código da tela nem entra no pacote.
const TelaDeVerificacao =
  __DEV__ && process.env.EXPO_PUBLIC_CIFRA_VERIFICACAO === '1'
    ? lazy(() =>
        import('./spike/TelaDoSpike.tsx').then(({ TelaDoSpike }) => ({ default: TelaDoSpike })),
      )
    : null;

const desbloquear = () => {
  void controle.abrir();
};
const recomecar = () => {
  controle.recomecar();
};
/** Na restauração com backup, o tema e o idioma dele valem logo depois de entrar (RF-47). */
const concluir = async (identidade: Identidade, backup: ConteudoDoBackup | null) => {
  await controle.concluirOnboarding(identidade, backup);
  if (backup) {
    const { tema, idioma } = backup.preferencias;
    void preferencias.mudar({ tema, idioma }).catch(() => undefined);
  }
};
const apagarTudo = () => {
  void controle.panico();
};

export function App() {
  const estilos = useEstilos();
  const tema = useTema();
  const estado = useSyncExternalStore(controle.aoMudar, estadoAtual);

  useEffect(() => {
    void definirBarrasDoTema(tema === 'claro');
  }, [tema]);

  // A capa que o nativo pôs ao voltar depois do prazo sai quando a tela de bloqueio já está aqui.
  useEffect(() => {
    if (estado.tipo === 'abrindo') return;
    const quadro = requestAnimationFrame(() => {
      void alarmeDoBloqueio.descobrir();
    });
    return () => {
      cancelAnimationFrame(quadro);
    };
  }, [estado.tipo]);

  // Com a conversa na frente, o aviso de mensagem nova some; fora da frente, ele sai do correio,
  // que já decifrou e sabe que é mensagem. Na primeira vez, o sistema pede a permissão.
  const uso = estado.tipo === 'pronto' ? estado.uso : null;
  useEffect(() => {
    if (!uso) return;
    if (AppState.currentState === 'active') void avisos.limpar();
    const atual = preferencias.atual;
    if (atual.notificacoes && !atual.avisosPedidos) void mudarNotificacoes(true);
    return uso.aoChegarMensagem(() => {
      if (AppState.currentState !== 'active' && preferencias.atual.notificacoes) {
        void avisos.novaMensagem();
      }
    });
  }, [uso]);

  useEffect(() => {
    if (TelaDeVerificacao) return;
    void preferencias.carregar().finally(() => controle.abrir());
    // No Android, o app vai para `background` ao sair da frente e volta para `active`.
    const assinatura = AppState.addEventListener('change', (agora) => {
      if (agora === 'background') {
        void controle.irParaSegundoPlano();
      } else if (agora === 'active') {
        void controle.voltarAoPrimeiroPlano();
        sincronizarAvisos(agora);
        if (controle.estado.tipo === 'pronto') void avisos.limpar();
      }
    });
    return () => {
      assinatura.remove();
    };
  }, []);

  return (
    // As margens das barras do sistema (status, recorte da câmera e navegação) chegam às telas.
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <StatusBar
        barStyle={tema === 'claro' ? 'dark-content' : 'light-content'}
        backgroundColor="transparent"
        translucent
      />
      <View
        style={estilos.app}
        onTouchStart={() => {
          controle.usar();
        }}
      >
        {TelaDeVerificacao ? (
          <Suspense fallback={null}>
            <TelaDeVerificacao t={i18n.t.bind(i18n)} />
          </Suspense>
        ) : estado.tipo === 'bloqueado' ? (
          <Bloqueado falhou={estado.falhou} aoDesbloquear={desbloquear} />
        ) : estado.tipo === 'dados-perdidos' ? (
          <DadosPerdidos motivo={estado.motivo} aoContinuar={recomecar} />
        ) : estado.tipo === 'substituido' ? (
          <Substituido aoContinuar={recomecar} />
        ) : estado.tipo === 'onboarding' ? (
          <Onboarding aoConcluir={concluir} apagado={estado.apagado === true} />
        ) : estado.tipo === 'pronto' ? (
          <Principal
            conversas={estado.uso}
            preferencias={preferencias}
            aoMudarNotificacoes={mudarNotificacoes}
            aoApagarTudo={apagarTudo}
          />
        ) : null}
        <TrocaDeTema />
      </View>
    </SafeAreaProvider>
  );
}

const useEstilos = criarEstilos((cores) => ({
  app: { flex: 1, backgroundColor: cores.fundo },
}));
