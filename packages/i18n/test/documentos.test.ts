import { describe, expect, it } from 'vitest';
import {
  DOCUMENTOS,
  IDIOMAS,
  secoesDoDocumento,
  TRADUCOES,
  type Documento,
  type Idioma,
} from '../src/index.ts';

// A política de privacidade (RF-61) e os termos de uso (RF-62) nos arquivos de tradução. A tela do
// app e os arquivos em docs/ mostram as seções na ordem dos textos: os dois idiomas seguem a mesma
// ordem, e cada parágrafo é um texto só.

type Secoes = Readonly<Record<string, Readonly<Record<string, string>>>>;

const ordem = (documento: Documento, idioma: Idioma) => {
  const secoes: Secoes = TRADUCOES[idioma][documento].secoes;
  return Object.entries(secoes).map(([secao, textos]) => [secao, Object.keys(textos)]);
};

describe.each(DOCUMENTOS)('%s', (documento) => {
  it('as seções e os parágrafos vêm na mesma ordem nos dois idiomas', () => {
    expect(ordem(documento, 'en')).toEqual(ordem(documento, 'pt-BR'));
  });

  it('cada seção tem o título e pelo menos um parágrafo, e o título não vira parágrafo', () => {
    for (const idioma of IDIOMAS) {
      const secoes = secoesDoDocumento(documento, idioma);
      expect(secoes).toHaveLength(Object.keys(TRADUCOES[idioma][documento].secoes).length);
      for (const { titulo, paragrafos } of secoes) {
        expect(titulo.trim()).not.toBe('');
        expect(paragrafos.length).toBeGreaterThan(0);
        expect(paragrafos).not.toContain(titulo);
      }
    }
  });

  it('cada parágrafo fica numa linha só', () => {
    const quebrados = IDIOMAS.flatMap((idioma) =>
      secoesDoDocumento(documento, idioma).flatMap(({ paragrafos }) =>
        paragrafos.filter((paragrafo) => /\n/.test(paragrafo)),
      ),
    );
    expect(quebrados).toEqual([]);
  });
});

describe('aceite dos termos de uso (RF-62)', () => {
  it('a frase da abertura contém o trecho que abre os termos, nos dois idiomas', () => {
    for (const idioma of IDIOMAS) {
      const { aceite, termos } = TRADUCOES[idioma].abertura;
      expect(aceite).toContain(termos);
    }
  });
});
