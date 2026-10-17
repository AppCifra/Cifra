// O timer das mensagens temporárias (TimerPill e TimerRing do design): a pílula do cabeçalho da
// conversa, em fósforo quando ligada; a versão discreta, nas linhas da lista e no campo de
// escrever; e o anel que conta o tempo no balão. O anel é feito com Views, sem biblioteca de SVG:
// em cada metade recortada, meio aro gira até o ângulo que falta.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fontes, useCores } from '../tema.ts';
import { Icone } from './Icone.tsx';

interface PropsDaPilula {
  /** "1h", "off". */
  readonly rotulo: string;
  /** Com timer: a pílula fica em fósforo. */
  readonly ativo: boolean;
  /** "Mensagens temporárias: 1 hora", para quem lê a tela. */
  readonly rotuloAcessivel: string;
  readonly aoTocar: () => void;
}

/** A pílula do cabeçalho da conversa, que abre o painel do timer. */
export function PilulaDoTimer({ rotulo, ativo, rotuloAcessivel, aoTocar }: PropsDaPilula) {
  const cores = useCores();
  const cor = ativo ? cores.sobreAcento : cores.secundario;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={rotuloAcessivel}
      // 34 px de altura no design; o toque passa de 44 (RNF-18).
      hitSlop={6}
      onPress={aoTocar}
      style={({ pressed }) => [
        estilos.pilula,
        { backgroundColor: ativo ? cores.acento : cores.superficie },
        pressed && estilos.pressionada,
      ]}
    >
      <Icone nome="timer" tamanho={16} traco={1.9} cor={cor} />
      <Text style={[estilos.textoDaPilula, { color: cor }]}>{rotulo}</Text>
    </Pressable>
  );
}

/** A versão discreta: o ícone e o rótulo em mono, apagados. */
export function TimerDiscreto({
  rotulo,
  cor: corPedida,
}: {
  readonly rotulo: string;
  readonly cor?: string;
}) {
  const cores = useCores();
  const cor = corPedida ?? cores.secundario;
  return (
    <View style={estilos.discreto}>
      <Icone nome="timer" tamanho={12} traco={2} cor={cor} />
      <Text style={[estilos.textoDiscreto, { color: cor }]}>{rotulo}</Text>
    </View>
  );
}

/**
 * O anel do balão: o aro apagado inteiro e, por cima, o arco do tempo que falta, a partir do alto,
 * no sentido do relógio. `fracao` vai de 1 (acabou de sair) a 0 (vai sumir).
 */
export function AnelDoTimer({
  fracao,
  cor,
  tamanho = 11,
}: {
  readonly fracao: number;
  readonly cor: string;
  readonly tamanho?: number;
}) {
  // No design: grade de 12, raio 4,5 e traço 1,6.
  const traco = (1.6 * tamanho) / 12;
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[estilos.anel, { width: tamanho, height: tamanho }]}
    >
      <Aro
        fracao={fracao}
        cor={cor}
        lado={(9 * tamanho) / 12 + traco}
        traco={traco}
        apagado={0.3}
      />
    </View>
  );
}

/**
 * O aro e o arco do que falta (ou do que já foi), a partir do alto, no sentido do relógio. Serve ao
 * anel do timer e ao progresso de uma transferência (TransferButton).
 */
export function Aro({
  fracao,
  cor,
  lado,
  traco,
  apagado,
}: {
  readonly fracao: number;
  readonly cor: string;
  readonly lado: number;
  readonly traco: number;
  /** A opacidade do aro inteiro, por baixo do arco. */
  readonly apagado: number;
}) {
  const meio = lado / 2;
  const angulo = Math.max(0, Math.min(1, fracao)) * 360;
  const aro = { width: lado, height: lado, borderRadius: meio, borderWidth: traco };
  return (
    <View accessible={false} style={{ width: lado, height: lado }}>
      <View style={{ width: lado, height: lado }}>
        <View style={[estilos.solto, aro, { borderColor: cor, opacity: apagado }]} />
        {/* Metade da direita: do alto até o ângulo, no máximo meia volta. */}
        <View style={[estilos.recorte, { left: meio, width: meio, height: lado }]}>
          <View
            style={[
              estilos.solto,
              aro,
              {
                left: -meio,
                borderColor: 'transparent',
                borderTopColor: cor,
                borderRightColor: cor,
                transform: [{ rotate: `${String(Math.min(angulo, 180) - 135)}deg` }],
              },
            ]}
          />
        </View>
        {/* Metade da esquerda: o que passa de meia volta. */}
        {angulo > 180 && (
          <View style={[estilos.recorte, { left: 0, width: meio, height: lado }]}>
            <View
              style={[
                estilos.solto,
                aro,
                {
                  borderColor: 'transparent',
                  borderBottomColor: cor,
                  borderLeftColor: cor,
                  transform: [{ rotate: `${String(angulo - 315)}deg` }],
                },
              ]}
            />
          </View>
        )}
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  pilula: {
    height: 34,
    paddingHorizontal: 11,
    borderRadius: 17,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pressionada: { transform: [{ scale: 0.98 }] },
  textoDaPilula: { fontFamily: fontes.mono, fontSize: 12 },
  discreto: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  textoDiscreto: { fontFamily: fontes.mono, fontSize: 11 },
  anel: { alignItems: 'center', justifyContent: 'center' },
  solto: { position: 'absolute', top: 0, left: 0 },
  recorte: { position: 'absolute', top: 0, overflow: 'hidden' },
});
