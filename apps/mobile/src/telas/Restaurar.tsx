// Restaurar a identidade digitando as 12 palavras, em português ou em inglês (RF-03). O campo e o
// botão ficam no alto, acima do teclado. O texto digitado só vive na memória desta tela.
import { QUANTIDADE_DE_PALAVRAS, separarPalavras, type ProblemaNasPalavras } from '@cifra/core';
import { useEffect, useState } from 'react';
import { BackHandler, Text, View } from 'react-native';
import { Botao } from '../componentes/Botao.tsx';
import { CampoDeTexto } from '../componentes/CampoDeTexto.tsx';
import { Marca } from '../componentes/Marca.tsx';
import { Tela } from '../componentes/Tela.tsx';
import { useTextos, type Traduzir } from '../i18n.ts';
import { criarEstilos, tipos } from '../tema.ts';

interface PropsDaRestauracao {
  readonly problema: ProblemaNasPalavras | null;
  readonly aoRestaurar: (texto: string) => void;
  readonly aoVoltar: () => void;
}

function descrever(t: Traduzir, problema: ProblemaNasPalavras): string {
  switch (problema.tipo) {
    case 'quantidade':
      return t('restaurar.problemas.quantidade', { n: problema.encontradas });
    case 'desconhecida':
      return t('restaurar.problemas.desconhecida', { posicao: problema.posicao });
    case 'checksum':
      return t('restaurar.problemas.checksum');
  }
}

export function Restaurar({ problema, aoRestaurar, aoVoltar }: PropsDaRestauracao) {
  const estilos = useEstilos();
  const t = useTextos();
  const [texto, setTexto] = useState('');
  const [mostrarProblema, setMostrarProblema] = useState(false);

  // Problema novo aparece; editar o texto esconde até a próxima tentativa.
  useEffect(() => {
    setMostrarProblema(problema !== null);
  }, [problema]);

  useEffect(() => {
    const assinatura = BackHandler.addEventListener('hardwareBackPress', () => {
      aoVoltar();
      return true;
    });
    return () => {
      assinatura.remove();
    };
  }, [aoVoltar]);

  const contagem = separarPalavras(texto).length;

  return (
    <Tela>
      <Marca />
      <View style={estilos.conteudo}>
        <View style={estilos.textos}>
          <Text accessibilityRole="header" style={estilos.titulo}>
            {t('restaurar.titulo')}
          </Text>
          <Text style={estilos.descricao}>{t('restaurar.descricao')}</Text>
        </View>
        <CampoDeTexto
          valor={texto}
          aoMudar={(novo) => {
            setTexto(novo);
            setMostrarProblema(false);
          }}
          rotulo={t('restaurar.campo')}
          mono
          multilinha
        />
        <Text
          accessibilityLiveRegion="polite"
          style={[estilos.status, mostrarProblema && estilos.problema]}
        >
          {mostrarProblema && problema
            ? descrever(t, problema)
            : t('restaurar.contagem', { n: contagem })}
        </Text>
        <View style={estilos.acoes}>
          <Botao
            titulo={t('restaurar.restaurar')}
            desativado={contagem !== QUANTIDADE_DE_PALAVRAS}
            aoTocar={() => {
              aoRestaurar(texto);
            }}
          />
          <Botao titulo={t('restaurar.voltar')} variante="fantasma" pequeno aoTocar={aoVoltar} />
        </View>
      </View>
    </Tela>
  );
}

const useEstilos = criarEstilos((cores) => ({
  conteudo: { gap: 18, paddingTop: 34 },
  textos: { gap: 10 },
  titulo: { ...tipos.titulo, color: cores.texto },
  descricao: { ...tipos.corpoGrande, color: cores.secundario },
  status: { ...tipos.monoPequeno, color: cores.secundario },
  problema: { color: cores.texto },
  acoes: { gap: 14, paddingTop: 6 },
}));
