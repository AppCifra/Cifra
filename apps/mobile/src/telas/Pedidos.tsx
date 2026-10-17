// Pedidos de conversa (RF-07): quem escreveu sem ser contato, numa área à parte. Cada um abre a
// conversa com aceitar, recusar e bloquear. Embaixo, os IDs bloqueados que vieram de pedidos, para
// desbloquear (RF-08).
import type { ResumoDaConversa } from '@cifra/core';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ItemDaConversa } from '../componentes/ItemDaConversa.tsx';
import { RotuloDeSecao } from '../componentes/RotuloDeSecao.tsx';
import { Cabecalho } from '../componentes/Topo.tsx';
import type { ConversasDoApp } from '../conversas.ts';
import { horarioDaLista, nomeDaConversa, previaDaConversa } from '../formato-da-conversa.ts';
import { rotuloCurto } from '../formato-do-timer.ts';
import { useTextos } from '../i18n.ts';
import type { TelaDoApp } from '../navegacao.ts';
import { criarEstilos, fontes, tipos } from '../tema.ts';
import { useLeitura, useVersao } from './dados.ts';

interface PropsDosPedidos {
  readonly conversas: ConversasDoApp;
  readonly aoVoltar: () => void;
  readonly abrir: (tela: TelaDoApp) => void;
}

export function Pedidos({ conversas, aoVoltar, abrir }: PropsDosPedidos) {
  const estilos = useEstilos();
  const t = useTextos();
  const margens = useSafeAreaInsets();
  const versao = useVersao(conversas);
  const pedidos = useLeitura(() => conversas.agenda.pedidos(), [versao]) ?? [];
  const bloqueados = useLeitura(() => conversas.agenda.bloqueados(), [versao]) ?? [];
  const agora = Date.now();

  const item = (resumo: ResumoDaConversa) => (
    <ItemDaConversa
      key={resumo.id}
      id={resumo.id}
      nome={nomeDaConversa(t, resumo)}
      verificado={false}
      horario={resumo.ultima ? horarioDaLista(t, resumo.atividade, agora) : ''}
      previa={previaDaConversa(t, resumo)}
      naoLidas={resumo.naoLidas}
      timer={resumo.timer > 0 ? rotuloCurto(t, resumo.timer) : undefined}
      aoTocar={() => {
        abrir({ tipo: 'conversa', id: resumo.id });
      }}
    />
  );

  return (
    <View style={[estilos.tela, { paddingTop: margens.top }]}>
      <Cabecalho titulo={t('pedidos.titulo')} aoVoltar={aoVoltar} />
      <ScrollView contentContainerStyle={{ paddingBottom: margens.bottom + 40 }}>
        <Text style={estilos.descricao}>{t('pedidos.descricao')}</Text>
        {pedidos.length === 0 && <Text style={estilos.nenhum}>{t('pedidos.nenhum')}</Text>}
        {pedidos.map(item)}
        {bloqueados.length > 0 && (
          <View style={estilos.secao}>
            <RotuloDeSecao texto={t('pedidos.bloqueados')} />
          </View>
        )}
        {bloqueados.map(item)}
      </ScrollView>
    </View>
  );
}

const useEstilos = criarEstilos((cores) => ({
  tela: { flex: 1, backgroundColor: cores.fundo },
  descricao: {
    ...tipos.pequeno,
    color: cores.secundario,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  nenhum: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    fontFamily: fontes.mono,
    fontSize: 11,
    color: cores.secundario,
  },
  secao: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 6 },
}));
