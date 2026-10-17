// Porta do tempo. Injetada para que timers, expiração e reenvio sejam testáveis sem esperar. O
// núcleo compila sem DOM e sem tipos de Node, então nem `setTimeout` ele conhece: todo prazo
// passa por aqui.

export interface Relogio {
  /** Milissegundos desde 1970-01-01T00:00:00Z, na mesma base de `Date.now()`. */
  agora(): number;
  /**
   * Roda `tarefa` uma vez, daqui a `atraso` milissegundos. Devolve a função que cancela; cancelar
   * depois de rodar não faz nada.
   */
  agendar(atraso: number, tarefa: () => void): () => void;
}
