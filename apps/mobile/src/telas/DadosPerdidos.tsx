// Quando os dados deste aparelho não abrem mais (RNF-07): o Android apagou a chave porque o
// bloqueio de tela foi removido, ou o banco não abre com ela. A tela explica sem termo técnico e
// leva ao onboarding, onde a identidade volta com as 12 palavras. Nada é apagado aqui: o banco que
// não abre sai quando a identidade nova for guardada.
import { Text, View } from 'react-native';
import { Botao } from '../componentes/Botao.tsx';
import { Marca } from '../componentes/Marca.tsx';
import { Tela } from '../componentes/Tela.tsx';
import { useTextos } from '../i18n.ts';
import { criarEstilos, tipos } from '../tema.ts';

interface PropsDosDadosPerdidos {
  /** `chave`: o aparelho apagou a chave. `arquivo`: o banco não abre com ela. */
  readonly motivo: 'chave' | 'arquivo';
  readonly aoContinuar: () => void;
}

export function DadosPerdidos({ motivo, aoContinuar }: PropsDosDadosPerdidos) {
  const estilos = useEstilos();
  const t = useTextos();
  return (
    <Tela>
      <Marca />
      <View style={estilos.meio}>
        <Text accessibilityRole="header" style={estilos.titulo}>
          {t('perdidos.titulo')}
        </Text>
        <Text style={estilos.descricao}>
          {t(motivo === 'chave' ? 'perdidos.chave' : 'perdidos.arquivo')}
        </Text>
        <Text style={estilos.descricao}>{t('perdidos.palavras')}</Text>
      </View>
      <Botao titulo={t('perdidos.continuar')} aoTocar={aoContinuar} />
    </Tela>
  );
}

const useEstilos = criarEstilos((cores) => ({
  meio: { flex: 1, justifyContent: 'center', gap: 14, paddingVertical: 24 },
  titulo: { ...tipos.titulo, color: cores.texto },
  descricao: { ...tipos.corpoGrande, color: cores.secundario },
}));
