// O ID na tela. Com a fonte do celular grande, ele não cabe numa linha, e o Android quebraria no
// meio de um grupo de 4. Um espaço de largura zero depois de cada hífen marca onde a linha pode
// quebrar, sem aparecer. Copiar continua usando o ID sem ele.

/** Espaço de largura zero: invisível, só deixa a linha quebrar ali. */
const PODE_QUEBRAR = '​';

export function idNaTela(id: string): string {
  return id.replaceAll('-', `-${PODE_QUEBRAR}`);
}
