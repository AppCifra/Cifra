import { describe, expect, it } from 'vitest';
import {
  deslocamentoDoArraste,
  eArrasteParaResponder,
  LIMIAR_DA_RESPOSTA,
  LIMITE_DO_ARRASTE,
  respondeAoSoltar,
} from '../src/gesto.ts';

describe('arrastar para responder', () => {
  it('só começa com o dedo indo para a direita, bem mais de lado que de pé', () => {
    expect(eArrasteParaResponder(12, 0)).toBe(true);
    expect(eArrasteParaResponder(40, 19)).toBe(true);
    expect(eArrasteParaResponder(40, -19)).toBe(true);
    // Ainda pode ser um toque ou o segurar.
    expect(eArrasteParaResponder(10, 0)).toBe(false);
    // Para a esquerda, nada.
    expect(eArrasteParaResponder(-40, 0)).toBe(false);
    // Na diagonal ou de pé, é a rolagem da conversa.
    expect(eArrasteParaResponder(40, 20)).toBe(false);
    expect(eArrasteParaResponder(20, -60)).toBe(false);
  });

  it('o balão segue o dedo até o limiar', () => {
    expect(deslocamentoDoArraste(-30)).toBe(0);
    expect(deslocamentoDoArraste(0)).toBe(0);
    expect(deslocamentoDoArraste(25)).toBe(25);
    expect(deslocamentoDoArraste(LIMIAR_DA_RESPOSTA)).toBe(LIMIAR_DA_RESPOSTA);
  });

  it('depois do limiar, freia sem tranco e não passa do limite', () => {
    // Logo depois do limiar, ainda no passo do dedo.
    expect(deslocamentoDoArraste(LIMIAR_DA_RESPOSTA + 1)).toBeCloseTo(LIMIAR_DA_RESPOSTA + 1, 0);
    const perto = deslocamentoDoArraste(90);
    const longe = deslocamentoDoArraste(150);
    const muitoLonge = deslocamentoDoArraste(2000);
    expect(perto).toBeLessThan(90);
    expect(longe).toBeGreaterThan(perto);
    expect(muitoLonge).toBeGreaterThanOrEqual(longe);
    expect(muitoLonge).toBeLessThanOrEqual(LIMITE_DO_ARRASTE);
    expect(longe).toBeGreaterThan(LIMITE_DO_ARRASTE - 1);
  });

  it('soltar responde só depois do limiar', () => {
    expect(respondeAoSoltar(0)).toBe(false);
    expect(respondeAoSoltar(LIMIAR_DA_RESPOSTA - 1)).toBe(false);
    expect(respondeAoSoltar(LIMIAR_DA_RESPOSTA)).toBe(true);
    expect(respondeAoSoltar(300)).toBe(true);
  });
});
