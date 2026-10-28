import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { IDIOMAS, TRADUCOES } from '../../../packages/i18n/src/index.ts';
import { ORBOT_NA_LOJA, PACOTE_DO_ORBOT } from '../src/orbot.ts';

// O "?" ao lado do status da conexão (RF-64): o painel explica o Orbot e "Baixar o Orbot" abre a
// página dele na loja de apps do celular. É o único link do app, e nunca vai para o navegador, que
// sairia do Tor.

const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** O código do app, arquivo por arquivo. */
const codigo = () =>
  readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((arquivo) => /\.tsx?$/.test(arquivo))
    .map((arquivo) => ({ arquivo, texto: readFileSync(join(SRC, arquivo), 'utf8') }));

describe('ajuda da conexão (RF-64)', () => {
  it('o link é a página do Orbot na loja de apps, pelo market://', () => {
    expect(PACOTE_DO_ORBOT).toBe('org.torproject.android');
    expect(ORBOT_NA_LOJA).toBe(`market://details?id=${PACOTE_DO_ORBOT}`);
  });

  it('o app só abre esse link, e nenhum endereço da web', () => {
    const aberturas = codigo().flatMap(({ arquivo, texto }) =>
      [...texto.matchAll(/Linking\.openURL\(([^)]*)\)/g)].map(([, alvo]) => `${arquivo}: ${alvo}`),
    );
    expect(aberturas).toHaveLength(1);
    expect(aberturas[0]).toMatch(/: ORBOT_NA_LOJA$/);
    const web = codigo().filter(({ texto }) => /Linking\.\w+\(\s*['"`]https?:/.test(texto));
    expect(web).toEqual([]);
  });

  it('o painel cita o status de conectado como a tela mostra', () => {
    for (const idioma of IDIOMAS) {
      const { conexao, rede } = TRADUCOES[idioma];
      expect(conexao.descricao).toContain(`“${rede.conectado}”`);
    }
  });
});
