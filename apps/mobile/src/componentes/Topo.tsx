// O alto das telas empilhadas: voltar e título (Header do design), e o ponto de status da rede
// (StatusDot), em mono e minúsculas, com o "?" que explica a conexão (RF-64). Sem espaço, o rótulo
// do status quebra a linha em vez de empurrar para fora da tela o que vem ao lado.
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTextos } from '../i18n.ts';
import { criarEstilos, fontes, useCores } from '../tema.ts';
import { BotaoDeIcone } from './Botoes.tsx';
import { Icone } from './Icone.tsx';

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
  ajuda,
}: {
  readonly ligado: boolean;
  readonly rotulo: string;
  /** O "?" ao lado do rótulo, com 44 px de toque (RNF-18). */
  readonly ajuda?: { readonly rotulo: string; readonly aoTocar: () => void };
}) {
  const cores = useCores();
  const estilos = useEstilos();
  const cor = ligado ? cores.acento : cores.secundario;
  const marca = (
    <View style={estilos.marca}>
      <View style={[estilos.halo, { backgroundColor: cor }]} />
      <View style={[estilos.ponto, { backgroundColor: cor }]} />
    </View>
  );
  if (!ajuda) {
    return (
      <View accessible accessibilityLiveRegion="polite" style={estilos.status}>
        {marca}
        <Text style={estilos.rotulo}>{rotulo}</Text>
      </View>
    );
  }
  // Com ajuda, o status inteiro é o botão, e o "?" vai no fim do texto: ao lado dele, não tira
  // largura do rótulo, que continua quebrando só onde quebraria sem o "?".
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${rotulo}. ${ajuda.rotulo}`}
      accessibilityLiveRegion="polite"
      onPress={ajuda.aoTocar}
      style={({ pressed }) => [estilos.status, estilos.comAjuda, pressed && estilos.tocado]}
    >
      {marca}
      <Text style={estilos.rotulo}>
        {`${rotulo} `}
        <View style={estilos.ajuda}>
          <Icone nome="ajuda" tamanho={15} traco={2} cor={cores.secundario} />
        </View>
      </Text>
    </Pressable>
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
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  // O toque do status com ajuda tem 44 px de altura (RNF-18).
  comAjuda: { minHeight: 44, marginLeft: -8, paddingHorizontal: 8, borderRadius: 12 },
  ajuda: { width: 15, height: 15, transform: [{ translateY: 3 }] },
  tocado: { backgroundColor: cores.superficie },
  marca: { width: 13, height: 13, alignItems: 'center', justifyContent: 'center' },
  // O halo de 3 px do design, em 22% da cor.
  halo: { position: 'absolute', width: 13, height: 13, borderRadius: 6.5, opacity: 0.22 },
  ponto: { width: 7, height: 7, borderRadius: 3.5 },
  rotulo: { flexShrink: 1, fontFamily: fontes.mono, fontSize: 12, color: cores.secundario },
}));
