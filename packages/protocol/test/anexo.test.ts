import { describe, expect, it } from 'vitest';
import {
  BYTES_DO_PEDACO,
  BYTES_DO_TOKEN,
  caminhoDoAnexo,
  enderecoDoAnexo,
  lerCaminhoDoAnexo,
  padme,
  TAMANHO_MAXIMO_DO_ANEXO,
  TAMANHO_MAXIMO_DO_CLARO,
  TAMANHO_MINIMO_DO_ANEXO,
  tamanhoCifrado,
  tamanhoDeAnexoValido,
  tamanhoDoAnexo,
} from '../src/index.ts';

const token = Uint8Array.from({ length: BYTES_DO_TOKEN }, (_, i) => i * 7);
const hex = Array.from(token, (b) => b.toString(16).padStart(2, '0')).join('');

describe('faixas de tamanho do anexo (SPEC, "Anexos")', () => {
  it('Padmé arredonda para cima, com sobra abaixo de 12%', () => {
    expect(padme(4096)).toBe(4096);
    expect(padme(5000)).toBe(5120);
    for (
      let tamanho = 4096;
      tamanho < TAMANHO_MAXIMO_DO_ANEXO;
      tamanho = Math.ceil(tamanho * 1.37)
    ) {
      const faixa = padme(tamanho);
      expect(faixa).toBeGreaterThanOrEqual(tamanho);
      expect(faixa / tamanho).toBeLessThan(1.12);
      expect(padme(faixa)).toBe(faixa);
    }
  });

  it('o blob nunca é menor que 4 KB, e arquivo pequeno não revela o tamanho exato', () => {
    expect(tamanhoDoAnexo(1)).toBe(TAMANHO_MINIMO_DO_ANEXO);
    expect(tamanhoDoAnexo(3000)).toBe(TAMANHO_MINIMO_DO_ANEXO);
    expect(() => tamanhoDoAnexo(0)).toThrow(RangeError);
  });

  it('cada pedaço de 64 KiB ganha 17 bytes, e o fluxo tem 24 de cabeçalho', () => {
    expect(tamanhoCifrado(1)).toBe(24 + 1 + 17);
    expect(tamanhoCifrado(BYTES_DO_PEDACO)).toBe(24 + BYTES_DO_PEDACO + 17);
    expect(tamanhoCifrado(BYTES_DO_PEDACO + 1)).toBe(24 + BYTES_DO_PEDACO + 1 + 34);
  });

  it('o maior arquivo cabe no maior blob, de 25 MiB; um byte a mais não cabe', () => {
    expect(TAMANHO_MAXIMO_DO_ANEXO).toBe(26_214_400);
    expect(tamanhoDoAnexo(TAMANHO_MAXIMO_DO_CLARO)).toBe(TAMANHO_MAXIMO_DO_ANEXO);
    expect(tamanhoCifrado(TAMANHO_MAXIMO_DO_CLARO + 1)).toBeGreaterThan(TAMANHO_MAXIMO_DO_ANEXO);
  });

  it('o relay só aceita tamanhos de faixa, entre 4 KB e 25 MiB', () => {
    for (const claro of [1, 5000, 123_456, 3_000_000, TAMANHO_MAXIMO_DO_CLARO]) {
      expect(tamanhoDeAnexoValido(tamanhoDoAnexo(claro))).toBe(true);
    }
    expect(tamanhoDeAnexoValido(TAMANHO_MINIMO_DO_ANEXO - 1)).toBe(false);
    expect(tamanhoDeAnexoValido(TAMANHO_MAXIMO_DO_ANEXO + 1)).toBe(false);
    expect(tamanhoDeAnexoValido(5121)).toBe(false);
    expect(tamanhoDeAnexoValido(5000.5)).toBe(false);
  });
});

describe('endereço do anexo no relay', () => {
  it('caminho com o token em hexadecimal, ida e volta', () => {
    expect(caminhoDoAnexo(token)).toBe(`/anexos/${hex}`);
    expect(lerCaminhoDoAnexo(`/anexos/${hex}`)).toEqual(token);
    expect(() => caminhoDoAnexo(new Uint8Array(31))).toThrow(RangeError);
  });

  it('o relay recusa qualquer caminho que não seja exatamente um anexo', () => {
    for (const caminho of [
      `/anexos/${hex.toUpperCase()}`,
      `/anexos/${hex.slice(2)}`,
      `/anexos/${hex}00`,
      `/anexos/${hex}?x=1`,
      `/anexos/${hex}/`,
      `/anexo/${hex}`,
      `//anexos/${hex}`,
      '/',
    ]) {
      expect(lerCaminhoDoAnexo(caminho)).toBeNull();
    }
  });

  it('ws:// vira http:// e wss:// vira https://, com o caminho do relay antes', () => {
    const onion = 'ws://' + 'a'.repeat(56) + '.onion';
    expect(enderecoDoAnexo(onion, token)).toBe(`http://${'a'.repeat(56)}.onion/anexos/${hex}`);
    expect(enderecoDoAnexo('wss://relay.exemplo:8443/cifra/', token)).toBe(
      `https://relay.exemplo:8443/cifra/anexos/${hex}`,
    );
    expect(() => enderecoDoAnexo('http://relay.exemplo', token)).toThrow(RangeError);
  });
});
