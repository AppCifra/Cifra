import i18next, { type i18n, type LoggerModule } from 'i18next';
import en from '../locales/en.json';
import ptBR from '../locales/pt-BR.json';

/** Idiomas da interface (RF-49). */
export type Idioma = 'pt-BR' | 'en';

export const IDIOMAS: readonly Idioma[] = ['pt-BR', 'en'];

/** Quando o sistema não está em português nem em inglês, o app abre em inglês. */
export const IDIOMA_PADRAO: Idioma = 'en';

/** Textos de cada idioma. O pt-BR é a referência; o en tem exatamente as mesmas chaves (RNF-22). */
export const TRADUCOES = { 'pt-BR': ptBR, en } as const satisfies Record<Idioma, typeof ptBR>;

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof ptBR };
  }
}

/**
 * Idioma da primeira abertura: o primeiro idioma do sistema que o app fala (RF-49).
 * Recebe as etiquetas do sistema em ordem de preferência, como `pt-BR`, `pt_BR` ou `en-GB`.
 */
export function escolherIdioma(locaisDoSistema: readonly string[]): Idioma {
  for (const local of locaisDoSistema) {
    const lingua = local.split(/[-_]/, 1)[0]?.toLowerCase();
    if (lingua === 'pt') return 'pt-BR';
    if (lingua === 'en') return 'en';
  }
  return IDIOMA_PADRAO;
}

// RNF-05: o i18next escreve erros no console mesmo fora do modo debug. Aqui ele não escreve nada.
const semLog: LoggerModule = {
  type: 'logger',
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Os documentos que o app mostra e que também saem em docs/: a política de privacidade (RF-61),
 * em docs/PRIVACIDADE.md, e os termos de uso (RF-62), em docs/TERMOS.md.
 */
export type Documento = 'politica' | 'termos';

export const DOCUMENTOS: readonly Documento[] = ['politica', 'termos'];

/** Uma seção de um documento: o título e os parágrafos, na ordem dos textos. */
export interface SecaoDoDocumento {
  readonly titulo: string;
  readonly paragrafos: readonly string[];
}

/** Um documento num idioma, seção por seção. É o texto da tela do app e o do arquivo em docs/. */
export function secoesDoDocumento(documento: Documento, idioma: Idioma): SecaoDoDocumento[] {
  return Object.values<Record<string, string> & { titulo: string }>(
    TRADUCOES[idioma][documento].secoes,
  ).map(({ titulo, ...paragrafos }) => ({
    titulo,
    paragrafos: Object.values(paragrafos),
  }));
}

/**
 * Cria uma instância isolada do i18next, já pronta para uso. `changeLanguage` troca os textos
 * na hora, na mesma instância, sem reiniciar nada (RF-49).
 */
export function criarI18n(idioma: Idioma): i18n {
  const instancia = i18next.createInstance();
  void instancia.use(semLog).init({
    lng: idioma,
    supportedLngs: IDIOMAS,
    load: 'currentOnly',
    // Sem idioma reserva: as chaves são as mesmas nos dois idiomas, e os testes garantem isso.
    fallbackLng: false,
    resources: {
      'pt-BR': { translation: TRADUCOES['pt-BR'] },
      en: { translation: TRADUCOES.en },
    },
    initAsync: false,
    // A interface (React Native e web) já escapa o texto ao desenhar.
    interpolation: { escapeValue: false },
  });
  return instancia;
}
