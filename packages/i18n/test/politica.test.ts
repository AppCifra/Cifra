import { describe, expect, it } from 'vitest';
import { IDIOMAS, secoesDaPolitica, TRADUCOES, type Idioma } from '../src/index.ts';

// A política de privacidade (RF-61) nos arquivos de tradução. A tela do app e o docs/PRIVACIDADE.md
// mostram as seções na ordem dos textos: os dois idiomas seguem a mesma ordem, e cada parágrafo é
// um texto só.

const ordem = (idioma: Idioma) =>
  Object.entries(TRADUCOES[idioma].politica.secoes).map(([secao, textos]) => [
    secao,
    Object.keys(textos),
  ]);

describe('política de privacidade (RF-61)', () => {
  it('as seções e os parágrafos vêm na mesma ordem nos dois idiomas', () => {
    expect(ordem('en')).toEqual(ordem('pt-BR'));
  });

  it('cada seção tem o título e pelo menos um parágrafo, e o título não vira parágrafo', () => {
    for (const idioma of IDIOMAS) {
      const secoes = secoesDaPolitica(idioma);
      expect(secoes).toHaveLength(Object.keys(TRADUCOES[idioma].politica.secoes).length);
      for (const { titulo, paragrafos } of secoes) {
        expect(titulo.trim()).not.toBe('');
        expect(paragrafos.length).toBeGreaterThan(0);
        expect(paragrafos).not.toContain(titulo);
      }
    }
  });

  it('cada parágrafo fica numa linha só', () => {
    const quebrados = IDIOMAS.flatMap((idioma) =>
      secoesDaPolitica(idioma).flatMap(({ paragrafos }) =>
        paragrafos.filter((paragrafo) => /\n/.test(paragrafo)),
      ),
    );
    expect(quebrados).toEqual([]);
  });
});
