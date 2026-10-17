// Rótulo de seção: mono, em maiúsculas, discreto. O da seção do pânico vai na cor de perigo, como
// no design.
import { Text } from 'react-native';
import { criarEstilos, tipos } from '../tema.ts';

export function RotuloDeSecao({
  texto,
  perigo = false,
}: {
  readonly texto: string;
  readonly perigo?: boolean;
}) {
  const estilos = useEstilos();
  return (
    <Text accessibilityRole="header" style={[estilos.rotulo, perigo && estilos.perigo]}>
      {texto}
    </Text>
  );
}

const useEstilos = criarEstilos((cores) => ({
  rotulo: { ...tipos.rotulo, paddingLeft: 4, color: cores.secundario },
  perigo: { color: cores.perigo },
}));
