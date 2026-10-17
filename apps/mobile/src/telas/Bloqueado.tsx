// O app bloqueado: ao abrir, quando a pessoa cancela a biometria ou a senha, e depois de sair da
// frente (RNF-07). O banco está fechado e os dados continuam cifrados até ela desbloquear. Se a
// última tentativa falhou por erro, e não por cancelamento, uma linha avisa para tentar de novo.
import { Text, View } from 'react-native';
import { Botao } from '../componentes/Botao.tsx';
import { Marca } from '../componentes/Marca.tsx';
import { Tela } from '../componentes/Tela.tsx';
import { useTextos } from '../i18n.ts';
import { criarEstilos, tipos } from '../tema.ts';

interface PropsDoBloqueado {
  readonly falhou: boolean;
  readonly aoDesbloquear: () => void;
}

export function Bloqueado({ falhou, aoDesbloquear }: PropsDoBloqueado) {
  const estilos = useEstilos();
  const t = useTextos();
  return (
    <Tela>
      <Marca />
      <View style={estilos.meio}>
        <Text accessibilityRole="header" style={estilos.titulo}>
          {t('bloqueado.titulo')}
        </Text>
        <Text style={estilos.descricao}>{t('bloqueado.descricao')}</Text>
        {falhou && (
          <Text accessibilityLiveRegion="polite" style={estilos.aviso}>
            {t('bloqueado.falhou')}
          </Text>
        )}
      </View>
      <Botao titulo={t('bloqueado.desbloquear')} aoTocar={aoDesbloquear} />
    </Tela>
  );
}

const useEstilos = criarEstilos((cores) => ({
  meio: { flex: 1, justifyContent: 'center', gap: 14, paddingVertical: 24 },
  titulo: { ...tipos.titulo, color: cores.texto },
  descricao: { ...tipos.corpoGrande, color: cores.secundario },
  aviso: { ...tipos.monoPequeno, color: cores.texto },
}));
