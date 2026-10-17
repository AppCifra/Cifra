// Recado curto do design (Toast): em mono e minúsculas, invertido (texto da cor do fundo sobre a
// cor do texto), perto do pé da tela. Com uma ação ao lado, como o "desfazer" do apagar só neste
// celular.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Text } from 'react-native';
import { criarEstilos, fontes, movimento } from '../tema.ts';
import { useMovimentoReduzido } from './movimento.ts';

/** Quanto tempo um recado simples fica na tela. */
export const DURACAO_DO_RECADO = 2500;

/** O recado simples de uma tela: mostrar troca o texto e recomeça a contagem. */
export function useRecado(): readonly [string | null, (texto: string) => void] {
  const [texto, setTexto] = useState<string | null>(null);
  const [vez, setVez] = useState(0);
  useEffect(() => {
    if (texto === null) return;
    const timer = setTimeout(() => {
      setTexto(null);
    }, DURACAO_DO_RECADO);
    return () => {
      clearTimeout(timer);
    };
  }, [texto, vez]);
  const mostrar = useCallback((novo: string) => {
    setTexto(novo);
    setVez((v) => v + 1);
  }, []);
  return [texto, mostrar];
}

interface PropsDoRecado {
  readonly visivel: boolean;
  readonly texto: string;
  /** Distância do pé da tela. */
  readonly embaixo: number;
  readonly acao?: { readonly rotulo: string; readonly aoTocar: () => void } | undefined;
}

export function Recado({ visivel, texto, embaixo, acao }: PropsDoRecado) {
  const estilos = useEstilos();
  const reduzido = useMovimentoReduzido();
  const entrada = useRef(new Animated.Value(0)).current;
  const [montado, setMontado] = useState(visivel);

  useEffect(() => {
    if (visivel) setMontado(true);
    const animacao = Animated.timing(entrada, {
      toValue: visivel ? 1 : 0,
      duration: reduzido ? movimento.reduzido : 300,
      easing: movimento.curva,
      useNativeDriver: true,
    });
    animacao.start(({ finished }) => {
      if (finished && !visivel) setMontado(false);
    });
    return () => {
      animacao.stop();
    };
  }, [visivel, reduzido, entrada]);

  if (!montado) return null;
  const subida = entrada.interpolate({ inputRange: [0, 1], outputRange: [reduzido ? 0 : 10, 0] });
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      pointerEvents={visivel ? 'box-none' : 'none'}
      style={[
        estilos.recado,
        { bottom: embaixo, opacity: entrada, transform: [{ translateY: subida }] },
      ]}
    >
      <Text style={estilos.texto}>{texto}</Text>
      {acao && (
        <>
          <Text style={estilos.texto}> · </Text>
          <Pressable accessibilityRole="button" hitSlop={14} onPress={acao.aoTocar}>
            <Text style={[estilos.texto, estilos.acao]}>{acao.rotulo}</Text>
          </Pressable>
        </>
      )}
    </Animated.View>
  );
}

const useEstilos = criarEstilos((cores) => ({
  recado: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: cores.texto,
  },
  texto: { fontFamily: fontes.mono, fontSize: 12.5, color: cores.fundo },
  acao: { textDecorationLine: 'underline' },
}));
