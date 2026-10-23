// As 12 palavras de recuperação, mostradas uma vez depois de gerar (RF-02). Pular abre um painel
// que avisa que, sem elas, perder o celular é perder a identidade. A tela nasce com o bloqueio de
// print ligado, como todo o app.
import { useEffect } from 'react';
import { BackHandler, Text, useWindowDimensions, View } from 'react-native';
import { colunasDasPalavras } from '../colunas-das-palavras.ts';
import { Botao } from '../componentes/Botao.tsx';
import { Marca } from '../componentes/Marca.tsx';
import { Painel } from '../componentes/Painel.tsx';
import { RotuloDeSecao } from '../componentes/RotuloDeSecao.tsx';
import { Tela } from '../componentes/Tela.tsx';
import { useTextos } from '../i18n.ts';
import { criarEstilos, MARGEM_DO_ONBOARDING, raios, tipos } from '../tema.ts';

/** O respiro do cartão e os espaços entre as colunas e entre o número e a palavra, do design. */
const RESPIRO = 18;
const ENTRE_COLUNAS = 12;
const ENTRE_NUMERO_E_PALAVRA = 10;

interface PropsDasPalavras {
  readonly palavras: readonly string[];
  readonly confirmandoPulo: boolean;
  readonly naoGuardou: boolean;
  readonly guardando: boolean;
  readonly aoAnotar: () => void;
  readonly aoPular: () => void;
  readonly aoConfirmarPulo: () => void;
  readonly aoCancelarPulo: () => void;
  readonly aoVoltar: () => void;
}

export function Palavras(props: PropsDasPalavras) {
  const estilos = useEstilos();
  const { palavras, confirmandoPulo, naoGuardou, guardando, aoVoltar } = props;
  const t = useTextos();
  const { width: largura, fontScale } = useWindowDimensions();

  useEffect(() => {
    if (confirmandoPulo || guardando) return;
    const assinatura = BackHandler.addEventListener('hardwareBackPress', () => {
      aoVoltar();
      return true;
    });
    return () => {
      assinatura.remove();
    };
  }, [confirmandoPulo, guardando, aoVoltar]);

  // Duas colunas: de 1 a 6 à esquerda e de 7 a 12 à direita, para copiar no papel de cima a baixo.
  // Com a fonte do celular grande, uma coluna só, para nenhuma palavra passar por cima de um número.
  // Cada coluna fica uma View de verdade (sem `collapsable`), senão o React Native achata as duas
  // num mesmo pai e o leitor de tela lê na ordem da tela, linha por linha: 1, 7, 2, 8…
  const duas =
    colunasDasPalavras(palavras, {
      coluna: (largura - 2 * MARGEM_DO_ONBOARDING - 2 * RESPIRO - ENTRE_COLUNAS) / 2,
      numero: tipos.monoPequeno,
      palavra: tipos.mono,
      espaco: ENTRE_NUMERO_E_PALAVRA,
      escala: fontScale,
    }) === 2;
  const metade = Math.ceil(palavras.length / 2);
  const colunas = duas ? [palavras.slice(0, metade), palavras.slice(metade)] : [palavras];

  return (
    <Tela
      sobre={
        <Painel
          visivel={confirmandoPulo}
          aoFechar={props.aoCancelarPulo}
          titulo={t('palavras.aviso.titulo')}
          descricao={t('palavras.aviso.descricao')}
        >
          <Botao
            titulo={t('palavras.aviso.confirmar')}
            variante="secundario"
            aoTocar={props.aoConfirmarPulo}
          />
          <Botao
            titulo={t('palavras.aviso.voltar')}
            variante="fantasma"
            pequeno
            aoTocar={props.aoCancelarPulo}
          />
        </Painel>
      }
    >
      <Marca />
      <View style={estilos.meio}>
        <View style={estilos.textos}>
          <RotuloDeSecao texto={t('palavras.rotulo')} />
          <Text accessibilityRole="header" style={estilos.titulo}>
            {t('palavras.titulo')}
          </Text>
          <Text style={estilos.descricao}>{t('palavras.descricao')}</Text>
        </View>
        <View style={estilos.cartao}>
          {colunas.map((coluna, c) => (
            <View key={c} style={estilos.coluna} collapsable={false}>
              {coluna.map((palavra, i) => {
                const numero = c * metade + i + 1;
                return (
                  <View
                    key={numero}
                    style={estilos.palavra}
                    accessible
                    accessibilityLabel={`${numero} ${palavra}`}
                  >
                    <Text style={estilos.numero}>{String(numero).padStart(2, '0')}</Text>
                    <Text style={estilos.texto}>{palavra}</Text>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
        {naoGuardou && <Text style={estilos.aviso}>{t('guardar.erro')}</Text>}
      </View>
      <View style={estilos.acoes}>
        <Botao titulo={t('palavras.anotei')} desativado={guardando} aoTocar={props.aoAnotar} />
        <Botao
          titulo={t('palavras.pular')}
          variante="fantasma"
          pequeno
          desativado={guardando}
          aoTocar={props.aoPular}
        />
      </View>
    </Tela>
  );
}

const useEstilos = criarEstilos((cores) => ({
  meio: { flex: 1, justifyContent: 'center', gap: 24, paddingVertical: 24 },
  textos: { gap: 10 },
  titulo: { ...tipos.titulo, color: cores.texto },
  descricao: { ...tipos.corpoGrande, color: cores.secundario },
  cartao: {
    flexDirection: 'row',
    gap: ENTRE_COLUNAS,
    padding: RESPIRO,
    borderRadius: raios.cartao,
    backgroundColor: cores.superficie,
  },
  coluna: { flex: 1, gap: 10 },
  palavra: { flexDirection: 'row', alignItems: 'baseline', gap: ENTRE_NUMERO_E_PALAVRA },
  numero: { ...tipos.monoPequeno, color: cores.secundario },
  texto: { ...tipos.mono, color: cores.texto },
  aviso: { ...tipos.monoPequeno, color: cores.texto },
  acoes: { gap: 14 },
}));
