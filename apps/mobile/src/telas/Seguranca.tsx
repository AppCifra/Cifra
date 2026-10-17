// A segurança do contato (RF-37, RF-38), como no design: identicon, nome, ID, a situação da
// verificação e o número de segurança para comparar fora do app. O número copia, para mandar por
// outro caminho, e o campo de colar compara os 60 dígitos com o que a outra pessoa mandou: só
// quando batem, ele oferece marcar como verificado. Embaixo, o apelido (RF-09), que fica só neste
// aparelho, o timer das mensagens temporárias (RF-25), os prints bloqueados na conversa para os
// dois (RF-58), apagar a conversa só deste celular (RF-31) ou dos dois (RF-59) e o bloqueio
// (RF-08). Ocultar e reexibir a conversa (RF-20) só funcionam com as ocultas abertas e com conexão;
// com elas fechadas, o painel explica como abrir ou criar o código.
import { compararNumero, lerApelido } from '@cifra/core';
import { TIMER_MAXIMO_EM_SEGUNDOS } from '@cifra/protocol';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Botao } from '../componentes/Botao.tsx';
import { CampoDeTexto } from '../componentes/CampoDeTexto.tsx';
import { IdenticonNaMoldura } from '../componentes/ItemDaConversa.tsx';
import { Painel } from '../componentes/Painel.tsx';
import { PainelDoTimer } from '../componentes/PainelDoTimer.tsx';
import { Recado, useRecado } from '../componentes/Recado.tsx';
import {
  GrupoDeLinhas,
  LinhaComInterruptor,
  LinhaDeValor,
  NumeroDeSeguranca,
  SituacaoDaVerificacao,
} from '../componentes/Seguranca.tsx';
import { Cabecalho } from '../componentes/Topo.tsx';
import type { ConversasDoApp } from '../conversas.ts';
import { nomeDaConversa } from '../formato-da-conversa.ts';
import { OPCOES_DO_TIMER, rotuloLongo } from '../formato-do-timer.ts';
import { useTextos } from '../i18n.ts';
import { criarEstilos, fontes, tipos } from '../tema.ts';
import { useLeitura, useTelaProtegida, useVersao } from './dados.ts';

interface PropsDaSeguranca {
  readonly conversas: ConversasDoApp;
  readonly id: string;
  readonly aoVoltar: () => void;
  /** O pedido bloqueado sai da área de pedidos: a tela some. */
  readonly aoSumir: () => void;
}

export function Seguranca({ conversas, id, aoVoltar, aoSumir }: PropsDaSeguranca) {
  const estilos = useEstilos();
  const t = useTextos();
  const margens = useSafeAreaInsets();
  const versao = useVersao(conversas);
  const [painel, setPainel] = useState<
    'apelido' | 'bloquear' | 'timer' | 'apagar' | 'fechadas' | 'ocultar' | 'reexibir' | null
  >(null);
  const [mudandoDeBanco, setMudandoDeBanco] = useState(false);
  const [apelido, setApelido] = useState('');
  const [apelidoInvalido, setApelidoInvalido] = useState(false);
  const [colado, setColado] = useState('');
  const [recado, mostrarRecado] = useRecado();
  const agenda = conversas.agendaDe(id);
  const oculta = conversas.oculta(id);
  const resumo = useLeitura(() => agenda.conversa(id), [versao, id, oculta]);
  // As 5200 iterações de cada lado rodam uma vez por contato.
  const numero = useLeitura(() => agenda.numeroDeSeguranca(id), [id, oculta]);
  const semTimer = useLeitura(() => agenda.temMensagensSemTimer(id), [versao, id, oculta]) ?? false;
  useTelaProtegida(conversas, resumo?.printsBloqueados ?? false);

  if (!resumo) return <View style={estilos.tela} />;
  const nome = nomeDaConversa(t, resumo);
  const comparacao = numero ? compararNumero(colado, numero) : 'vazio';
  const verificar = () => {
    void conversas.mudar((daConversa) => daConversa.verificar(id, !resumo.verificado), id);
  };
  const fechar = () => {
    setPainel(null);
  };

  const mudarDeBanco = (ocultar: boolean) => {
    setMudandoDeBanco(true);
    void (ocultar ? conversas.ocultar(id) : conversas.reexibir(id)).then((resultado) => {
      setMudandoDeBanco(false);
      fechar();
      if (resultado === 'ok') {
        aoSumir();
        return;
      }
      mostrarRecado(
        t(resultado === 'sem-conexao' ? 'nova.erros.semConexao' : 'seguranca.ocultarFalhou'),
      );
    });
  };

  const salvarApelido = () => {
    try {
      lerApelido(apelido);
    } catch {
      setApelidoInvalido(true);
      return;
    }
    void conversas.mudar((daConversa) => daConversa.renomear(id, apelido), id).then(fechar);
  };

  return (
    <View style={[estilos.tela, { paddingTop: margens.top }]}>
      <Cabecalho titulo={t('seguranca.titulo')} aoVoltar={aoVoltar} />
      <ScrollView
        contentContainerStyle={[estilos.conteudo, { paddingBottom: margens.bottom + 40 }]}
      >
        <View style={estilos.quem}>
          <IdenticonNaMoldura id={resumo.id} tamanho={104} moldura={142} />
          <View style={estilos.nomes}>
            <Text style={estilos.nome}>{nome}</Text>
            <Text style={estilos.id}>{resumo.id}</Text>
          </View>
          <SituacaoDaVerificacao
            verificado={resumo.verificado}
            rotulo={t(resumo.verificado ? 'seguranca.verificado' : 'seguranca.naoVerificado')}
          />
        </View>
        {numero && (
          <NumeroDeSeguranca
            rotulo={t('seguranca.numero')}
            grupos={numero}
            explicacao={t('seguranca.comparar', { nome })}
          />
        )}
        {(resumo.verificado || comparacao !== 'confere') && (
          <Botao
            titulo={t(resumo.verificado ? 'seguranca.removerVerificacao' : 'seguranca.verificar')}
            variante={resumo.verificado ? 'fantasma' : 'secundario'}
            pequeno
            aoTocar={verificar}
          />
        )}
        {numero && (
          <View style={estilos.comparar}>
            {conversas.comMidia && (
              <Botao
                titulo={t('seguranca.copiarNumero')}
                variante="fantasma"
                pequeno
                aoTocar={() => {
                  void conversas.copiarTexto(numero.join(' ')).then((copiou) => {
                    if (copiou) mostrarRecado(t('seguranca.numeroCopiado'));
                  });
                }}
              />
            )}
            <Text style={estilos.explicacaoDoColar}>{t('seguranca.colar.descricao')}</Text>
            <CampoDeTexto
              valor={colado}
              aoMudar={setColado}
              rotulo={t('seguranca.colar.campo')}
              mono
            />
            {(comparacao === 'confere' || comparacao === 'diferente') && (
              <Text accessibilityLiveRegion="polite" style={estilos.aviso}>
                {t(
                  comparacao === 'confere'
                    ? 'seguranca.colar.confere'
                    : 'seguranca.colar.diferente',
                )}
              </Text>
            )}
            {comparacao === 'confere' && !resumo.verificado && (
              <Botao
                titulo={t('seguranca.verificar')}
                variante="secundario"
                pequeno
                aoTocar={verificar}
              />
            )}
          </View>
        )}
        <GrupoDeLinhas>
          <LinhaDeValor
            rotulo={t('seguranca.apelido')}
            valor={resumo.apelido ?? ''}
            aoTocar={() => {
              setApelido(resumo.apelido ?? '');
              setApelidoInvalido(false);
              setPainel('apelido');
            }}
          />
          {resumo.tipo === 'contato' && !resumo.bloqueado && (
            <LinhaDeValor
              rotulo={t('seguranca.temporarias')}
              valor={rotuloLongo(t, resumo.timer)}
              aoTocar={() => {
                setPainel('timer');
              }}
            />
          )}
          {resumo.tipo === 'contato' && !resumo.bloqueado && (
            <LinhaComInterruptor
              rotulo={t('seguranca.prints')}
              descricao={t('seguranca.printsDescricao')}
              ligado={resumo.printsBloqueados}
              aoMudar={(bloquear) => {
                void conversas.mudarPrints(id, bloquear).then((mudou) => {
                  if (!mudou) mostrarRecado(t('seguranca.printsFalhou'));
                });
              }}
            />
          )}
          {resumo.tipo === 'contato' && !resumo.bloqueado && (
            <LinhaDeValor
              rotulo={t(oculta ? 'seguranca.reexibir' : 'seguranca.ocultar')}
              aoTocar={() => {
                setPainel(oculta ? 'reexibir' : conversas.ocultasAbertas ? 'ocultar' : 'fechadas');
              }}
            />
          )}
          {resumo.tipo === 'contato' && (
            <LinhaDeValor
              rotulo={t('seguranca.apagarConversa')}
              perigo
              aoTocar={() => {
                setPainel('apagar');
              }}
            />
          )}
          {resumo.bloqueado ? (
            <LinhaDeValor
              rotulo={t('seguranca.desbloquear')}
              aoTocar={() => {
                void conversas
                  .mudar((daConversa) => daConversa.desbloquear(id), id)
                  .then(() => {
                    if (resumo.tipo === 'pedido') aoSumir();
                  });
              }}
            />
          ) : (
            <LinhaDeValor
              rotulo={t('seguranca.bloquear')}
              perigo
              aoTocar={() => {
                setPainel('bloquear');
              }}
            />
          )}
        </GrupoDeLinhas>
      </ScrollView>

      <Painel
        visivel={painel === 'apelido'}
        aoFechar={fechar}
        titulo={t('seguranca.painelApelido.titulo')}
        descricao={t('seguranca.painelApelido.descricao')}
      >
        <CampoDeTexto
          valor={apelido}
          aoMudar={(novo) => {
            setApelido(novo);
            setApelidoInvalido(false);
          }}
          rotulo={t('seguranca.painelApelido.campo')}
        />
        {apelidoInvalido && (
          <Text accessibilityLiveRegion="polite" style={estilos.aviso}>
            {t('seguranca.painelApelido.invalido')}
          </Text>
        )}
        <Botao titulo={t('seguranca.painelApelido.salvar')} pequeno aoTocar={salvarApelido} />
      </Painel>

      <Painel
        visivel={painel === 'bloquear'}
        aoFechar={fechar}
        titulo={t('seguranca.painelBloquear.titulo', { nome })}
        descricao={t('seguranca.painelBloquear.descricao')}
      >
        <Botao
          titulo={t('seguranca.painelBloquear.confirmar')}
          variante="perigo"
          pequeno
          aoTocar={() => {
            void conversas
              .mudar((daConversa) => daConversa.bloquear(id), id)
              .then(() => {
                fechar();
                if (resumo.tipo === 'pedido') aoSumir();
              });
          }}
        />
        <Botao
          titulo={t('seguranca.painelBloquear.cancelar')}
          variante="fantasma"
          pequeno
          aoTocar={fechar}
        />
      </Painel>

      <Painel
        visivel={painel === 'fechadas'}
        aoFechar={fechar}
        titulo={t('seguranca.painelOcultasFechadas.titulo')}
        descricao={t('seguranca.painelOcultasFechadas.descricao')}
      >
        <Botao titulo={t('seguranca.painelOcultasFechadas.entendi')} pequeno aoTocar={fechar} />
      </Painel>

      {(['ocultar', 'reexibir'] as const).map((qual) => {
        const textos = qual === 'ocultar' ? 'seguranca.painelOcultar' : 'seguranca.painelReexibir';
        return (
          <Painel
            key={qual}
            visivel={painel === qual}
            aoFechar={fechar}
            titulo={t(`${textos}.titulo`, { nome })}
            descricao={t(`${textos}.descricao`)}
          >
            <Botao
              titulo={
                mudandoDeBanco
                  ? t(qual === 'ocultar' ? 'seguranca.ocultando' : 'seguranca.reexibindo')
                  : t(`${textos}.confirmar`)
              }
              pequeno
              desativado={mudandoDeBanco}
              aoTocar={() => {
                mudarDeBanco(qual === 'ocultar');
              }}
            />
            <Botao
              titulo={t(`${textos}.cancelar`)}
              variante="fantasma"
              pequeno
              desativado={mudandoDeBanco}
              aoTocar={fechar}
            />
          </Painel>
        );
      })}

      <PainelDoTimer
        visivel={painel === 'timer'}
        aoFechar={fechar}
        titulo={t('timer.conversa.titulo')}
        descricao={t('timer.conversa.descricao')}
        valor={resumo.timer}
        opcoes={OPCOES_DO_TIMER}
        maximo={TIMER_MAXIMO_EM_SEGUNDOS}
        nota={false}
        perguntarAnteriores={semTimer}
        aoEscolher={(segundos, anteriores) => {
          fechar();
          void conversas.mudarTimer(id, segundos, anteriores);
        }}
      />

      <Painel
        visivel={painel === 'apagar'}
        aoFechar={fechar}
        titulo={t('seguranca.painelApagar.titulo')}
        descricao={t('seguranca.painelApagar.descricao')}
      >
        {!resumo.bloqueado && (
          <Botao
            titulo={t('seguranca.painelApagar.paraOsDois')}
            variante="perigo"
            pequeno
            aoTocar={() => {
              void conversas.apagarConversaParaOsDois(id).then((apagou) => {
                fechar();
                if (!apagou) {
                  mostrarRecado(t('seguranca.painelApagar.falhou'));
                  return;
                }
                aoVoltar();
              });
            }}
          />
        )}
        <Botao
          titulo={t('seguranca.painelApagar.confirmar')}
          variante={resumo.bloqueado ? 'perigo' : 'secundario'}
          pequeno
          aoTocar={() => {
            void conversas
              .mudar((daConversa) => daConversa.apagarConversa(id), id)
              .then(() => {
                fechar();
                // A conversa, agora vazia, fica embaixo.
                aoVoltar();
              });
          }}
        />
        <Botao
          titulo={t('seguranca.painelApagar.cancelar')}
          variante="fantasma"
          pequeno
          aoTocar={fechar}
        />
      </Painel>
      <Recado visivel={recado !== null} texto={recado ?? ''} embaixo={margens.bottom + 24} />
    </View>
  );
}

const useEstilos = criarEstilos((cores) => ({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { gap: 22, paddingHorizontal: 20, paddingTop: 12 },
  quem: { alignItems: 'center', gap: 14, paddingTop: 6 },
  nomes: { alignItems: 'center', gap: 4 },
  nome: { fontFamily: fontes.media, fontSize: 24, letterSpacing: -0.48, color: cores.texto },
  id: { fontFamily: fontes.mono, fontSize: 12.5, color: cores.secundario },
  aviso: { ...tipos.monoPequeno, color: cores.texto },
  comparar: { gap: 10 },
  explicacaoDoColar: {
    paddingHorizontal: 4,
    fontFamily: fontes.regular,
    fontSize: 13.5,
    lineHeight: 19.6,
    color: cores.secundario,
  },
}));
