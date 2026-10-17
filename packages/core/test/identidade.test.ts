import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  BYTES_DA_ENTROPIA,
  gerarIdentidade,
  idDaChavePublica,
  identidadeDaEntropia,
  identidadeDaSemente,
  palavrasDaEntropia,
  restaurarIdentidade,
  type Cripto,
  type IdiomaDasPalavras,
} from '../src/index.ts';
import { cripto } from './adaptadores/sodium-node.ts';

// Vetores de ID. Os valores esperados saem de implementações independentes da libsodium, para o
// teste não conferir a si mesmo: BLAKE2b-256 do @noble/hashes, Ed25519 e X25519 do OpenSSL
// (node:crypto; a X25519 privada é o SHA-512 da semente com o clamp da RFC 7748) e base32 por
// BigInt. As entropias são as dos vetores oficiais do BIP39 (test/palavras.test.ts).
const VETORES_DE_ID = [
  {
    entropia: '00000000000000000000000000000000',
    semente: '94c1c088cc9453996779630ad3af45cbd92814828dd784cf2aa12df95d1b8afe',
    publicaEd25519: 'a43b5d84d25beb49892c7cd32868c86605c65b72836bb187fc6841bf9bd8ba6c',
    privadaX25519: 'b033b54a447df59e686c637cc2e3b799beef706aa4b195eadda1f6de17325b64',
    publicaX25519: '5750b63946210cacbe247d5a69ea0bfd8ed00f0ebb91531d92b8f801da241311',
    id: 'D65H-8D0J-J5KX-F235',
  },
  {
    entropia: '7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f',
    semente: '84df84a01a3c3ac99c3279dede48e43fcff44751a9345bc1fad68bc3f217ab78',
    publicaEd25519: '3e40c9108fe57945dcd10eb5d302bc5c77626001d538ea027861bc08e555b4ce',
    privadaX25519: 'e805ceda414a40e35b8581bd7766ed72e9ba34549f73aa0646514a4d4390b562',
    publicaX25519: '20f360414c11c2531f491e2a74327e5c0ed2084fdde94d09a106c73e7d42e759',
    id: 'NHZX-THFK-8Q4A-ZSNZ',
  },
  {
    entropia: '80808080808080808080808080808080',
    semente: '63e8143f12c7569d0dacb1788d388af66cae3a5e5d39f9c095e6b473a5ff2c4a',
    publicaEd25519: '0485c7eb58b8fd82e34eeae5b2db21ca96bf34f9a5de902c916330adc4c89eeb',
    privadaX25519: '00581f730fa6bbdcc8614e932c747a023e103322cc65c4ce99bfd8a773267479',
    publicaX25519: 'da915d8062ed434bd560e2aba74ec29bfc4d48dc269285a50f24aa481f929e11',
    id: '1VWY-3D2X-1WZS-7G1N',
  },
  {
    entropia: 'ffffffffffffffffffffffffffffffff',
    semente: '681467b3337425fd38fa3983531ca1a6214de9264eebabdf9c9bc5d157d202b4',
    publicaEd25519: 'cc1e6654d3dc02075d40ecbd60d2251ac758b03e03c22e42ae8da7e82418f931',
    privadaX25519: 'd06f8070790ea1fce4dde4ae7b4422935306737e3a9e0574b50baf48161c8654',
    publicaX25519: '3b34c3681a0db1dc3602390e6b427a13d575abfbb32be071c69590c73d3e1e56',
    id: '8T5P-5MQN-NNV2-5Y6M',
  },
  {
    entropia: '9e885d952ad362caeb4efe34a8e91bd2',
    semente: 'a64f6ba9837e38f361acaf14583c9b292a01295554c6505140ba74c58e7ae26e',
    publicaEd25519: 'c15cbdfd3997f6b59873e8ccfcb781eecc60385ad2d1f62ca063f31cf95e6512',
    privadaX25519: 'e8fed4fe4091688f517becc63fc3f3331384e42451bd5b176eaf13d584c7f455',
    publicaX25519: 'b596bc46da7a5f6fef36b52b33fbd051f2122799a88b00e04ec19ef743db007d',
    id: 'JWH3-RF3G-445W-3D8T',
  },
  {
    entropia: 'c0ba5a8e914111210f2bd131f3d5e08d',
    semente: '9dcfae0a3a98aef8e1420f29899594cebcb0d15ae71e3df5111b4ae988db6e33',
    publicaEd25519: '9389b006482f5eec97697dab352532b2d53c5a45d7e23d637e821eb0691f5b40',
    privadaX25519: '90ce0e89d50a899d1377795c6288e90598840633f5fa79d1d66a3c1d09fa127b',
    publicaX25519: '8be6528f10a7deabaa107850ecfeeeaa9a30f5153528b35a6ed433fb21c97172',
    id: 'TWJR-T15E-YJAJ-SNQH',
  },
  {
    entropia: '23db8160a31d3e0dca3688ed941adbf3',
    semente: 'ceca3a40cea4f43f0c5a78d1e58b98940beeacaf35287fea55d55ba12c3a4b42',
    publicaEd25519: 'db12a346197652088217aa0f554896dd6cbfa33874a22e71b20add6803a93f4b',
    privadaX25519: 'd871d6f2b80256b7722e117fe25543dafa1924fb70349cf842a78115e414617d',
    publicaX25519: '5f897153fbdc941f5acd1db36d4233a5e4490d6bcbca31b5b0a02c5713eed776',
    id: 'WVJ4-KKY1-E9TC-V166',
  },
  {
    entropia: 'f30f8c1da665478f49b001d94c5fc452',
    semente: '9c788708f847ea3e587e62207e773d3e47edebf73920f6ae3624d311451d897e',
    publicaEd25519: '6083a274bb020a9390bc04cf9f6bc767c21981c6af35eea14d16f61162a8a0f3',
    privadaX25519: '00d03464b67dff6d464f53adc84596b5dd5937234752b34ca396116903639146',
    publicaX25519: '25ebdc0aeef5160f8ecc336cdae2ace0aa6facb3b7cf36514ac3e5534cd1f258',
    id: 'QZB0-9Z4G-CGBB-0XBH',
  },
] as const;

const FORMATO_DO_ID = /^[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){3}$/;
const IDIOMAS: readonly IdiomaDasPalavras[] = ['portugues', 'ingles'];
const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'));
const hex = (valor: Uint8Array) => Buffer.from(valor).toString('hex');

/** Ponto base da curva 25519 (u = 9). */
const BASE_X25519 = bytes('09' + '00'.repeat(31));

describe('vetores de ID', () => {
  it('entropia, semente, chaves Ed25519 e X25519 e ID batem com as implementações independentes', () => {
    for (const vetor of VETORES_DE_ID) {
      const identidade = identidadeDaEntropia(cripto, bytes(vetor.entropia));
      expect(hex(identidade.semente)).toBe(vetor.semente);
      expect(hex(identidade.assinatura.publicKey)).toBe(vetor.publicaEd25519);
      expect(hex(identidade.acordo.privateKey)).toBe(vetor.privadaX25519);
      expect(hex(identidade.acordo.publicKey)).toBe(vetor.publicaX25519);
      expect(identidade.id).toBe(vetor.id);
    }
  });

  it('o ID é o da chave pública Ed25519, no formato XXXX-XXXX-XXXX-XXXX', () => {
    for (const vetor of VETORES_DE_ID) {
      expect(idDaChavePublica(cripto, bytes(vetor.publicaEd25519))).toBe(vetor.id);
      expect(vetor.id).toMatch(FORMATO_DO_ID);
    }
  });

  it('a mesma semente refaz as mesmas chaves e o mesmo ID', () => {
    for (const vetor of VETORES_DE_ID) {
      const identidade = identidadeDaSemente(cripto, bytes(vetor.semente));
      expect(identidade.id).toBe(vetor.id);
      expect(hex(identidade.acordo.publicKey)).toBe(vetor.publicaX25519);
    }
    expect(() => identidadeDaSemente(cripto, new Uint8Array(31))).toThrow();
    expect(() => identidadeDaEntropia(cripto, new Uint8Array(32))).toThrow();
  });
});

describe('gerar identidade (RF-01)', () => {
  it('não pede nenhum dado pessoal: só a libsodium e o idioma das palavras', () => {
    expectTypeOf(gerarIdentidade).parameters.toEqualTypeOf<[Cripto, IdiomaDasPalavras]>();
  });

  it('sorteia chaves novas a cada vez, com ID no formato e 12 palavras do idioma pedido', () => {
    const ids = new Set<string>();
    for (const idioma of IDIOMAS) {
      for (let i = 0; i < 50; i++) {
        const { identidade, palavras } = gerarIdentidade(cripto, idioma);
        expect(identidade.id).toMatch(FORMATO_DO_ID);
        expect(palavras).toHaveLength(12);
        ids.add(identidade.id);
      }
    }
    expect(ids.size).toBe(100);
  });

  it('a chave X25519 sai da Ed25519 e serve para o acordo de chaves', () => {
    const a = gerarIdentidade(cripto, 'portugues').identidade;
    const b = gerarIdentidade(cripto, 'ingles').identidade;
    expect(cripto.crypto_scalarmult(a.acordo.privateKey, BASE_X25519)).toEqual(a.acordo.publicKey);
    expect(cripto.crypto_scalarmult(a.acordo.privateKey, b.acordo.publicKey)).toEqual(
      cripto.crypto_scalarmult(b.acordo.privateKey, a.acordo.publicKey),
    );
  });

  it('zera a entropia sorteada depois de usar', () => {
    const sorteadas: Uint8Array[] = [];
    const espiao = Object.assign(Object.create(cripto) as Cripto, {
      randombytes_buf: (tamanho: number) => {
        const sorteio = cripto.randombytes_buf(tamanho);
        sorteadas.push(sorteio);
        return sorteio;
      },
    });
    gerarIdentidade(espiao, 'portugues');
    expect(sorteadas).toHaveLength(1);
    expect(sorteadas[0]).toEqual(new Uint8Array(BYTES_DA_ENTROPIA));
  });
});

describe('restaurar identidade (RF-03)', () => {
  it('as palavras devolvem o ID original', () => {
    for (const idioma of IDIOMAS) {
      for (let i = 0; i < 50; i++) {
        const { identidade, palavras } = gerarIdentidade(cripto, idioma);
        const restaurada = restaurarIdentidade(cripto, palavras.join(' '));
        if (!restaurada.ok) throw new Error('restauração recusada');
        expect(restaurada.identidade.id).toBe(identidade.id);
        expect(restaurada.identidade.assinatura).toEqual(identidade.assinatura);
        expect(restaurada.identidade.semente).toEqual(identidade.semente);
      }
    }
  });

  it('as palavras em português e em inglês da mesma entropia dão o mesmo ID', () => {
    for (const vetor of VETORES_DE_ID) {
      const entropia = bytes(vetor.entropia);
      for (const idioma of IDIOMAS) {
        const texto = palavrasDaEntropia(cripto, entropia, idioma).join(' ');
        const restaurada = restaurarIdentidade(cripto, texto);
        expect(restaurada.ok && restaurada.identidade.id).toBe(vetor.id);
      }
    }
  });

  it('palavras com problema não criam identidade', () => {
    expect(restaurarIdentidade(cripto, 'abacate abaixo')).toEqual({
      ok: false,
      problema: { tipo: 'quantidade', encontradas: 2 },
    });
    expect(restaurarIdentidade(cripto, `${'abacate '.repeat(11)}abacate`)).toEqual({
      ok: false,
      problema: { tipo: 'checksum' },
    });
  });
});
