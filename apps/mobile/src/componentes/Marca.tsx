// A marca do Cifra: um quadradinho fósforo e "cifra" em mono, minúsculo. Não há logo.
import { Text, View } from 'react-native';
import { useTextos } from '../i18n.ts';
import { criarEstilos, fontes } from '../tema.ts';

export function Marca() {
  const estilos = useEstilos();
  const t = useTextos();
  return (
    <View style={estilos.marca}>
      <View style={estilos.quadrado} />
      <Text style={estilos.nome}>{t('app.nome')}</Text>
    </View>
  );
}

const useEstilos = criarEstilos((cores) => ({
  marca: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  quadrado: { width: 10, height: 10, borderRadius: 2, backgroundColor: cores.acento },
  nome: { fontFamily: fontes.mono, fontSize: 14, color: cores.texto },
}));
