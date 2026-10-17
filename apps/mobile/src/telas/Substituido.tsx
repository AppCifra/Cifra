// Quando a identidade é restaurada em outro celular (RF-05): este não envia nem recebe mais. A tela
// explica sem termo técnico e leva ao onboarding. Nada é apagado aqui: os dados deste celular saem
// quando uma identidade nova for guardada.
import { Text, View } from 'react-native';
import { Botao } from '../componentes/Botao.tsx';
import { Marca } from '../componentes/Marca.tsx';
import { Tela } from '../componentes/Tela.tsx';
import { useTextos } from '../i18n.ts';
import { criarEstilos, tipos } from '../tema.ts';

export function Substituido({ aoContinuar }: { readonly aoContinuar: () => void }) {
  const estilos = useEstilos();
  const t = useTextos();
  return (
    <Tela>
      <Marca />
      <View style={estilos.meio}>
        <Text accessibilityRole="header" style={estilos.titulo}>
          {t('substituido.titulo')}
        </Text>
        <Text style={estilos.descricao}>{t('substituido.descricao')}</Text>
        <Text style={estilos.descricao}>{t('substituido.seNaoFoi')}</Text>
      </View>
      <Botao titulo={t('substituido.continuar')} aoTocar={aoContinuar} />
    </Tela>
  );
}

const useEstilos = criarEstilos((cores) => ({
  meio: { flex: 1, justifyContent: 'center', gap: 14, paddingVertical: 24 },
  titulo: { ...tipos.titulo, color: cores.texto },
  descricao: { ...tipos.corpoGrande, color: cores.secundario },
}));
