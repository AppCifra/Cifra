// O que a lista e a conversa mostram de cada conversa e mensagem, sem React: nome, prévia (com o
// tipo do anexo) e horários. Os horários são sempre do relógio deste aparelho: a enviada pela hora em que saiu
// daqui, a recebida pela hora em que chegou.
import type { Mensagem, ResumoDaConversa } from '@cifra/core';
import type { Traduzir } from './i18n.ts';

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;

const DIA = 24 * 3_600_000;

const doisDigitos = (n: number) => String(n).padStart(2, '0');

/** O nome na lista e no cabeçalho: o apelido, ou "anon·" e o começo do ID, como no design. */
export function nomeDaConversa(
  t: Traduzir,
  resumo: Pick<ResumoDaConversa, 'id' | 'tipo' | 'apelido'>,
): string {
  if (resumo.tipo === 'nota') return t('conversas.nota');
  return resumo.apelido ?? t('conversas.anonimo', { inicio: resumo.id.slice(0, 4) });
}

/** A hora em que a mensagem entrou nesta conversa, neste aparelho. */
export function instanteDaMensagem(mensagem: Mensagem): number {
  return mensagem.deMim ? mensagem.enviadaEm : (mensagem.recebidaEm ?? mensagem.enviadaEm);
}

/**
 * Uma mensagem numa linha: o texto; num anexo, "foto", "vídeo" ou "documento", com a legenda
 * depois, se houver. Serve à prévia da lista e à citação de uma resposta.
 */
export function textoDaPrevia(t: Traduzir, mensagem: Pick<Mensagem, 'tipo' | 'texto'>): string {
  const texto = mensagem.texto.replace(/\s+/g, ' ').trim();
  if (mensagem.tipo === 'texto') return texto;
  const tipo = t(`conversas.previa.${mensagem.tipo}`);
  return texto === '' ? tipo : `${tipo} · ${texto}`;
}

/** A prévia da lista, numa linha: a última mensagem, com "você:" nas suas. */
export function previaDaConversa(t: Traduzir, resumo: ResumoDaConversa): string {
  const { ultima } = resumo;
  if (!ultima) return t('conversas.semMensagens');
  const texto = textoDaPrevia(t, ultima);
  return ultima.deMim && resumo.tipo !== 'nota' ? t('conversas.voce', { texto }) : texto;
}

/** "14:02". */
export function hora(instante: number): string {
  const data = new Date(instante);
  return `${doisDigitos(data.getHours())}:${doisDigitos(data.getMinutes())}`;
}

/** A data com o ano inteiro, no formato do idioma: "15/10/2026". */
export function dataComAno(t: Traduzir, instante: number): string {
  const data = new Date(instante);
  return t('tempo.dataComAno', {
    dia: doisDigitos(data.getDate()),
    mes: doisDigitos(data.getMonth() + 1),
    ano: String(data.getFullYear()),
  });
}

/** O horário da lista: a hora, se for hoje; "ontem"; o dia da semana, até 6 dias; senão a data. */
export function horarioDaLista(t: Traduzir, instante: number, agora: number): string {
  const data = new Date(instante);
  const hoje = new Date(agora);
  const meiaNoite = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime();
  if (instante >= meiaNoite) return hora(instante);
  const inicioDoDia = new Date(data.getFullYear(), data.getMonth(), data.getDate()).getTime();
  const diasAtras = Math.round((meiaNoite - inicioDoDia) / DIA);
  if (diasAtras === 1) return t('tempo.ontem');
  if (diasAtras < 7) return t(`tempo.dias.${DIAS[data.getDay()] ?? 'dom'}`);
  const dia = doisDigitos(data.getDate());
  const mes = doisDigitos(data.getMonth() + 1);
  if (data.getFullYear() === hoje.getFullYear()) return t('tempo.data', { dia, mes });
  return t('tempo.dataComAno', { dia, mes, ano: String(data.getFullYear()).slice(-2) });
}
