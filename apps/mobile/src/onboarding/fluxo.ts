// Fluxo do onboarding (RF-01 a RF-03), sem React: as telas desenham o estado e mandam eventos.
// Nenhum evento leva dado pessoal: gerar não pede nada, e o único texto digitado são as palavras
// da restauração. Nada é gravado aqui: quando o estado chega a `guardando`, o app grava a
// identidade (sessao.ts) e, se não conseguir, manda `naoGuardou`.
//
// Na restauração, a pessoa pode escolher um backup (RF-47) antes de entrar: ele chega aqui já
// aberto com as palavras, e entra no banco junto com a identidade.
import type {
  ConteudoDoBackup,
  Identidade,
  IdentidadeNova,
  ProblemaNasPalavras,
  Restauracao,
} from '@cifra/core';

export type EstadoDoOnboarding =
  /** `nova` é `null` até a pessoa gerar a identidade. */
  | { readonly tela: 'abertura'; readonly nova: IdentidadeNova | null }
  | {
      readonly tela: 'palavras';
      readonly nova: IdentidadeNova;
      /** O painel que pede confirmação para pular está aberto. */
      readonly confirmandoPulo: boolean;
      readonly naoGuardou: boolean;
    }
  | { readonly tela: 'restaurar'; readonly problema: ProblemaNasPalavras | null }
  | {
      readonly tela: 'restaurada';
      readonly identidade: Identidade;
      readonly naoGuardou: boolean;
      /** O backup escolhido, já aberto com as palavras; `null` sem backup. */
      readonly backup: ConteudoDoBackup | null;
      /** O último arquivo escolhido não abriu com estas palavras. */
      readonly backupRecusado: boolean;
    }
  | {
      readonly tela: 'guardando';
      readonly identidade: Identidade;
      /** Para onde voltar se não conseguir guardar. */
      readonly origem: 'palavras' | 'restaurada';
      readonly nova: IdentidadeNova | null;
      readonly backup: ConteudoDoBackup | null;
    };

export type EventoDoOnboarding =
  | { readonly tipo: 'gerada'; readonly nova: IdentidadeNova }
  | { readonly tipo: 'continuar' }
  | { readonly tipo: 'anotei' }
  | { readonly tipo: 'pular' }
  | { readonly tipo: 'confirmarPulo' }
  | { readonly tipo: 'cancelarPulo' }
  | { readonly tipo: 'irParaRestaurar' }
  | { readonly tipo: 'restauracao'; readonly restauracao: Restauracao }
  /** O arquivo escolhido, aberto com as palavras; `null` se não abriu. */
  | { readonly tipo: 'backup'; readonly backup: ConteudoDoBackup | null }
  | { readonly tipo: 'entrar' }
  | { readonly tipo: 'voltar' }
  | { readonly tipo: 'naoGuardou' };

export const INICIO: EstadoDoOnboarding = { tela: 'abertura', nova: null };

const guardando = (nova: IdentidadeNova): EstadoDoOnboarding => ({
  tela: 'guardando',
  identidade: nova.identidade,
  origem: 'palavras',
  nova,
  backup: null,
});

/** Próximo estado. Evento que não faz sentido na tela atual não muda nada. */
export function avancar(
  estado: EstadoDoOnboarding,
  evento: EventoDoOnboarding,
): EstadoDoOnboarding {
  switch (estado.tela) {
    case 'abertura':
      if (evento.tipo === 'gerada' && !estado.nova) return { tela: 'abertura', nova: evento.nova };
      if (evento.tipo === 'continuar' && estado.nova) {
        return { tela: 'palavras', nova: estado.nova, confirmandoPulo: false, naoGuardou: false };
      }
      if (evento.tipo === 'irParaRestaurar') return { tela: 'restaurar', problema: null };
      return estado;

    case 'palavras':
      if (estado.confirmandoPulo) {
        if (evento.tipo === 'confirmarPulo') return guardando(estado.nova);
        if (evento.tipo === 'cancelarPulo' || evento.tipo === 'voltar') {
          return { ...estado, confirmandoPulo: false };
        }
        return estado;
      }
      if (evento.tipo === 'anotei') return guardando(estado.nova);
      if (evento.tipo === 'pular') return { ...estado, confirmandoPulo: true, naoGuardou: false };
      if (evento.tipo === 'voltar') return { tela: 'abertura', nova: estado.nova };
      return estado;

    case 'restaurar':
      if (evento.tipo === 'restauracao') {
        return evento.restauracao.ok
          ? {
              tela: 'restaurada',
              identidade: evento.restauracao.identidade,
              naoGuardou: false,
              backup: null,
              backupRecusado: false,
            }
          : { tela: 'restaurar', problema: evento.restauracao.problema };
      }
      if (evento.tipo === 'voltar') return INICIO;
      return estado;

    case 'restaurada':
      if (evento.tipo === 'entrar') {
        return {
          tela: 'guardando',
          identidade: estado.identidade,
          origem: 'restaurada',
          nova: null,
          backup: estado.backup,
        };
      }
      if (evento.tipo === 'backup') {
        // Um arquivo que não abriu não tira o backup que já estava escolhido.
        return evento.backup
          ? { ...estado, backup: evento.backup, backupRecusado: false, naoGuardou: false }
          : { ...estado, backupRecusado: true, naoGuardou: false };
      }
      if (evento.tipo === 'voltar') return { tela: 'restaurar', problema: null };
      return estado;

    case 'guardando':
      if (evento.tipo !== 'naoGuardou') return estado;
      if (estado.origem === 'palavras' && estado.nova) {
        return { tela: 'palavras', nova: estado.nova, confirmandoPulo: false, naoGuardou: true };
      }
      return {
        tela: 'restaurada',
        identidade: estado.identidade,
        naoGuardou: true,
        backup: estado.backup,
        backupRecusado: false,
      };
  }
}
