// Escolhas do design (components/forms): a lista de opções com rádio (RadioList), usada nos
// painéis, e o controle segmentado (SegmentedControl).
import { useEffect, useRef } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { criarEstilos, fontes, useCores } from '../tema.ts';
import { useMovimentoReduzido } from './movimento.ts';

export interface Opcao<T> {
  readonly valor: T;
  readonly rotulo: string;
  /** Uma linha a mais, menor, embaixo do rótulo: um aviso ou o valor escolhido. */
  readonly detalhe?: string | undefined;
}

/** Radio: o aro fica em fósforo, e o ponto entra com uma mola leve. */
function Radio({ marcada }: { readonly marcada: boolean }) {
  const cores = useCores();
  const estilos = useEstilos();
  const reduzido = useMovimentoReduzido();
  const escala = useRef(new Animated.Value(marcada ? 1 : 0)).current;
  useEffect(() => {
    const animacao = reduzido
      ? Animated.timing(escala, { toValue: marcada ? 1 : 0, duration: 0, useNativeDriver: true })
      : Animated.spring(escala, { toValue: marcada ? 1 : 0, bounciness: 8, useNativeDriver: true });
    animacao.start();
    return () => {
      animacao.stop();
    };
  }, [marcada, reduzido, escala]);
  return (
    <View style={[estilos.radio, { borderColor: marcada ? cores.acento : cores.linha }]}>
      <Animated.View style={[estilos.ponto, { transform: [{ scale: escala }] }]} />
    </View>
  );
}

export function ListaDeOpcoes<T>({
  opcoes,
  valor,
  aoEscolher,
}: {
  readonly opcoes: readonly Opcao<T>[];
  readonly valor: T;
  readonly aoEscolher: (valor: T) => void;
}) {
  const estilos = useEstilos();
  return (
    <View accessibilityRole="radiogroup">
      {opcoes.map((opcao, i) => {
        const marcada = opcao.valor === valor;
        return (
          <Pressable
            key={i}
            accessibilityRole="radio"
            accessibilityState={{ checked: marcada }}
            onPress={() => {
              aoEscolher(opcao.valor);
            }}
            style={({ pressed }) => [estilos.opcao, pressed && estilos.tocada]}
          >
            <View style={estilos.textos}>
              <Text style={estilos.rotulo}>{opcao.rotulo}</Text>
              {opcao.detalhe !== undefined && <Text style={estilos.detalhe}>{opcao.detalhe}</Text>}
            </View>
            <Radio marcada={marcada} />
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Opções lado a lado, uma escolhida. Dentro de um painel, sobre o fundo da tela; com `naTela`,
 * como a Aparência dos ajustes: sobre a superfície, e a escolhida da cor do fundo.
 */
export function Segmentos<T>({
  opcoes,
  valor,
  aoEscolher,
  naTela = false,
}: {
  readonly opcoes: readonly Opcao<T>[];
  readonly valor: T;
  readonly aoEscolher: (valor: T) => void;
  readonly naTela?: boolean;
}) {
  const estilos = useEstilos();
  return (
    <View
      accessibilityRole="radiogroup"
      style={[estilos.segmentos, naTela && estilos.segmentosNaTela]}
    >
      {opcoes.map((opcao, i) => {
        const escolhido = opcao.valor === valor;
        return (
          <Pressable
            key={i}
            accessibilityRole="radio"
            accessibilityState={{ checked: escolhido }}
            onPress={() => {
              aoEscolher(opcao.valor);
            }}
            style={[
              estilos.segmento,
              escolhido && (naTela ? estilos.escolhidoNaTela : estilos.segmentoEscolhido),
            ]}
          >
            <Text
              numberOfLines={1}
              style={[estilos.textoDoSegmento, escolhido && estilos.textoEscolhido]}
            >
              {opcao.rotulo}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useEstilos = criarEstilos((cores) => ({
  opcao: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: cores.linha,
  },
  tocada: { backgroundColor: cores.superficie2 },
  textos: { flex: 1, gap: 2 },
  rotulo: { fontFamily: fontes.regular, fontSize: 15.5, color: cores.texto },
  detalhe: { fontFamily: fontes.regular, fontSize: 12.5, lineHeight: 17, color: cores.secundario },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ponto: { width: 12, height: 12, borderRadius: 6, backgroundColor: cores.acento },
  segmentos: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: cores.linha,
    backgroundColor: cores.fundo,
  },
  segmento: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentosNaTela: { borderWidth: 0, backgroundColor: cores.superficie },
  segmentoEscolhido: { backgroundColor: cores.superficie2 },
  escolhidoNaTela: { backgroundColor: cores.fundo },
  textoDoSegmento: { fontFamily: fontes.media, fontSize: 14, color: cores.secundario },
  textoEscolhido: { color: cores.texto },
}));
