// Peças da tela de segurança e dos ajustes (components/identity e settings do design): a situação
// da verificação, o número de segurança, o grupo de linhas, a linha com valor e a linha com
// interruptor.
import { Children, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { criarEstilos, fontes, tipos, useCores } from '../tema.ts';
import { Interruptor } from './Anexos.tsx';

/** VerifyStatus: a pílula "verificado" em fósforo, ou "não verificado" apagada. */
export function SituacaoDaVerificacao({
  verificado,
  rotulo,
}: {
  readonly verificado: boolean;
  readonly rotulo: string;
}) {
  const cores = useCores();
  const estilos = useEstilos();
  const cor = verificado ? cores.sobreAcento : cores.secundario;
  return (
    <View
      style={[estilos.situacao, { backgroundColor: verificado ? cores.acento : cores.superficie }]}
    >
      <View style={[estilos.bolinha, { backgroundColor: cor }]} />
      <Text style={[estilos.textoDaSituacao, { color: cor }]}>{rotulo}</Text>
    </View>
  );
}

/** SafetyNumber: 12 grupos de 5 dígitos em 4 colunas, com a explicação embaixo. */
export function NumeroDeSeguranca({
  rotulo,
  grupos,
  explicacao,
}: {
  readonly rotulo: string;
  readonly grupos: readonly string[];
  readonly explicacao: string;
}) {
  const estilos = useEstilos();
  const linhas = [0, 4, 8].map((inicio) => grupos.slice(inicio, inicio + 4));
  return (
    <View style={estilos.numero}>
      <Text style={estilos.rotulo}>{rotulo}</Text>
      {/* Lido como um número só, grupo a grupo, na ordem. */}
      <View accessible accessibilityLabel={grupos.join(' ')} style={estilos.grade}>
        {linhas.map((linha, i) => (
          <View key={i} style={estilos.linhaDoNumero}>
            {linha.map((grupo, j) => (
              <Text key={j} style={estilos.grupo}>
                {grupo}
              </Text>
            ))}
          </View>
        ))}
      </View>
      <Text style={estilos.explicacao}>{explicacao}</Text>
    </View>
  );
}

/** SettingsGroup: linhas numa superfície, separadas por uma linha fina. */
export function GrupoDeLinhas({ children }: { readonly children: ReactNode }) {
  const estilos = useEstilos();
  return (
    <View style={estilos.grupoDeLinhas}>
      {Children.toArray(children).map((filho, i) => (
        <View key={i} style={i > 0 && estilos.separada}>
          {filho}
        </View>
      ))}
    </View>
  );
}

/** ValueRow: rótulo à esquerda e, se houver, o valor em mono com "›". */
export function LinhaDeValor({
  rotulo,
  valor,
  perigo = false,
  aoTocar,
}: {
  readonly rotulo: string;
  readonly valor?: string;
  readonly perigo?: boolean;
  readonly aoTocar: () => void;
}) {
  const cores = useCores();
  const estilos = useEstilos();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={aoTocar}
      style={({ pressed }) => [estilos.linhaDeValor, pressed && estilos.tocada]}
    >
      <Text style={[estilos.textoDaLinha, perigo && { color: cores.perigo }]}>{rotulo}</Text>
      {valor !== undefined && (
        <Text numberOfLines={1} style={estilos.valor}>
          {valor} ›
        </Text>
      )}
    </Pressable>
  );
}

/**
 * ToggleRow: o rótulo, a descrição com a consequência de ligar e o interruptor. A linha inteira
 * liga e desliga.
 */
export function LinhaComInterruptor({
  rotulo,
  descricao,
  ligado,
  aoMudar,
}: {
  readonly rotulo: string;
  readonly descricao: string;
  readonly ligado: boolean;
  readonly aoMudar: (ligado: boolean) => void;
}) {
  const estilos = useEstilos();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: ligado }}
      accessibilityHint={descricao}
      onPress={() => {
        aoMudar(!ligado);
      }}
      style={({ pressed }) => [estilos.linhaComInterruptor, pressed && estilos.tocada]}
    >
      <View style={estilos.textosDaLinha}>
        <Text style={estilos.textoDaLinha}>{rotulo}</Text>
        <Text style={estilos.descricaoDaLinha}>{descricao}</Text>
      </View>
      <Interruptor ligado={ligado} />
    </Pressable>
  );
}

const useEstilos = criarEstilos((cores) => ({
  situacao: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 28,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  bolinha: { width: 6, height: 6, borderRadius: 3 },
  textoDaSituacao: { fontFamily: fontes.mono, fontSize: 11.5 },
  numero: { gap: 12, padding: 18, borderRadius: 20, backgroundColor: cores.superficie },
  rotulo: { ...tipos.rotulo, color: cores.secundario },
  grade: { gap: 10 },
  linhaDoNumero: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  grupo: { fontFamily: fontes.mono, fontSize: 17, letterSpacing: 0.68, color: cores.texto },
  explicacao: {
    fontFamily: fontes.regular,
    fontSize: 13.5,
    lineHeight: 19.6,
    color: cores.secundario,
  },
  grupoDeLinhas: { borderRadius: 20, overflow: 'hidden', backgroundColor: cores.superficie },
  separada: { borderTopWidth: 1, borderTopColor: cores.linha },
  linhaDeValor: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 15,
    paddingHorizontal: 18,
  },
  tocada: { backgroundColor: cores.superficie2 },
  textoDaLinha: { fontFamily: fontes.regular, fontSize: 15, color: cores.texto },
  valor: { flexShrink: 1, fontFamily: fontes.mono, fontSize: 13, color: cores.secundario },
  linhaComInterruptor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingLeft: 18,
    paddingRight: 16,
  },
  textosDaLinha: { flex: 1, minWidth: 0, gap: 3 },
  descricaoDaLinha: {
    fontFamily: fontes.regular,
    fontSize: 12.5,
    lineHeight: 16.9,
    color: cores.secundario,
  },
}));
