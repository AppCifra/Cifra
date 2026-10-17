// Tela inteira: desvia das barras do sistema, rola quando falta altura e entra com o movimento
// do design (500 ms, ou um esmaecer curto com movimento reduzido). O que vai por cima, como um
// painel, entra em `sobre`.
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { criarEstilos, MARGEM_DO_ONBOARDING, movimento } from '../tema.ts';
import { useMovimentoReduzido } from './movimento.ts';

/** Folga entre as barras do sistema e o conteúdo, como no onboarding do design. */
const FOLGA = 16;

interface PropsDaTela {
  readonly children: ReactNode;
  readonly sobre?: ReactNode;
}

export function Tela({ children, sobre }: PropsDaTela) {
  const estilos = useEstilos();
  const margens = useSafeAreaInsets();
  const reduzido = useMovimentoReduzido();
  const entrada = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(entrada, {
      toValue: 1,
      duration: reduzido ? movimento.reduzido : movimento.tela,
      easing: movimento.curva,
      useNativeDriver: true,
    }).start();
  }, [entrada, reduzido]);

  const deslize = entrada.interpolate({ inputRange: [0, 1], outputRange: [reduzido ? 0 : 24, 0] });

  return (
    <Animated.View style={[estilos.tela, { opacity: entrada }]}>
      <Animated.View style={[estilos.tela, { transform: [{ translateX: deslize }] }]}>
        <ScrollView
          style={estilos.tela}
          contentContainerStyle={[
            estilos.conteudo,
            { paddingTop: margens.top + FOLGA, paddingBottom: margens.bottom + FOLGA },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </Animated.View>
      {sobre}
    </Animated.View>
  );
}

const useEstilos = criarEstilos((cores) => ({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { flexGrow: 1, paddingHorizontal: MARGEM_DO_ONBOARDING },
}));
