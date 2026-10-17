// Adaptador da porta Relogio no Android: a hora do relógio do aparelho e os timers do módulo
// nativo, que continuam andando com o app fora da frente (os do JS param). Assim a reconexão, o
// reenvio da fila, as temporárias e os anexos seguem enquanto o app não bloqueia, e o vigia do app
// bloqueado reconecta sozinho (RF-42).
import type { Relogio } from '@cifra/core';
import { relogioNativo } from '../../modules/cifra-plataforma/index.ts';
import { relogioPorEspera } from './relogio-por-espera.ts';

export const relogio: Relogio = relogioPorEspera(relogioNativo);

/** O prazo do bloqueio sozinho (RF-40): o alarme que acorda o aparelho e a capa ao voltar. */
export const alarmeDoBloqueio = {
  decorrido: () => relogioNativo.decorrido(),
  armar: (ms: number, corDoFundo: string) => {
    relogioNativo.armarBloqueio(ms, corDoFundo);
  },
  desarmar: () => {
    relogioNativo.desarmarBloqueio();
  },
  aoVencer: (ouvinte: () => void) => {
    const assinatura = relogioNativo.addListener('bloquear', ouvinte);
    return () => {
      assinatura.remove();
    };
  },
  descobrir: () => relogioNativo.descobrir().catch(() => undefined),
};
