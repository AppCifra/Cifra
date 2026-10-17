import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Contatos só no Cifra (RF-10): nada vai para a agenda do sistema. O app não pede permissão de
// contatos, e o app.json bloqueia essas permissões no manifesto, para nenhuma biblioteca pedir por
// ele. Os contatos ficam no banco cifrado (migração 4 do núcleo).

interface AppJson {
  expo: { android: { permissions?: string[]; blockedPermissions?: string[] } };
}

const ler = (caminho: string): unknown =>
  JSON.parse(readFileSync(new URL(caminho, import.meta.url), 'utf8'));

const appJson = ler('../app.json') as AppJson;
const pacote = ler('../package.json') as { dependencies: Record<string, string> };

const DA_AGENDA = ['android.permission.READ_CONTACTS', 'android.permission.WRITE_CONTACTS'];

describe('contatos só no Cifra (RF-10)', () => {
  it('as permissões da agenda ficam bloqueadas no manifesto, e nenhuma é pedida', () => {
    expect(appJson.expo.android.blockedPermissions).toEqual(expect.arrayContaining(DA_AGENDA));
    const pedidas = appJson.expo.android.permissions ?? [];
    expect(pedidas.filter((permissao) => /CONTACTS/i.test(permissao))).toEqual([]);
  });

  it('nenhuma dependência mexe na agenda do sistema', () => {
    const nomes = Object.keys(pacote.dependencies);
    expect(nomes.filter((nome) => /contact/i.test(nome))).toEqual([]);
  });
});
