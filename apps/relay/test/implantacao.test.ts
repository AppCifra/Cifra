import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Registros (RNF-05) na implantação: o Docker não guarda log do relay, e o Tor só escreve avisos,
// sem endereço nenhum.

const ler = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), 'utf8');

describe('implantação sem registros (RNF-05)', () => {
  it('o Tor só escreve avisos, com SafeLogging', () => {
    const linhas = ler('../tor/torrc')
      .split('\n')
      .filter((linha) => linha.trim() !== '' && !linha.startsWith('#'));
    expect(linhas).toContain('SafeLogging 1');
    expect(linhas.filter((linha) => linha.startsWith('Log '))).toEqual(['Log warn stdout']);
  });

  it('o compose não guarda log do relay', () => {
    const compose = ler('../docker-compose.yml');
    const relay = compose.slice(compose.indexOf('\n  relay:'), compose.indexOf('\nvolumes:'));
    expect(relay).toMatch(/\n {4}logging:\n {6}driver: none\n/);
  });
});
