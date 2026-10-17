// Tokens do design do Cifra: cores, fontes, tipos, raios e movimento. Os valores são os do design
// system e da seção "Tokens" do SPEC; nada aqui é inventado.
//
// Tema escuro ou claro (RF-39), escuro por padrão. A troca vale na hora, sem remontar as telas:
// quem desenha pega as cores com `useCores()` e os estilos com o hook que `criarEstilos` devolve,
// um StyleSheet por tema, feito na primeira vez que o tema aparece.
import { useSyncExternalStore } from 'react';
import { Easing, StyleSheet, type TextStyle } from 'react-native';
import type { Tema } from './preferencias.ts';

export interface Cores {
  readonly fundo: string;
  readonly superficie: string;
  readonly superficie2: string;
  readonly linha: string;
  readonly texto: string;
  readonly secundario: string;
  readonly acento: string;
  /** Texto sobre o acento: sempre a tinta escura, nos dois temas. */
  readonly sobreAcento: string;
  readonly perigo: string;
  /** Véu atrás dos painéis inferiores. */
  readonly veu: string;
}

export const ESCURO: Cores = {
  fundo: '#0B0C0B',
  superficie: '#151715',
  superficie2: '#1D201D',
  linha: '#262A26',
  texto: '#E9EBE4',
  secundario: '#8D9289',
  acento: '#C6F432',
  sobreAcento: '#0B0C0B',
  perigo: '#FF5A43',
  veu: 'rgba(0,0,0,0.45)',
};

export const CLARO: Cores = {
  fundo: '#F2F1EB',
  superficie: '#FFFFFF',
  superficie2: '#E9E8E1',
  linha: '#DEDCD3',
  texto: '#131412',
  secundario: '#64675F',
  acento: '#C6F432',
  sobreAcento: '#0B0C0B',
  perigo: '#BF321D',
  veu: 'rgba(0,0,0,0.45)',
};

let temaAtivo: Tema = 'escuro';
const ouvintesDoTema = new Set<() => void>();

function assinarTema(ouvinte: () => void): () => void {
  ouvintesDoTema.add(ouvinte);
  return () => ouvintesDoTema.delete(ouvinte);
}

const lerTema = () => temaAtivo;

/** O tema de agora, fora do React (a cor da capa do bloqueio). */
export function temaAtual(): Tema {
  return temaAtivo;
}

/** Troca o tema de todas as telas na hora. */
export function aplicarTema(tema: Tema): void {
  if (tema === temaAtivo) return;
  temaAtivo = tema;
  for (const ouvinte of [...ouvintesDoTema]) ouvinte();
}

export function coresDo(tema: Tema): Cores {
  return tema === 'claro' ? CLARO : ESCURO;
}

/** O tema da tela. Quem usa desenha de novo quando ele muda. */
export function useTema(): Tema {
  return useSyncExternalStore(assinarTema, lerTema);
}

/** As cores do tema da tela. */
export function useCores(): Cores {
  return coresDo(useTema());
}

/**
 * Os estilos de um componente nos dois temas. Devolve o hook que entrega os do tema da tela; cada
 * StyleSheet é feito uma vez só.
 */
export function criarEstilos<T extends StyleSheet.NamedStyles<T>>(
  criar: (cores: Cores) => T & StyleSheet.NamedStyles<T>,
): () => T {
  const feitos: Partial<Record<Tema, T>> = {};
  return function useEstilos() {
    const tema = useTema();
    return (feitos[tema] ??= StyleSheet.create(criar(coresDo(tema))));
  };
}

/** Arquivos em assets/fontes, copiados para o Android pelo plugin `fontes`. */
export const fontes = {
  regular: 'Geist-Regular',
  media: 'Geist-Medium',
  seminegrito: 'Geist-SemiBold',
  mono: 'GeistMono-Regular',
} as const;

/** Tamanho em px, altura da linha relativa ao tamanho e espaçamento em em, como no design. */
function tipo(fontFamily: string, fontSize: number, altura: number, espacamento = 0): TextStyle {
  return {
    fontFamily,
    fontSize,
    lineHeight: Math.round(fontSize * altura * 10) / 10,
    letterSpacing: Math.round(fontSize * espacamento * 100) / 100,
  };
}

export const tipos = {
  /** Título do onboarding. */
  destaque: tipo(fontes.media, 42, 1.02, -0.035),
  titulo: tipo(fontes.media, 34, 1.1, -0.03),
  painel: tipo(fontes.media, 21, 1.25, -0.02),
  corpoGrande: tipo(fontes.regular, 16, 1.45),
  corpo: tipo(fontes.regular, 15, 1.4),
  pequeno: tipo(fontes.regular, 13, 1.4),
  /** IDs, chaves e as palavras de recuperação. */
  mono: tipo(fontes.mono, 17, 1.3, 0.02),
  /** Status e metadados, sempre em minúsculas. */
  monoPequeno: tipo(fontes.mono, 12, 1.5),
  /** Rótulos de seção, em maiúsculas. */
  rotulo: { ...tipo(fontes.mono, 11, 1.4, 0.08), textTransform: 'uppercase' },
} satisfies Record<string, TextStyle>;

export const raios = {
  celula: 3,
  campo: 15,
  botao: 18,
  cartao: 22,
  painel: 34,
} as const;

/** Margem lateral das telas do onboarding. */
export const MARGEM_DO_ONBOARDING = 28;

export const movimento = {
  curva: Easing.bezier(0.22, 0.9, 0.24, 1),
  tela: 500,
  painel: 450,
  veu: 350,
  /** A duração de base do design: a volta do balão arrastado. */
  base: 300,
  /** Com movimento reduzido, tudo vira um esmaecer curto. */
  reduzido: 200,
} as const;
