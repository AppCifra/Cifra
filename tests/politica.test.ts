import { describe, expect, it } from 'vitest';
import { QUANTIDADE_DE_PALAVRAS } from '../packages/core/src/identidade/palavras.ts';
import { IDIOMAS, secoesDaPolitica, TRADUCOES, type Idioma } from '../packages/i18n/src/index.ts';
import {
  RETENCAO_DA_CAIXA_EM_DIAS,
  RETENCAO_DO_ANEXO_EM_DIAS,
  RETENCAO_DO_CARTAO_EM_DIAS,
  RETENCAO_DO_PACOTE_EM_DIAS,
  TAXAS_DO_RELAY,
} from '../packages/protocol/src/limites.ts';
import { lerTexto } from './util.ts';

// A política de privacidade (RF-61) fica nos textos do app, e o docs/PRIVACIDADE.md sai deles: o
// texto do app e o público são o mesmo. Os prazos e os números que ela diz são os do código. Depois
// de mudar o texto, gere o arquivo de novo:
//   pnpm exec vitest run tests/politica.test.ts -u

type Secoes = Readonly<Record<string, Readonly<Record<string, string>>>>;

const secoesDe = (idioma: Idioma): Secoes => TRADUCOES[idioma].politica.secoes;

function texto(idioma: Idioma, secao: string, paragrafo: string): string {
  const achado = secoesDe(idioma)[secao]?.[paragrafo];
  if (achado === undefined) throw new Error(`${idioma}: politica.secoes.${secao}.${paragrafo}`);
  return achado;
}

/** A âncora que o GitHub dá a um título: minúsculas, sem pontuação, hífen no lugar do espaço. */
const ancora = (titulo: string) =>
  titulo
    .toLowerCase()
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .replaceAll(' ', '-');

/** O docs/PRIVACIDADE.md: a política em português e, embaixo, em inglês. */
function politicaEmMarkdown(): string {
  const idiomas = IDIOMAS.map((idioma) => {
    const { documento, atualizada } = TRADUCOES[idioma].politica;
    return [
      `# ${documento}`,
      atualizada,
      ...secoesDaPolitica(idioma).flatMap(({ titulo, paragrafos }) => [
        `## ${titulo}`,
        ...paragrafos,
      ]),
    ].join('\n\n');
  });
  const emIngles = `[${TRADUCOES.en.idiomas.en}](#${ancora(TRADUCOES.en.politica.documento)})`;
  return `${emIngles}\n\n${idiomas.join('\n\n---\n\n')}\n`;
}

/** O prazo da área de transferência fica no adaptador do app, que só roda no aparelho. */
const segundosNaAreaDeTransferencia = Number(
  /const SEGUNDOS_NA_AREA_DE_TRANSFERENCIA = (\d+);/.exec(
    lerTexto('apps/mobile/src/adaptadores/anexos.ts'),
  )?.[1],
);

const UNIDADES = {
  dias: { 'pt-BR': 'dias', en: 'days' },
  palavras: { 'pt-BR': 'palavras', en: 'words' },
  segundos: { 'pt-BR': 'segundos', en: 'seconds' },
} as const satisfies Record<string, Record<Idioma, string>>;

interface Numero {
  readonly secao: string;
  readonly paragrafo: string;
  readonly valor: number;
  readonly unidade: keyof typeof UNIDADES;
}

/** Cada número da política, no parágrafo em que aparece, com o valor que o código usa. */
const NUMEROS: readonly Numero[] = [
  { secao: 'servidor', paragrafo: 'cartao', valor: RETENCAO_DO_CARTAO_EM_DIAS, unidade: 'dias' },
  {
    secao: 'servidor',
    paragrafo: 'mensagens',
    valor: RETENCAO_DO_PACOTE_EM_DIAS,
    unidade: 'dias',
  },
  { secao: 'servidor', paragrafo: 'arquivos', valor: RETENCAO_DO_ANEXO_EM_DIAS, unidade: 'dias' },
  { secao: 'servidor', paragrafo: 'caixa', valor: RETENCAO_DA_CAIXA_EM_DIAS, unidade: 'dias' },
  { secao: 'apagar', paragrafo: 'prazos', valor: RETENCAO_DO_CARTAO_EM_DIAS, unidade: 'dias' },
  { secao: 'apagar', paragrafo: 'prazos', valor: RETENCAO_DO_PACOTE_EM_DIAS, unidade: 'dias' },
  // As caixas das conversas ocultas, que o pânico não apaga.
  { secao: 'apagar', paragrafo: 'prazos', valor: RETENCAO_DA_CAIXA_EM_DIAS, unidade: 'dias' },
  { secao: 'apagar', paragrafo: 'semCelular', valor: QUANTIDADE_DE_PALAVRAS, unidade: 'palavras' },
  { secao: 'backup', paragrafo: 'arquivo', valor: QUANTIDADE_DE_PALAVRAS, unidade: 'palavras' },
  { secao: 'limites', paragrafo: 'palavras', valor: QUANTIDADE_DE_PALAVRAS, unidade: 'palavras' },
  {
    secao: 'limites',
    paragrafo: 'copiar',
    valor: segundosNaAreaDeTransferencia,
    unidade: 'segundos',
  },
];

describe('política de privacidade (RF-61)', () => {
  it('o docs/PRIVACIDADE.md é o texto do app, nos dois idiomas', async () => {
    await expect(politicaEmMarkdown()).toMatchFileSnapshot('../docs/PRIVACIDADE.md');
  });

  it('cada número da política é o do código, no parágrafo em que aparece', () => {
    const diferentes = IDIOMAS.flatMap((idioma) =>
      Object.entries(secoesDe(idioma)).flatMap(([secao, textos]) =>
        Object.entries(textos).flatMap(([paragrafo, escrito]) => {
          const achados = [...escrito.matchAll(/\d+/g)].map(([numero]) => Number(numero));
          const esperados = NUMEROS.filter(
            (numero) => numero.secao === secao && numero.paragrafo === paragrafo,
          ).map(({ valor }) => valor);
          const ordenar = (lista: number[]) => lista.sort((a, b) => a - b).join();
          return ordenar(achados) === ordenar(esperados)
            ? []
            : [`${idioma}: ${secao}.${paragrafo}`];
        }),
      ),
    );
    expect(diferentes).toEqual([]);
  });

  it('os números vêm com a unidade, nos dois idiomas', () => {
    expect(segundosNaAreaDeTransferencia).toBeGreaterThan(0);
    for (const idioma of IDIOMAS) {
      for (const { secao, paragrafo, valor, unidade } of NUMEROS) {
        expect(texto(idioma, secao, paragrafo)).toContain(`${valor} ${UNIDADES[unidade][idioma]}`);
      }
    }
  });

  it('o relay esquece as contas de taxa em cerca de uma hora', () => {
    // Um balde cheio é esquecido: o mais lento a encher leva rajada / taxa por minuto.
    const minutos = Math.max(
      ...Object.values(TAXAS_DO_RELAY).map(({ rajada, porMinuto }) => rajada / porMinuto),
    );
    expect(minutos).toBe(60);
    expect(texto('pt-BR', 'servidor', 'registros')).toContain('cerca de uma hora');
    expect(texto('en', 'servidor', 'registros')).toContain('about an hour');
  });

  it('a data é a mesma nos dois idiomas, no formato de data do app', () => {
    const [, dia, mes, ano] =
      /^atualizada em (\d{2})\/(\d{2})\/(\d{4})$/.exec(TRADUCOES['pt-BR'].politica.atualizada) ??
      [];
    expect(ano).toBeDefined();
    expect(TRADUCOES.en.politica.atualizada).toBe(`updated ${mes}/${dia}/${ano}`);
  });

  it('o caminho do pânico e o aviso de mensagem usam os nomes da interface', () => {
    for (const idioma of IDIOMAS) {
      const { ajustes, avisos } = TRADUCOES[idioma];
      expect(texto(idioma, 'apagar', 'panico')).toContain(
        `${ajustes.titulo} > ${ajustes.panico.titulo}`,
      );
      expect(texto(idioma, 'notificacoes', 'ligadas')).toContain(`“${avisos.novaMensagem}”`);
    }
  });

  it('as permissões que ela cita são as do módulo do app, e as outras ficam bloqueadas', () => {
    // A biometria (da react-native-keychain) e a internet (do modelo do Expo) só aparecem no
    // manifesto do build: confira o APK com `aapt2 dump permissions` quando mudar uma biblioteca.
    const manifesto = lerTexto(
      'apps/mobile/modules/cifra-plataforma/android/src/main/AndroidManifest.xml',
    );
    const pedidas = [
      ...manifesto.matchAll(/<uses-permission android:name="android\.permission\.(\w+)"/g),
    ].map(([, nome]) => nome);
    expect(pedidas.sort()).toEqual([
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_SPECIAL_USE',
      'POST_NOTIFICATIONS',
    ]);
    const { android } = (
      JSON.parse(lerTexto('apps/mobile/app.json')) as {
        expo: { android: { permissions?: string[]; blockedPermissions: string[] } };
      }
    ).expo;
    expect(android.permissions).toBeUndefined();
    expect(android.blockedPermissions).toEqual(
      expect.arrayContaining(
        [
          'READ_CONTACTS',
          'WRITE_CONTACTS',
          'READ_EXTERNAL_STORAGE',
          'READ_MEDIA_IMAGES',
          'READ_MEDIA_VIDEO',
          'ACCESS_MEDIA_LOCATION',
          'VIBRATE',
        ].map((nome) => `android.permission.${nome}`),
      ),
    );
  });

  it('diz quem responde por ela, com um contato só, e não sobra marcador', () => {
    const paragrafos = IDIOMAS.flatMap((idioma) =>
      secoesDaPolitica(idioma).flatMap((secao) => secao.paragrafos),
    );
    expect(paragrafos.flatMap((paragrafo) => paragrafo.match(/\[[^\]]*\]/g) ?? [])).toEqual([]);
    const contatos = new Set(
      paragrafos.flatMap((paragrafo) => paragrafo.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []),
    );
    expect(contatos.size).toBe(1);
    for (const idioma of IDIOMAS) {
      for (const [secao, paragrafo] of [
        ['responsavel', 'quem'],
        ['direitos', 'noCifra'],
      ] as const) {
        expect(texto(idioma, secao, paragrafo)).toContain([...contatos][0]);
      }
    }
  });
});
