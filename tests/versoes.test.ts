import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAMPOS_DE_DEPENDENCIA, lerPacotes, lerTexto, RAIZ } from './util.ts';

const VERSAO_EXATA = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const PACOTE_INTERNO = 'workspace:*';
const SETE_DIAS_EM_MINUTOS = 7 * 24 * 60;

interface Uso {
  readonly pacote: string;
  readonly dependencia: string;
  readonly versao: string;
}

interface Registro {
  readonly dependencia: string;
  readonly versao: string;
  readonly usadoEm: readonly string[];
  readonly justificativa: string;
}

/** Cada dependência de terceiros declarada em algum package.json do workspace. */
function usos(): Uso[] {
  return lerPacotes().flatMap(({ nome, manifesto }) =>
    CAMPOS_DE_DEPENDENCIA.flatMap((campo) =>
      Object.entries(manifesto[campo] ?? {}).map(([dependencia, versao]) => ({
        pacote: nome,
        dependencia,
        versao,
      })),
    ),
  );
}

/** Linhas da tabela de docs/DEPENDENCIAS.md: | `pacote` | versão | usado em | justificativa | */
function registros(): Registro[] {
  const linha = /^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*$/;
  return lerTexto('docs/DEPENDENCIAS.md')
    .split('\n')
    .flatMap((texto) => {
      const [, dependencia, versao, usadoEm, justificativa] = linha.exec(texto) ?? [];
      if (!dependencia || !versao || !usadoEm || justificativa === undefined) return [];
      const pacotes = usadoEm.split(',').map((pacote) => pacote.replace(/`/g, '').trim());
      return [{ dependencia, versao, usadoEm: pacotes, justificativa }];
    });
}

describe('dependências com versões travadas (RNF-16)', () => {
  it('toda dependência usa versão exata, nunca faixa', () => {
    const comFaixa = usos()
      .filter(({ versao }) => versao !== PACOTE_INTERNO && !VERSAO_EXATA.test(versao))
      .map(({ pacote, dependencia, versao }) => `${pacote}: ${dependencia}@${versao}`);
    expect(comFaixa).toEqual([]);
  });

  it('o lockfile existe', () => {
    expect(existsSync(join(RAIZ, 'pnpm-lock.yaml'))).toBe(true);
  });

  it('o pnpm está travado numa versão exata', () => {
    const [raiz] = lerPacotes();
    expect(raiz?.manifesto.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+(?:\+sha\d+\.[0-9a-f]+)?$/);
  });

  it('o pnpm grava versão exata e só aceita versões publicadas há 7 dias ou mais', () => {
    const workspace = lerTexto('pnpm-workspace.yaml');
    expect(workspace).toMatch(/^saveExact: true$/m);
    const idadeMinima = Number(/^minimumReleaseAge: (\d+)$/m.exec(workspace)?.[1]);
    expect(idadeMinima).toBeGreaterThanOrEqual(SETE_DIAS_EM_MINUTOS);
  });
});

describe('registro de dependências em docs/DEPENDENCIAS.md (RNF-16)', () => {
  it('toda dependência está registrada, com a mesma versão, onde é usada e com justificativa', () => {
    const porNome = new Map(registros().map((registro) => [registro.dependencia, registro]));
    const problemas = usos()
      .filter(({ versao }) => versao !== PACOTE_INTERNO)
      .flatMap(({ pacote, dependencia, versao }) => {
        const registro = porNome.get(dependencia);
        if (!registro) return [`${dependencia}: falta no registro`];
        return [
          ...(registro.versao === versao
            ? []
            : [`${dependencia}: ${pacote} usa ${versao}, o registro diz ${registro.versao}`]),
          ...(registro.usadoEm.includes(pacote) ? [] : [`${dependencia}: falta "${pacote}"`]),
          ...(registro.justificativa === '' ? [`${dependencia}: sem justificativa`] : []),
        ];
      });
    expect(problemas).toEqual([]);
  });

  it('o registro não tem linha sobrando nem dependência repetida', () => {
    const emUso = new Set(usos().map(({ pacote, dependencia }) => `${dependencia} em ${pacote}`));
    const sobrando = registros().flatMap(({ dependencia, usadoEm }) =>
      usadoEm
        .map((pacote) => `${dependencia} em ${pacote}`)
        .filter((entrada) => !emUso.has(entrada)),
    );
    expect(sobrando).toEqual([]);

    const nomes = registros().map(({ dependencia }) => dependencia);
    expect(nomes.filter((nome, i) => nomes.indexOf(nome) !== i)).toEqual([]);
  });
});

/** Linhas `chave: valor` de um bloco do pnpm-workspace.yaml, sem comentários. */
function bloco(workspace: string, nome: string): [string, string][] {
  const linhas = workspace.split('\n');
  const inicio = linhas.indexOf(`${nome}:`);
  if (inicio === -1) return [];
  const itens: [string, string][] = [];
  for (const linha of linhas.slice(inicio + 1)) {
    if (linha.trim() === '' || linha.trim().startsWith('#')) continue;
    if (!/^\s/.test(linha)) break;
    const [, chave, valor] = /^\s+([^:#\s][^:]*?):\s*(\S+)\s*$/.exec(linha) ?? [];
    if (chave && valor) itens.push([chave.replace(/^['"]|['"]$/g, ''), valor]);
  }
  return itens;
}

describe('patches e scripts de instalação (RNF-16)', () => {
  const workspace = lerTexto('pnpm-workspace.yaml');
  const registro = lerTexto('docs/DEPENDENCIAS.md');

  it('todo patch existe e está explicado em docs/DEPENDENCIAS.md', () => {
    const problemas = bloco(workspace, 'patchedDependencies').flatMap(([pacote, arquivo]) => [
      ...(existsSync(join(RAIZ, arquivo)) ? [] : [`${pacote}: ${arquivo} não existe`]),
      ...(registro.includes(`\`${arquivo}\``) ? [] : [`${pacote}: ${arquivo} sem explicação`]),
    ]);
    expect(problemas).toEqual([]);
  });

  it('todo script de instalação liberado está explicado em docs/DEPENDENCIAS.md', () => {
    const liberados = bloco(workspace, 'allowBuilds')
      .filter(([, valor]) => valor === 'true')
      .map(([pacote]) => pacote);
    const secao = registro.split('## Scripts de instalação liberados')[1]?.split('\n## ')[0] ?? '';
    expect(liberados.filter((pacote) => !secao.includes(`\`${pacote}\``))).toEqual([]);
  });

  it('a leitura do pnpm-workspace.yaml entende os blocos e ignora comentários', () => {
    const exemplo = [
      'allowBuilds:',
      '  # motivo',
      '  pacote-a: true',
      "  'pacote-b': false",
      'outro: 1',
    ].join('\n');
    expect(bloco(exemplo, 'allowBuilds')).toEqual([
      ['pacote-a', 'true'],
      ['pacote-b', 'false'],
    ]);
    expect(bloco(exemplo, 'patchedDependencies')).toEqual([]);
  });
});
