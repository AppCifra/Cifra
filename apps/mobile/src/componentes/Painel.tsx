// Painel inferior do design, para escolhas curtas e confirmações. O Cifra não tem modal central.
// Fica por cima da tela, na mesma janela: herda o bloqueio de print dela. O de texto longo rola
// quando, com a fonte do celular grande, passaria do alto da tela.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
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
  /** Texto longo: com a fonte do celular grande, o painel rola em vez de passar do alto da tela. */
  readonly rolavel?: boolean;
}

/** Distância de onde o painel sobe. Só precisa passar da altura dele. */
const DESLOCAMENTO = 480;

export function Painel({
  visivel,
  aoFechar,
  titulo,
  descricao,
  children,
  rolavel = false,
}: PropsDoPainel) {
  const estilos = useEstilos();
  const margens = useSafeAreaInsets();
  const reduzido = useMovimentoReduzido();
  const { height: alturaDaTela } = useWindowDimensions();
  // Painel com campo sobe junto com o teclado.
  const teclado = useAlturaDoTeclado();
  const embaixo = 8 + Math.max(margens.bottom, teclado);
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
  const conteudo = (
    <>
      <Text accessibilityRole="header" style={estilos.titulo}>
        {titulo}
      </Text>
      <Text style={estilos.descricao}>{descricao}</Text>
      <View style={estilos.acoes}>{children}</View>
    </>
  );

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
            bottom: embaixo,
            opacity: reduzido ? abertura : 1,
            transform: [{ translateY: subida }],
          },
          rolavel && { maxHeight: alturaDaTela - embaixo - margens.top - 8 },
        ]}
      >
        <View style={estilos.alca} />
        {rolavel ? (
          <ScrollView style={estilos.rolagem} keyboardShouldPersistTaps="handled">
            {conteudo}
          </ScrollView>
        ) : (
          conteudo
        )}
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
  rolagem: { flexGrow: 0, flexShrink: 1 },
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
