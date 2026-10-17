import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// Release sem log (RNF-05): o plugin liga o R8, deixa ele otimizar (senão o -assumenosideeffects
// não vale) e tira o android.util.Log; o console do JS fica mudo no release; e a permissão de
// sobrepor outros apps, que vem do modelo do Expo, sai.

interface Propriedade {
  readonly type: string;
  readonly key?: string;
  readonly value?: string;
}

interface PluginDoRelease {
  comMinificacao(propriedades: readonly Propriedade[]): Propriedade[];
  comOtimizacao(gradle: string): string;
  comRegrasSemLog(regras: string): string;
}

const plugin = createRequire(import.meta.url)('../plugins/release-sem-log.js') as PluginDoRelease;

describe('release sem log (RNF-05)', () => {
  it('liga o R8 no release, uma vez só', () => {
    const antes = [
      { type: 'property', key: 'android.enableMinifyInReleaseBuilds', value: 'false' },
      { type: 'property', key: 'outra', value: '1' },
    ];
    const depois = plugin.comMinificacao(plugin.comMinificacao(antes));
    expect(depois.filter((p) => p.key === 'android.enableMinifyInReleaseBuilds')).toEqual([
      { type: 'property', key: 'android.enableMinifyInReleaseBuilds', value: 'true' },
    ]);
    expect(depois).toContainEqual({ type: 'property', key: 'outra', value: '1' });
  });

  it('troca as regras padrão pelas que otimizam; sem elas no build.gradle, falha', () => {
    const gradle = `proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"`;
    expect(plugin.comOtimizacao(gradle)).toBe(
      `proguardFiles getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro"`,
    );
    expect(() => plugin.comOtimizacao('nada aqui')).toThrow();
  });

  it('tira todo android.util.Log e não ofusca, sem repetir as regras', () => {
    const regras = plugin.comRegrasSemLog(plugin.comRegrasSemLog('# do modelo\n'));
    expect(regras.match(/-assumenosideeffects class android\.util\.Log/g)).toHaveLength(1);
    for (const metodo of ['v', 'd', 'i', 'w', 'e', 'wtf', 'println']) {
      expect(regras).toContain(`public static int ${metodo}(...);`);
    }
    expect(regras).toContain('-dontobfuscate');
  });

  it('o app usa o plugin, bloqueia a sobreposição e cala o console no release', () => {
    const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')) as {
      expo: { plugins: string[]; android: { blockedPermissions: string[] } };
    };
    expect(app.expo.plugins).toContain('./plugins/release-sem-log.js');
    expect(app.expo.android.blockedPermissions).toContain('android.permission.SYSTEM_ALERT_WINDOW');
    const entrada = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    expect(entrada).toMatch(/if \(!__DEV__\) \{[\s\S]*Object\.assign\(console/);
  });

  it('todo Record do módulo nativo converte sem reflexão, que o R8 quebra no release', () => {
    const pasta = new URL(
      '../modules/cifra-plataforma/android/src/main/java/org/cifra/plataforma/',
      import.meta.url,
    );
    const records = readdirSync(pasta)
      .filter((arquivo) => arquivo.endsWith('.kt'))
      .flatMap((arquivo) =>
        [
          ...readFileSync(new URL(arquivo, pasta), 'utf8').matchAll(
            /((?:^@\w+\n)*)^(?:data )?class (\w+)[^\n{]*: Record\b/gm,
          ),
        ].map(([, anotacoes = '', nome]) => ({ nome, anotacoes })),
      );
    expect(records.map((r) => r.nome)).toContain('TextosDosAvisos');
    for (const { nome, anotacoes } of records) {
      expect(anotacoes, nome).toContain('@OptimizedRecord');
    }
  });
});
