import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// A abertura no fundo escuro, com o wordmark do ícone no meio, do Android 10 ao 16 (SPEC,
// "Abertura"): a cor é a do fundo do ícone adaptável, para o Android 12+ desenhar só a camada da
// frente, e no 10 e no 11 o fundo da janela mostra a mesma camada no mesmo tamanho.

interface Item {
  $: Record<string, string>;
  _?: string;
}

interface Estilos {
  resources: { $?: Record<string, string>; style?: { $: { name: string }; item?: Item[] }[] };
}

interface PluginDaAbertura {
  (config: { android?: { adaptiveIcon?: { backgroundColor?: string } } }): unknown;
  desenhoDaAbertura(): string;
  comTemaDaAbertura(estilos: Estilos): Estilos;
}

const plugin = createRequire(import.meta.url)('../plugins/abertura.js') as PluginDaAbertura;

interface AppJson {
  expo: {
    backgroundColor?: string;
    android: { adaptiveIcon?: { backgroundColor?: string } };
    plugins: string[];
  };
}

const app = (JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')) as AppJson)
  .expo;

/** O styles.xml do modelo do Expo, como o prebuild entrega aos plugins. */
function modelo(): Estilos {
  return {
    resources: {
      $: { 'xmlns:tools': 'http://schemas.android.com/tools' },
      style: [
        {
          $: { name: 'AppTheme' },
          item: [{ $: { name: 'android:windowBackground' }, _: '@color/activityBackground' }],
        },
        {
          $: { name: 'Theme.App.SplashScreen' },
          item: [{ $: { name: 'android:windowBackground' }, _: '@drawable/splashscreen_logo' }],
        },
      ],
    },
  };
}

function itens(estilos: Estilos, nome: string): Item[] {
  return estilos.resources.style?.find((estilo) => estilo.$.name === nome)?.item ?? [];
}

describe('abertura do app', () => {
  it('o app.json liga o plugin, e o fundo do ícone é o fundo do app', () => {
    expect(app.plugins).toContain('./plugins/abertura.js');
    expect(app.android.adaptiveIcon?.backgroundColor).toBe(app.backgroundColor);
  });

  it('o tema da abertura troca a grade do modelo pela abertura e dá a cor ao Android 12+', () => {
    const estilos = plugin.comTemaDaAbertura(modelo());
    expect(itens(estilos, 'Theme.App.SplashScreen')).toEqual([
      { $: { name: 'android:windowBackground' }, _: '@drawable/abertura' },
      {
        $: { name: 'android:windowSplashScreenBackground', 'tools:targetApi': '31' },
        _: '@color/fundo_da_abertura',
      },
    ]);
    expect(itens(estilos, 'AppTheme')).toEqual(itens(modelo(), 'AppTheme'));
  });

  it('aplicado duas vezes, o tema fica igual', () => {
    const uma = plugin.comTemaDaAbertura(modelo());
    expect(plugin.comTemaDaAbertura(structuredClone(uma))).toEqual(uma);
  });

  it('sem o tema da abertura no styles.xml, o prebuild para', () => {
    const semTema = modelo();
    semTema.resources.style = (semTema.resources.style ?? []).slice(0, 1);
    expect(() => plugin.comTemaDaAbertura(semTema)).toThrow('Theme.App.SplashScreen');
  });

  it('no Android 10 e no 11, a janela tem a cor e a camada da frente do ícone em 288 dp', () => {
    const xml = plugin.desenhoDaAbertura();
    expect(xml).toContain('<item android:drawable="@color/fundo_da_abertura" />');
    expect(xml).toMatch(
      /android:width="288dp"\s+android:height="288dp"\s+android:gravity="center"\s+android:drawable="@mipmap\/ic_launcher_foreground"/,
    );
  });

  it('sem a cor de fundo do ícone adaptável, o prebuild para', () => {
    expect(() => plugin({ android: {} })).toThrow('backgroundColor');
    expect(() => plugin({})).toThrow('backgroundColor');
  });
});
