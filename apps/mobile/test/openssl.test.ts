import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// O OpenSSL do SQLCipher sai do fonte oficial, compilado na imagem do release: o plugin troca o do
// Maven Central pelo do repositório local. Versão, SHA-256 e chave batem entre o Dockerfile, o
// plugin, a verificação técnica e o docs/DEPENDENCIAS.md.

interface PluginDoOpenssl {
  comOpenssl(gradle: string): string;
  readonly VERSAO: string;
}

const plugin = createRequire(import.meta.url)('../plugins/openssl.js') as PluginDoOpenssl;
const ler = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), 'utf8');

describe('OpenSSL do SQLCipher', () => {
  const dockerfile = ler('../release/Dockerfile');
  const argumento = (nome: string) =>
    new RegExp(`^ARG ${nome}=(\\S+)$`, 'm').exec(dockerfile)?.[1] ?? '';

  it('o plugin põe o repositório local e troca o OpenSSL do op-sqlite, uma vez só', () => {
    const gradle = plugin.comOpenssl(plugin.comOpenssl('allprojects {}\n'));
    expect(gradle.match(/OpenSSL do Cifra/g)).toHaveLength(1);
    expect(gradle).toContain(
      `substitute module('io.github.ronickg:openssl') using module('org.cifra.thirdparty:openssl:${plugin.VERSAO}')`,
    );
    // O grupo só existe no repositório local, e sem o AAR o build para.
    expect(gradle).toMatch(/exclusiveContent \{[\s\S]*includeGroup 'org\.cifra\.thirdparty'/);
    expect(gradle).toContain("System.getenv('CIFRA_OPENSSL_MAVEN')");
    expect(gradle).toContain('throw new GradleException');
  });

  it('o app usa o plugin, e o op-sqlite ainda pede o OpenSSL que ele troca', () => {
    const app = JSON.parse(ler('../app.json')) as { expo: { plugins: string[] } };
    expect(app.expo.plugins).toContain('./plugins/openssl.js');
    const opSqlite = ler('../node_modules/@op-engineering/op-sqlite/android/build.gradle');
    expect(opSqlite).toMatch(/implementation\('io\.github\.ronickg:openssl:[^']+'\)/);
  });

  it('a mesma versão no Dockerfile, no plugin, na verificação técnica e no registro', () => {
    expect(argumento('OPENSSL_VERSAO')).toBe(plugin.VERSAO);
    expect(ler('../src/spike/verificacoes.ts')).toContain(
      `const VERSAO_DO_OPENSSL = '${plugin.VERSAO}';`,
    );
    const registro = ler('../../../docs/DEPENDENCIAS.md');
    expect(registro).toContain(`OpenSSL ${plugin.VERSAO}`);
    expect(registro).toContain(`\`${argumento('OPENSSL_SHA256')}\``);
    // A impressão digital como o site do OpenSSL escreve, em grupos de 4.
    const chave = argumento('OPENSSL_CHAVE');
    expect(chave).toMatch(/^[0-9A-F]{40}$/);
    expect(registro).toContain(chave.replace(/(.{4})(?!$)/g, '$1 '));
  });

  it('o tarball confere pelo SHA-256 e pela assinatura da chave travada', () => {
    const script = ler('../release/openssl.sh');
    expect(argumento('OPENSSL_SHA256')).toMatch(/^[0-9a-f]{64}$/);
    expect(script).toContain('sha256sum -c -');
    expect(script).toContain('VALIDSIG .* ${OPENSSL_CHAVE}');
    expect(dockerfile).toContain('COPY openssl-chave.asc openssl.sh /tmp/openssl/');
    expect(ler('../release/openssl-chave.asc')).toMatch(/^-----BEGIN PGP PUBLIC KEY BLOCK-----\n/);
  });
});
