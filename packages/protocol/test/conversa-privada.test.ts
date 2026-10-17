import { describe, expect, it } from 'vitest';
import { CABECALHO_DO_CONTEUDO, codificarConteudo, lerConteudo } from '../src/index.ts';

// Prints bloqueados na conversa (RF-58, tipo 8, 1 byte) e apagar a conversa nos dois celulares
// (RF-59, tipo 9, 8 bytes com o `enviadaEm` até onde apagar), no mesmo tamanho fixo de todo
// conteúdo.

const comum = { id: new Uint8Array(16).fill(9), enviadaEm: 1_700_000_000_000, ttl: 0 };
const CAPACIDADE = 3000;

describe('conteúdo "prints" (RF-58)', () => {
  it('ida e volta, bloqueados e liberados', () => {
    for (const bloqueados of [true, false]) {
      const bytes = codificarConteudo({ ...comum, tipo: 'prints', bloqueados }, CAPACIDADE);
      expect(bytes).toHaveLength(CAPACIDADE);
      expect(bytes[16]).toBe(8);
      expect(lerConteudo(bytes)).toEqual({ ...comum, tipo: 'prints', bloqueados });
    }
  });

  it('corpo fora do formato não é lido', () => {
    const bytes = codificarConteudo({ ...comum, tipo: 'prints', bloqueados: true }, CAPACIDADE);
    const valor = bytes.slice();
    valor[CABECALHO_DO_CONTEUDO] = 2;
    expect(lerConteudo(valor)).toBeNull();
    const longo = bytes.slice();
    longo[CABECALHO_DO_CONTEUDO - 1] = 2;
    expect(lerConteudo(longo)).toBeNull();
  });
});

describe('conteúdo "apagarConversa" (RF-59)', () => {
  it('ida e volta, com e sem mensagens recebidas', () => {
    for (const ate of [0, 1_700_000_123_456]) {
      const bytes = codificarConteudo({ ...comum, tipo: 'apagarConversa', ate }, CAPACIDADE);
      expect(bytes).toHaveLength(CAPACIDADE);
      expect(bytes[16]).toBe(9);
      expect(lerConteudo(bytes)).toEqual({ ...comum, tipo: 'apagarConversa', ate });
    }
  });

  it('corpo fora do formato não é lido, e valor inválido não é escrito', () => {
    const bytes = codificarConteudo({ ...comum, tipo: 'apagarConversa', ate: 5 }, CAPACIDADE);
    const curto = bytes.slice();
    curto[CABECALHO_DO_CONTEUDO - 1] = 7;
    expect(lerConteudo(curto)).toBeNull();
    expect(() =>
      codificarConteudo({ ...comum, tipo: 'apagarConversa', ate: -1 }, CAPACIDADE),
    ).toThrow(RangeError);
  });
});
