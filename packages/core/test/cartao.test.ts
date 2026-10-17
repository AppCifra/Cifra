import { describe, expect, it } from 'vitest';
import {
  MINIMO_DE_PREKEYS,
  planejarPublicacao,
  planejarReposicao,
  RENOVACAO_DO_CARTAO,
  VIDA_DA_PREKEY_ASSINADA,
  type EstadoDoCartao,
} from '../src/cartao/publicacao.ts';
import { intervaloDeReenvio, MAIOR_INTERVALO } from '../src/mensagens/fila.ts';

// RF-04 e RF-15: quando o cartão é publicado de novo, quando a prekey assinada muda, quando as
// one-time prekeys são repostas e como os reenvios se espaçam. O caminho inteiro, contra o relay,
// está nos testes do correio.

const AGORA = Date.UTC(2026, 9, 1, 12);

const publicado: EstadoDoCartao = {
  relay: 'ws://' + 'r'.repeat(56) + '.onion',
  caixaCriada: true,
  prekeyAssinada: { numero: 1, criadaEm: AGORA },
  data: AGORA,
  publicadoEm: AGORA,
  prekeysNoRelay: 100,
  proximaPrekey: 102,
};

describe('publicação do cartão (RF-04)', () => {
  it('a primeira publicação neste relay substitui tudo e leva 100 one-time prekeys', () => {
    expect(planejarPublicacao({ ...publicado, data: null, prekeyAssinada: null }, AGORA)).toEqual({
      modo: 'substituir',
      novaAssinada: true,
      avulsas: 100,
    });
  });

  it('com menos de 24 h, nada a publicar; depois, renova sem prekey nova', () => {
    expect(planejarPublicacao(publicado, AGORA + RENOVACAO_DO_CARTAO - 1)).toBeNull();
    expect(planejarPublicacao(publicado, AGORA + RENOVACAO_DO_CARTAO)).toEqual({
      modo: 'acrescentar',
      novaAssinada: false,
      avulsas: 0,
    });
  });

  it('a prekey assinada muda depois de 7 dias', () => {
    expect(planejarPublicacao(publicado, AGORA + VIDA_DA_PREKEY_ASSINADA)?.novaAssinada).toBe(true);
  });

  it('relógio que voltou renova: não dá para saber quanto tempo passou', () => {
    expect(planejarPublicacao(publicado, AGORA - 1)).toEqual({
      modo: 'acrescentar',
      novaAssinada: true,
      avulsas: 0,
    });
  });

  it(`repõe até 100 quando o relay guarda menos de ${MINIMO_DE_PREKEYS}`, () => {
    expect(planejarReposicao(MINIMO_DE_PREKEYS)).toBeNull();
    expect(planejarReposicao(MINIMO_DE_PREKEYS - 1)).toEqual({
      modo: 'acrescentar',
      novaAssinada: false,
      avulsas: 100 - MINIMO_DE_PREKEYS + 1,
    });
    expect(planejarReposicao(0)?.avulsas).toBe(100);
  });
});

describe('intervalos de reenvio (RF-15)', () => {
  it('1 s, 2 s, 4 s… até 1 min', () => {
    expect(Array.from({ length: 9 }, (_, i) => intervaloDeReenvio(i + 1))).toEqual([
      1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000,
    ]);
    expect(intervaloDeReenvio(1000)).toBe(MAIOR_INTERVALO);
  });
});
