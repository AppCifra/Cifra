// Os ajustes deste aparelho, numa linha só do banco cifrado (migração 5): o timer padrão das
// conversas novas (RF-50), o timer da nota pessoal, que não tem contato, se os anexos baixam
// sozinhos (RF-57, migração 6) e os de privacidade (migração 7): confirmação de leitura (RF-17),
// indicador de digitação (RF-18), o prazo do bloqueio sozinho (RF-40) e o bloqueio de prints
// (RF-41). Tema, idioma, notificações e Tor ficam fora daqui: valem com o app bloqueado, quando
// este banco está fechado.
import { numeroDe } from '../banco/linhas.ts';
import type { Armazenamento } from '../portas/armazenamento.ts';

export interface AjustesDoTimer {
  /** Com que timer toda conversa nova começa; 0 é sem timer. */
  readonly timerPadrao: number;
  /** O timer das notas pessoais; 0 é sem timer. */
  readonly timerDaNota: number;
}

export async function ajustesDoTimer(banco: Armazenamento): Promise<AjustesDoTimer> {
  const [linha] = await banco.consultar(
    'SELECT timer_padrao, timer_da_nota FROM ajustes WHERE unica = 1',
  );
  if (!linha) throw new Error('ajustes ilegíveis no banco');
  return {
    timerPadrao: numeroDe(linha, 'timer_padrao'),
    timerDaNota: numeroDe(linha, 'timer_da_nota'),
  };
}

export async function mudarTimerPadrao(banco: Armazenamento, segundos: number): Promise<void> {
  await banco.executar('UPDATE ajustes SET timer_padrao = ? WHERE unica = 1', [segundos]);
}

export async function mudarTimerDaNota(banco: Armazenamento, segundos: number): Promise<void> {
  await banco.executar('UPDATE ajustes SET timer_da_nota = ? WHERE unica = 1', [segundos]);
}

/** Se o anexo que chega baixa sozinho (RF-57). Desligado, só baixa quando a pessoa tocar. */
export async function baixarSozinho(banco: Armazenamento): Promise<boolean> {
  const [linha] = await banco.consultar('SELECT baixar_sozinho FROM ajustes WHERE unica = 1');
  if (!linha) throw new Error('ajustes ilegíveis no banco');
  return numeroDe(linha, 'baixar_sozinho') === 1;
}

export async function mudarBaixarSozinho(banco: Armazenamento, ligado: boolean): Promise<void> {
  await banco.executar('UPDATE ajustes SET baixar_sozinho = ? WHERE unica = 1', [ligado ? 1 : 0]);
}

/**
 * Os prazos do bloqueio sozinho (RF-40), em segundos parado: ao sair do app, 1 minuto, 5 minutos
 * (o padrão), 15 minutos e 1 hora.
 */
export const PRAZOS_DO_BLOQUEIO = [0, 60, 300, 900, 3600] as const;

export interface AjustesDePrivacidade {
  /**
   * A confirmação de leitura (RF-17): ligada, o contato fica sabendo quando você leu, e você vê
   * quando ele leu. Desligada por padrão.
   */
  readonly confirmacoesDeLeitura: boolean;
  /**
   * O indicador de digitação (RF-18): ligado, o contato vê quando você está escrevendo, e você vê
   * quando ele escreve. Desligado por padrão.
   */
  readonly indicadorDeDigitacao: boolean;
  /** Segundos parado até o app bloquear sozinho (RF-40); 0 é ao sair do app. */
  readonly bloquearSozinho: number;
  /** Prints e gravações de tela saem em branco (RF-41). Ligado por padrão. */
  readonly bloquearCapturas: boolean;
}

const COLUNAS_DE_PRIVACIDADE = {
  confirmacoesDeLeitura: 'confirmacoes_de_leitura',
  indicadorDeDigitacao: 'indicador_de_digitacao',
  bloquearSozinho: 'bloquear_sozinho',
  bloquearCapturas: 'bloquear_capturas',
} as const satisfies Record<keyof AjustesDePrivacidade, string>;

export async function ajustesDePrivacidade(banco: Armazenamento): Promise<AjustesDePrivacidade> {
  const [linha] = await banco.consultar(
    `SELECT ${Object.values(COLUNAS_DE_PRIVACIDADE).join(', ')} FROM ajustes WHERE unica = 1`,
  );
  if (!linha) throw new Error('ajustes ilegíveis no banco');
  return {
    confirmacoesDeLeitura: numeroDe(linha, 'confirmacoes_de_leitura') === 1,
    indicadorDeDigitacao: numeroDe(linha, 'indicador_de_digitacao') === 1,
    bloquearSozinho: numeroDe(linha, 'bloquear_sozinho'),
    bloquearCapturas: numeroDe(linha, 'bloquear_capturas') === 1,
  };
}

/** O prazo é um dos de `PRAZOS_DO_BLOQUEIO`. */
export function prazoDoBloqueioValido(segundos: number): boolean {
  return (PRAZOS_DO_BLOQUEIO as readonly number[]).includes(segundos);
}

/** Muda só os ajustes de privacidade que vierem; quem chama já conferiu o prazo. */
export async function mudarAjustesDePrivacidade(
  banco: Armazenamento,
  mudanca: Partial<AjustesDePrivacidade>,
): Promise<void> {
  for (const [chave, coluna] of Object.entries(COLUNAS_DE_PRIVACIDADE)) {
    const valor = mudanca[chave as keyof AjustesDePrivacidade];
    if (valor === undefined) continue;
    await banco.executar(`UPDATE ajustes SET ${coluna} = ? WHERE unica = 1`, [
      typeof valor === 'boolean' ? (valor ? 1 : 0) : valor,
    ]);
  }
}

/** As colunas da linha dos ajustes, todas. */
const COLUNAS_DOS_AJUSTES = [
  'timer_padrao',
  'timer_da_nota',
  'baixar_sozinho',
  'confirmacoes_de_leitura',
  'indicador_de_digitacao',
  'bloquear_sozinho',
  'bloquear_capturas',
] as const;

/** A linha dos ajustes como está no banco. */
export type LinhaDosAjustes = Readonly<Record<(typeof COLUNAS_DOS_AJUSTES)[number], number>>;

export async function linhaDosAjustes(banco: Armazenamento): Promise<LinhaDosAjustes> {
  const [linha] = await banco.consultar(
    `SELECT ${COLUNAS_DOS_AJUSTES.join(', ')} FROM ajustes WHERE unica = 1`,
  );
  if (!linha) throw new Error('ajustes ilegíveis no banco');
  return Object.fromEntries(
    COLUNAS_DOS_AJUSTES.map((coluna) => [coluna, numeroDe(linha, coluna)]),
  ) as LinhaDosAjustes;
}

/**
 * Grava a linha inteira dos ajustes: o cofre das conversas ocultas usa os mesmos do principal,
 * copiados ao abrir e a cada mudança.
 */
export async function gravarLinhaDosAjustes(
  banco: Armazenamento,
  linha: LinhaDosAjustes,
): Promise<void> {
  await banco.executar(
    `UPDATE ajustes SET ${COLUNAS_DOS_AJUSTES.map((coluna) => `${coluna} = ?`).join(', ')}
      WHERE unica = 1`,
    COLUNAS_DOS_AJUSTES.map((coluna) => linha[coluna]),
  );
}
