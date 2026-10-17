// Botão de largura total do design. Primário (fósforo) para a ação principal da tela; secundário
// (invertido) para confirmações sérias; fantasma para o resto; perigo só para destruir.
import { Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import { fontes, raios, useCores, type Cores } from '../tema.ts';

export type VarianteDoBotao = 'primario' | 'secundario' | 'fantasma' | 'perigo';

interface PropsDoBotao {
  readonly titulo: string;
  readonly aoTocar: () => void;
  readonly variante?: VarianteDoBotao;
  readonly pequeno?: boolean;
  readonly desativado?: boolean;
}

function variantes(
  cores: Cores,
): Readonly<Record<VarianteDoBotao, { caixa: ViewStyle; texto: string }>> {
  return {
    primario: {
      caixa: { backgroundColor: cores.acento, borderColor: cores.acento },
      texto: cores.sobreAcento,
    },
    secundario: {
      caixa: { backgroundColor: cores.texto, borderColor: cores.texto },
      texto: cores.fundo,
    },
    fantasma: {
      caixa: { backgroundColor: 'transparent', borderColor: cores.linha },
      texto: cores.texto,
    },
    perigo: {
      caixa: { backgroundColor: 'transparent', borderColor: cores.perigo },
      texto: cores.perigo,
    },
  };
}

export function Botao({
  titulo,
  aoTocar,
  variante = 'primario',
  pequeno = false,
  desativado = false,
}: PropsDoBotao) {
  const { caixa, texto } = variantes(useCores())[variante];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: desativado }}
      disabled={desativado}
      onPress={aoTocar}
      style={({ pressed }) => [
        estilos.base,
        pequeno ? estilos.pequeno : estilos.medio,
        caixa,
        desativado && estilos.desativado,
        pressed && !desativado && estilos.pressionado,
      ]}
    >
      <Text style={[pequeno ? estilos.textoPequeno : estilos.texto, { color: texto }]}>
        {titulo}
      </Text>
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  base: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    borderWidth: 1,
  },
  medio: { height: 56, borderRadius: raios.botao },
  pequeno: { height: 50, borderRadius: raios.campo },
  desativado: { opacity: 0.4 },
  pressionado: { transform: [{ scale: 0.98 }] },
  texto: { fontFamily: fontes.seminegrito, fontSize: 16 },
  textoPequeno: { fontFamily: fontes.seminegrito, fontSize: 15.5 },
});
