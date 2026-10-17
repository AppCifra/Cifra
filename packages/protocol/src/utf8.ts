// UTF-8 estrito para o texto das mensagens. O protocolo compila sem DOM (RNF-15), então não conta
// com TextEncoder nem TextDecoder: a codificação fica aqui, igual em toda plataforma. A leitura
// recusa o que não é UTF-8 válido: sequência cortada, forma longa demais, surrogate e código acima
// de U+10FFFF. Quem manda texto fora disso não é o app oficial.

/** Bytes UTF-8 de um texto. Lança com surrogate sem par: não há caractere para codificar. */
export function utf8(texto: string): Uint8Array {
  const bytes: number[] = [];
  for (const caractere of texto) {
    const ponto = caractere.codePointAt(0) ?? 0;
    if (ponto >= 0xd800 && ponto <= 0xdfff) throw new RangeError('surrogate sem par');
    if (ponto < 0x80) {
      bytes.push(ponto);
    } else if (ponto < 0x800) {
      bytes.push(0xc0 | (ponto >> 6), 0x80 | (ponto & 0x3f));
    } else if (ponto < 0x10000) {
      bytes.push(0xe0 | (ponto >> 12), 0x80 | ((ponto >> 6) & 0x3f), 0x80 | (ponto & 0x3f));
    } else {
      bytes.push(
        0xf0 | (ponto >> 18),
        0x80 | ((ponto >> 12) & 0x3f),
        0x80 | ((ponto >> 6) & 0x3f),
        0x80 | (ponto & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

/** Texto de bytes UTF-8, ou `null` se os bytes não forem UTF-8 válido. */
export function deUtf8(bytes: Uint8Array): string | null {
  let texto = '';
  let i = 0;
  while (i < bytes.length) {
    const primeiro = bytes[i] ?? 0;
    if (primeiro < 0x80) {
      texto += String.fromCharCode(primeiro);
      i++;
      continue;
    }
    // Quantos bytes de continuação, o menor código que essa forma pode ter e os bits do primeiro.
    let seguintes: number;
    let minimo: number;
    let ponto: number;
    if (primeiro >= 0xc2 && primeiro <= 0xdf) {
      [seguintes, minimo, ponto] = [1, 0x80, primeiro & 0x1f];
    } else if (primeiro >= 0xe0 && primeiro <= 0xef) {
      [seguintes, minimo, ponto] = [2, 0x800, primeiro & 0x0f];
    } else if (primeiro >= 0xf0 && primeiro <= 0xf4) {
      [seguintes, minimo, ponto] = [3, 0x10000, primeiro & 0x07];
    } else {
      return null;
    }
    if (i + seguintes >= bytes.length) return null;
    for (let j = 1; j <= seguintes; j++) {
      const continuacao = bytes[i + j] ?? 0;
      if ((continuacao & 0xc0) !== 0x80) return null;
      ponto = (ponto << 6) | (continuacao & 0x3f);
    }
    if (ponto < minimo || ponto > 0x10ffff || (ponto >= 0xd800 && ponto <= 0xdfff)) return null;
    texto += String.fromCodePoint(ponto);
    i += seguintes + 1;
  }
  return texto;
}
