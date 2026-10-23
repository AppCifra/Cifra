import { describe, expect, it } from 'vitest';
import { lerTexto } from './util.ts';

// O número da versão aparece no app e no nome do APK publicado; o versionCode decide se o Android
// aceita o APK como atualização (só um maior). Os dois ficam no app.json, e o package.json do app
// repete o número (SPEC, "Distribuição").

interface AppJson {
  readonly expo: {
    readonly version: unknown;
    readonly android: { readonly versionCode?: unknown };
  };
}

const app = (JSON.parse(lerTexto('apps/mobile/app.json')) as AppJson).expo;

describe('versão do app', () => {
  it('segue X.Y.Z e é a mesma do package.json do app', () => {
    expect(app.version).toMatch(/^\d+\.\d+\.\d+$/);
    const pacote = JSON.parse(lerTexto('apps/mobile/package.json')) as { version: unknown };
    expect(pacote.version).toBe(app.version);
  });

  it('tem versionCode inteiro e positivo', () => {
    const codigo = app.android.versionCode;
    expect(Number.isInteger(codigo) && (codigo as number) > 0).toBe(true);
  });
});
