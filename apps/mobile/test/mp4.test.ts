import { describe, expect, it } from 'vitest';
import { limparMp4 } from '../src/mp4.ts';

// O MP4 que sai do MediaMuxer (RF-33): sem a versão do Android e sem o instante da limpeza, com os
// mesmos tamanhos e deslocamentos.

function caixa(tipo: string, ...conteudo: Uint8Array[]): Uint8Array {
  const corpo = Buffer.concat(conteudo);
  const cabecalho = Buffer.alloc(8);
  cabecalho.writeUInt32BE(8 + corpo.length, 0);
  cabecalho.write(tipo, 4, 'latin1');
  return Buffer.concat([cabecalho, corpo]);
}

/** Caixa com versão e datas: `versao` 0 com datas de 4 bytes, 1 com 8. */
function comDatas(tipo: string, versao: 0 | 1, resto: number): Uint8Array {
  const datas = Buffer.alloc(versao === 1 ? 16 : 8, 0xaa);
  return caixa(tipo, Buffer.from([versao, 0, 0, 0]), datas, Buffer.alloc(resto, 0x11));
}

const texto = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

function exemplo(): Uint8Array {
  const versaoDoAndroid = caixa('meta', Buffer.from('com.android.version\x0016'));
  return Buffer.concat([
    caixa('ftyp', Buffer.from('mp42isom')),
    caixa(
      'moov',
      comDatas('mvhd', 0, 80),
      caixa(
        'trak',
        comDatas('tkhd', 0, 60),
        caixa('mdia', comDatas('mdhd', 1, 8), caixa('hdlr', Buffer.from('vide'))),
      ),
      caixa('udta', versaoDoAndroid),
      versaoDoAndroid,
    ),
    caixa('mdat', Buffer.from('amostras do video com.android.version')),
  ]);
}

describe('limpeza do MP4 do MediaMuxer (RF-33)', () => {
  it('tira a versão do Android e zera as datas, sem mudar o tamanho', () => {
    const original = exemplo();
    const limpo = limparMp4(Uint8Array.from(original));
    expect(limpo).toHaveLength(original.length);
    const moov = texto(limpo).slice(texto(limpo).indexOf('moov'), texto(limpo).indexOf('mdat'));
    expect(moov).not.toContain('com.android.version');
    expect(moov).not.toContain('meta');
    expect(moov).not.toContain('udta');
    expect(moov).not.toContain('\xaa');
    // As amostras e o resto ficam como estavam.
    expect(texto(limpo).slice(texto(limpo).indexOf('mdat'))).toBe(
      texto(original).slice(texto(original).indexOf('mdat')),
    );
    expect(texto(limpo)).toContain('hdlrvide');
    expect(texto(limpo)).toContain('\x11'.repeat(80));
  });

  it('caixa com tamanho errado: para, sem passar do fim', () => {
    const quebrado = Buffer.concat([
      caixa('ftyp', Buffer.from('mp42')),
      Buffer.from([0, 0, 0, 200]),
      Buffer.from('moov'),
    ]);
    expect(limparMp4(Uint8Array.from(quebrado))).toEqual(Uint8Array.from(quebrado));
  });
});
