// O HoldToConfirm do design: a ação que destrói tudo só acontece depois de segurar, no lugar de um
// painel de confirmação (o pânico, RF-48). Borda e texto na cor de perigo; segurando, o fundo enche
// da esquerda para a direita em 1,6 s, e o texto fica branco quando passa de 45%. Soltar antes volta
// ao começo. Com movimento reduzido, o enchimento continua: é ele que mostra quanto falta.
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, Text } from 'react-native';
import { criarEstilos, fontes, raios } from '../tema.ts';

/** Quanto tempo segurar, como no design. */
export const DURACAO_DO_SEGURAR = 1600;

/** O texto fica branco sobre o enchimento a partir daqui, como no design. */
const VIRADA = 0.45;

/** O texto sobre o enchimento: branco nos dois temas, como no design. */
const BRANCO = '#FFFFFF';

interface PropsDoSegurar {
  readonly rotulo: string;
  /** O texto enquanto a pessoa segura. */
  readonly segurando: string;
  readonly aoConfirmar: () => void;
}

export function SegurarParaApagar({ rotulo, segurando, aoConfirmar }: PropsDoSegurar) {
  const estilos = useEstilos();
  const progresso = useRef(new Animated.Value(0)).current;
  const animacao = useRef<Animated.CompositeAnimation | null>(null);
  const [comecou, setComecou] = useState(false);
  const [virou, setVirou] = useState(false);

  useEffect(() => {
    const ouvinte = progresso.addListener(({ value }) => {
      setVirou(value > VIRADA);
    });
    return () => {
      progresso.removeListener(ouvinte);
      animacao.current?.stop();
    };
  }, [progresso]);

  const comecar = () => {
    animacao.current?.stop();
    progresso.setValue(0);
    setComecou(true);
    const atual = Animated.timing(progresso, {
      toValue: 1,
      duration: DURACAO_DO_SEGURAR,
      easing: Easing.linear,
      // A largura não anda no driver nativo.
      useNativeDriver: false,
    });
    animacao.current = atual;
    atual.start(({ finished }) => {
      if (finished && animacao.current === atual) aoConfirmar();
    });
  };

  const soltar = () => {
    const atual = animacao.current;
    animacao.current = null;
    atual?.stop();
    progresso.setValue(0);
    setComecou(false);
  };

  const largura = progresso.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={rotulo}
      onPressIn={comecar}
      onPressOut={soltar}
      style={estilos.botao}
    >
      <Animated.View style={[estilos.enchimento, { width: largura }]} />
      <Text style={[estilos.texto, virou && estilos.textoVirado]}>
        {comecou ? segurando : rotulo}
      </Text>
    </Pressable>
  );
}

const useEstilos = criarEstilos((cores) => ({
  botao: {
    alignSelf: 'stretch',
    height: 56,
    borderRadius: raios.botao,
    borderWidth: 1,
    borderColor: cores.perigo,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  enchimento: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: cores.perigo,
  },
  texto: { fontFamily: fontes.seminegrito, fontSize: 15.5, color: cores.perigo },
  textoVirado: { color: BRANCO },
}));
