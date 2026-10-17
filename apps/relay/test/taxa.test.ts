import { describe, expect, it } from 'vitest';
import { criarBalde } from '../src/taxa.ts';

describe('balde de fichas', () => {
  it('libera a rajada de uma vez e depois a taxa por minuto, sem passar da rajada', () => {
    let agora = 0;
    const tirar = criarBalde({ rajada: 3, porMinuto: 6 }, () => agora);
    expect([tirar(), tirar(), tirar(), tirar()]).toEqual([true, true, true, false]);

    agora += 10_000; // 6 por minuto: uma ficha a cada 10 s
    expect([tirar(), tirar()]).toEqual([true, false]);

    agora += 60 * 60_000; // uma hora parado não junta mais que a rajada
    expect([tirar(), tirar(), tirar(), tirar()]).toEqual([true, true, true, false]);
  });

  it('relógio que volta não devolve fichas nem quebra o balde', () => {
    let agora = 1_000_000;
    const tirar = criarBalde({ rajada: 1, porMinuto: 1 }, () => agora);
    expect(tirar()).toBe(true);
    agora -= 500_000;
    expect(tirar()).toBe(false);
    agora += 60_000;
    expect(tirar()).toBe(true);
  });
});
