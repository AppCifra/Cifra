// O alto das telas empilhadas: voltar e título (Header do design), e o ponto de status da rede
// (StatusDot), em mono e minúsculas.
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useTextos } from '../i18n.ts';
import { criarEstilos, fontes, useCores } from '../tema.ts';
import { BotaoDeIcone } from './Botoes.tsx';

export function Cabecalho({
  titulo,
  aoVoltar,
  children,
}: {
  readonly titulo?: string;
  readonly aoVoltar: () => void;
  readonly children?: ReactNode;
}) {
  const estilos = useEstilos();
  const t = useTextos();
  return (
    <View style={estilos.cabecalho}>
      <BotaoDeIcone icone="voltar" rotulo={t('conversa.voltar')} aoTocar={aoVoltar} />
      {titulo !== undefined && (
        <Text accessibilityRole="header" style={estilos.titulo}>
          {titulo}
        </Text>
      )}
      {children}
    </View>
  );
}

export function PontoDeStatus({
  ligado,
  rotulo,
}: {
  readonly ligado: boolean;
  readonly rotulo: string;
}) {
  const cores = useCores();
  const estilos = useEstilos();
  const cor = ligado ? cores.acento : cores.secundario;
  return (
    <View accessible accessibilityLiveRegion="polite" style={estilos.status}>
      <View style={estilos.marca}>
        <View style={[estilos.halo, { backgroundColor: cor }]} />
        <View style={[estilos.ponto, { backgroundColor: cor }]} />
      </View>
      <Text style={estilos.rotulo}>{rotulo}</Text>
    </View>
  );
}

const useEstilos = criarEstilos((cores) => ({
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: 12,
  },
  titulo: { flex: 1, fontFamily: fontes.seminegrito, fontSize: 16, color: cores.texto },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  marca: { width: 13, height: 13, alignItems: 'center', justifyContent: 'center' },
  // O halo de 3 px do design, em 22% da cor.
  halo: { position: 'absolute', width: 13, height: 13, borderRadius: 6.5, opacity: 0.22 },
  ponto: { width: 7, height: 7, borderRadius: 3.5 },
  rotulo: { fontFamily: fontes.mono, fontSize: 12, color: cores.secundario },
}));
