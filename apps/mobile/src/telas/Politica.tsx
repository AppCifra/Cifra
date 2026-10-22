// A política de privacidade (RF-61), pelos ajustes: a data e cada seção com o rótulo e os
// parágrafos. O texto vem dos arquivos de tradução e é o mesmo de docs/PRIVACIDADE.md. Abre sem
// rede: um link levaria ao navegador, fora do Tor.
import { secoesDaPolitica } from '@cifra/i18n';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RotuloDeSecao } from '../componentes/RotuloDeSecao.tsx';
import { Cabecalho } from '../componentes/Topo.tsx';
import { idiomaAtivo, useTextos } from '../i18n.ts';
import { criarEstilos, tipos } from '../tema.ts';

export function Politica({ aoVoltar }: { readonly aoVoltar: () => void }) {
  const t = useTextos();
  const estilos = useEstilos();
  const margens = useSafeAreaInsets();

  return (
    <View style={[estilos.tela, { paddingTop: margens.top }]}>
      <Cabecalho titulo={t('politica.titulo')} aoVoltar={aoVoltar} />
      <ScrollView
        contentContainerStyle={[estilos.conteudo, { paddingBottom: margens.bottom + 44 }]}
      >
        <Text style={estilos.data}>{t('politica.atualizada')}</Text>
        {secoesDaPolitica(idiomaAtivo()).map(({ titulo, paragrafos }) => (
          <View key={titulo} style={estilos.secao}>
            <RotuloDeSecao texto={titulo} />
            {paragrafos.map((paragrafo) => (
              <Text key={paragrafo} style={estilos.paragrafo}>
                {paragrafo}
              </Text>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const useEstilos = criarEstilos((cores) => ({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { gap: 24, paddingHorizontal: 20, paddingTop: 8 },
  data: { ...tipos.monoPequeno, paddingHorizontal: 4, color: cores.secundario },
  secao: { gap: 10 },
  paragrafo: { ...tipos.corpo, paddingHorizontal: 4, color: cores.texto },
}));
