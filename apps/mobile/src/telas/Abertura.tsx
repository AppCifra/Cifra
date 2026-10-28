// Abertura do onboarding, como no design: gerar a identidade no aparelho, sem pedir nenhum dado
// pessoal (RF-01). Ao gerar, o cartão embaralha o ID por pouco mais de um segundo antes de mostrar
// o de verdade; com movimento reduzido, mostra direto. Embaixo, a frase de que usar o Cifra é
// aceitar os termos de uso, que abrem ali mesmo (RF-62). Depois do pânico (RF-48), um recado diz
// que tudo foi apagado.
import type { IdentidadeNova } from '@cifra/core';
import { formatarId } from '@cifra/protocol';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cripto } from '../adaptadores/cripto.ts';
import { Botao } from '../componentes/Botao.tsx';
import { CartaoDeIdentidade } from '../componentes/CartaoDeIdentidade.tsx';
import { Marca } from '../componentes/Marca.tsx';
import { useMovimentoReduzido } from '../componentes/movimento.ts';
import { Recado, useRecado } from '../componentes/Recado.tsx';
import { Tela } from '../componentes/Tela.tsx';
import { useTextos } from '../i18n.ts';
import { criarEstilos, tipos } from '../tema.ts';

interface PropsDaAbertura {
  readonly nova: IdentidadeNova | null;
  readonly aoGerar: () => void;
  readonly aoContinuar: () => void;
  readonly aoRestaurar: () => void;
  /** Abre os termos de uso por cima da abertura. */
  readonly aoLerTermos: () => void;
  /** O pânico acabou de apagar tudo: o recado aparece uma vez. */
  readonly apagado?: boolean;
}

/** 24 quadros de 55 ms, como no protótipo. */
const QUADROS = 24;
const INTERVALO = 55;

/** Um ID qualquer, só para o embaralhamento. */
const idQualquer = () => formatarId(cripto.randombytes_buf(10));

export function Abertura({
  nova,
  aoGerar,
  aoContinuar,
  aoRestaurar,
  aoLerTermos,
  apagado = false,
}: PropsDaAbertura) {
  const estilos = useEstilos();
  const t = useTextos();
  const margens = useSafeAreaInsets();
  const [recado, mostrarRecado] = useRecado();

  useEffect(() => {
    if (apagado) mostrarRecado(t('abertura.apagado'));
    // Só ao chegar do pânico: trocar o idioma depois não mostra de novo.
  }, [apagado, mostrarRecado]);
  const reduzido = useMovimentoReduzido();
  const [embaralhado, setEmbaralhado] = useState<string | null>(null);
  const [mostrada, setMostrada] = useState(nova !== null);

  useEffect(() => {
    if (!nova || mostrada) return;
    if (reduzido) {
      setMostrada(true);
      return;
    }
    let quadro = 0;
    const relogio = setInterval(() => {
      quadro++;
      if (quadro >= QUADROS) {
        clearInterval(relogio);
        setEmbaralhado(null);
        setMostrada(true);
      } else {
        setEmbaralhado(idQualquer());
      }
    }, INTERVALO);
    return () => {
      clearInterval(relogio);
    };
  }, [nova, mostrada, reduzido]);

  const gerando = nova !== null && !mostrada;
  const legenda = mostrada
    ? t('identidade.sua')
    : gerando
      ? t('identidade.gerando')
      : t('identidade.nenhuma');
  // "termos de uso" está dentro da frase, nos dois idiomas (o teste confere), e é o que se toca.
  const aceite = t('abertura.aceite');
  const termos = t('abertura.termos');
  const inicio = aceite.indexOf(termos);

  return (
    <Tela
      sobre={
        <Recado visivel={recado !== null} texto={recado ?? ''} embaixo={margens.bottom + 24} />
      }
    >
      <Marca />
      <View style={estilos.meio}>
        <View style={estilos.textos}>
          <Text accessibilityRole="header" style={estilos.titulo}>
            {t('abertura.titulo')}
          </Text>
          <Text style={estilos.descricao}>{t('abertura.descricao')}</Text>
        </View>
        <CartaoDeIdentidade
          id={mostrada ? (nova?.identidade.id ?? null) : embaralhado}
          legenda={legenda}
        />
      </View>
      <View style={estilos.acoes}>
        <Botao
          titulo={
            mostrada
              ? t('abertura.continuar')
              : gerando
                ? t('abertura.gerando')
                : t('abertura.gerar')
          }
          desativado={gerando}
          aoTocar={mostrada ? aoContinuar : aoGerar}
        />
        <Botao
          titulo={t('abertura.restaurar')}
          variante="fantasma"
          pequeno
          desativado={gerando}
          aoTocar={aoRestaurar}
        />
        <Text style={estilos.aceite}>
          {inicio < 0 ? `${aceite} ` : aceite.slice(0, inicio)}
          <Text accessibilityRole="link" onPress={aoLerTermos} style={estilos.termos}>
            {termos}
          </Text>
          {inicio < 0 ? '' : aceite.slice(inicio + termos.length)}
        </Text>
        <Text style={estilos.rodape}>{t('abertura.rodape')}</Text>
      </View>
    </Tela>
  );
}

const useEstilos = criarEstilos((cores) => ({
  meio: { flex: 1, justifyContent: 'center', gap: 34, paddingVertical: 24 },
  textos: { gap: 14 },
  titulo: { ...tipos.destaque, color: cores.texto },
  descricao: { ...tipos.corpoGrande, color: cores.secundario },
  acoes: { gap: 14 },
  aceite: { ...tipos.pequeno, textAlign: 'center', color: cores.secundario },
  termos: { color: cores.texto, textDecorationLine: 'underline' },
  rodape: {
    ...tipos.rotulo,
    textTransform: 'none',
    letterSpacing: 0,
    textAlign: 'center',
    color: cores.secundario,
  },
}));
