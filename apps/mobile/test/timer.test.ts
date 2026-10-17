import { criarI18n } from '@cifra/i18n';
import type { ItemDaConversa, Mensagem } from '@cifra/core';
import { describe, expect, it } from 'vitest';
import {
  agruparNotas,
  avisaTimerCurto,
  fracaoRestante,
  lerPersonalizado,
  maximoPersonalizado,
  OPCOES_DO_TIMER,
  opcoesDaMensagem,
  rotuloCurto,
  rotuloLongo,
  tempoRestante,
  textoDaNota,
} from '../src/formato-do-timer.ts';

// O que a interface mostra das temporárias: as opções e os rótulos do timer (RF-25, RF-26, RF-50),
// o aviso dos timers curtos (RF-29) e as notas de sistema (RF-25, RF-28).

const pt = criarI18n('pt-BR').t;
const en = criarI18n('en').t;
const MINUTO = 60;
const HORA = 3600;
const DIA = 86_400;

describe('opções do timer (RF-25, RF-50)', () => {
  it('desligado, 10 s, 5 min, 30 min, 1 h, 12 h, 24 h e 1 semana, com os rótulos do design', () => {
    expect(OPCOES_DO_TIMER.map((s) => rotuloCurto(pt, s))).toEqual([
      'off',
      '10s',
      '5m',
      '30m',
      '1h',
      '12h',
      '24h',
      '7d',
    ]);
    expect(OPCOES_DO_TIMER.map((s) => rotuloLongo(pt, s))).toEqual([
      'Desligado',
      '10 segundos',
      '5 minutos',
      '30 minutos',
      '1 hora',
      '12 horas',
      '24 horas',
      '1 semana',
    ]);
    expect(OPCOES_DO_TIMER.map((s) => rotuloLongo(en, s))).toEqual([
      'Off',
      '10 seconds',
      '5 minutes',
      '30 minutes',
      '1 hour',
      '12 hours',
      '24 hours',
      '1 week',
    ]);
  });

  it('um personalizado aparece na maior unidade inteira', () => {
    expect(rotuloCurto(pt, 90)).toBe('90s');
    expect(rotuloCurto(pt, 2 * HORA)).toBe('2h');
    expect(rotuloCurto(pt, 5 * DIA)).toBe('5d');
    expect(rotuloLongo(pt, MINUTO)).toBe('1 minuto');
    expect(rotuloLongo(pt, 90 * MINUTO)).toBe('90 minutos');
    expect(rotuloLongo(pt, 36 * HORA)).toBe('36 horas');
    expect(rotuloLongo(pt, 5 * DIA)).toBe('5 dias');
    expect(rotuloLongo(en, 5 * DIA)).toBe('5 days');
  });
});

describe('timer por mensagem (RF-26)', () => {
  it('as opções nunca passam do timer da conversa, e sem timer na conversa vão todas', () => {
    expect(opcoesDaMensagem(0)).toEqual([...OPCOES_DO_TIMER]);
    expect(opcoesDaMensagem(HORA)).toEqual([10, 5 * MINUTO, 30 * MINUTO, HORA]);
    expect(opcoesDaMensagem(10)).toEqual([10]);
    expect(maximoPersonalizado(0)).toBe(7 * DIA);
    expect(maximoPersonalizado(HORA)).toBe(HORA);
  });

  it('personalizado: um número inteiro e a unidade, de 10 s até o máximo', () => {
    expect(lerPersonalizado('30', 'segundos', 7 * DIA)).toBe(30);
    expect(lerPersonalizado(' 5 ', 'dias', 7 * DIA)).toBe(5 * DIA);
    expect(lerPersonalizado('2', 'horas', 7 * DIA)).toBe(2 * HORA);
    expect(lerPersonalizado('9', 'segundos', 7 * DIA)).toBeNull();
    expect(lerPersonalizado('8', 'dias', 7 * DIA)).toBeNull();
    expect(lerPersonalizado('2', 'horas', HORA)).toBeNull();
    for (const texto of ['', '1,5', '-3', '1e3', 'dez']) {
      expect(lerPersonalizado(texto, 'minutos', 7 * DIA)).toBeNull();
    }
  });
});

describe('aviso dos timers curtos (RF-29)', () => {
  it('10 s, 5 min e qualquer personalizado até 5 min avisam; os outros e a nota pessoal, não', () => {
    const avisam = OPCOES_DO_TIMER.filter((s) => avisaTimerCurto(s, false));
    expect(avisam).toEqual([10, 5 * MINUTO]);
    expect(avisaTimerCurto(90, false)).toBe(true);
    expect(avisaTimerCurto(5 * MINUTO + 1, false)).toBe(false);
    expect(avisaTimerCurto(10, true)).toBe(false);
    expect(pt('timer.soAberta')).toBe('Só chega se a outra pessoa estiver com a conversa aberta.');
  });
});

function mensagem(campos: Partial<Mensagem>): Mensagem {
  return {
    id: new Uint8Array(16),
    conversa: new Uint8Array(10),
    deMim: false,
    tipo: 'texto',
    texto: 'oi',
    resposta: null,
    enviadaEm: 0,
    recebidaEm: 0,
    ttl: 0,
    expiraEm: null,
    status: 'recebida',
    ...campos,
  };
}

describe('contagem no balão (RF-27)', () => {
  it('quanto falta, como no design, e a fração do anel', () => {
    expect(tempoRestante(pt, 45_000)).toBe('45s');
    expect(tempoRestante(pt, 1_500)).toBe('2s');
    expect(tempoRestante(pt, 0)).toBe('0s');
    expect(tempoRestante(pt, 19 * 60_000 - 1)).toBe('19m');
    expect(tempoRestante(pt, 3 * 3_600_000)).toBe('3h');
    expect(tempoRestante(pt, 2 * 86_400_000)).toBe('2d');
    const comTimer = mensagem({ ttl: 100, expiraEm: 100_000 });
    expect(fracaoRestante(comTimer, 0)).toBe(1);
    expect(fracaoRestante(comTimer, 75_000)).toBe(0.25);
    expect(fracaoRestante(comTimer, 200_000)).toBe(0);
    expect(fracaoRestante(mensagem({}), 0)).toBe(1);
  });
});

describe('notas de sistema (RF-25, RF-28)', () => {
  it('o texto de cada nota, em minúsculas, nos dois idiomas', () => {
    const timer = (segundos: number, anteriores = false) =>
      ({ tipo: 'timer', segundos, anteriores, instante: 0 }) as const;
    expect(textoDaNota(pt, timer(HORA))).toBe('mensagens temporárias: 1 hora');
    expect(textoDaNota(pt, timer(DIA, true))).toBe(
      'mensagens temporárias: 24 horas, inclusive as anteriores',
    );
    expect(textoDaNota(pt, timer(0))).toBe('mensagens temporárias desativadas');
    expect(textoDaNota(en, timer(7 * DIA))).toBe('disappearing messages: 1 week');
    const expirou = { tipo: 'expirou', instante: 0 } as const;
    expect(textoDaNota(pt, expirou)).toBe('uma mensagem expirou antes de você abrir');
    expect(textoDaNota(pt, expirou, 3)).toBe('3 mensagens expiraram antes de você abrir');
    expect(textoDaNota(en, expirou, 2)).toBe('2 messages expired before you opened them');
  });

  it('notas "expirou" seguidas viram uma só, com a contagem', () => {
    const expirou = { tipo: 'nota', nota: { tipo: 'expirou', instante: 0 } } as const;
    const timer = {
      tipo: 'nota',
      nota: { tipo: 'timer', segundos: HORA, anteriores: false, instante: 0 },
    } as const;
    const texto = { tipo: 'mensagem', mensagem: mensagem({}), anexo: null, citada: null } as const;
    const itens: ItemDaConversa[] = [expirou, expirou, texto, expirou, timer, expirou, expirou];
    expect(
      agruparNotas(itens).map((item) =>
        item.tipo === 'nota' ? `${item.nota.tipo} ${String(item.quantas)}` : 'mensagem',
      ),
    ).toEqual(['expirou 2', 'mensagem', 'expirou 1', 'timer 1', 'expirou 2']);
  });
});
