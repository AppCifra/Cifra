// Identicon: a grade espelhada que substitui foto e iniciais. É só um desenho do ID, então fica
// fora da leitura de tela; quem lê a tela ouve o ID.
import type { Celula, Grade } from '@cifra/core';
import { StyleSheet, View } from 'react-native';
import { useCores, type Cores } from '../tema.ts';

interface PropsDoIdenticon {
  readonly celulas: readonly Celula[];
  readonly grade: Grade;
  readonly tamanho: number;
}

/** No claro, as células cheias ficam escuras sobre o papel, como no design. */
const corDas = (cores: Cores): Readonly<Record<Celula, string>> => ({
  vazia: cores.superficie2,
  cheia: cores.texto,
  acento: cores.acento,
});

export function Identicon({ celulas, grade, tamanho }: PropsDoIdenticon) {
  const cor = corDas(useCores());
  const espaco = Math.max(1.5, tamanho / (grade * 6.5));
  const lado = (tamanho - espaco * (grade - 1)) / grade;
  const raio = Math.max(1, tamanho / 28);
  const linhas = Array.from({ length: grade }, (_, y) => celulas.slice(y * grade, (y + 1) * grade));
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[estilos.grade, { width: tamanho, height: tamanho, gap: espaco }]}
    >
      {linhas.map((linha, y) => (
        <View key={y} style={[estilos.linha, { gap: espaco }]}>
          {linha.map((celula, x) => (
            <View
              key={x}
              style={{
                width: lado,
                height: lado,
                borderRadius: raio,
                backgroundColor: cor[celula],
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const estilos = StyleSheet.create({
  grade: { flexShrink: 0 },
  linha: { flexDirection: 'row' },
});
