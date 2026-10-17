// Identicon: a grade espelhada que o Cifra usa no lugar de foto, 6×6 para a própria identidade e
// 5×5 para os contatos. O algoritmo é o do protótipo do design (hash FNV-1a do texto do ID e o
// gerador mulberry32), para o desenho sair igual. É só visual: poucos bits decidem o desenho,
// então ele não serve para conferir ninguém. Quem confere é o número de segurança.

export type Celula = 'vazia' | 'cheia' | 'acento';

export type Grade = 5 | 6;

function fnv1a(texto: string): number {
  let hash = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    hash ^= texto.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(semente: number): () => number {
  let a = semente >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * As células da grade, linha por linha. A metade esquerda é sorteada e a direita é o espelho.
 * Uma célula cheia e a espelhada dela levam o acento (na coluna do meio da grade 5, é uma só).
 */
export function celulasDoIdenticon(id: string, grade: Grade): Celula[] {
  const sortear = mulberry32(fnv1a(id));
  const metade = Math.ceil(grade / 2);
  const celulas: Celula[] = [];
  for (let y = 0; y < grade; y++) {
    const linha = Array.from({ length: metade }, () => sortear() < 0.5);
    for (let x = 0; x < grade; x++) {
      celulas.push(linha[x < metade ? x : grade - 1 - x] ? 'cheia' : 'vazia');
    }
  }

  const cheias = celulas.flatMap((celula, i) => (celula === 'cheia' ? [i] : []));
  const escolhida = cheias[Math.floor(sortear() * cheias.length)];
  if (escolhida !== undefined) {
    const espelho = Math.floor(escolhida / grade) * grade + (grade - 1 - (escolhida % grade));
    celulas[escolhida] = 'acento';
    celulas[espelho] = 'acento';
  }
  return celulas;
}
