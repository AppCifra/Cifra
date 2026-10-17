import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BYTES_DO_ID, CARACTERES_DO_ID, formatarId, idDaChave, lerId } from '../src/index.ts';
import { sodium } from './sodium.ts';

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'));

// Calculados com BigInt (n.toString(32) e a troca de cada dígito pela letra do Crockford),
// sem o código daqui.
const VETORES = [
  { bytes: '00000000000000000000', id: '0000-0000-0000-0000' },
  { bytes: 'ffffffffffffffffffff', id: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' },
  { bytes: '00010203040506070809', id: '000G-40R4-0M30-E209' },
  { bytes: '8000000000000000000f', id: 'G000-0000-0000-000F' },
  { bytes: 'a1b2c3d4e5f60718293a', id: 'M6SC-7N75-YR3H-GA9T' },
] as const;

const FORMATO = /^[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){3}$/;

describe('ID em base32 Crockford', () => {
  it('10 bytes viram 16 caracteres em grupos de 4', () => {
    expect(BYTES_DO_ID).toBe(10);
    expect(CARACTERES_DO_ID).toBe(16);
  });

  it('confere com os vetores, nos dois sentidos', () => {
    for (const vetor of VETORES) {
      expect(formatarId(bytes(vetor.bytes))).toBe(vetor.id);
      expect(lerId(vetor.id)).toEqual(bytes(vetor.bytes));
    }
  });

  it('só usa o alfabeto Crockford: sem I, L, O e U', () => {
    for (let i = 0; i < 200; i++) {
      const id = formatarId(randomBytes(BYTES_DO_ID));
      expect(id).toMatch(FORMATO);
      expect(lerId(id)).not.toBeNull();
    }
  });

  it('ida e volta preserva os bytes', () => {
    for (let i = 0; i < 200; i++) {
      const original = Uint8Array.from(randomBytes(BYTES_DO_ID));
      expect(lerId(formatarId(original))).toEqual(original);
    }
  });

  it('lê minúsculas, sem hífen, com espaços e com O, I e L no lugar de 0 e 1', () => {
    const esperado = bytes('a1b2c3d4e5f60718293a');
    expect(lerId('m6sc-7n75-yr3h-ga9t')).toEqual(esperado);
    expect(lerId('M6SC7N75YR3HGA9T')).toEqual(esperado);
    expect(lerId(' M6SC 7N75\nYR3H GA9T ')).toEqual(esperado);
    expect(lerId('OOOO-oooo-0000-0000')).toEqual(lerId('0000-0000-0000-0000'));
    expect(lerId('IIII-llll-1111-LiLi')).toEqual(lerId('1111-1111-1111-1111'));
  });

  it('recusa o que não é ID', () => {
    expect(lerId('')).toBeNull();
    expect(lerId('M6SC-7N75-YR3H-GA9')).toBeNull();
    expect(lerId('M6SC-7N75-YR3H-GA9TT')).toBeNull();
    expect(lerId('M6SC-7N75-YR3H-GA9U')).toBeNull();
    expect(lerId('M6SC-7N75-YR3H-GA9*')).toBeNull();
    expect(lerId('M6SC-7N75-YR3H-GA9Ç')).toBeNull();
  });

  it('recusa bytes que não têm o tamanho do ID', () => {
    expect(() => formatarId(new Uint8Array(9))).toThrow();
    expect(() => formatarId(new Uint8Array(11))).toThrow();
  });
});

describe('derivação do ID', () => {
  // Os mesmos vetores do núcleo (packages/core/test/identidade.test.ts), calculados com o BLAKE2b
  // do @noble/hashes, fora da libsodium.
  const VETORES = [
    {
      publica: 'a43b5d84d25beb49892c7cd32868c86605c65b72836bb187fc6841bf9bd8ba6c',
      id: 'D65H-8D0J-J5KX-F235',
    },
    {
      publica: 'cc1e6654d3dc02075d40ecbd60d2251ac758b03e03c22e42ae8da7e82418f931',
      id: '8T5P-5MQN-NNV2-5Y6M',
    },
  ] as const;

  it('o ID são os primeiros 80 bits do BLAKE2b-256 da chave pública', () => {
    for (const vetor of VETORES) {
      const id = idDaChave(sodium, bytes(vetor.publica));
      expect(id).toHaveLength(BYTES_DO_ID);
      expect(formatarId(id)).toBe(vetor.id);
    }
  });
});
