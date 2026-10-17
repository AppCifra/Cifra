import { describe, expect, it } from 'vitest';
import { CABECALHO_DO_CONTEUDO, codificarConteudo, lerConteudo } from '../src/index.ts';

// O "digitando" (RF-18): tipo 7, 1 byte de corpo (1 começou, 0 parou), no mesmo tamanho fixo de
// todo conteúdo.

const comum = { id: new Uint8Array(16).fill(7), enviadaEm: 1_700_000_000_000, ttl: 0 };
const CAPACIDADE = 3000;

describe('conteúdo "digitando" (RF-18)', () => {
  it('ida e volta, começou e parou, no tamanho fixo', () => {
    for (const digitando of [true, false]) {
      const bytes = codificarConteudo({ ...comum, tipo: 'digitando', digitando }, CAPACIDADE);
      expect(bytes).toHaveLength(CAPACIDADE);
      expect(bytes[16]).toBe(7);
      expect(lerConteudo(bytes)).toEqual({ ...comum, tipo: 'digitando', digitando });
    }
  });

  it('corpo fora do formato não é lido', () => {
    const bytes = codificarConteudo({ ...comum, tipo: 'digitando', digitando: true }, CAPACIDADE);
    const valor = bytes.slice();
    valor[CABECALHO_DO_CONTEUDO] = 2;
    expect(lerConteudo(valor)).toBeNull();
    const longo = bytes.slice();
    longo[CABECALHO_DO_CONTEUDO - 1] = 2;
    expect(lerConteudo(longo)).toBeNull();
  });
});
