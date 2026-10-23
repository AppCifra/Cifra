import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// O ícone do app é o wordmark inteiro (SPEC, design): o comum e as duas camadas do ícone
// adaptável estão no app.json, e cada arquivo é um PNG quadrado de 1024 px.

interface AppJson {
  readonly expo: {
    readonly icon?: string;
    readonly android: {
      readonly adaptiveIcon?: {
        readonly foregroundImage?: string;
        readonly monochromeImage?: string;
        readonly backgroundColor?: string;
      };
    };
  };
}

const app = (JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')) as AppJson)
  .expo;

function tamanhoDoPng(caminho: string): { largura: number; altura: number } {
  const bytes = readFileSync(new URL(`../${caminho}`, import.meta.url));
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { largura: bytes.readUInt32BE(16), altura: bytes.readUInt32BE(20) };
}

describe('ícone do app', () => {
  it('tem o ícone comum e as duas camadas do adaptável, com o fundo escuro do tema', () => {
    const adaptavel = app.android.adaptiveIcon;
    expect(adaptavel?.backgroundColor).toBe('#0B0C0B');
    for (const caminho of [app.icon, adaptavel?.foregroundImage, adaptavel?.monochromeImage]) {
      expect(caminho).toMatch(/^\.\/assets\/.+\.png$/);
      expect(tamanhoDoPng(String(caminho))).toEqual({ largura: 1024, altura: 1024 });
    }
  });
});
