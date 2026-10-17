import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lerTexto, RAIZ } from './util.ts';

// RNF-16 também vale para as imagens Docker: uma tag pode passar a apontar para outra imagem, o
// digest não. Todo `FROM` de Dockerfile e todo `image:` de compose ficam travados pelo digest.

const DIGEST = /@sha256:[0-9a-f]{64}$/;

/** Arquivos do repositório, inclusive os novos ainda fora do git, sem o que o git ignora. */
function arquivosDoRepositorio(): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: RAIZ,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((arquivo) => arquivo !== '');
}

const ehDockerfile = (arquivo: string) => /^(Dockerfile|.+\.Dockerfile)$/.test(basename(arquivo));
const ehCompose = (arquivo: string) => /^(docker-)?compose(\..+)?\.ya?ml$/.test(basename(arquivo));

/** Imagens de um Dockerfile ou compose que não estão travadas pelo digest. */
function imagensSemDigest(texto: string, tipo: 'dockerfile' | 'compose'): string[] {
  const padrao =
    tipo === 'dockerfile' ? /^\s*FROM\s+(?:--\S+\s+)*(\S+)/gim : /^\s*image:\s*(\S+)/gm;
  // Num Dockerfile, `FROM scratch` e `FROM <estágio>` do mesmo arquivo não baixam imagem.
  const locais = new Set(['scratch']);
  if (tipo === 'dockerfile') {
    for (const [, estagio] of texto.matchAll(/^\s*FROM\s+.+\s+AS\s+(\S+)\s*$/gim)) {
      locais.add((estagio ?? '').toLowerCase());
    }
  }
  return [...texto.matchAll(padrao)]
    .map(([, imagem]) => (imagem ?? '').replace(/^['"]|['"]$/g, ''))
    .filter((imagem) => !(tipo === 'dockerfile' && locais.has(imagem.toLowerCase())))
    .filter((imagem) => !DIGEST.test(imagem));
}

describe('imagens Docker travadas pelo digest (RNF-16)', () => {
  const arquivos = arquivosDoRepositorio();
  const dockerfiles = arquivos.filter(ehDockerfile);
  const composes = arquivos.filter(ehCompose);

  it('acha os Dockerfiles e composes do relay, do release e do .onion de teste', () => {
    expect(dockerfiles).toEqual(
      expect.arrayContaining([
        'apps/relay/Dockerfile',
        'apps/relay/tor/Dockerfile',
        'apps/mobile/release/Dockerfile',
      ]),
    );
    expect(composes).toEqual(
      expect.arrayContaining([
        'apps/relay/docker-compose.yml',
        'apps/mobile/spike/onion/docker-compose.yml',
      ]),
    );
  });

  it('todo FROM e todo image: usam @sha256', () => {
    const problemas = [
      ...dockerfiles.flatMap((arquivo) =>
        imagensSemDigest(lerTexto(arquivo), 'dockerfile').map((imagem) => `${arquivo}: ${imagem}`),
      ),
      ...composes.flatMap((arquivo) =>
        imagensSemDigest(lerTexto(arquivo), 'compose').map((imagem) => `${arquivo}: ${imagem}`),
      ),
    ];
    expect(problemas).toEqual([]);
  });

  it('a verificação acusa imagem por tag, com ou sem opção no FROM', () => {
    const digest = `@sha256:${'a'.repeat(64)}`;
    const dockerfile = [
      `FROM node:24-alpine${digest} AS base`,
      'FROM alpine:3.24',
      'from --platform=$BUILDPLATFORM debian:12',
      `FROM --platform=linux/arm64 node${digest}`,
      'FROM base AS construcao',
      'FROM scratch AS saida',
      'FROM outro',
    ].join('\n');
    expect(imagensSemDigest(dockerfile, 'dockerfile')).toEqual([
      'alpine:3.24',
      'debian:12',
      'outro',
    ]);
    const compose = [`    image: node:24${digest}`, "    image: 'tor:latest'"].join('\n');
    expect(imagensSemDigest(compose, 'compose')).toEqual(['tor:latest']);
  });
});
