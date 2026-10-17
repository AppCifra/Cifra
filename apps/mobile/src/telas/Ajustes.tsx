// Os ajustes, como no design: o cartão do próprio ID, que copia (RF-45); a aparência (RF-39) e o
// idioma (RF-49); a privacidade: o bloqueio sozinho (RF-40), as notificações cegas (RF-42), o
// bloqueio de prints (RF-41), a confirmação de leitura (RF-17) e o indicador de digitação (RF-18);
// as mensagens temporárias (RF-50); os anexos (RF-57); o backup (RF-46), que sai pelo "salvar como"
// do sistema; e o pânico (RF-48): segurar 1,6 s apaga tudo deste celular.
//
// Tema, idioma e notificações valem com o app bloqueado e ficam nas preferências do Keystore; o
// resto fica no banco cifrado.
import { PRAZOS_DO_BLOQUEIO } from '@cifra/core';
import type { Idioma } from '@cifra/i18n';
import { TIMER_MAXIMO_EM_SEGUNDOS } from '@cifra/protocol';
import { useState, useSyncExternalStore } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { expo } from '../../app.json';
import { CartaoDeIdentidade } from '../componentes/CartaoDeIdentidade.tsx';
import { ListaDeOpcoes, Segmentos } from '../componentes/Opcoes.tsx';
import { Painel } from '../componentes/Painel.tsx';
import { PainelDoTimer } from '../componentes/PainelDoTimer.tsx';
import { Recado, useRecado } from '../componentes/Recado.tsx';
import { RotuloDeSecao } from '../componentes/RotuloDeSecao.tsx';
import { SegurarParaApagar } from '../componentes/SegurarParaApagar.tsx';
import { GrupoDeLinhas, LinhaComInterruptor, LinhaDeValor } from '../componentes/Seguranca.tsx';
import { Cabecalho } from '../componentes/Topo.tsx';
import type { ConversasDoApp } from '../conversas.ts';
import { nomeDoBackup } from '../formato-do-backup.ts';
import { OPCOES_DO_TIMER, rotuloLongo } from '../formato-do-timer.ts';
import { idiomaAtivo, useTextos, type Traduzir } from '../i18n.ts';
import type { PreferenciasDoApp, Tema } from '../preferencias.ts';
import { criarEstilos, fontes } from '../tema.ts';
import type { TelaDoApp } from '../navegacao.ts';
import { useLeitura, useVersao } from './dados.ts';

interface PropsDosAjustes {
  readonly conversas: ConversasDoApp;
  readonly preferencias: PreferenciasDoApp;
  /** Ligar pede a permissão do sistema; devolve se ficaram ligadas. */
  readonly aoMudarNotificacoes: (ligar: boolean) => Promise<boolean>;
  readonly aoVoltar: () => void;
  /** Abre outra tela por cima: o código secreto. */
  readonly abrir: (tela: TelaDoApp) => void;
  /** Pânico (RF-48): apaga tudo deste celular. */
  readonly aoApagarTudo: () => void;
}

/** O prazo do bloqueio sozinho: "Ao sair do app", ou o tempo, como nos timers ("5 minutos"). */
export function rotuloDoPrazo(t: Traduzir, segundos: number): string {
  return segundos === 0 ? t('ajustes.bloqueio.aoSair') : rotuloLongo(t, segundos);
}

export function Ajustes({
  conversas,
  preferencias,
  aoMudarNotificacoes,
  aoVoltar,
  abrir,
  aoApagarTudo,
}: PropsDosAjustes) {
  const t = useTextos();
  const estilos = useEstilos();
  const margens = useSafeAreaInsets();
  const versao = useVersao(conversas);
  const preferidas = useSyncExternalStore(preferencias.aoMudar, () => preferencias.atual);
  const [painel, setPainel] = useState<'timer' | 'bloqueio' | null>(null);
  const [recado, mostrarRecado] = useRecado();
  const ajustes = useLeitura(() => conversas.agenda.ajustesDoTimer(), [versao]);
  const padrao = ajustes?.timerPadrao ?? 0;
  const baixarSozinho = useLeitura(() => conversas.agenda.baixarSozinho(), [versao]) ?? true;
  const { privacidade } = conversas;
  const fechar = () => {
    setPainel(null);
  };
  const mudarPrivacidade = (mudanca: Parameters<ConversasDoApp['mudarPrivacidade']>[0]) => {
    void conversas.mudarPrivacidade(mudanca).catch(() => undefined);
  };
  const exportar = () => {
    const { tema, idioma } = preferencias.atual;
    void conversas
      .exportarBackup({ tema, idioma }, nomeDoBackup(t, Date.now()))
      .then((resultado) => {
        if (resultado === 'salvo') mostrarRecado(t('ajustes.backup.salvo'));
        else if (resultado === 'falhou') mostrarRecado(t('ajustes.backup.falhou'));
      });
  };

  return (
    <View style={[estilos.tela, { paddingTop: margens.top }]}>
      <Cabecalho titulo={t('ajustes.titulo')} aoVoltar={aoVoltar} />
      <ScrollView
        contentContainerStyle={[estilos.conteudo, { paddingBottom: margens.bottom + 44 }]}
      >
        <CartaoDeIdentidade
          id={conversas.meuId}
          legenda={t('ajustes.seuId')}
          dica={conversas.comMidia ? t('ajustes.tocarParaCopiar') : undefined}
          tamanho={56}
          aoTocar={
            conversas.comMidia
              ? () => {
                  void conversas.copiarTexto(conversas.meuId).then((copiou) => {
                    if (copiou) mostrarRecado(t('ajustes.idCopiado'));
                  });
                }
              : undefined
          }
        />

        <View style={estilos.secao}>
          <RotuloDeSecao texto={t('ajustes.aparencia')} />
          <Segmentos<Tema>
            naTela
            opcoes={[
              { valor: 'escuro', rotulo: t('ajustes.escuro') },
              { valor: 'claro', rotulo: t('ajustes.claro') },
            ]}
            valor={preferidas.tema}
            aoEscolher={(tema) => {
              void preferencias.mudar({ tema }).catch(() => undefined);
            }}
          />
        </View>

        <View style={estilos.secao}>
          <RotuloDeSecao texto={t('ajustes.idioma.titulo')} />
          <Segmentos<Idioma>
            naTela
            opcoes={[
              { valor: 'pt-BR', rotulo: t('idiomas.pt-BR') },
              { valor: 'en', rotulo: t('idiomas.en') },
            ]}
            valor={preferidas.idioma ?? idiomaAtivo()}
            aoEscolher={(idioma) => {
              void preferencias.mudar({ idioma }).catch(() => undefined);
            }}
          />
          <Text style={estilos.explicacao}>{t('ajustes.idioma.descricao')}</Text>
        </View>

        <View style={estilos.secao}>
          <RotuloDeSecao texto={t('ajustes.privacidade')} />
          <GrupoDeLinhas>
            <LinhaDeValor
              rotulo={t('ajustes.bloquearSozinho')}
              valor={rotuloDoPrazo(t, privacidade.bloquearSozinho)}
              aoTocar={() => {
                setPainel('bloqueio');
              }}
            />
            <LinhaDeValor
              rotulo={t('ajustes.codigoSecreto')}
              aoTocar={() => {
                abrir({ tipo: 'codigo' });
              }}
            />
            <LinhaComInterruptor
              rotulo={t('ajustes.notificacoes')}
              descricao={t('ajustes.notificacoesDescricao')}
              ligado={preferidas.notificacoes}
              aoMudar={(ligar) => {
                void aoMudarNotificacoes(ligar).then((ligadas) => {
                  if (ligar && !ligadas) mostrarRecado(t('ajustes.notificacoesNegadas'));
                });
              }}
            />
            <LinhaComInterruptor
              rotulo={t('ajustes.capturas')}
              descricao={t('ajustes.capturasDescricao')}
              ligado={privacidade.bloquearCapturas}
              aoMudar={(bloquearCapturas) => {
                mudarPrivacidade({ bloquearCapturas });
              }}
            />
            <LinhaComInterruptor
              rotulo={t('ajustes.leitura')}
              descricao={t('ajustes.leituraDescricao')}
              ligado={privacidade.confirmacoesDeLeitura}
              aoMudar={(confirmacoesDeLeitura) => {
                mudarPrivacidade({ confirmacoesDeLeitura });
              }}
            />
            <LinhaComInterruptor
              rotulo={t('ajustes.digitacao')}
              descricao={t('ajustes.digitacaoDescricao')}
              ligado={privacidade.indicadorDeDigitacao}
              aoMudar={(indicadorDeDigitacao) => {
                mudarPrivacidade({ indicadorDeDigitacao });
              }}
            />
          </GrupoDeLinhas>
        </View>

        <View style={estilos.secao}>
          <RotuloDeSecao texto={t('ajustes.temporarias')} />
          <GrupoDeLinhas>
            <LinhaDeValor
              rotulo={t('ajustes.timerPadrao')}
              valor={rotuloLongo(t, padrao)}
              aoTocar={() => {
                setPainel('timer');
              }}
            />
          </GrupoDeLinhas>
          <Text style={estilos.explicacao}>{t('ajustes.timerPadraoDescricao')}</Text>
        </View>

        <View style={estilos.secao}>
          <RotuloDeSecao texto={t('ajustes.anexos')} />
          <GrupoDeLinhas>
            <LinhaComInterruptor
              rotulo={t('ajustes.baixarSozinho')}
              descricao={t('ajustes.baixarSozinhoDescricao')}
              ligado={baixarSozinho}
              aoMudar={(ligado) => {
                void conversas.mudar((agenda) => agenda.mudarBaixarSozinho(ligado));
              }}
            />
          </GrupoDeLinhas>
        </View>

        {conversas.comMidia && (
          <View style={estilos.secao}>
            <RotuloDeSecao texto={t('ajustes.backup.titulo')} />
            <GrupoDeLinhas>
              <LinhaDeValor rotulo={t('ajustes.backup.exportar')} aoTocar={exportar} />
            </GrupoDeLinhas>
            <Text style={estilos.explicacao}>{t('ajustes.backup.descricao')}</Text>
          </View>
        )}

        <View style={estilos.secao}>
          <RotuloDeSecao texto={t('ajustes.panico.titulo')} perigo />
          <SegurarParaApagar
            rotulo={t('ajustes.panico.segure')}
            segurando={t('ajustes.panico.segurando')}
            aoConfirmar={aoApagarTudo}
          />
          <Text style={estilos.explicacao}>{t('ajustes.panico.descricao')}</Text>
        </View>

        <Text style={estilos.versao}>{t('ajustes.versao', { versao: expo.version })}</Text>
      </ScrollView>

      <PainelDoTimer
        visivel={painel === 'timer'}
        aoFechar={fechar}
        titulo={t('timer.padrao.titulo')}
        descricao={t('timer.padrao.descricao')}
        valor={padrao}
        opcoes={OPCOES_DO_TIMER}
        maximo={TIMER_MAXIMO_EM_SEGUNDOS}
        nota={false}
        perguntarAnteriores={false}
        aoEscolher={(segundos) => {
          fechar();
          void conversas.mudar((agenda) => agenda.mudarTimerPadrao(segundos));
        }}
      />

      <Painel
        visivel={painel === 'bloqueio'}
        aoFechar={fechar}
        titulo={t('ajustes.bloqueio.titulo')}
        descricao={t('ajustes.bloqueio.descricao')}
      >
        <ListaDeOpcoes<number>
          opcoes={PRAZOS_DO_BLOQUEIO.map((segundos) => ({
            valor: segundos,
            rotulo: rotuloDoPrazo(t, segundos),
          }))}
          valor={privacidade.bloquearSozinho}
          aoEscolher={(bloquearSozinho) => {
            fechar();
            mudarPrivacidade({ bloquearSozinho });
          }}
        />
      </Painel>

      <Recado visivel={recado !== null} texto={recado ?? ''} embaixo={margens.bottom + 24} />
    </View>
  );
}

const useEstilos = criarEstilos((cores) => ({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { gap: 24, paddingHorizontal: 20, paddingTop: 8 },
  secao: { gap: 10 },
  explicacao: {
    paddingHorizontal: 4,
    fontFamily: fontes.regular,
    fontSize: 12.5,
    lineHeight: 17.5,
    color: cores.secundario,
  },
  versao: {
    textAlign: 'center',
    fontFamily: fontes.mono,
    fontSize: 11,
    color: cores.secundario,
  },
}));
