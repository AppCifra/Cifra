// A porta Relogio sobre timers que esperam e podem ser cancelados (no Android, os do módulo nativo,
// que andam com o app fora da frente). Sem React Native: os testes rodam no Node.
import type { Relogio } from '@cifra/core';

export interface Esperas {
  /** Resolve com `true` depois de `ms`, ou com `false` se for cancelado antes. */
  esperar(numero: number, ms: number): Promise<boolean>;
  cancelar(numero: number): void;
}

export function relogioPorEspera(esperas: Esperas): Relogio {
  let proximo = 1;
  return {
    agora: () => Date.now(),
    agendar(atraso, tarefa) {
      const numero = proximo++;
      // O cancelamento vale aqui também: no Android, ele pode chegar ao módulo antes da espera, que
      // então venceria como se nada tivesse acontecido.
      let cancelado = false;
      void esperas.esperar(numero, Math.max(0, atraso)).then((venceu) => {
        if (venceu && !cancelado) tarefa();
      });
      return () => {
        cancelado = true;
        esperas.cancelar(numero);
      };
    },
  };
}
