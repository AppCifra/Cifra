// Balde de fichas: cada pedido gasta uma ficha, e elas voltam aos poucos, na taxa por minuto, até
// encher a rajada (RNF-13). Há um balde por tipo de pedido em cada conexão e, para o que uma conexão
// nova não pode recomeçar, um por chave no relay inteiro (o ID buscado, a caixa do depósito).
import type { Taxa } from '@cifra/protocol';

/** Tira uma ficha. Devolve `false` quando o balde está vazio. */
export type Balde = () => boolean;

/** Um balde para cada chave, com a mesma taxa. */
export interface Baldes {
  /** Tira uma ficha do balde da chave. Devolve `false` quando ele está vazio. */
  tirar(chave: string): boolean;
  /** Esquece os baldes que já voltaram a encher: um balde cheio é o mesmo que nenhum. */
  esquecerCheios(): void;
}

interface Fichas {
  quantas: number;
  ultimo: number;
}

export function criarBaldes(taxa: Taxa, agora: () => number): Baldes {
  const baldes = new Map<string, Fichas>();
  /** Devolve as fichas que voltaram desde a última conta. Relógio que volta não devolve nada. */
  const encher = (fichas: Fichas, instante: number) => {
    const passou = Math.max(0, instante - fichas.ultimo);
    fichas.quantas = Math.min(taxa.rajada, fichas.quantas + (passou * taxa.porMinuto) / 60_000);
    fichas.ultimo = instante;
  };
  return {
    tirar(chave) {
      const instante = agora();
      const fichas = baldes.get(chave) ?? { quantas: taxa.rajada, ultimo: instante };
      baldes.set(chave, fichas);
      encher(fichas, instante);
      if (fichas.quantas < 1) return false;
      fichas.quantas -= 1;
      return true;
    },
    esquecerCheios() {
      const instante = agora();
      for (const [chave, fichas] of baldes) {
        encher(fichas, instante);
        if (fichas.quantas >= taxa.rajada) baldes.delete(chave);
      }
    },
  };
}

export function criarBalde(taxa: Taxa, agora: () => number): Balde {
  const baldes = criarBaldes(taxa, agora);
  return () => baldes.tirar('');
}
