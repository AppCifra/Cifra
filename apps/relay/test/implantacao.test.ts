import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Registros (RNF-05) na implantação: o Docker não guarda log de nenhum serviço, e o Tor só escreve
// avisos, sem endereço nenhum. E as defesas do onion service contra inundação.

const ler = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), 'utf8');

const torrc = ler('../tor/torrc')
  .split('\n')
  .map((linha) => linha.trim())
  .filter((linha) => linha !== '' && !linha.startsWith('#'));

const compose = ler('../docker-compose.yml');

/** O trecho de um serviço do compose, até o próximo serviço ou a próxima seção. */
function servico(nome: string): string {
  const inicio = compose.indexOf(`\n  ${nome}:\n`);
  if (inicio === -1) throw new Error(`serviço ${nome} fora do compose`);
  const resto = compose.slice(inicio + 1);
  const fim = resto.search(/\n {2}\S|\n\S/);
  return fim === -1 ? resto : resto.slice(0, fim);
}

describe('implantação sem registros (RNF-05)', () => {
  it('o Tor só escreve avisos, com SafeLogging', () => {
    expect(torrc).toContain('SafeLogging 1');
    expect(torrc.filter((linha) => linha.startsWith('Log '))).toEqual(['Log warn stdout']);
  });

  it('o compose não guarda log de nenhum serviço', () => {
    for (const nome of ['tor', 'relay']) {
      expect(servico(nome)).toMatch(/\n {4}logging:\n {6}driver: none(\n|$)/);
    }
  });
});

describe('defesas do onion service', () => {
  it('liga a defesa dos pontos de introdução e a prova de trabalho, depois do HiddenServiceDir', () => {
    const diretorio = torrc.indexOf('HiddenServiceDir /var/lib/tor/cifra-relay/');
    expect(diretorio).toBeGreaterThanOrEqual(0);
    for (const linha of [
      'HiddenServiceEnableIntroDoSDefense 1',
      'HiddenServicePoWDefensesEnabled 1',
    ]) {
      expect(torrc.indexOf(linha)).toBeGreaterThan(diretorio);
    }
  });
});
