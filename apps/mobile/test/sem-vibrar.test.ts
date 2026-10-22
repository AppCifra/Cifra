import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// O app não vibra: responder arrastando e o pânico ficam sem vibração, para não pedir permissão
// (SPEC, "Telas"). A permissão de vibrar vem do modelo do Expo e fica bloqueada no manifesto, como
// a de sobrepor outros apps, e nenhum código usa a vibração.

interface AppJson {
  expo: { android: { permissions?: string[]; blockedPermissions?: string[] } };
}

const MOBILE = fileURLToPath(new URL('..', import.meta.url));

const appJson = JSON.parse(readFileSync(join(MOBILE, 'app.json'), 'utf8')) as AppJson;

/** Os arquivos de código de uma pasta do app e das subpastas. */
function codigo(pasta: string): string[] {
  return readdirSync(join(MOBILE, pasta), { withFileTypes: true }).flatMap((item) => {
    const caminho = `${pasta}/${item.name}`;
    if (item.isDirectory()) return codigo(caminho);
    return /\.(ts|tsx|kt)$/.test(item.name) ? [caminho] : [];
  });
}

describe('sem vibrar', () => {
  it('a permissão de vibrar fica bloqueada no manifesto, e nenhuma é pedida', () => {
    expect(appJson.expo.android.blockedPermissions).toContain('android.permission.VIBRATE');
    expect(appJson.expo.android.permissions ?? []).not.toContain('android.permission.VIBRATE');
  });

  it('nenhum código do app usa a vibração', () => {
    const arquivos = [...codigo('src'), ...codigo('modules/cifra-plataforma/android/src')];
    expect(arquivos.length).toBeGreaterThan(0);
    const vibram = arquivos.filter((arquivo) =>
      /\bVibration\b|\bVibrator|\bVIBRATE\b/.test(readFileSync(join(MOBILE, arquivo), 'utf8')),
    );
    expect(vibram).toEqual([]);
  });
});
