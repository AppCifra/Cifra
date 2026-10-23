import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Registros (RNF-05) na implantação: o Docker não guarda log do relay, e o Tor só escreve avisos,
// sem endereço nenhum. E as defesas do onion service contra inundação.

const ler = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), 'utf8');

const torrc = ler('../tor/torrc')
  .split('\n')
  .map((linha) => linha.trim())
  .filter((linha) => linha !== '' && !linha.startsWith('#'));

describe('implantação sem registros (RNF-05)', () => {
  it('o Tor só escreve avisos, com SafeLogging', () => {
    expect(torrc).toContain('SafeLogging 1');
    expect(torrc.filter((linha) => linha.startsWith('Log '))).toEqual(['Log warn stdout']);
  });

  it('o compose não guarda log do relay', () => {
    const compose = ler('../docker-compose.yml');
    const relay = compose.slice(compose.indexOf('\n  relay:'), compose.indexOf('\nvolumes:'));
    expect(relay).toMatch(/\n {4}logging:\n {6}driver: none\n/);
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
