// Leitura do repositório para os testes de política.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = fileURLToPath(new URL('..', import.meta.url));

export interface Manifesto {
  readonly name?: string;
  readonly license?: string;
  readonly packageManager?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
}

export interface Pacote {
  /** `raiz` para o package.json da raiz; nos outros, o nome do pacote. */
  readonly nome: string;
  /** Pasta do pacote relativa à raiz, com `/`. */
  readonly pasta: string;
  readonly manifesto: Manifesto;
}

export const CAMPOS_DE_DEPENDENCIA = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
] as const;

/** Conteúdo de um arquivo do repositório, com quebras de linha normalizadas. */
export function lerTexto(caminho: string): string {
  return readFileSync(join(RAIZ, caminho), 'utf8').replace(/\r\n/g, '\n');
}

function lerManifesto(caminho: string): Manifesto {
  return JSON.parse(lerTexto(caminho)) as Manifesto;
}

/** Pastas dos pacotes do workspace, pelos padrões `pasta/*` do pnpm-workspace.yaml. */
export function pastasDoWorkspace(): string[] {
  const lista = /^packages:\n((?:[ \t]+-[^\n]*\n)+)/m.exec(lerTexto('pnpm-workspace.yaml'))?.[1];
  if (!lista) throw new Error('pnpm-workspace.yaml sem a lista de packages');

  return lista
    .split('\n')
    .filter((linha) => linha.trim() !== '')
    .flatMap((linha) => {
      const padrao = linha.replace(/^\s*-\s*/, '').replace(/^['"]|['"]$/g, '');
      const pasta = /^([\w.-]+)\/\*$/.exec(padrao)?.[1];
      if (!pasta) throw new Error(`padrão de workspace que o teste não entende: ${padrao}`);
      if (!existsSync(join(RAIZ, pasta))) return [];
      return readdirSync(join(RAIZ, pasta), { withFileTypes: true })
        .filter((item) => item.isDirectory())
        .filter((item) => existsSync(join(RAIZ, pasta, item.name, 'package.json')))
        .map((item) => `${pasta}/${item.name}`);
    });
}

/** O package.json da raiz e o de cada pacote do workspace. */
export function lerPacotes(): Pacote[] {
  const pacotes = pastasDoWorkspace().map((pasta) => {
    const manifesto = lerManifesto(`${pasta}/package.json`);
    return { nome: manifesto.name ?? pasta, pasta, manifesto };
  });
  return [{ nome: 'raiz', pasta: '.', manifesto: lerManifesto('package.json') }, ...pacotes];
}

/** Arquivos de uma pasta e das subpastas, relativos à raiz, com `/`. */
export function listarArquivos(pasta: string, extensoes: readonly string[]): string[] {
  if (!existsSync(join(RAIZ, pasta))) return [];
  return readdirSync(join(RAIZ, pasta), { withFileTypes: true }).flatMap((item) => {
    const caminho = `${pasta}/${item.name}`;
    if (item.isDirectory()) return listarArquivos(caminho, extensoes);
    return extensoes.some((extensao) => item.name.endsWith(extensao)) ? [caminho] : [];
  });
}
