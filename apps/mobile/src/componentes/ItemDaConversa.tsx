// Uma linha da lista de conversas (ChatListItem do design, RF-11): identicon, nome, selo de
// verificado, horário, prévia, timer e não lidas. A etiqueta (Badge) também conta os pedidos de
// conversa.
import { celulasDoIdenticon } from '@cifra/core';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { criarEstilos, fontes } from '../tema.ts';
import { SeloDeVerificado } from './Icone.tsx';
import { Identicon } from './Identicon.tsx';
import { TimerDiscreto } from './Timer.tsx';

/** O identicon 5×5 na moldura de raio 15, como nas linhas e no cabeçalho da conversa. */
export function IdenticonNaMoldura({
  id,
  tamanho,
  moldura,
}: {
  readonly id: string;
  readonly tamanho: number;
  readonly moldura: number;
}) {
  const estilos = useEstilos();
  return (
    <View
      style={[
        estilos.moldura,
        { width: moldura, height: moldura, borderRadius: Math.round(moldura * 0.31) },
      ]}
    >
      <Identicon celulas={celulasDoIdenticon(id, 5)} grade={5} tamanho={tamanho} />
    </View>
  );
}

export function Etiqueta({ children }: { readonly children: ReactNode }) {
  const estilos = useEstilos();
  return (
    <View style={estilos.etiqueta}>
      <Text style={estilos.textoDaEtiqueta}>{children}</Text>
    </View>
  );
}

interface PropsDoItem {
  readonly id: string;
  readonly nome: string;
  readonly verificado: boolean;
  readonly horario: string;
  readonly previa: string;
  readonly naoLidas: number;
  /** O timer da conversa, discreto ("1h"); sem timer, nada. */
  readonly timer?: string | undefined;
  readonly aoTocar: () => void;
}

export function ItemDaConversa({
  id,
  nome,
  verificado,
  horario,
  previa,
  naoLidas,
  timer,
  aoTocar,
}: PropsDoItem) {
  const estilos = useEstilos();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={aoTocar}
      style={({ pressed }) => [estilos.item, pressed && estilos.tocado]}
    >
      <IdenticonNaMoldura id={id} tamanho={26} moldura={48} />
      <View style={estilos.textos}>
        <View style={estilos.linha}>
          <Text numberOfLines={1} style={estilos.nome}>
            {nome}
          </Text>
          {verificado && <SeloDeVerificado />}
          <View style={estilos.espaco} />
          <Text style={estilos.horario}>{horario}</Text>
        </View>
        <View style={estilos.linha}>
          <Text numberOfLines={1} style={estilos.previa}>
            {previa}
          </Text>
          {timer !== undefined && <TimerDiscreto rotulo={timer} />}
          {naoLidas > 0 && <Etiqueta>{naoLidas}</Etiqueta>}
        </View>
      </View>
    </Pressable>
  );
}

const useEstilos = criarEstilos((cores) => ({
  moldura: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: cores.linha,
    backgroundColor: cores.superficie,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 11,
    paddingHorizontal: 20,
  },
  tocado: { backgroundColor: cores.superficie },
  textos: { flex: 1, minWidth: 0, gap: 4 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nome: {
    flexShrink: 1,
    fontFamily: fontes.seminegrito,
    fontSize: 16,
    letterSpacing: -0.16,
    color: cores.texto,
  },
  espaco: { flex: 1 },
  horario: { fontFamily: fontes.mono, fontSize: 11.5, color: cores.secundario },
  previa: {
    flex: 1,
    minWidth: 0,
    fontFamily: fontes.regular,
    fontSize: 14.5,
    color: cores.secundario,
  },
  etiqueta: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cores.acento,
  },
  textoDaEtiqueta: { fontFamily: fontes.mono, fontSize: 11, color: cores.sobreAcento },
}));
