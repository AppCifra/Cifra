import { describe, expect, it } from 'vitest';
import { colunasDasPalavras, type MedidasDasPalavras } from '../src/colunas-das-palavras.ts';

// A tela das 12 palavras (RF-02) fica em duas colunas só quando a palavra mais comprida cabe ao lado
// do número. As medidas são as do app: número em monoPequeno (12), palavra em mono (17, espaçamento
// 0,34), 10 dp entre os dois, e a coluna de um celular de 360 ou 411 dp de largura, tirando as
// margens da tela (28), o respiro do cartão (18) e o espaço entre as colunas (12).

function medidas(larguraDaTela: number, escala: number): MedidasDasPalavras {
  return {
    coluna: (larguraDaTela - 2 * 28 - 2 * 18 - 12) / 2,
    numero: { fontSize: 12 },
    palavra: { fontSize: 17, letterSpacing: 0.34 },
    espaco: 10,
    escala,
  };
}

const ATE_OITO = ['gelado', 'navegar', 'soberano', 'flechada', 'bastante', 'triplo'];
const ATE_SETE = ['hello', 'armed', 'whisper', 'orchard', 'bamboo', 'visual'];

describe('colunas das palavras', () => {
  it('na fonte normal, duas colunas mesmo com palavras de 8 letras', () => {
    expect(colunasDasPalavras(ATE_OITO, medidas(360, 1))).toBe(2);
  });

  it('com a fonte em 130% num celular de 360 dp, uma palavra de 8 letras leva a uma coluna', () => {
    expect(colunasDasPalavras(ATE_OITO, medidas(360, 1.3))).toBe(1);
    expect(colunasDasPalavras(ATE_SETE, medidas(360, 1.3))).toBe(2);
  });

  it('com a fonte em 150%, até 7 letras já não cabem em duas', () => {
    expect(colunasDasPalavras(ATE_SETE, medidas(360, 1.5))).toBe(1);
  });

  it('num celular mais largo, as duas colunas aguentam fonte maior', () => {
    expect(colunasDasPalavras(ATE_OITO, medidas(411, 1.3))).toBe(2);
    expect(colunasDasPalavras(ATE_OITO, medidas(411, 2))).toBe(1);
  });

  it('sem tamanho no estilo, conta com o 14 do React Native', () => {
    const semTamanho = { ...medidas(360, 1), palavra: {} };
    const com14 = { ...medidas(360, 1), palavra: { fontSize: 14 } };
    for (const escala of [1, 1.5, 2]) {
      expect(colunasDasPalavras(ATE_OITO, { ...semTamanho, escala })).toBe(
        colunasDasPalavras(ATE_OITO, { ...com14, escala }),
      );
    }
  });
});
