import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lerTexto, listarArquivos, RAIZ } from './util.ts';

// As fontes do app vêm de fora do npm. Como qualquer dependência, cada arquivo fica registrado em
// docs/DEPENDENCIAS.md, com o SHA-256: trocar um arquivo sem atualizar o registro falha aqui.

const PASTA = 'apps/mobile/assets/fontes';

describe('fontes do app (RNF-16)', () => {
  const registro = lerTexto('docs/DEPENDENCIAS.md');
  const fontes = listarArquivos(PASTA, ['.ttf']);

  it('existem e vêm com o texto da licença OFL', () => {
    expect(fontes.length).toBeGreaterThan(0);
    expect(lerTexto(`${PASTA}/OFL.txt`)).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });

  it('cada arquivo está registrado com o SHA-256 dele', () => {
    const problemas = fontes.flatMap((arquivo) => {
      const nome = arquivo.slice(PASTA.length + 1);
      const hash = createHash('sha256')
        .update(readFileSync(join(RAIZ, arquivo)))
        .digest('hex');
      return registro.includes(`\`${nome}\`: \`${hash}\``) ? [] : [`${nome}: ${hash}`];
    });
    expect(problemas).toEqual([]);
  });
});
