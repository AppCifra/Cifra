import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { listarArquivos, lerTexto, pastasDoWorkspace, RAIZ } from './util.ts';

// Tudo em packages/ roda em Node, Android, iOS e web (RNF-15). Além dos próprios arquivos,
// cada pacote só importa o que está nesta lista; incluir algo aqui pede a mesma revisão
// de uma dependência nova.
const IMPORTS_PERMITIDOS: Readonly<Record<string, readonly string[]>> = {
  'packages/protocol': [],
  'packages/core': ['@cifra/protocol'],
  'packages/i18n': ['i18next'],
};

/** Libs de tipos que trazem APIs de uma plataforma: DOM, workers, Windows Script Host. */
const LIB_DE_PLATAFORMA = /dom|webworker|scripthost|\.full\./;

function opcoesDoTsconfig(caminho: string): ts.CompilerOptions {
  const arquivo = join(RAIZ, caminho);
  const lido = ts.readConfigFile(arquivo, (nome) => ts.sys.readFile(nome));
  if (lido.error) throw new Error(ts.flattenDiagnosticMessageText(lido.error.messageText, '\n'));
  const { options, errors } = ts.parseJsonConfigFileContent(lido.config, ts.sys, dirname(arquivo));
  if (errors.length > 0) throw new Error(`${caminho}: tsconfig com erro`);
  return options;
}

/**
 * Imports e referências de tipo de um arquivo do pacote que fogem do permitido.
 * `arquivo` é relativo à raiz do repositório.
 */
function problemasDoArquivo(
  pasta: string,
  arquivo: string,
  codigo: string,
  permitidos: readonly string[],
): string[] {
  const info = ts.preProcessFile(codigo, true, true);
  const imports = info.importedFiles.flatMap(({ fileName }) => {
    if (fileName.startsWith('.')) {
      const destino = relative(join(RAIZ, pasta), resolve(join(RAIZ, dirname(arquivo)), fileName));
      return destino.startsWith('..') || isAbsolute(destino)
        ? [`${arquivo}: ${fileName} sai do pacote`]
        : [];
    }
    return permitidos.includes(fileName) ? [] : [`${arquivo}: ${fileName}`];
  });
  const referencias = [
    ...info.typeReferenceDirectives,
    ...info.libReferenceDirectives,
    ...info.referencedFiles,
  ].map(({ fileName }) => `${arquivo}: /// <reference> ${fileName}`);
  return [...imports, ...referencias];
}

describe('pacotes sem dependência de plataforma (RNF-15)', () => {
  it('todo pacote em packages/ passa por estas regras', () => {
    const pastas = pastasDoWorkspace().filter((pasta) => pasta.startsWith('packages/'));
    expect(pastas.sort()).toEqual(Object.keys(IMPORTS_PERMITIDOS).sort());
  });

  for (const [pasta, permitidos] of Object.entries(IMPORTS_PERMITIDOS)) {
    describe(pasta, () => {
      it('src/ só importa os próprios arquivos e o que a lista permite', () => {
        const problemas = listarArquivos(`${pasta}/src`, ['.ts']).flatMap((arquivo) =>
          problemasDoArquivo(pasta, arquivo, lerTexto(arquivo), permitidos),
        );
        expect(problemas).toEqual([]);
      });

      it('src/ compila sem DOM e sem tipos de Node', () => {
        const { lib, types } = opcoesDoTsconfig(`${pasta}/tsconfig.json`);
        expect(types).toEqual([]);
        // Sem `lib` explícita, o TypeScript inclui o DOM por padrão.
        expect(lib).toBeDefined();
        expect((lib ?? []).filter((nome) => LIB_DE_PLATAFORMA.test(nome))).toEqual([]);
      });
    });
  }

  it('a verificação acusa import de plataforma, import que sai do pacote e referência de tipo', () => {
    // Diretivas `/// <reference>` só valem no topo do arquivo, antes de qualquer instrução.
    const codigo = [
      '/// <reference types="node" />',
      "import { limite } from './limites.ts';",
      "import { readFileSync } from 'node:fs';",
      "export { Platform } from 'react-native';",
      "const segredo = await import('../../../apps/mobile/segredo.ts');",
    ].join('\n');
    expect(problemasDoArquivo('packages/core', 'packages/core/src/x.ts', codigo, [])).toEqual([
      'packages/core/src/x.ts: node:fs',
      'packages/core/src/x.ts: react-native',
      'packages/core/src/x.ts: ../../../apps/mobile/segredo.ts sai do pacote',
      'packages/core/src/x.ts: /// <reference> node',
    ]);
  });
});
