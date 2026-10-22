// Verificações dos arquivos de tradução, usadas pelos testes.

/** Árvore de traduções: cada folha é um texto. */
export interface Arvore {
  readonly [chave: string]: string | Arvore;
}

/** Todas as folhas da árvore, no formato `grupo.subgrupo.chave` para texto. */
export function folhas(arvore: Arvore, prefixo = ''): Map<string, string> {
  const resultado = new Map<string, string>();
  for (const [chave, valor] of Object.entries(arvore)) {
    const caminho = prefixo ? `${prefixo}.${chave}` : chave;
    if (typeof valor === 'string') {
      resultado.set(caminho, valor);
    } else if (typeof valor === 'object' && !Array.isArray(valor)) {
      for (const [subcaminho, texto] of folhas(valor, caminho)) resultado.set(subcaminho, texto);
    } else {
      throw new Error(`${caminho}: tradução precisa ser texto ou grupo de textos`);
    }
  }
  return resultado;
}

/** Chaves de texto que existem em `referencia` e não existem em `outra`. */
export function chavesFaltando(referencia: Arvore, outra: Arvore): string[] {
  const existentes = folhas(outra);
  return [...folhas(referencia).keys()].filter((chave) => !existentes.has(chave));
}

/** Variáveis de interpolação `{{nome}}` do texto, sem repetição e em ordem alfabética. */
export function variaveis(texto: string): string[] {
  const nomes = [...texto.matchAll(/\{\{\s*([^{}\s,]+)[^{}]*\}\}/g)].map(
    (achado) => achado[1] ?? '',
  );
  return [...new Set(nomes)].sort();
}

/** O que fere a voz do design: exclamação e emoji (RNF-17). */
export function problemasDeVoz(texto: string): string[] {
  const problemas: string[] = [];
  if (/[!¡]/.test(texto)) problemas.push('exclamação');
  if (/[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE0F}]/u.test(texto)) {
    problemas.push('emoji');
  }
  return problemas;
}

// Tabela "Textos a evitar" do SPEC, coluna "Evitar", e as promessas que o guia de voz proíbe.
// Estes trechos nunca podem voltar, em nenhum idioma.
const TRECHOS_PROIBIDOS = [
  'sem e-mail. sem metadados',
  'neste aparelho — e só existe aqui',
  'nada é guardado em servidor',
  'não há backup em lugar nenhum',
  'build reproduzível',
  'sem coleta de dados',
  '100% seguro',
  'nível militar',
  'nothing is stored on a server',
  'no backup anywhere',
  'reproducible build',
  'no data collection',
  '100% secure',
  'military-grade',
  'military grade',
];

// Textos que só podem aparecer com o complemento que o SPEC mandou acrescentar.
const TEXTOS_INTEIROS_PROIBIDOS = ['também oculta o app no multitarefa'];

/** Diz se o texto traz de volta algo que o SPEC mandou corrigir. */
export function voltaTextoCorrigido(texto: string): boolean {
  const normalizado = texto.normalize('NFC').toLowerCase().trim();
  const semPontoFinal = normalizado.replace(/\.$/, '');
  return (
    TRECHOS_PROIBIDOS.some((trecho) => normalizado.includes(trecho)) ||
    TEXTOS_INTEIROS_PROIBIDOS.includes(semPontoFinal)
  );
}
