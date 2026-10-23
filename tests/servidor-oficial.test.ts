import { describe, expect, it } from 'vitest';
import { lerTexto } from './util.ts';

// O release oficial leva o endereço do servidor oficial (SPEC, "Distribuição"), e o DESENVOLVIMENTO o
// repete no comando do release. Um caractere trocado deixaria o app sem servidor.

describe('servidor oficial', () => {
  it('o DESENVOLVIMENTO traz o mesmo endereço do SPEC, um .onion v3', () => {
    const endereco = /\*\*Servidor oficial:\*\* `(ws:\/\/[a-z2-7]{56}\.onion)`/.exec(
      lerTexto('docs/SPEC.md'),
    )?.[1];
    if (!endereco) throw new Error('SPEC sem o endereço do servidor oficial');
    expect(lerTexto('docs/DESENVOLVIMENTO.md')).toContain(`\`${endereco}\``);
  });
});
