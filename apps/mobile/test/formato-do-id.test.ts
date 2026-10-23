import { describe, expect, it } from 'vitest';
import { idNaTela } from '../src/formato-do-id.ts';

// Com a fonte do celular grande, o ID quebra a linha só entre os grupos de 4: o espaço de largura
// zero depois de cada hífen marca onde pode quebrar e não muda o que aparece.

describe('ID na tela', () => {
  it('marca a quebra depois de cada hífen, e só ali', () => {
    expect(idNaTela('M89R-XAZR-VT98-44ME')).toBe('M89R-​XAZR-​VT98-​44ME');
  });

  it('sem os espaços de largura zero, volta a ser o mesmo ID', () => {
    const id = '7HDZ-V955-EZM8-WCW9';
    expect(idNaTela(id).replaceAll('​', '')).toBe(id);
  });
});
