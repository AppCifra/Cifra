import { describe, expect, it } from 'vitest';
import { lerTexto } from './util.ts';

// O README repete dois valores da seção "Distribuição" do SPEC: a impressão digital do certificado,
// com que quem baixa o APK confere a assinatura, e o endereço das doações (RF-60). Um caractere
// trocado mandaria alguém a um APK falso ou à carteira de outra pessoa.

const spec = lerTexto('docs/SPEC.md');

const impressao =
  /Impressão digital SHA-256 do certificado: `((?:[0-9A-F]{2}:){31}[0-9A-F]{2})`/.exec(spec)?.[1];
const endereco = /\*\*Doações:\*\* em Monero, no endereço `([1-9A-HJ-NP-Za-km-z]{95})`/.exec(
  spec,
)?.[1];

describe('README', () => {
  const readme = lerTexto('README.md');

  it('traz a impressão digital do certificado, a mesma do SPEC e do DESENVOLVIMENTO', () => {
    if (!impressao) throw new Error('SPEC sem a impressão digital do certificado');
    expect(readme).toContain(`\`${impressao}\``);
    // O apksigner mostra o mesmo valor em minúsculas e sem os dois-pontos.
    expect(readme).toContain(impressao.replaceAll(':', '').toLowerCase());
    expect(lerTexto('docs/DESENVOLVIMENTO.md')).toContain(`\`${impressao}\``);
  });

  it('traz o endereço das doações do SPEC (RF-60)', () => {
    if (!endereco) throw new Error('SPEC sem o endereço das doações');
    expect(readme).toContain(endereco);
  });
});
