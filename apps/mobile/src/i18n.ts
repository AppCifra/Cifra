// Textos da interface (RF-49, RNF-22). Na primeira abertura, o idioma segue o do sistema; a troca
// nos ajustes muda tudo na hora, sem reiniciar.
import type { IdiomaDasPalavras } from '@cifra/core';
import { criarI18n, escolherIdioma, type Idioma } from '@cifra/i18n';
import { useSyncExternalStore } from 'react';

const idiomaDoSistema = () => escolherIdioma([Intl.DateTimeFormat().resolvedOptions().locale]);

export const i18n = criarI18n(idiomaDoSistema());

export type Traduzir = typeof i18n.t;

const traduzir: Traduzir = i18n.t.bind(i18n);

function assinar(avisar: () => void) {
  i18n.on('languageChanged', avisar);
  return () => {
    i18n.off('languageChanged', avisar);
  };
}

/** A função de tradução. Quem usa desenha de novo quando o idioma muda. */
export function useTextos(): Traduzir {
  useSyncExternalStore(assinar, () => i18n.language);
  return traduzir;
}

/** O idioma da interface agora. */
export function idiomaAtivo(): Idioma {
  return i18n.language === 'pt-BR' ? 'pt-BR' : 'en';
}

/** Troca o idioma das telas na hora; `null` volta ao do sistema (RF-49). */
export function aplicarIdioma(idioma: Idioma | null): void {
  const novo = idioma ?? idiomaDoSistema();
  if (novo !== i18n.language) void i18n.changeLanguage(novo);
}

/** As palavras de uma identidade nova saem na lista do idioma da interface. */
export function idiomaDasPalavras(): IdiomaDasPalavras {
  return i18n.language === 'pt-BR' ? 'portugues' : 'ingles';
}
