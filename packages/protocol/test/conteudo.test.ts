import { describe, expect, it } from 'vitest';
import {
  BYTES_DO_ID_DA_MENSAGEM,
  CABECALHO_DO_CONTEUDO,
  capacidadeDoConteudo,
  codificarConteudo,
  lerConteudo,
  LIMITE_DO_TEXTO,
  MAXIMO_DE_APAGADAS,
  MAXIMO_DE_LIDAS,
  timerValido,
  type Conteudo,
} from '../src/index.ts';

const CAPACIDADE = capacidadeDoConteudo('sessao');
const id = (byte: number) => new Uint8Array(BYTES_DO_ID_DA_MENSAGEM).fill(byte);
const ENVIADA = Date.UTC(2026, 9, 1, 10, 0, 0, 123);

function texto(mensagem: string, mudancas: Partial<Conteudo> = {}): Conteudo {
  return {
    tipo: 'texto',
    id: id(1),
    enviadaEm: ENVIADA,
    ttl: 0,
    texto: mensagem,
    ...mudancas,
  } as Conteudo;
}

describe('conteúdo interno da mensagem (RF-13, RNF-04)', () => {
  it('texto: ida e volta com id, enviadaEm, ttl e corpo', () => {
    const conteudo = texto('encontro às nove · ação', { ttl: 3600 });
    const bytes = codificarConteudo(conteudo, CAPACIDADE);
    expect(bytes).toHaveLength(CAPACIDADE);
    expect(lerConteudo(bytes)).toEqual(conteudo);
  });

  it('o tamanho não depende do texto: o resto é preenchido com zeros', () => {
    const curto = codificarConteudo(texto('a'), CAPACIDADE);
    const longo = codificarConteudo(texto('x'.repeat(LIMITE_DO_TEXTO)), CAPACIDADE);
    expect(curto).toHaveLength(longo.length);
    expect(curto.subarray(CABECALHO_DO_CONTEUDO + 1).every((byte) => byte === 0)).toBe(true);
  });

  it('texto de 1 a 3500 bytes UTF-8; fora disso é erro de quem chama', () => {
    expect(lerConteudo(codificarConteudo(texto('é'.repeat(1750)), CAPACIDADE))).not.toBeNull();
    expect(() => codificarConteudo(texto('é'.repeat(1751)), CAPACIDADE)).toThrow(RangeError);
    expect(() => codificarConteudo(texto(''), CAPACIDADE)).toThrow(RangeError);
  });

  it('o maior texto cabe nos dois tipos de envelope', () => {
    const maior = texto('\u{1F512}'.repeat(LIMITE_DO_TEXTO / 4));
    for (const tipo of ['inicial', 'sessao'] as const) {
      expect(lerConteudo(codificarConteudo(maior, capacidadeDoConteudo(tipo)))).toEqual(maior);
    }
  });

  it('leitura: ida e volta com os IDs das mensagens lidas', () => {
    const conteudo: Conteudo = {
      tipo: 'leitura',
      id: id(9),
      enviadaEm: ENVIADA,
      ttl: 0,
      lidas: [id(2), id(3), id(4)],
    };
    expect(lerConteudo(codificarConteudo(conteudo, CAPACIDADE))).toEqual(conteudo);
  });

  it('leitura: de 1 a 100 IDs, sem repetir', () => {
    const base = { tipo: 'leitura', id: id(9), enviadaEm: ENVIADA, ttl: 0 } as const;
    const muitas = Array.from({ length: MAXIMO_DE_LIDAS + 1 }, (_, i) => id(i));
    expect(() => codificarConteudo({ ...base, lidas: [] }, CAPACIDADE)).toThrow(RangeError);
    expect(() => codificarConteudo({ ...base, lidas: muitas }, CAPACIDADE)).toThrow(RangeError);
    expect(() => codificarConteudo({ ...base, lidas: [id(2), id(2)] }, CAPACIDADE)).toThrow(
      RangeError,
    );
    expect(() => codificarConteudo({ ...base, lidas: [new Uint8Array(15)] }, CAPACIDADE)).toThrow(
      RangeError,
    );
  });

  it('apagar pra todos: ida e volta com os IDs das mensagens apagadas (RF-30)', () => {
    const conteudo: Conteudo = {
      tipo: 'apagar',
      id: id(9),
      enviadaEm: ENVIADA,
      ttl: 0,
      apagadas: [id(2), id(3)],
    };
    expect(lerConteudo(codificarConteudo(conteudo, CAPACIDADE))).toEqual(conteudo);
  });

  it('apagar pra todos: de 1 a 100 IDs, sem repetir', () => {
    const base = { tipo: 'apagar', id: id(9), enviadaEm: ENVIADA, ttl: 0 } as const;
    const muitas = Array.from({ length: MAXIMO_DE_APAGADAS + 1 }, (_, i) => id(i));
    expect(() => codificarConteudo({ ...base, apagadas: [] }, CAPACIDADE)).toThrow(RangeError);
    expect(() => codificarConteudo({ ...base, apagadas: muitas }, CAPACIDADE)).toThrow(RangeError);
    expect(() => codificarConteudo({ ...base, apagadas: [id(2), id(2)] }, CAPACIDADE)).toThrow(
      RangeError,
    );
  });

  it('timer da conversa: ida e volta com os segundos e se vale para as anteriores (RF-25)', () => {
    const casos = [
      [0, false],
      [10, false],
      [3600, true],
      [604_800, true],
    ] as const;
    for (const [segundos, anteriores] of casos) {
      const conteudo: Conteudo = {
        tipo: 'timer',
        id: id(7),
        enviadaEm: ENVIADA,
        ttl: 0,
        segundos,
        anteriores,
      };
      expect(lerConteudo(codificarConteudo(conteudo, CAPACIDADE))).toEqual(conteudo);
    }
  });

  it('timer da conversa: 0 ou de 10 s a 7 dias, inteiro; "anteriores" só com timer', () => {
    const base = {
      tipo: 'timer',
      id: id(7),
      enviadaEm: ENVIADA,
      ttl: 0,
      anteriores: false,
    } as const;
    for (const segundos of [9, 604_801, 1.5, -10]) {
      expect(timerValido(segundos)).toBe(false);
      expect(() => codificarConteudo({ ...base, segundos }, CAPACIDADE)).toThrow(RangeError);
    }
    expect([0, 10, 90, 604_800].every(timerValido)).toBe(true);
    expect(() => codificarConteudo({ ...base, segundos: 0, anteriores: true }, CAPACIDADE)).toThrow(
      RangeError,
    );
  });

  it('recusa conteúdo maior que a capacidade', () => {
    expect(() => codificarConteudo(texto('x'.repeat(100)), CABECALHO_DO_CONTEUDO + 99)).toThrow(
      RangeError,
    );
  });

  describe('a leitura não confia em quem mandou', () => {
    const valido = () => codificarConteudo(texto('oi'), CAPACIDADE);

    it('preenchimento com qualquer byte diferente de zero', () => {
      const bytes = valido();
      bytes[CAPACIDADE - 1] = 1;
      expect(lerConteudo(bytes)).toBeNull();
    });

    it('tipo desconhecido', () => {
      const bytes = valido();
      bytes[BYTES_DO_ID_DA_MENSAGEM] = 0x7f;
      expect(lerConteudo(bytes)).toBeNull();
    });

    it('tamanho do corpo maior que o que sobra, ou zero', () => {
      const posicao = CABECALHO_DO_CONTEUDO - 2;
      const grande = valido();
      grande.set([0xff, 0xff], posicao);
      expect(lerConteudo(grande)).toBeNull();
      const vazio = valido();
      vazio.set([0, 0], posicao);
      expect(lerConteudo(vazio)).toBeNull();
    });

    it('texto acima do limite, mesmo cabendo no pacote', () => {
      const bytes = codificarConteudo(texto('x'.repeat(LIMITE_DO_TEXTO)), CAPACIDADE);
      const comMais = bytes.slice();
      comMais.set([0x0d, 0xad], CABECALHO_DO_CONTEUDO - 2);
      comMais[CABECALHO_DO_CONTEUDO + LIMITE_DO_TEXTO] = 0x78;
      expect(lerConteudo(comMais)).toBeNull();
    });

    it('texto que não é UTF-8', () => {
      const bytes = valido();
      bytes[CABECALHO_DO_CONTEUDO] = 0xff;
      expect(lerConteudo(bytes)).toBeNull();
    });

    it('leitura com tamanho que não é múltiplo de 16 ou com ID repetido', () => {
      const leitura: Conteudo = {
        tipo: 'leitura',
        id: id(9),
        enviadaEm: ENVIADA,
        ttl: 0,
        lidas: [id(2), id(3)],
      };
      const torto = codificarConteudo(leitura, CAPACIDADE);
      torto.set([0, 31], CABECALHO_DO_CONTEUDO - 2);
      expect(lerConteudo(torto)).toBeNull();
      const repetido = codificarConteudo(leitura, CAPACIDADE);
      repetido.set(id(2), CABECALHO_DO_CONTEUDO + BYTES_DO_ID_DA_MENSAGEM);
      expect(lerConteudo(repetido)).toBeNull();
    });

    it('timer fora do limite, "anteriores" que não é 0 ou 1, ou corpo de outro tamanho', () => {
      const bytes = codificarConteudo(
        { tipo: 'timer', id: id(7), enviadaEm: ENVIADA, ttl: 0, segundos: 3600, anteriores: false },
        CAPACIDADE,
      );
      expect(lerConteudo(bytes)).not.toBeNull();
      const curto = bytes.slice();
      curto.set([0, 0, 0, 9], CABECALHO_DO_CONTEUDO);
      expect(lerConteudo(curto)).toBeNull();
      const longo = bytes.slice();
      longo.set([0, 0x09, 0x3a, 0x81], CABECALHO_DO_CONTEUDO);
      expect(lerConteudo(longo)).toBeNull();
      const marca = bytes.slice();
      marca[CABECALHO_DO_CONTEUDO + 4] = 2;
      expect(lerConteudo(marca)).toBeNull();
      const anterioresSemTimer = bytes.slice();
      anterioresSemTimer.set([0, 0, 0, 0, 1], CABECALHO_DO_CONTEUDO);
      expect(lerConteudo(anterioresSemTimer)).toBeNull();
      const comSobra = bytes.slice();
      comSobra.set([0, 6], CABECALHO_DO_CONTEUDO - 2);
      expect(lerConteudo(comSobra)).toBeNull();
    });

    it('apagar com ID repetido ou sem nenhum', () => {
      const apagar: Conteudo = {
        tipo: 'apagar',
        id: id(9),
        enviadaEm: ENVIADA,
        ttl: 0,
        apagadas: [id(2), id(3)],
      };
      const repetido = codificarConteudo(apagar, CAPACIDADE);
      repetido.set(id(2), CABECALHO_DO_CONTEUDO + BYTES_DO_ID_DA_MENSAGEM);
      expect(lerConteudo(repetido)).toBeNull();
      const vazio = codificarConteudo(apagar, CAPACIDADE);
      vazio.set([0, 0], CABECALHO_DO_CONTEUDO - 2);
      expect(lerConteudo(vazio)).toBeNull();
    });

    it('bytes que nem chegam ao corpo', () => {
      expect(lerConteudo(new Uint8Array(CABECALHO_DO_CONTEUDO - 1))).toBeNull();
    });
  });
});
