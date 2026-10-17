// Relógios dos testes: o de verdade (Date.now e setTimeout), que passa pela conformidade, e um que o
// teste controla, para conferir prazos e intervalos sem esperar.
import type { Relogio } from '../../src/index.ts';

export const relogioDoNode: Relogio = {
  agora: () => Date.now(),
  agendar(atraso, tarefa) {
    const timer = setTimeout(tarefa, atraso);
    return () => {
      clearTimeout(timer);
    };
  },
};

/** 1º de outubro de 2026, 10:17:23.456: fora da hora cheia, de propósito. */
export const INICIO = Date.UTC(2026, 9, 1, 10, 17, 23, 456);

interface Tarefa {
  readonly quando: number;
  readonly ordem: number;
  readonly tarefa: () => void;
}

export class RelogioDeTeste implements Relogio {
  #agora = INICIO;
  #proxima = 0;
  readonly #tarefas = new Map<number, Tarefa>();

  agora(): number {
    return this.#agora;
  }

  agendar(atraso: number, tarefa: () => void): () => void {
    const ordem = this.#proxima++;
    this.#tarefas.set(ordem, { quando: this.#agora + Math.max(0, atraso), ordem, tarefa });
    return () => this.#tarefas.delete(ordem);
  }

  /** Os instantes agendados que ainda não rodaram, em ordem. */
  get agendados(): number[] {
    return [...this.#tarefas.values()].map(({ quando }) => quando).sort((a, b) => a - b);
  }

  /** Anda `ms` e roda, em ordem, o que vencer no caminho, inclusive o agendado durante. */
  avancar(ms: number): void {
    const fim = this.#agora + ms;
    for (;;) {
      const [proxima] = [...this.#tarefas.values()]
        .filter(({ quando }) => quando <= fim)
        .sort((a, b) => a.quando - b.quando || a.ordem - b.ordem);
      if (!proxima) break;
      this.#tarefas.delete(proxima.ordem);
      this.#agora = Math.max(this.#agora, proxima.quando);
      proxima.tarefa();
    }
    this.#agora = fim;
  }
}
