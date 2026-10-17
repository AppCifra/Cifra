import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// Anexos fora da galeria (RF-36): o app não pede permissão de fotos, vídeos nem armazenamento (o
// app.json bloqueia essas permissões no manifesto, para nenhuma biblioteca pedir por ele), escolhe
// pelos seletores do sistema e só grava no MediaStore quando a pessoa pede para salvar (RF-53).
// Dentro do Cifra, o anexo só é decifrado na memória: o núcleo testa isso no arquivo do banco. E o
// app roda do Android 10 em diante.

interface AppJson {
  expo: { android: { permissions?: string[]; blockedPermissions?: string[] }; plugins: string[] };
}

interface Propriedade {
  readonly type: string;
  readonly key?: string;
  readonly value?: string;
}

interface PluginAndroidMinimo {
  readonly VERSAO_MINIMA: string;
  comVersaoMinima(propriedades: readonly Propriedade[]): Propriedade[];
}

const appJson = JSON.parse(
  readFileSync(new URL('../app.json', import.meta.url), 'utf8'),
) as AppJson;
const plugin = createRequire(import.meta.url)(
  '../plugins/android-minimo.js',
) as PluginAndroidMinimo;

const DE_MIDIA = [
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_AUDIO',
  'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
  'android.permission.ACCESS_MEDIA_LOCATION',
];

const PASTA_NATIVA = new URL(
  '../modules/cifra-plataforma/android/src/main/java/org/cifra/plataforma/',
  import.meta.url,
);

describe('anexos fora da galeria (RF-36)', () => {
  it('as permissões de fotos, vídeos e armazenamento ficam bloqueadas, e nenhuma é pedida', () => {
    expect(appJson.expo.android.blockedPermissions).toEqual(expect.arrayContaining(DE_MIDIA));
    const pedidas = appJson.expo.android.permissions ?? [];
    expect(pedidas.filter((permissao) => /STORAGE|MEDIA/i.test(permissao))).toEqual([]);
  });

  it('só o salvar no celular grava no MediaStore, e o seletor não guarda permissão', () => {
    const codigo = readdirSync(PASTA_NATIVA)
      .filter((nome) => nome.endsWith('.kt'))
      .map((nome) => ({ nome, texto: readFileSync(new URL(nome, PASTA_NATIVA), 'utf8') }));
    const gravacoes = codigo.flatMap(({ nome, texto }) =>
      [...texto.matchAll(/resolver\.insert\(|insertImage\(|openFileOutput\(/g)].map(() => nome),
    );
    expect(gravacoes).toEqual(['AnexosModule.kt']);
    const anexos = codigo.find(({ nome }) => nome === 'AnexosModule.kt')?.texto ?? '';
    const salvar = /private fun salvarNoCelular[\s\S]*?\n {2}}\n/.exec(anexos)?.[0] ?? '';
    expect(salvar).toContain('resolver.insert(');
    expect(codigo.some(({ texto }) => texto.includes('takePersistableUriPermission'))).toBe(false);
  });

  it('o app roda do Android 10 em diante', () => {
    expect(appJson.expo.plugins).toContain('./plugins/android-minimo.js');
    expect(plugin.VERSAO_MINIMA).toBe('29');
    const propriedades = plugin.comVersaoMinima([
      { type: 'comment', value: 'outras' },
      { type: 'property', key: 'android.minSdkVersion', value: '24' },
    ]);
    expect(propriedades.filter((p) => p.key === 'android.minSdkVersion')).toEqual([
      { type: 'property', key: 'android.minSdkVersion', value: '29' },
    ]);
    expect(propriedades).toHaveLength(2);
  });
});
