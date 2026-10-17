import { describe, expect, it } from 'vitest';
import { CABECALHO_DO_CONTEUDO, codificarConteudo, lerConteudo } from '../src/index.ts';

// A caixa da conversa (tipo 10): o `ate` (8 bytes) seguido da chave da caixa de uma conversa oculta
// (32 bytes) ou de nada, e aí é a caixa do cartão.

const comum = { id: new Uint8Array(16).fill(10), enviadaEm: 1_700_000_000_000, ttl: 0 };
const CAPACIDADE = 3000;

describe('conteúdo "caixa"', () => {
  it('ida e volta, com a caixa oculta e com a do cartão', () => {
    const oculta = new Uint8Array(32).fill(3);
    for (const [caixa, ate, corpo] of [
      [oculta, 1_700_000_123_456, 40],
      [null, 0, 8],
    ] as const) {
      const bytes = codificarConteudo({ ...comum, tipo: 'caixa', caixa, ate }, CAPACIDADE);
      expect(bytes).toHaveLength(CAPACIDADE);
      expect(bytes[16]).toBe(10);
      expect(bytes[CABECALHO_DO_CONTEUDO - 1]).toBe(corpo);
      expect(lerConteudo(bytes)).toEqual({ ...comum, tipo: 'caixa', caixa, ate });
    }
  });

  it('corpo fora do formato não é lido, e valor inválido não é escrito', () => {
    const bytes = codificarConteudo(
      { ...comum, tipo: 'caixa', caixa: new Uint8Array(32), ate: 5 },
      CAPACIDADE,
    );
    for (const tamanho of [0, 7, 9, 39, 41]) {
      const outro = bytes.slice();
      outro[CABECALHO_DO_CONTEUDO - 1] = tamanho;
      expect(lerConteudo(outro)).toBeNull();
    }
    const grande = bytes.slice();
    grande[CABECALHO_DO_CONTEUDO] = 0xff;
    expect(lerConteudo(grande)).toBeNull();
    expect(() =>
      codificarConteudo({ ...comum, tipo: 'caixa', caixa: null, ate: -1 }, CAPACIDADE),
    ).toThrow(RangeError);
    expect(() =>
      codificarConteudo({ ...comum, tipo: 'caixa', caixa: new Uint8Array(31), ate: 0 }, CAPACIDADE),
    ).toThrow(RangeError);
  });
});
