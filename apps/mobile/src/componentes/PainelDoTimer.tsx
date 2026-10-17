// O painel de escolher um timer: o da conversa (RF-25), o desta mensagem (RF-26) e o padrão das
// conversas novas (RF-50). A lista de opções do design, com o aviso nos timers curtos (RF-29), e o
// "Personalizado": um número e a unidade. Ao ligar o timer numa conversa que tem mensagens sem
// timer, o painel pergunta se elas também passam a sumir.
import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, Text, useWindowDimensions } from 'react-native';
import {
  avisaTimerCurto,
  lerPersonalizado,
  rotuloLongo,
  UNIDADES,
  type Unidade,
} from '../formato-do-timer.ts';
import { useTextos } from '../i18n.ts';
import { criarEstilos, tipos } from '../tema.ts';
import { Botao } from './Botao.tsx';
import { CampoDeTexto } from './CampoDeTexto.tsx';
import { ListaDeOpcoes, Segmentos } from './Opcoes.tsx';
import { Painel } from './Painel.tsx';

/** O valor da linha "Personalizado" na lista: nenhum timer de verdade é negativo. */
const PERSONALIZADO = -1;

interface PropsDoPainelDoTimer {
  readonly visivel: boolean;
  readonly aoFechar: () => void;
  readonly titulo: string;
  readonly descricao: string;
  /** O timer de agora, em segundos. */
  readonly valor: number;
  /** As opções da lista, em segundos. */
  readonly opcoes: readonly number[];
  /** O maior tempo personalizado. */
  readonly maximo: number;
  /** Nota pessoal: sem outra pessoa, sem o aviso dos timers curtos e com os textos da nota. */
  readonly nota: boolean;
  /** Ao ligar o timer, perguntar se as mensagens sem timer também passam a sumir. */
  readonly perguntarAnteriores: boolean;
  readonly aoEscolher: (segundos: number, anteriores: boolean) => void;
}

export function PainelDoTimer({
  visivel,
  aoFechar,
  titulo,
  descricao,
  valor,
  opcoes,
  maximo,
  nota,
  perguntarAnteriores,
  aoEscolher,
}: PropsDoPainelDoTimer) {
  const estilos = useEstilos();
  const t = useTextos();
  const { height } = useWindowDimensions();
  const [etapa, setEtapa] = useState<'lista' | 'personalizado' | 'anteriores'>('lista');
  const [escolhido, setEscolhido] = useState(0);
  const [numero, setNumero] = useState('');
  const [unidade, setUnidade] = useState<Unidade>('minutos');
  const [invalido, setInvalido] = useState(false);

  // Cada vez que abre, começa pela lista.
  useEffect(() => {
    if (!visivel) return;
    setEtapa('lista');
    setNumero('');
    setInvalido(false);
  }, [visivel]);

  const escolher = (segundos: number) => {
    if (perguntarAnteriores && segundos > 0) {
      setEscolhido(segundos);
      setEtapa('anteriores');
      return;
    }
    aoEscolher(segundos, false);
  };

  const personalizado = !opcoes.includes(valor);
  const aviso = (segundos: number) =>
    avisaTimerCurto(segundos, nota) ? t('timer.soAberta') : undefined;
  const lista = [
    ...opcoes.map((segundos) => ({
      valor: segundos,
      rotulo: rotuloLongo(t, segundos),
      detalhe: aviso(segundos),
    })),
    {
      valor: PERSONALIZADO,
      rotulo: t('timer.personalizado'),
      detalhe: personalizado ? rotuloLongo(t, valor) : undefined,
    },
  ];

  // Um painel só, que troca de conteúdo: ele não sobe de novo a cada etapa.
  let tituloDaEtapa = titulo;
  let descricaoDaEtapa = descricao;
  let conteudo: ReactNode;
  if (etapa === 'anteriores') {
    const tempo = rotuloLongo(t, escolhido);
    tituloDaEtapa = t('timer.anteriores.titulo');
    descricaoDaEtapa = nota
      ? t('timer.anteriores.descricaoDaNota', { tempo })
      : t('timer.anteriores.descricao', { tempo });
    conteudo = (
      <>
        <Botao
          titulo={t('timer.anteriores.soNovas')}
          pequeno
          aoTocar={() => {
            aoEscolher(escolhido, false);
          }}
        />
        <Botao
          titulo={t('timer.anteriores.tambem')}
          variante="perigo"
          pequeno
          aoTocar={() => {
            aoEscolher(escolhido, true);
          }}
        />
      </>
    );
  } else if (etapa === 'personalizado') {
    const lido = lerPersonalizado(numero, unidade, maximo);
    conteudo = (
      <>
        <CampoDeTexto
          valor={numero}
          aoMudar={(novo) => {
            setNumero(novo);
            setInvalido(false);
          }}
          rotulo={t('timer.quantidade')}
          numerico
        />
        <Segmentos
          opcoes={UNIDADES.map((u) => ({ valor: u, rotulo: t(`timer.unidades.${u}`) }))}
          valor={unidade}
          aoEscolher={(nova) => {
            setUnidade(nova);
            setInvalido(false);
          }}
        />
        {invalido && (
          <Text accessibilityLiveRegion="polite" style={estilos.aviso}>
            {t('timer.foraDoLimite', { maximo: rotuloLongo(t, maximo) })}
          </Text>
        )}
        {!invalido && lido !== null && avisaTimerCurto(lido, nota) && (
          <Text style={estilos.aviso}>{t('timer.soAberta')}</Text>
        )}
        <Botao
          titulo={t('timer.usar')}
          pequeno
          desativado={numero.trim() === ''}
          aoTocar={() => {
            if (lido === null) setInvalido(true);
            else escolher(lido);
          }}
        />
      </>
    );
  } else {
    conteudo = (
      <ScrollView style={{ maxHeight: height * 0.55 }}>
        <ListaDeOpcoes
          opcoes={lista}
          valor={personalizado ? PERSONALIZADO : valor}
          aoEscolher={(segundos) => {
            if (segundos === PERSONALIZADO) setEtapa('personalizado');
            else escolher(segundos);
          }}
        />
      </ScrollView>
    );
  }

  return (
    <Painel
      visivel={visivel}
      aoFechar={aoFechar}
      titulo={tituloDaEtapa}
      descricao={descricaoDaEtapa}
    >
      {conteudo}
    </Painel>
  );
}

const useEstilos = criarEstilos((cores) => ({
  aviso: { ...tipos.pequeno, color: cores.secundario },
}));
