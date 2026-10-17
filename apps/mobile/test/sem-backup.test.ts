import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// Dados do app fora dos backups do sistema (RNF-09): o `allowBackup` desligado no app.json e as
// regras de extração do plugin, que excluem tudo da nuvem e da transferência entre aparelhos.

interface Manifesto {
  manifest: { application?: { $: Record<string, string> }[] };
}

interface PluginSemBackup {
  (config: { android?: { allowBackup?: boolean } }): unknown;
  readonly DOMINIOS: readonly string[];
  regrasDeExtracao(): string;
  ligarRegras(manifesto: Manifesto): Manifesto;
}

const exigir = createRequire(import.meta.url);
const plugin = exigir('../plugins/sem-backup.js') as PluginSemBackup;

interface AppJson {
  expo: { android: { allowBackup?: boolean }; plugins: string[] };
}

const appJson = JSON.parse(
  readFileSync(new URL('../app.json', import.meta.url), 'utf8'),
) as AppJson;

/** As regras de uma seção do XML: o domínio e o caminho de cada `<exclude>`. */
function exclusoes(xml: string, secao: string): string[] {
  const corpo = new RegExp(`<${secao}>([\\s\\S]*?)</${secao}>`).exec(xml)?.[1] ?? '';
  return [...corpo.matchAll(/<exclude domain="([^"]+)" path="([^"]+)" \/>/g)].map(
    ([, dominio, caminho]) => `${String(dominio)}:${String(caminho)}`,
  );
}

describe('fora dos backups do sistema (RNF-09)', () => {
  it('o app.json desliga o backup e liga o plugin', () => {
    expect(appJson.expo.android.allowBackup).toBe(false);
    expect(appJson.expo.plugins).toContain('./plugins/sem-backup.js');
  });

  it('as regras excluem os 9 lugares de dados, inteiros, da nuvem e da transferência', () => {
    const xml = plugin.regrasDeExtracao();
    const todos = plugin.DOMINIOS.map((dominio) => `${dominio}:.`);
    expect(plugin.DOMINIOS).toHaveLength(9);
    expect(exclusoes(xml, 'cloud-backup')).toEqual(todos);
    expect(exclusoes(xml, 'device-transfer')).toEqual(todos);
    // Nada é incluído de volta.
    expect(xml).not.toContain('<include');
  });

  it('o manifesto aponta para as regras', () => {
    const manifesto = plugin.ligarRegras({ manifest: { application: [{ $: {} }] } });
    expect(manifesto.manifest.application?.[0]?.$['android:dataExtractionRules']).toBe(
      '@xml/regras_de_extracao',
    );
  });

  it('sem allowBackup desligado no app.json, o prebuild para', () => {
    expect(() => plugin({ android: {} })).toThrow('allowBackup');
    expect(() => plugin({ android: { allowBackup: true } })).toThrow('allowBackup');
    expect(() => plugin({})).toThrow('allowBackup');
  });
});
