// A pilha de telas com o movimento do design: a tela nova entra da direita (500 ms) e a de baixo
// recua 26%; ao voltar, a de baixo volta ao lugar. Com movimento reduzido, só esmaece. A tela
// coberta fica montada (a lista guarda a busca e a rolagem), mas fora do toque e da leitura.
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, StyleSheet, useWindowDimensions } from 'react-native';
import { criarEstilos, movimento } from '../tema.ts';
import { useMovimentoReduzido } from './movimento.ts';

export interface TelaNaPilha {
  readonly chave: string;
  readonly conteudo: ReactNode;
}

export function Pilha({ telas }: { readonly telas: readonly TelaNaPilha[] }) {
  return (
    <>
      {telas.map((tela, i) => (
        <Camada key={tela.chave} topo={i === telas.length - 1} primeira={i === 0}>
          {tela.conteudo}
        </Camada>
      ))}
    </>
  );
}

function Camada({
  topo,
  primeira,
  children,
}: {
  readonly topo: boolean;
  readonly primeira: boolean;
  readonly children: ReactNode;
}) {
  const estilos = useEstilos();
  const { width: largura } = useWindowDimensions();
  const reduzido = useMovimentoReduzido();
  // 1: fora, à direita; 0: na tela; -1: coberta pela de cima.
  const posicao = useRef(new Animated.Value(primeira ? 0 : 1)).current;

  useEffect(() => {
    const animacao = Animated.timing(posicao, {
      toValue: topo ? 0 : -1,
      duration: reduzido ? movimento.reduzido : movimento.tela,
      easing: movimento.curva,
      useNativeDriver: true,
    });
    animacao.start();
    return () => {
      animacao.stop();
    };
  }, [topo, reduzido, posicao]);

  const translateX = posicao.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: reduzido ? [0, 0, 0] : [-0.26 * largura, 0, 1.02 * largura],
  });
  const opacity = reduzido
    ? posicao.interpolate({ inputRange: [-1, 0, 1], outputRange: [0, 1, 0] })
    : 1;

  return (
    <Animated.View
      pointerEvents={topo ? 'auto' : 'none'}
      importantForAccessibility={topo ? 'auto' : 'no-hide-descendants'}
      style={[StyleSheet.absoluteFill, estilos.camada, { opacity, transform: [{ translateX }] }]}
    >
      {children}
    </Animated.View>
  );
}

const useEstilos = criarEstilos((cores) => ({
  camada: { backgroundColor: cores.fundo },
}));
