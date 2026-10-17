import { describe, expect, it } from 'vitest';
import { lerPacotes, lerTexto } from './util.ts';

const LICENCA = 'GPL-3.0-only';

describe('licença GPLv3 (RNF-20)', () => {
  const licenca = lerTexto('LICENSE');
  const pacotes = lerPacotes();
  const apps = pacotes.filter(({ pasta }) => pasta.startsWith('apps/'));

  it('LICENSE na raiz traz o texto integral da GPLv3', () => {
    expect(licenca).toMatch(/^\s*GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007\n/);
    expect(licenca).toContain('TERMS AND CONDITIONS');
    expect(licenca).toContain('END OF TERMS AND CONDITIONS');
    expect(licenca).toContain('How to Apply These Terms to Your New Programs');
  });

  it(`todo package.json declara ${LICENCA}`, () => {
    const semLicenca = pacotes
      .filter(({ manifesto }) => manifesto.license !== LICENCA)
      .map(({ pasta }) => pasta);
    expect(semLicenca).toEqual([]);
  });

  // O app e o relay são distribuídos cada um por si: cada um leva o próprio LICENSE.
  it.skipIf(apps.length === 0)('cada app em apps/ traz um LICENSE igual ao da raiz', () => {
    for (const { pasta } of apps) expect(lerTexto(`${pasta}/LICENSE`)).toBe(licenca);
  });
});
