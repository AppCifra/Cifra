import { describe, expect, it } from 'vitest';
import {
  BYTES_DA_ETIQUETA,
  BYTES_DO_INTERIOR,
  BYTES_DO_SELO,
  CABECALHO_DO_CONTEUDO,
  capacidadeDoConteudo,
  codificarCabecalho,
  codificarInterior,
  lerInterior,
  LIMITE_DO_TEXTO,
  TAMANHO_DO_PACOTE,
  VERSAO_DO_ENVELOPE,
  type Interior,
} from '../src/index.ts';
import { sodium } from './sodium.ts';

const chave = (byte: number) => new Uint8Array(32).fill(byte);
const cabecalho = { chave: chave(7), anteriores: 3, numero: 41 };

function inicial(prekeyAvulsa: number | null = 12): Interior {
  return {
    tipo: 'inicial',
    abertura: {
      chaveDeIdentidade: chave(1),
      chaveEfemera: chave(2),
      prekeyAssinada: 5,
      prekeyAvulsa,
    },
    cabecalho,
    cifrado: sodium.randombytes_buf(capacidadeDoConteudo('inicial') + BYTES_DA_ETIQUETA),
  };
}

function sessao(): Interior {
  return {
    tipo: 'sessao',
    remetente: new Uint8Array(10).fill(3),
    cabecalho,
    cifrado: sodium.randombytes_buf(capacidadeDoConteudo('sessao') + BYTES_DA_ETIQUETA),
  };
}

describe('interior do pacote selado (RNF-04)', () => {
  it('com o selo da libsodium, o pacote tem exatamente 4096 bytes', () => {
    expect(BYTES_DO_SELO).toBe(sodium.crypto_box_SEALBYTES);
    expect(BYTES_DO_INTERIOR + BYTES_DO_SELO).toBe(TAMANHO_DO_PACOTE);
    const destino = sodium.crypto_box_keypair();
    for (const interior of [inicial(), sessao()]) {
      const bytes = codificarInterior(interior);
      expect(bytes).toHaveLength(BYTES_DO_INTERIOR);
      expect(sodium.crypto_box_seal(bytes, destino.publicKey)).toHaveLength(TAMANHO_DO_PACOTE);
    }
  });

  it('o maior texto cabe nos dois tipos de envelope', () => {
    for (const tipo of ['inicial', 'sessao'] as const) {
      expect(capacidadeDoConteudo(tipo) - CABECALHO_DO_CONTEUDO).toBeGreaterThanOrEqual(
        LIMITE_DO_TEXTO,
      );
    }
    expect(capacidadeDoConteudo('inicial')).toBe(3917);
    expect(capacidadeDoConteudo('sessao')).toBe(3980);
  });

  it('ida e volta do inicial, com e sem one-time prekey, e do de sessão', () => {
    for (const interior of [inicial(), inicial(null), inicial(0), sessao()]) {
      expect(lerInterior(codificarInterior(interior))).toEqual(interior);
    }
  });

  it('o cabeçalho da catraca: chave, PN e N em big-endian', () => {
    expect(Array.from(codificarCabecalho(cabecalho).subarray(32))).toEqual([
      0, 0, 0, 3, 0, 0, 0, 41,
    ]);
  });

  it('montar com campo fora do tamanho é erro de quem chama', () => {
    const errado = { ...sessao(), remetente: new Uint8Array(9) } as Interior;
    expect(() => codificarInterior(errado)).toThrow(RangeError);
    const cifradoCurto = { ...sessao(), cifrado: new Uint8Array(10) } as Interior;
    expect(() => codificarInterior(cifradoCurto)).toThrow(RangeError);
  });

  describe('a leitura não confia em quem mandou', () => {
    it('tamanho diferente de 4048 bytes', () => {
      const bytes = codificarInterior(sessao());
      expect(lerInterior(bytes.subarray(1))).toBeNull();
      expect(lerInterior(new Uint8Array(BYTES_DO_INTERIOR + 1))).toBeNull();
    });

    it('versão ou tipo desconhecidos', () => {
      const versao = codificarInterior(sessao());
      versao[0] = VERSAO_DO_ENVELOPE + 1;
      expect(lerInterior(versao)).toBeNull();
      const tipo = codificarInterior(sessao());
      tipo[1] = 9;
      expect(lerInterior(tipo)).toBeNull();
    });

    it('marcador de one-time prekey que não é 0 nem 1, ou 0 com número', () => {
      const posicaoDaMarca = 2 + 32 + 32 + 4;
      const marca = codificarInterior(inicial());
      marca[posicaoDaMarca] = 2;
      expect(lerInterior(marca)).toBeNull();
      const semMarcaComNumero = codificarInterior(inicial(null));
      semMarcaComNumero[posicaoDaMarca + 4] = 1;
      expect(lerInterior(semMarcaComNumero)).toBeNull();
    });
  });
});
