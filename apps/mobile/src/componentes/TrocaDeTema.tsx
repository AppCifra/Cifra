// A troca de tema esmaece o fundo, como o design manda (500 ms; com movimento reduzido, 200 ms):
// um véu da cor do fundo anterior cobre a tela na hora da troca e some devagar, revelando as cores
// novas. Ele não pega toque nem leitura de tela.
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { coresDo, movimento, useTema } from '../tema.ts';
import { useMovimentoReduzido } from './movimento.ts';

export function TrocaDeTema() {
  const tema = useTema();
  const reduzido = useMovimentoReduzido();
  const anterior = useRef(tema);
  const opacidade = useRef(new Animated.Value(0)).current;
  const [veu, setVeu] = useState<string | null>(null);

  useEffect(() => {
    if (anterior.current === tema) return;
    setVeu(coresDo(anterior.current).fundo);
    anterior.current = tema;
    opacidade.setValue(1);
    const animacao = Animated.timing(opacidade, {
      toValue: 0,
      duration: reduzido ? movimento.reduzido : movimento.tela,
      easing: movimento.curva,
      useNativeDriver: true,
    });
    animacao.start(({ finished }) => {
      if (finished) setVeu(null);
    });
    return () => {
      animacao.stop();
    };
  }, [tema, reduzido, opacidade]);

  if (!veu) return null;
  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { backgroundColor: veu, opacity: opacidade }]}
    />
  );
}
