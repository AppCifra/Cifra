// Painel inferior do design, para escolhas curtas e confirmações. O Cifra não tem modal central.
// Fica por cima da tela, na mesma janela: herda o bloqueio de print dela.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { criarEstilos, movimento, raios, tipos } from '../tema.ts';
import { useMovimentoReduzido } from './movimento.ts';
import { useAlturaDoTeclado } from './teclado.ts';

interface PropsDoPainel {
  readonly visivel: boolean;
  readonly aoFechar: () => void;
  readonly titulo: string;
  readonly descricao: string;
  readonly children: ReactNode;
}

/** Distância de onde o painel sobe. Só precisa passar da altura dele. */
const DESLOCAMENTO = 480;

export function Painel({ visivel, aoFechar, titulo, descricao, children }: PropsDoPainel) {
  const estilos = useEstilos();
  const margens = useSafeAreaInsets();
  const reduzido = useMovimentoReduzido();
  // Painel com campo sobe junto com o teclado.
  const teclado = useAlturaDoTeclado();
  const abertura = useRef(new Animated.Value(0)).current;
  const [montado, setMontado] = useState(visivel);

  useEffect(() => {
    if (visivel) setMontado(true);
    const animacao = Animated.timing(abertura, {
      toValue: visivel ? 1 : 0,
      duration: reduzido ? movimento.reduzido : movimento.painel,
      easing: movimento.curva,
      useNativeDriver: true,
    });
    animacao.start(({ finished }) => {
      if (finished && !visivel) setMontado(false);
    });
    return () => {
      animacao.stop();
    };
  }, [visivel, reduzido, abertura]);

  useEffect(() => {
    if (!visivel) return;
    const assinatura = BackHandler.addEventListener('hardwareBackPress', () => {
      aoFechar();
      return true;
    });
    return () => {
      assinatura.remove();
    };
  }, [visivel, aoFechar]);

  if (!montado) return null;

  const subida = abertura.interpolate({
    inputRange: [0, 1],
    outputRange: [reduzido ? 0 : DESLOCAMENTO, 0],
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visivel ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: abertura }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={titulo}
          onPress={aoFechar}
          style={[StyleSheet.absoluteFill, estilos.veu]}
        />
      </Animated.View>
      <Animated.View
        accessibilityViewIsModal
        style={[
          estilos.painel,
          {
            bottom: 8 + Math.max(margens.bottom, teclado),
            opacity: reduzido ? abertura : 1,
            transform: [{ translateY: subida }],
          },
        ]}
      >
        <View style={estilos.alca} />
        <Text accessibilityRole="header" style={estilos.titulo}>
          {titulo}
        </Text>
        <Text style={estilos.descricao}>{descricao}</Text>
        <View style={estilos.acoes}>{children}</View>
      </Animated.View>
    </View>
  );
}

const useEstilos = criarEstilos((cores) => ({
  veu: { backgroundColor: cores.veu },
  painel: {
    position: 'absolute',
    left: 8,
    right: 8,
    paddingTop: 10,
    paddingHorizontal: 20,
    paddingBottom: 26,
    borderRadius: raios.painel,
    borderWidth: 1,
    borderColor: cores.linha,
    backgroundColor: cores.superficie,
  },
  alca: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 18,
    backgroundColor: cores.linha,
  },
  titulo: { ...tipos.painel, color: cores.texto, marginBottom: 6 },
  descricao: {
    ...tipos.corpo,
    fontSize: 14,
    lineHeight: 19.6,
    color: cores.secundario,
    marginBottom: 16,
  },
  acoes: { gap: 10 },
}));
