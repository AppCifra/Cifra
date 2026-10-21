import { describe, expect, it } from 'vitest';
import { enderecoDeRelayValido, LIMITE_DO_ENDERECO } from '../src/index.ts';

const ONION = 'ws://' + 'a'.repeat(56) + '.onion';

describe('endereço de relay no cartão', () => {
  it('aceita .onion com ws:// e qualquer host com wss://', () => {
    for (const endereco of [
      ONION,
      `${ONION}:80`,
      `${ONION}/`,
      'wss://relay.cifra.example',
      'wss://relay.cifra.example:443/caixas',
      'wss://' + 'a'.repeat(56) + '.onion',
    ]) {
      expect(enderecoDeRelayValido(endereco), endereco).toBe(true);
    }
  });

  it('recusa texto claro fora do Tor e qualquer coisa fora do formato', () => {
    for (const endereco of [
      'ws://relay.cifra.example',
      'ws://127.0.0.1:8080',
      'http://relay.cifra.example',
      'wss://',
      'wss://Relay.cifra.example',
      'wss://relay.cifra.example:0',
      'wss://relay.cifra.example:65536',
      'wss://relay .cifra.example',
      'wss://-relay.cifra.example',
      'wss://relay.cifra.example.',
      'wss://relação.example',
      'wss://relay.cifra.example/ caixa',
      ` ${ONION}`,
      '',
    ]) {
      expect(enderecoDeRelayValido(endereco), endereco).toBe(false);
    }
  });

  it('recusa ? e # no caminho: o endereço dos anexos vem colado depois dele', () => {
    for (const endereco of [
      `${ONION}/?a`,
      `${ONION}/caixas?versao=1`,
      'wss://relay.cifra.example/#topo',
      'wss://relay.cifra.example/caixas#',
    ]) {
      expect(enderecoDeRelayValido(endereco), endereco).toBe(false);
    }
  });

  it(`aceita até ${LIMITE_DO_ENDERECO} bytes`, () => {
    const base = 'wss://relay.example/';
    const noLimite = base + 'a'.repeat(LIMITE_DO_ENDERECO - base.length);
    expect(enderecoDeRelayValido(noLimite)).toBe(true);
    expect(enderecoDeRelayValido(noLimite + 'a')).toBe(false);
  });
});
