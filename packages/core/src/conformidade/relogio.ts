// Conformidade da porta Relogio: o tempo anda em milissegundos, o agendamento roda depois do atraso
// e o que foi cancelado não roda.
import type { Relogio } from '../portas/relogio.ts';
import { rodar, type ResultadoDaVerificacao } from './resultado.ts';

/** 1º de janeiro de 2020: um relógio antes disso está errado ou em outra unidade. */
const PISO = Date.UTC(2020, 0, 1);

function esperar(relogio: Relogio, ms: number): Promise<void> {
  return new Promise((pronto) => {
    relogio.agendar(ms, pronto);
  });
}

export function verificarRelogio(relogio: Relogio): Promise<ResultadoDaVerificacao[]> {
  return rodar({
    'relogio.agora-em-milissegundos': () => {
      const antes = relogio.agora();
      const depois = relogio.agora();
      return Number.isInteger(antes) && antes > PISO && depois >= antes;
    },

    // Folga de 10 ms: o timer da plataforma e o relógio arredondam de jeitos diferentes.
    'relogio.agendar-roda-depois-do-atraso': async () => {
      const inicio = relogio.agora();
      await esperar(relogio, 50);
      return relogio.agora() - inicio >= 40;
    },

    'relogio.cancelar-nao-roda': async () => {
      let rodou = false;
      const cancelar = relogio.agendar(10, () => {
        rodou = true;
      });
      cancelar();
      await esperar(relogio, 60);
      cancelar();
      return !rodou;
    },
  });
}
