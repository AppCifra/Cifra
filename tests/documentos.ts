// Os documentos que saem dos textos do app para docs/: a política de privacidade (RF-61) e os
// termos de uso (RF-62), em português e, embaixo, em inglês.
import {
  IDIOMAS,
  secoesDoDocumento,
  TRADUCOES,
  type Documento,
} from '../packages/i18n/src/index.ts';

/** A âncora que o GitHub dá a um título: minúsculas, sem pontuação, hífen no lugar do espaço. */
export const ancora = (titulo: string) =>
  titulo
    .toLowerCase()
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .replaceAll(' ', '-');

/** O arquivo de docs/ do documento: o texto em português e, embaixo, em inglês. */
export function documentoEmMarkdown(documento: Documento): string {
  const idiomas = IDIOMAS.map((idioma) => {
    const { documento: titulo, atualizada } = TRADUCOES[idioma][documento];
    return [
      `# ${titulo}`,
      atualizada,
      ...secoesDoDocumento(documento, idioma).flatMap(({ titulo: secao, paragrafos }) => [
        `## ${secao}`,
        ...paragrafos,
      ]),
    ].join('\n\n');
  });
  const emIngles = `[${TRADUCOES.en.idiomas.en}](#${ancora(TRADUCOES.en[documento].documento)})`;
  return `${emIngles}\n\n${idiomas.join('\n\n---\n\n')}\n`;
}

/** Os parágrafos do documento nos dois idiomas. */
export const paragrafosDo = (documento: Documento): string[] =>
  IDIOMAS.flatMap((idioma) =>
    secoesDoDocumento(documento, idioma).flatMap((secao) => secao.paragrafos),
  );

/** Os e-mails citados nos textos. */
export const emailsEm = (textos: readonly string[]): Set<string> =>
  new Set(textos.flatMap((texto) => texto.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []));
