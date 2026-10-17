import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// Release assinado com a chave do Cifra, lida do ambiente na hora do build: nada da chave fica no
// repositório nem no projeto gerado. Sem o ambiente, o release segue com a chave de depuração.

interface PluginDaAssinatura {
  comAssinatura(gradle: string): string;
}

const plugin = createRequire(import.meta.url)('../plugins/assinatura.js') as PluginDaAssinatura;

const MODELO = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}
`;

describe('assinatura do release', () => {
  it('lê a chave do ambiente e só usa a de depuração sem ela', () => {
    const novo = plugin.comAssinatura(MODELO);
    expect(novo).toContain("storeFile file(System.getenv('CIFRA_ASSINATURA_ARQUIVO'))");
    expect(novo).toContain("storePassword System.getenv('CIFRA_ASSINATURA_SENHA')");
    expect(novo).toContain(
      "signingConfig System.getenv('CIFRA_ASSINATURA_ARQUIVO') ? signingConfigs.release : signingConfigs.debug",
    );
    // O debug continua assinando com a chave de depuração.
    expect(novo).toMatch(/ {8}debug \{\n {12}signingConfig signingConfigs\.debug\n/);
    expect(novo.match(/signingConfig signingConfigs\.debug\n/g)).toHaveLength(1);
  });

  it('não repete nada num build.gradle já alterado', () => {
    const uma = plugin.comAssinatura(MODELO);
    expect(plugin.comAssinatura(uma)).toBe(uma);
  });

  it('sem o que espera no build.gradle, falha em vez de gerar um release sem a chave', () => {
    expect(() => plugin.comAssinatura('android {}')).toThrow();
    expect(() =>
      plugin.comAssinatura(
        MODELO.replace(
          '            signingConfig signingConfigs.debug\n            minifyEnabled',
          '            minifyEnabled',
        ),
      ),
    ).toThrow();
  });

  it('nenhuma senha nem caminho de chave no plugin, e o app usa o plugin', () => {
    const fonte = readFileSync(new URL('../plugins/assinatura.js', import.meta.url), 'utf8');
    expect(fonte).not.toMatch(/\.jks|storePassword '/);
    const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')) as {
      expo: { plugins: string[] };
    };
    expect(app.expo.plugins).toContain('./plugins/assinatura.js');
  });
});
