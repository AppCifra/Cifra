// Balde de fichas, um por tipo de pedido em cada conexão: cada pedido gasta uma ficha, e elas
// voltam aos poucos, na taxa por minuto, até encher a rajada (RNF-13).
import type { Taxa } from '@cifra/protocol';

/** Tira uma ficha. Devolve `false` quando o balde está vazio. */
export type Balde = () => boolean;

export function criarBalde(taxa: Taxa, agora: () => number): Balde {
  let fichas = taxa.rajada;
  let ultimo = agora();
  return () => {
    const instante = agora();
    const passou = Math.max(0, instante - ultimo);
    fichas = Math.min(taxa.rajada, fichas + (passou * taxa.porMinuto) / 60_000);
    ultimo = instante;
    if (fichas < 1) return false;
    fichas -= 1;
    return true;
  };
}
