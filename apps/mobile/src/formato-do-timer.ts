// O que a interface mostra das mensagens temporárias, sem React: as opções dos seletores (RF-25,
// RF-26, RF-50), os rótulos curtos da pílula e do balão ("1h", "19m"), os nomes das opções
// ("1 hora"), o aviso dos timers curtos (RF-29), o tempo personalizado e as notas de sistema da
// conversa (RF-25, RF-28). Os testes rodam no Node.
import type { ItemDaConversa, Mensagem, NotaDeSistema } from '@cifra/core';
import { TIMER_MAXIMO_EM_SEGUNDOS, TIMER_MINIMO_EM_SEGUNDOS } from '@cifra/protocol';
import type { Traduzir } from './i18n.ts';

const MINUTO = 60;
const HORA = 3600;
const DIA = 86_400;
const SEMANA = 7 * DIA;

/** As opções dos seletores, em segundos; 0 é desligado. O "Personalizado" vem depois delas. */
export const OPCOES_DO_TIMER: readonly number[] = [
  0,
  10,
  5 * MINUTO,
  30 * MINUTO,
  HORA,
  12 * HORA,
  DIA,
  SEMANA,
];

/** Até este timer, o seletor avisa que a mensagem só chega com a conversa aberta (RF-29). */
const TIMER_CURTO = 5 * MINUTO;

export type Unidade = 'segundos' | 'minutos' | 'horas' | 'dias';

export const UNIDADES: readonly Unidade[] = ['segundos', 'minutos', 'horas', 'dias'];

const SEGUNDOS_POR_UNIDADE: Readonly<Record<Unidade, number>> = {
  segundos: 1,
  minutos: MINUTO,
  horas: HORA,
  dias: DIA,
};

const SINGULAR = { minutos: 'minuto', horas: 'hora', dias: 'dia' } as const;

/** A maior unidade em que o tempo dá um número inteiro. Dias, só de 2 em diante: "24 horas". */
function emUnidade(segundos: number): { readonly n: number; readonly unidade: Unidade } {
  if (segundos % DIA === 0 && segundos >= 2 * DIA) return { n: segundos / DIA, unidade: 'dias' };
  if (segundos % HORA === 0) return { n: segundos / HORA, unidade: 'horas' };
  if (segundos % MINUTO === 0) return { n: segundos / MINUTO, unidade: 'minutos' };
  return { n: segundos, unidade: 'segundos' };
}

/** A pílula do timer: "off", "10s", "5m", "1h", "24h", "7d"; um personalizado, "90s" ou "2d". */
export function rotuloCurto(t: Traduzir, segundos: number): string {
  if (segundos === 0) return t('timer.curto.desligado');
  const { n, unidade } = emUnidade(segundos);
  return t(`timer.curto.${unidade}`, { n });
}

/** O nome da opção: "Desligado", "10 segundos", "24 horas", "1 semana"; ou "2 dias". */
export function rotuloLongo(t: Traduzir, segundos: number): string {
  if (segundos === 0) return t('timer.longo.desligado');
  if (segundos === SEMANA) return t('timer.longo.semana');
  const { n, unidade } = emUnidade(segundos);
  if (n === 1 && unidade !== 'segundos') return t(`timer.longo.${SINGULAR[unidade]}`);
  return t(`timer.longo.${unidade}`, { n });
}

/** Quanto falta para a mensagem sumir, como no design: "45s", "19m", "3h", "2d". */
export function tempoRestante(t: Traduzir, ms: number): string {
  const segundos = Math.max(0, ms / 1000);
  if (segundos < MINUTO) return t('timer.curto.segundos', { n: Math.ceil(segundos) });
  if (segundos < HORA) return t('timer.curto.minutos', { n: Math.ceil(segundos / MINUTO) });
  if (segundos < DIA) return t('timer.curto.horas', { n: Math.round(segundos / HORA) });
  return t('timer.curto.dias', { n: Math.round(segundos / DIA) });
}

/** A fração do timer que ainda falta, de 0 a 1: o anel do balão. */
export function fracaoRestante(
  mensagem: Pick<Mensagem, 'ttl' | 'expiraEm'>,
  agora: number,
): number {
  if (mensagem.expiraEm === null || mensagem.ttl === 0) return 1;
  return Math.min(1, Math.max(0, (mensagem.expiraEm - agora) / (mensagem.ttl * 1000)));
}

/**
 * O timer curto só chega se a outra pessoa estiver com a conversa aberta (RF-29). Na nota pessoal,
 * não há outra pessoa.
 */
export function avisaTimerCurto(segundos: number, nota: boolean): boolean {
  return !nota && segundos > 0 && segundos <= TIMER_CURTO;
}

/** As opções do timer desta mensagem: nunca passam do timer da conversa (RF-26). */
export function opcoesDaMensagem(timerDaConversa: number): number[] {
  return timerDaConversa === 0
    ? [...OPCOES_DO_TIMER]
    : OPCOES_DO_TIMER.filter((segundos) => segundos > 0 && segundos <= timerDaConversa);
}

/** O maior tempo personalizado: o timer da conversa, ou 7 dias sem ele. */
export function maximoPersonalizado(timerDaConversa: number): number {
  return timerDaConversa === 0 ? TIMER_MAXIMO_EM_SEGUNDOS : timerDaConversa;
}

/**
 * O tempo personalizado a partir do número digitado e da unidade, em segundos: de 10 s até
 * `maximo`. `null` quando não é um número inteiro ou passa dos limites.
 */
export function lerPersonalizado(texto: string, unidade: Unidade, maximo: number): number | null {
  const limpo = texto.trim();
  if (!/^\d{1,7}$/.test(limpo)) return null;
  const segundos = Number(limpo) * SEGUNDOS_POR_UNIDADE[unidade];
  return segundos >= TIMER_MINIMO_EM_SEGUNDOS && segundos <= maximo ? segundos : null;
}

/** Um item como a conversa mostra: as notas "expirou" seguidas viram uma só, com a contagem. */
export type ItemNaTela =
  | Extract<ItemDaConversa, { tipo: 'mensagem' }>
  | { readonly tipo: 'nota'; readonly nota: NotaDeSistema; readonly quantas: number };

export function agruparNotas(itens: readonly ItemDaConversa[]): ItemNaTela[] {
  const agrupados: ItemNaTela[] = [];
  for (const item of itens) {
    const anterior = agrupados.at(-1);
    if (
      item.tipo === 'nota' &&
      item.nota.tipo === 'expirou' &&
      anterior?.tipo === 'nota' &&
      anterior.nota.tipo === 'expirou'
    ) {
      agrupados[agrupados.length - 1] = { ...anterior, quantas: anterior.quantas + 1 };
    } else {
      agrupados.push(item.tipo === 'nota' ? { ...item, quantas: 1 } : item);
    }
  }
  return agrupados;
}

/** O texto da nota de sistema, no idioma da tela, em minúsculas como no design. */
export function textoDaNota(t: Traduzir, nota: NotaDeSistema, quantas = 1): string {
  if (nota.tipo === 'expirou') {
    return quantas === 1 ? t('notas.expirou') : t('notas.expiraram', { n: quantas });
  }
  if (nota.tipo === 'prints') {
    return t(nota.bloqueados ? 'notas.printsBloqueados' : 'notas.printsLiberados');
  }
  if (nota.segundos === 0) return t('notas.timerDesligado');
  const tempo = rotuloLongo(t, nota.segundos);
  return nota.anteriores ? t('notas.timerComAnteriores', { tempo }) : t('notas.timer', { tempo });
}
