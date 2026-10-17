import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENDERECO_MONERO } from '../src/doacao.ts';

// Doações em Monero, pelo endereço direto (RF-60): o endereço do app é o do SPEC, e o copiar passa
// pela mesma cópia sensível do ID, que sai da área de transferência sozinha. O checksum do endereço
// (Keccak-256) foi conferido à mão: nem a libsodium nem o OpenSSL do Node têm Keccak.

/** O alfabeto base58 do Monero: sem 0, O, I e l. */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

const ler = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), 'utf8');

describe('doações (RF-60)', () => {
  it('o endereço é um subendereço da rede principal do Monero, o mesmo do SPEC', () => {
    expect(ENDERECO_MONERO).toHaveLength(95);
    expect(ENDERECO_MONERO).toMatch(BASE58);
    // 8 no começo: subendereço, na rede principal.
    expect(ENDERECO_MONERO[0]).toBe('8');
    expect(ler('../../../docs/SPEC.md')).toContain(`\`${ENDERECO_MONERO}\``);
  });

  it('o painel copia o endereço pela cópia sensível, a mesma do ID', () => {
    const tela = ler('../src/telas/Conversas.tsx');
    expect(tela).toContain('conversas.copiarTexto(ENDERECO_MONERO)');
    expect(tela.match(/icone="coracao"/g)).toHaveLength(1);
  });
});
