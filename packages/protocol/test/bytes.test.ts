import { describe, expect, it } from 'vitest';
import { ErroDeFormato, Escritor, Leitor } from '../src/index.ts';
import { ascii, deAscii, juntar } from '../src/bytes.ts';

describe('leitura e escrita binária', () => {
  it('escreve e lê inteiros em big-endian', () => {
    const bytes = new Escritor()
      .uint8(0xab)
      .uint16(0x0a0b)
      .uint32(0x01020304)
      .uint64(Number.MAX_SAFE_INTEGER)
      .resultado();
    expect(Array.from(bytes)).toEqual([
      0xab, 0x0a, 0x0b, 1, 2, 3, 4, 0x00, 0x1f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    ]);
    const leitor = new Leitor(bytes);
    expect([leitor.uint8(), leitor.uint16(), leitor.uint32(), leitor.uint64()]).toEqual([
      0xab,
      0x0a0b,
      0x01020304,
      Number.MAX_SAFE_INTEGER,
    ]);
    leitor.fim();
  });

  it('acusa byte faltando e byte sobrando', () => {
    expect(() => new Leitor(new Uint8Array(3)).uint32()).toThrow(ErroDeFormato);
    expect(() => new Leitor(new Uint8Array(2)).bytes(3)).toThrow(ErroDeFormato);
    const leitor = new Leitor(new Uint8Array(2));
    leitor.uint8();
    expect(() => {
      leitor.fim();
    }).toThrow(ErroDeFormato);
  });

  it('recusa inteiro de 64 bits que não cabe exato em JS', () => {
    const grande = new Uint8Array([0, 0x20, 0, 0, 0, 0, 0, 0]);
    expect(() => new Leitor(grande).uint64()).toThrow(ErroDeFormato);
  });

  it('devolve cópias comuns, mesmo quando lê de um Buffer do Node', () => {
    const buffer = Buffer.from([1, 2, 3, 4]);
    const lido = new Leitor(buffer).bytes(2);
    expect(lido.constructor).toBe(Uint8Array);
    buffer[0] = 9;
    expect(Array.from(lido)).toEqual([1, 2]);
  });

  it('o escritor recusa valor fora do campo: é erro de quem chama', () => {
    expect(() => new Escritor().uint8(256)).toThrow(RangeError);
    expect(() => new Escritor().uint16(65536)).toThrow(RangeError);
    expect(() => new Escritor().uint32(-1)).toThrow(RangeError);
    expect(() => new Escritor().uint32(1.5)).toThrow(RangeError);
    expect(() => new Escritor().uint64(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });

  it('o escritor copia o que recebe', () => {
    const parte = new Uint8Array([1, 2]);
    const escritor = new Escritor().bytes(parte);
    parte[0] = 9;
    expect(Array.from(escritor.resultado())).toEqual([1, 2]);
    expect(Array.from(juntar(new Uint8Array([1]), new Uint8Array([2, 3])))).toEqual([1, 2, 3]);
  });

  it('ASCII só com caracteres imprimíveis', () => {
    expect(deAscii(ascii('wss://relay'))).toBe('wss://relay');
    expect(() => ascii('ç')).toThrow(RangeError);
    expect(deAscii(new Uint8Array([0x41, 0x0a]))).toBeNull();
    expect(deAscii(new Uint8Array([0x41, 0xc3]))).toBeNull();
  });
});
