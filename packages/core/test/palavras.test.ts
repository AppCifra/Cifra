import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BYTES_DA_ENTROPIA,
  LISTAS,
  lerPalavras,
  palavrasDaEntropia,
  separarPalavras,
  type IdiomaDasPalavras,
} from '../src/index.ts';
import { cripto } from './adaptadores/sodium-node.ts';

// Inglês: vetores oficiais de 12 palavras (github.com/trezor/python-mnemonic, vectors.json).
// Português: as mesmas entropias pelo @scure/bip39 e por um codificador mínimo com o SHA-256 do
// OpenSSL, os dois fora do repositório e com o mesmo resultado.
const VETORES_BIP39 = [
  {
    entropia: '00000000000000000000000000000000',
    ingles:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    portugues:
      'abacate abacate abacate abacate abacate abacate abacate abacate abacate abacate abacate abater',
  },
  {
    entropia: '7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f',
    ingles: 'legal winner thank year wave sausage worth useful legal winner thank yellow',
    portugues:
      'imitador vinheta sogro xerife veleiro pomar volumoso tratador imitador vinheta sogro xingar',
  },
  {
    entropia: '80808080808080808080808080808080',
    ingles: 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above',
    portugues:
      'inalador acirrar barulho abotoar afivelar coruja abutre amostra inalador acirrar barulho abduzir',
  },
  {
    entropia: 'ffffffffffffffffffffffffffffffff',
    ingles: 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
    portugues:
      'zumbido zumbido zumbido zumbido zumbido zumbido zumbido zumbido zumbido zumbido zumbido xeque',
  },
  {
    entropia: '9e885d952ad362caeb4efe34a8e91bd2',
    ingles: 'ozone drill grab fiber curtain grace pudding thank cruise elder eight picnic',
    portugues:
      'mexicano crosta farpa empolgar chatice fartura olaria sogro centeio defesa dedal multar',
  },
  {
    entropia: 'c0ba5a8e914111210f2bd131f3d5e08d',
    ingles: 'scheme spot photo card baby mountain device kick cradle pact join borrow',
    portugues:
      'pote ringue muda benzer andaime levitar comando guloso carreira micro grilo atracar',
  },
  {
    entropia: '23db8160a31d3e0dca3688ed941adbf3',
    ingles: 'cat swing flag economy stadium alone churn speed unique patch report train',
    portugues:
      'bifocal semanal enlatar debulhar roedor adquirir branco resumir tora modular patrono tangente',
  },
  {
    entropia: 'f30f8c1da665478f49b001d94c5fc452',
    ingles: 'vessel ladder alter error federal sibling chat ability sun glass valve picture',
    portugues:
      'turbo hoje aeronave diagrama embargo rachar bochecha abaixo sanidade extinto tridente mundial',
  },
] as const;

/** SHA-256 dos arquivos oficiais english.txt e portuguese.txt (bitcoin/bips e trezor, iguais). */
const HASH_DAS_LISTAS: Readonly<Record<IdiomaDasPalavras, string>> = {
  ingles: '2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda',
  portugues: '2685e9c194c82ae67e10ba59d9ea5345a23dc093e92276fc5361f6667d79cd3f',
};

const IDIOMAS: readonly IdiomaDasPalavras[] = ['portugues', 'ingles'];
const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'));

describe('listas de palavras', () => {
  it('são as listas oficiais do BIP39, sem nenhuma mudança', () => {
    for (const idioma of IDIOMAS) {
      const lista = LISTAS[idioma];
      expect(lista).toHaveLength(2048);
      const arquivo = `${lista.join('\n')}\n`;
      expect(createHash('sha256').update(arquivo).digest('hex')).toBe(HASH_DAS_LISTAS[idioma]);
    }
  });

  it('não têm palavra em comum: o idioma de cada palavra não é ambíguo', () => {
    const ingles = new Set(LISTAS.ingles);
    expect(LISTAS.portugues.filter((palavra) => ingles.has(palavra))).toEqual([]);
  });

  it('só têm letras de a a z, e as 4 primeiras letras não se repetem', () => {
    for (const idioma of IDIOMAS) {
      const lista = LISTAS[idioma];
      expect(lista.filter((palavra) => !/^[a-z]+$/.test(palavra))).toEqual([]);
      expect(new Set(lista.map((palavra) => palavra.slice(0, 4))).size).toBe(2048);
    }
  });
});

describe('da entropia para as palavras', () => {
  it('confere com os vetores, em inglês e em português', () => {
    for (const vetor of VETORES_BIP39) {
      const entropia = bytes(vetor.entropia);
      expect(palavrasDaEntropia(cripto, entropia, 'ingles').join(' ')).toBe(vetor.ingles);
      expect(palavrasDaEntropia(cripto, entropia, 'portugues').join(' ')).toBe(vetor.portugues);
    }
  });

  it('recusa entropia que não tem 128 bits', () => {
    expect(() => palavrasDaEntropia(cripto, new Uint8Array(15), 'portugues')).toThrow();
    expect(() => palavrasDaEntropia(cripto, new Uint8Array(32), 'ingles')).toThrow();
  });
});

describe('das palavras para a entropia', () => {
  it('confere com os vetores e reconhece o idioma', () => {
    for (const vetor of VETORES_BIP39) {
      expect(lerPalavras(cripto, vetor.ingles)).toEqual({
        ok: true,
        entropia: bytes(vetor.entropia),
        idioma: 'ingles',
      });
      expect(lerPalavras(cripto, vetor.portugues)).toEqual({
        ok: true,
        entropia: bytes(vetor.entropia),
        idioma: 'portugues',
      });
    }
  });

  it('ida e volta com entropia sorteada, nos dois idiomas', () => {
    for (let i = 0; i < 300; i++) {
      const entropia = Uint8Array.from(randomBytes(BYTES_DA_ENTROPIA));
      for (const idioma of IDIOMAS) {
        const texto = palavrasDaEntropia(cripto, entropia, idioma).join(' ');
        expect(lerPalavras(cripto, texto)).toEqual({ ok: true, entropia, idioma });
      }
    }
  });

  it('aceita maiúsculas, acentos, espaços, quebras de linha, vírgulas e numeração', () => {
    const [vetor] = VETORES_BIP39.slice(4);
    if (!vetor) throw new Error('vetor faltando');
    const esperado = { ok: true, entropia: bytes(vetor.entropia), idioma: 'portugues' };
    const palavras = vetor.portugues.split(' ');

    expect(lerPalavras(cripto, vetor.portugues.toUpperCase())).toEqual(esperado);
    expect(lerPalavras(cripto, `  ${palavras.join('\n\n')}\t `)).toEqual(esperado);
    expect(lerPalavras(cripto, palavras.join(', '))).toEqual(esperado);
    expect(lerPalavras(cripto, palavras.map((p, i) => `${i + 1}. ${p}`).join(' '))).toEqual(
      esperado,
    );
    expect(lerPalavras(cripto, vetor.portugues.replace('mexicano', 'méxicano'))).toEqual(esperado);
  });

  it('acusa quantidade errada', () => {
    const palavras = VETORES_BIP39[1].ingles.split(' ');
    expect(lerPalavras(cripto, palavras.slice(0, 11).join(' '))).toEqual({
      ok: false,
      problema: { tipo: 'quantidade', encontradas: 11 },
    });
    expect(lerPalavras(cripto, [...palavras, 'zoo'].join(' '))).toEqual({
      ok: false,
      problema: { tipo: 'quantidade', encontradas: 13 },
    });
    expect(lerPalavras(cripto, '   ')).toEqual({
      ok: false,
      problema: { tipo: 'quantidade', encontradas: 0 },
    });
  });

  it('acusa a posição da palavra que não está na lista', () => {
    const palavras = VETORES_BIP39[5].portugues.split(' ');
    const comErro = palavras.map((p, i) => (i === 4 ? 'andaimi' : p)).join(' ');
    expect(lerPalavras(cripto, comErro)).toEqual({
      ok: false,
      problema: { tipo: 'desconhecida', posicao: 5 },
    });
  });

  it('acusa palavra de outro idioma no meio, pela posição', () => {
    const portugues = VETORES_BIP39[6].portugues.split(' ');
    const ingles = VETORES_BIP39[6].ingles.split(' ');
    const misturado = portugues.map((p, i) => (i === 6 ? (ingles[i] ?? '') : p)).join(' ');
    expect(lerPalavras(cripto, misturado)).toEqual({
      ok: false,
      problema: { tipo: 'desconhecida', posicao: 7 },
    });
  });

  it('acusa palavras que existem mas não conferem com o checksum', () => {
    // Entropia zerada: o checksum é 3 ("abater"). Com "abacate" no fim, ele seria 0.
    const trocada = `${'abacate '.repeat(11)}abacate`;
    expect(lerPalavras(cripto, trocada)).toEqual({ ok: false, problema: { tipo: 'checksum' } });
  });

  it('o checksum vem do SHA-256 da porta Cripto', () => {
    const outroHash = Object.assign(Object.create(cripto) as typeof cripto, {
      crypto_hash_sha256: (mensagem: Uint8Array) => cripto.crypto_generichash(32, mensagem, null),
    });
    const corretas = VETORES_BIP39[0].portugues;
    expect(lerPalavras(outroHash, corretas)).toEqual({
      ok: false,
      problema: { tipo: 'checksum' },
    });
  });
});

describe('separação das palavras digitadas', () => {
  it('tira acento e maiúscula e separa por qualquer coisa que não seja letra', () => {
    expect(separarPalavras(' Ábaco,ÇEDILHA\n2-trem ')).toEqual(['abaco', 'cedilha', 'trem']);
    expect(separarPalavras('')).toEqual([]);
  });
});
