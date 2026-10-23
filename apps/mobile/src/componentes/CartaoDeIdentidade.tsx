// Cartão da própria identidade (IdentityCard): identicon 6×6 e o ID público em mono. Aparece no
// onboarding e, menor e com a dica "toque para copiar", no topo dos ajustes (RF-45).
import { celulasDoIdenticon, type Celula } from '@cifra/core';
import { Pressable, Text, View } from 'react-native';
import { idNaTela } from '../formato-do-id.ts';
import { criarEstilos, raios, tipos } from '../tema.ts';
import { Identicon } from './Identicon.tsx';

/** Enquanto não há identidade, o cartão mostra o ID vazio e a grade apagada. */
const SEM_ID = '····-····-····-····';
const GRADE_APAGADA: readonly Celula[] = Array.from({ length: 36 }, () => 'vazia');

interface PropsDoCartao {
  readonly id: string | null;
  readonly legenda: string;
  /** O lado do identicon; o do onboarding é 92. */
  readonly tamanho?: number;
  /** Uma linha pequena embaixo do ID, como "toque para copiar". */
  readonly dica?: string | undefined;
  /** Com ela, o cartão inteiro é um botão. */
  readonly aoTocar?: (() => void) | undefined;
}

export function CartaoDeIdentidade({ id, legenda, tamanho = 92, dica, aoTocar }: PropsDoCartao) {
  const estilos = useEstilos();
  const conteudo = (
    <>
      <Identicon
        celulas={id ? celulasDoIdenticon(id, 6) : GRADE_APAGADA}
        grade={6}
        tamanho={tamanho}
      />
      <View style={estilos.textos}>
        <Text style={estilos.legenda}>{legenda}</Text>
        <Text style={estilos.id}>{idNaTela(id ?? SEM_ID)}</Text>
        {dica !== undefined && <Text style={estilos.dica}>{dica}</Text>}
      </View>
    </>
  );
  if (!aoTocar) return <View style={estilos.cartao}>{conteudo}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${legenda}: ${id ?? ''}`}
      accessibilityHint={dica}
      onPress={aoTocar}
      style={({ pressed }) => [estilos.cartao, pressed && estilos.pressionado]}
    >
      {conteudo}
    </Pressable>
  );
}

const useEstilos = criarEstilos((cores) => ({
  cartao: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    padding: 18,
    borderRadius: raios.cartao,
    borderWidth: 1,
    borderColor: cores.linha,
    backgroundColor: cores.superficie,
  },
  pressionado: { transform: [{ scale: 0.98 }] },
  textos: { flex: 1, gap: 6 },
  legenda: { ...tipos.rotulo, color: cores.secundario },
  id: { ...tipos.mono, color: cores.texto },
  dica: { ...tipos.pequeno, color: cores.secundario },
}));
