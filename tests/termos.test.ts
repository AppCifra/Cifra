import { describe, expect, it } from 'vitest';
import { EMAIL_DO_PROJETO } from '../apps/mobile/src/denuncia.ts';
import { IDIOMAS, TRADUCOES, type Idioma } from '../packages/i18n/src/index.ts';
import { ancora, documentoEmMarkdown, emailsEm, paragrafosDo } from './documentos.ts';

// Os termos de uso (RF-62) ficam nos textos do app, e o docs/TERMOS.md sai deles, como a política
// de privacidade. A seção de proteção de crianças é a página que a Play pede aos apps de conversa
// anônima, com o link no Play Console. Depois de mudar o texto, gere o arquivo de novo:
//   pnpm exec vitest run tests/termos.test.ts -u

type Secoes = Readonly<Record<string, Readonly<Record<string, string>>>>;

function texto(idioma: Idioma, secao: string, paragrafo: string): string {
  const secoes: Secoes = TRADUCOES[idioma].termos.secoes;
  const achado = secoes[secao]?.[paragrafo];
  if (achado === undefined) throw new Error(`${idioma}: termos.secoes.${secao}.${paragrafo}`);
  return achado;
}

/** Quem publica o Cifra, como a política diz. */
const PUBLICADO_POR = {
  'pt-BR': /publicado por ([^,]+),/,
  en: /published by ([^,]+),/,
} as const satisfies Record<Idioma, RegExp>;

describe('termos de uso (RF-62)', () => {
  it('o docs/TERMOS.md é o texto do app, nos dois idiomas', async () => {
    await expect(documentoEmMarkdown('termos')).toMatchFileSnapshot('../docs/TERMOS.md');
  });

  it('o contato é um só, o mesmo da política e do painel de denúncia, e não sobra marcador', () => {
    const paragrafos = paragrafosDo('termos');
    expect(paragrafos.flatMap((paragrafo) => paragrafo.match(/\[[^\]]*\]/g) ?? [])).toEqual([]);
    expect([...emailsEm(paragrafos)]).toEqual([EMAIL_DO_PROJETO]);
    expect([...emailsEm(paragrafosDo('politica'))]).toEqual([EMAIL_DO_PROJETO]);
  });

  it('quem publica e responde é o mesmo da política', () => {
    for (const idioma of IDIOMAS) {
      const quem = PUBLICADO_POR[idioma].exec(
        TRADUCOES[idioma].politica.secoes.responsavel.quem,
      )?.[1];
      expect(quem).toBeDefined();
      expect(texto(idioma, 'quem', 'publica')).toContain(`${quem},`);
    }
  });

  it('o painel de denúncia e os termos mandam aos mesmos canais das autoridades', () => {
    for (const idioma of IDIOMAS) {
      const { denuncia } = TRADUCOES[idioma];
      for (const escrito of [
        denuncia.descricao,
        denuncia.descricaoDoContato,
        texto(idioma, 'criancas', 'fazer'),
        texto(idioma, 'denunciar', 'autoridades'),
      ]) {
        expect(escrito).toContain('Disque 100');
        expect(escrito).toContain('new.safernet.org.br/denuncie');
      }
    }
  });

  it('a proteção de crianças tem, em inglês, a âncora que vai no Play Console', () => {
    expect(ancora(TRADUCOES.en.termos.secoes.criancas.titulo)).toBe('child-safety');
    expect(documentoEmMarkdown('termos')).toContain(
      `\n## ${TRADUCOES.en.termos.secoes.criancas.titulo}\n`,
    );
  });

  it('o caminho da denúncia usa os nomes da interface', () => {
    for (const idioma of IDIOMAS) {
      const { ajustes, denuncia, seguranca } = TRADUCOES[idioma];
      const caminho = texto(idioma, 'denunciar', 'app');
      expect(caminho).toContain(seguranca.denunciar);
      expect(caminho).toContain(`${ajustes.titulo} > ${denuncia.titulo}`);
    }
  });

  it('a data é a mesma nos dois idiomas, no formato de data do app', () => {
    const [, dia, mes, ano] =
      /^atualizados em (\d{2})\/(\d{2})\/(\d{4})$/.exec(TRADUCOES['pt-BR'].termos.atualizada) ?? [];
    expect(ano).toBeDefined();
    expect(TRADUCOES.en.termos.atualizada).toBe(`updated ${mes}/${dia}/${ano}`);
  });
});
