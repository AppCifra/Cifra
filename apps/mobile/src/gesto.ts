// O arrastar para responder (RF-55), sem React, para o teste no Node: quando o dedo está arrastando
// para responder, quanto o balão anda com ele e quando soltar vira resposta. O balão segue o dedo
// até o limiar e, dali em diante, anda cada vez menos, sem passar do limite.

/** O máximo que o balão anda, em px. */
export const LIMITE_DO_ARRASTE = 80;

/** Soltar depois disto responde. */
export const LIMIAR_DA_RESPOSTA = 60;

/** Até aqui o dedo ainda pode estar só tocando no balão. */
const FOLGA = 10;

/** Para a direita e bem mais de lado que de pé: assim não briga com a rolagem da conversa. */
export function eArrasteParaResponder(dx: number, dy: number): boolean {
  return dx > FOLGA && dx > 2 * Math.abs(dy);
}

/** Quanto o balão anda quando o dedo andou `dx` desde que o arraste começou. */
export function deslocamentoDoArraste(dx: number): number {
  if (dx <= LIMIAR_DA_RESPOSTA) return Math.max(0, dx);
  // Depois do limiar, freia sem tranco: começa no passo do dedo e se aproxima do limite.
  const resto = LIMITE_DO_ARRASTE - LIMIAR_DA_RESPOSTA;
  return LIMIAR_DA_RESPOSTA + resto * (1 - Math.exp(-(dx - LIMIAR_DA_RESPOSTA) / resto));
}

/** Soltou com o dedo em `dx`: responde se passou do limiar. Voltar o dedo antes de soltar desiste. */
export function respondeAoSoltar(dx: number): boolean {
  return dx >= LIMIAR_DA_RESPOSTA;
}
