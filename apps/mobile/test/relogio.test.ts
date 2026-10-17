import { verificarRelogio } from '@cifra/core';
import { describe, expect, it } from 'vitest';
import { relogioPorEspera } from '../src/adaptadores/relogio-por-espera.ts';

// O adaptador espera pelos timers do módulo nativo, que andam com o app fora da frente. Aqui as
// esperas são de mentira, com os timers do Node, como a thread do Android: resolvem com `true` no
// prazo, ou com `false` se canceladas antes. No aparelho, a verificação técnica roda a mesma
// conformidade com o módulo de verdade.
const esperas = new Map<
  number,
  { timer: ReturnType<typeof setTimeout>; pronto: (v: boolean) => void }
>();
const relogio = relogioPorEspera({
  esperar: (numero, ms) =>
    new Promise<boolean>((pronto) => {
      const timer = setTimeout(() => {
        esperas.delete(numero);
        pronto(true);
      }, ms);
      esperas.set(numero, { timer, pronto });
    }),
  cancelar: (numero) => {
    const espera = esperas.get(numero);
    if (!espera) return;
    esperas.delete(numero);
    clearTimeout(espera.timer);
    espera.pronto(false);
  },
});

describe('adaptador da porta Relogio', () => {
  it('passa na conformidade do núcleo', async () => {
    expect((await verificarRelogio(relogio)).filter(({ ok }) => !ok)).toEqual([]);
  });

  it('cancelar antes do prazo: a tarefa nunca roda', async () => {
    let rodou = false;
    const cancelar = relogio.agendar(20, () => {
      rodou = true;
    });
    cancelar();
    await new Promise((pronto) => setTimeout(pronto, 50));
    expect(rodou).toBe(false);
  });

  // No aparelho, o `cancelar` do módulo é síncrono e o `esperar` vai pela fila das funções
  // assíncronas: cancelado logo depois de agendar, o cancelamento chegaria antes da espera, que
  // depois venceria e rodaria a tarefa.
  it('cancelar que chega ao módulo antes da espera: a tarefa também não roda', async () => {
    const atrasado = relogioPorEspera({
      esperar: (_numero, ms) =>
        new Promise<boolean>((pronto) => {
          setTimeout(() => {
            pronto(true);
          }, ms);
        }),
      cancelar: () => undefined,
    });
    let rodou = false;
    const cancelar = atrasado.agendar(10, () => {
      rodou = true;
    });
    cancelar();
    await new Promise((pronto) => setTimeout(pronto, 40));
    expect(rodou).toBe(false);
  });
});
