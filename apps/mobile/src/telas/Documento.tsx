// A política de privacidade (RF-61) e os termos de uso (RF-62): a data e cada seção com o rótulo e
// os parágrafos. O texto vem dos arquivos de tradução e é o mesmo de docs/PRIVACIDADE.md e de
// docs/TERMOS.md. Abre sem rede: um link levaria ao navegador, fora do Tor.
import { secoesDoDocumento, type Documento as QualDocumento } from '@cifra/i18n';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RotuloDeSecao } from '../componentes/RotuloDeSecao.tsx';
import { Cabecalho } from '../componentes/Topo.tsx';
import { idiomaAtivo, useTextos } from '../i18n.ts';
import { criarEstilos, tipos } from '../tema.ts';

export function Documento({
  documento,
  aoVoltar,
}: {
  readonly documento: QualDocumento;
  readonly aoVoltar: () => void;
}) {
  const t = useTextos();
  const estilos = useEstilos();
  const margens = useSafeAreaInsets();

  return (
    <View style={[estilos.tela, { paddingTop: margens.top }]}>
      <Cabecalho titulo={t(`${documento}.titulo`)} aoVoltar={aoVoltar} />
      <ScrollView
        contentContainerStyle={[estilos.conteudo, { paddingBottom: margens.bottom + 44 }]}
      >
        <Text style={estilos.data}>{t(`${documento}.atualizada`)}</Text>
        {secoesDoDocumento(documento, idiomaAtivo()).map(({ titulo, paragrafos }) => (
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
