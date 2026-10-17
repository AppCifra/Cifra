// Botões de ícone do design (IconButton e Fab). O de ícone tem 44 px de toque (RNF-18), mesmo
// quando o desenho é menor; o flutuante é o "+" da lista, em fósforo.
import { Pressable } from 'react-native';
import { criarEstilos, useCores } from '../tema.ts';
import { Icone, type NomeDoIcone } from './Icone.tsx';

interface PropsDoBotaoDeIcone {
  readonly icone: NomeDoIcone;
  readonly rotulo: string;
  readonly aoTocar: () => void;
  readonly tamanhoDoIcone?: number;
}

export function BotaoDeIcone({ icone, rotulo, aoTocar, tamanhoDoIcone = 22 }: PropsDoBotaoDeIcone) {
  const estilos = useEstilos();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={rotulo}
      onPress={aoTocar}
      style={({ pressed }) => [estilos.deIcone, pressed && estilos.tocado]}
    >
      <Icone nome={icone} tamanho={tamanhoDoIcone} traco={1.9} />
    </Pressable>
  );
}

interface PropsDoFlutuante {
  readonly rotulo: string;
  readonly aoTocar: () => void;
  readonly embaixo: number;
}

export function BotaoFlutuante({ rotulo, aoTocar, embaixo }: PropsDoFlutuante) {
  const cores = useCores();
  const estilos = useEstilos();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={rotulo}
      onPress={aoTocar}
      style={({ pressed }) => [
        estilos.flutuante,
        { bottom: embaixo },
        pressed && { transform: [{ scale: 0.94 }] },
      ]}
    >
      <Icone nome="mais" tamanho={24} traco={2} cor={cores.sobreAcento} />
    </Pressable>
  );
}

const useEstilos = criarEstilos((cores) => ({
  deIcone: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tocado: { backgroundColor: cores.superficie },
  flutuante: {
    position: 'absolute',
    right: 22,
    width: 58,
    height: 58,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cores.acento,
    elevation: 6,
  },
}));
