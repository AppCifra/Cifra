// Encaminhar (RF-54): até 5 conversas da lista (os contatos e a nota pessoal). Cada mensagem chega
// como nova, sem marca de encaminhada, com o timer de cada conversa; o anexo é cifrado de novo.
import { LIMITE_DO_ENCAMINHAR } from '@cifra/core';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Botao } from '../componentes/Botao.tsx';
import { IdenticonNaMoldura } from '../componentes/ItemDaConversa.tsx';
import { Cabecalho } from '../componentes/Topo.tsx';
import type { ConversasDoApp } from '../conversas.ts';
import { nomeDaConversa } from '../formato-da-conversa.ts';
import { useTextos } from '../i18n.ts';
import { criarEstilos, fontes, tipos } from '../tema.ts';
import { useLeitura, useVersao } from './dados.ts';

interface PropsDoEncaminhar {
  readonly conversas: ConversasDoApp;
  /** A conversa de onde as mensagens saem. */
  readonly origem: string;
  readonly mensagens: readonly Uint8Array[];
  readonly aoVoltar: () => void;
}

export function Encaminhar({ conversas, origem, mensagens, aoVoltar }: PropsDoEncaminhar) {
  const estilos = useEstilos();
  const t = useTextos();
  const margens = useSafeAreaInsets();
  const versao = useVersao(conversas);
  const [escolhidas, setEscolhidas] = useState<readonly string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [falhou, setFalhou] = useState(false);
  // A pessoa pode voltar antes de o envio terminar: aí a tela já saiu, e nada mais volta.
  const montada = useRef(true);
  useEffect(
    () => () => {
      montada.current = false;
    },
    [],
  );
  // Com as ocultas abertas, elas também aparecem.
  const lista = (
    useLeitura(
      async () => [
        ...(await conversas.agenda.conversas()),
        ...((await conversas.ocultas?.conversas()) ?? []),
      ],
      [versao],
    ) ?? []
  ).filter(
    (conversa) => conversa.tipo === 'nota' || (conversa.tipo === 'contato' && !conversa.bloqueado),
  );

  const alternar = (id: string) => {
    setEscolhidas((atuais) =>
      atuais.includes(id)
        ? atuais.filter((outra) => outra !== id)
        : atuais.length < LIMITE_DO_ENCAMINHAR
          ? [...atuais, id]
          : atuais,
    );
  };

  const encaminhar = () => {
    setEnviando(true);
    void conversas.encaminhar(origem, mensagens, escolhidas).then(({ falhas }) => {
      if (!montada.current) return;
      setEnviando(false);
      if (falhas === 0) aoVoltar();
      else setFalhou(true);
    });
  };

  return (
    <View style={[estilos.tela, { paddingTop: margens.top, paddingBottom: margens.bottom + 12 }]}>
      <Cabecalho titulo={t('encaminhar.titulo')} aoVoltar={aoVoltar} />
      <Text style={estilos.descricao}>{t('encaminhar.descricao')}</Text>
      <FlatList
        data={lista}
        keyExtractor={(conversa) => conversa.id}
        ListEmptyComponent={<Text style={estilos.aviso}>{t('encaminhar.nenhuma')}</Text>}
        renderItem={({ item }) => {
          const escolhida = escolhidas.includes(item.id);
          return (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: escolhida }}
              onPress={() => {
                alternar(item.id);
              }}
              style={({ pressed }) => [estilos.linha, pressed && estilos.tocada]}
            >
              <IdenticonNaMoldura id={item.id} tamanho={22} moldura={42} />
              <Text numberOfLines={1} style={estilos.nome}>
                {nomeDaConversa(t, item)}
              </Text>
              <View style={[estilos.marca, escolhida && estilos.marcaEscolhida]} />
            </Pressable>
          );
        }}
      />
      {falhou && <Text style={estilos.aviso}>{t('encaminhar.falhou')}</Text>}
      <View style={estilos.rodape}>
        <Botao
          titulo={t('encaminhar.enviar')}
          desativado={escolhidas.length === 0 || enviando}
          aoTocar={encaminhar}
        />
      </View>
    </View>
  );
}

const useEstilos = criarEstilos((cores) => ({
  tela: { flex: 1, backgroundColor: cores.fundo },
  descricao: { ...tipos.pequeno, color: cores.secundario, paddingHorizontal: 20, paddingBottom: 8 },
  linha: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  tocada: { backgroundColor: cores.superficie },
  nome: { flex: 1, fontFamily: fontes.seminegrito, fontSize: 16, color: cores.texto },
  marca: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: cores.linha,
  },
  marcaEscolhida: { borderColor: cores.acento, backgroundColor: cores.acento },
  aviso: { ...tipos.monoPequeno, color: cores.secundario, textAlign: 'center', padding: 16 },
  rodape: { paddingHorizontal: 20, paddingTop: 8 },
}));
