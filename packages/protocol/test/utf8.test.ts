import { describe, expect, it } from 'vitest';
import { deUtf8, utf8 } from '../src/index.ts';

const bytes = (...valores: number[]) => Uint8Array.from(valores);

describe('UTF-8 estrito das mensagens', () => {
  it('codifica como o TextEncoder: ASCII, acento, símbolo e fora do plano básico', () => {
    const encoder = new TextEncoder();
    for (const texto of ['abc', 'ação', 'você', '€ · —', '𝄞 e \u{1F512}', '\u0000x', '']) {
      expect(utf8(texto)).toEqual(encoder.encode(texto));
      expect(deUtf8(utf8(texto))).toBe(texto);
    }
  });

  it('ida e volta em todos os limites de tamanho de cada forma', () => {
    for (const ponto of [0x7f, 0x80, 0x7ff, 0x800, 0xd7ff, 0xe000, 0xffff, 0x10000, 0x10ffff]) {
      const texto = String.fromCodePoint(ponto);
      expect(deUtf8(utf8(texto))).toBe(texto);
    }
  });

  it('recusa codificar surrogate sem par', () => {
    expect(() => utf8('a\ud800b')).toThrow(RangeError);
    expect(() => utf8('\udc00')).toThrow(RangeError);
  });

  it('recusa ler o que não é UTF-8 válido', () => {
    // Continuação sem início, início sem continuação e sequência cortada no fim.
    expect(deUtf8(bytes(0x80))).toBeNull();
    expect(deUtf8(bytes(0xc3, 0x41))).toBeNull();
    expect(deUtf8(bytes(0xe2, 0x82))).toBeNull();
    // Formas longas demais: "/" em dois bytes e U+0800 em quatro.
    expect(deUtf8(bytes(0xc0, 0xaf))).toBeNull();
    expect(deUtf8(bytes(0xf0, 0x80, 0xa0, 0x80))).toBeNull();
    // Surrogate (U+D800) e acima de U+10FFFF.
    expect(deUtf8(bytes(0xed, 0xa0, 0x80))).toBeNull();
    expect(deUtf8(bytes(0xf4, 0x90, 0x80, 0x80))).toBeNull();
    expect(deUtf8(bytes(0xff))).toBeNull();
  });

  it('lê o que o TextDecoder estrito também aceita', () => {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const amostras = [bytes(0x41, 0xc3, 0xa7, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x94, 0x92)];
    for (const amostra of amostras) expect(deUtf8(amostra)).toBe(decoder.decode(amostra));
  });
});
