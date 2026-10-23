// Quantas colunas cabem na tela das 12 palavras (RF-02). O design mostra duas, de 1 a 6 e de 7 a
// 12. Com a fonte do celular grande, a palavra mais comprida passaria por cima do número da outra
// coluna, e quem anota poderia copiar errado: aí vão todas numa coluna só, de 1 a 12.

/** Largura de cada caractere da Geist Mono, em em: todos têm 600 de 1000. */
const LARGURA_DA_MONO = 0.6;

/** Sem tamanho no estilo, o React Native usa 14. */
const TAMANHO_PADRAO = 14;

/** Um texto em mono, com as medidas do estilo, em dp, antes da escala da fonte do celular. */
export interface TextoMono {
  readonly fontSize?: number | undefined;
  readonly letterSpacing?: number | undefined;
}

export interface MedidasDasPalavras {
  /** Largura de cada uma das duas colunas, em dp. */
  readonly coluna: number;
  readonly numero: TextoMono;
  readonly palavra: TextoMono;
  /** Espaço entre o número e a palavra, em dp. Não cresce com a fonte. */
  readonly espaco: number;
  /** A escala da fonte pedida nos ajustes do celular (1 é o normal). */
  readonly escala: number;
}

function largura(texto: TextoMono, caracteres: number, escala: number): number {
  const tamanho = texto.fontSize ?? TAMANHO_PADRAO;
  return caracteres * (tamanho * LARGURA_DA_MONO + (texto.letterSpacing ?? 0)) * escala;
}

/** Duas colunas, como no design, só quando a palavra mais comprida cabe ao lado do número. */
export function colunasDasPalavras(
  palavras: readonly string[],
  medidas: MedidasDasPalavras,
): 1 | 2 {
  const maior = Math.max(0, ...palavras.map((palavra) => palavra.length));
  const ocupa =
    largura(medidas.numero, 2, medidas.escala) +
    medidas.espaco +
    largura(medidas.palavra, maior, medidas.escala);
  return ocupa <= medidas.coluna ? 2 : 1;
}
