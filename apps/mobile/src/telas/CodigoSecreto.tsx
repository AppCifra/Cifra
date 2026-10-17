// O código secreto das conversas ocultas (RF-21), pelos ajustes. Com as ocultas fechadas, definir
// um código zera o cofre e cria um novo, já aberto: as ocultas de um código anterior somem, e o
// texto avisa. Com elas abertas, trocar o código mantém as ocultas. O código nunca é guardado.
import { codigoAceito } from '@cifra/core';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Botao } from '../componentes/Botao.tsx';
import { CampoDeTexto } from '../componentes/CampoDeTexto.tsx';
import { Recado, useRecado } from '../componentes/Recado.tsx';
import { Cabecalho } from '../componentes/Topo.tsx';
import type { ConversasDoApp } from '../conversas.ts';
import { useTextos } from '../i18n.ts';
import { criarEstilos, fontes, tipos } from '../tema.ts';
import { useVersao } from './dados.ts';

type Problema = 'curto' | 'diferentes' | 'falhou';

export function CodigoSecreto({
  conversas,
  aoVoltar,
}: {
  readonly conversas: ConversasDoApp;
  readonly aoVoltar: () => void;
}) {
  const t = useTextos();
  const estilos = useEstilos();
  const margens = useSafeAreaInsets();
  useVersao(conversas);
  const [codigo, setCodigo] = useState('');
  const [repetido, setRepetido] = useState('');
  const [problema, setProblema] = useState<Problema | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [recado, mostrarRecado] = useRecado();
  const abertas = conversas.ocultasAbertas;

  const salvar = () => {
    if (!codigoAceito(codigo)) {
      setProblema('curto');
      return;
    }
    if (codigo !== repetido) {
      setProblema('diferentes');
      return;
    }
    setSalvando(true);
    const acao = abertas ? conversas.trocarCodigo(codigo) : conversas.definirCodigo(codigo);
    void acao.then((resultado) => {
      setSalvando(false);
      if (resultado !== 'ok') {
        setProblema(resultado === 'curto' ? 'curto' : 'falhou');
        return;
      }
      setCodigo('');
      setRepetido('');
      mostrarRecado(t(abertas ? 'codigo.trocado' : 'codigo.definido'));
    });
  };

  const mudou = (mudar: (texto: string) => void) => (texto: string) => {
    mudar(texto);
    setProblema(null);
  };

  return (
    <View style={[estilos.tela, { paddingTop: margens.top }]}>
      <Cabecalho titulo={t('codigo.titulo')} aoVoltar={aoVoltar} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[estilos.conteudo, { paddingBottom: margens.bottom + 40 }]}
      >
        <Text style={estilos.texto}>
          {t(abertas ? 'codigo.descricaoAbertas' : 'codigo.descricaoFechadas')}
        </Text>
        {!abertas && <Text style={estilos.aviso}>{t('codigo.aviso')}</Text>}
        <CampoDeTexto valor={codigo} aoMudar={mudou(setCodigo)} rotulo={t('codigo.campo')} mono />
        <CampoDeTexto
          valor={repetido}
          aoMudar={mudou(setRepetido)}
          rotulo={t('codigo.repita')}
          mono
        />
        {problema && (
          <Text accessibilityLiveRegion="polite" style={estilos.aviso}>
            {t(`codigo.${problema}`)}
          </Text>
        )}
        <Botao
          titulo={t(abertas ? 'codigo.trocar' : 'codigo.definir')}
          aoTocar={salvar}
          desativado={salvando || codigo === '' || repetido === ''}
        />
        <Text style={estilos.dica}>{t('codigo.dica')}</Text>
      </ScrollView>
      <Recado visivel={recado !== null} texto={recado ?? ''} embaixo={margens.bottom + 24} />
    </View>
  );
}

const useEstilos = criarEstilos((cores) => ({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { gap: 16, paddingHorizontal: 20, paddingTop: 12 },
  texto: { fontFamily: fontes.regular, fontSize: 15, lineHeight: 22, color: cores.texto },
  aviso: { ...tipos.monoPequeno, color: cores.texto },
  dica: {
    fontFamily: fontes.regular,
    fontSize: 13.5,
    lineHeight: 19.6,
    color: cores.secundario,
  },
}));
