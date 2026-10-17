import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Contraste de 4,5:1 (RNF-18) entre cada cor de texto e cada fundo em que ela aparece, nos dois
// temas, pela conta do WCAG 2. O tema.ts importa o React Native, então as cores saem do texto dele.

const fonte = readFileSync(new URL('../src/tema.ts', import.meta.url), 'utf8');

function cores(nome: string): Record<string, string> {
  const bloco = new RegExp(`export const ${nome}: Cores = \\{([^}]*)\\}`).exec(fonte)?.[1];
  if (!bloco) throw new Error(`tema ${nome} não encontrado`);
  return Object.fromEntries(
    [...bloco.matchAll(/(\w+): '(#[0-9A-Fa-f]{6})'/g)].map(([, chave, cor]): [string, string] => [
      chave ?? '',
      cor ?? '',
    ]),
  );
}

function luminancia(cor: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const canal = parseInt(cor.slice(i, i + 2), 16) / 255;
    return canal <= 0.03928 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contraste(a: string, b: string): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return ((claro ?? 0) + 0.05) / ((escuro ?? 0) + 0.05);
}

describe('contraste dos tokens (RNF-18)', () => {
  for (const tema of ['ESCURO', 'CLARO']) {
    const c = cores(tema);
    it(`${tema.toLowerCase()}: texto, secundário e perigo sobre os três fundos`, () => {
      for (const tinta of ['texto', 'secundario', 'perigo']) {
        for (const fundo of ['fundo', 'superficie', 'superficie2']) {
          const [a, b] = [c[tinta], c[fundo]];
          if (!a || !b) throw new Error(`${tinta} ou ${fundo} faltando`);
          expect(contraste(a, b), `${tinta} sobre ${fundo}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
    it(`${tema.toLowerCase()}: a tinta sobre o acento`, () => {
      expect(contraste(c['sobreAcento'] ?? '', c['acento'] ?? '')).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('a conta bate com a do WCAG', () => {
    expect(contraste('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contraste('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });
});
