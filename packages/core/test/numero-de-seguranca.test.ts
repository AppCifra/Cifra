import { createHash } from 'node:crypto';
import { idDaChave } from '@cifra/protocol';
import { describe, expect, it } from 'vitest';
import { cenarioDosVetores, verificarProtocolo, VETORES } from '../src/conformidade/protocolo.ts';
import { GRUPOS_DO_NUMERO, ITERACOES_DO_NUMERO, numeroDeSeguranca } from '../src/index.ts';
import type { Cripto } from '../src/index.ts';
import { cripto } from './adaptadores/sodium-node.ts';

// RF-37: 12 grupos de 5 dígitos, iguais nos dois aparelhos. O vetor é refeito aqui sem a libsodium
// nas iterações: o BLAKE2b-512 do OpenSSL (node:crypto) e os pedaços de 5 bytes em BigInt. O ID,
// que entra no começo, tem os próprios vetores (packages/protocol/test/id.test.ts).

function digitosPeloOpenssl(chave: Uint8Array): string {
  const id = Buffer.from(idDaChave(cripto, chave));
  let h = Buffer.concat([Buffer.from([0, 0]), Buffer.from(chave), id]);
  for (let i = 0; i < 5200; i++) {
    h = createHash('blake2b512')
      .update(Buffer.concat([h, Buffer.from(chave)]))
      .digest();
  }
  let digitos = '';
  for (let pedaco = 0; pedaco < 6; pedaco++) {
    let valor = 0n;
    for (const byte of h.subarray(pedaco * 5, pedaco * 5 + 5)) valor = (valor << 8n) | BigInt(byte);
    digitos += String(valor % 100_000n).padStart(5, '0');
  }
  return digitos;
}

describe('número de segurança (RF-37)', () => {
  const { alice, bob } = cenarioDosVetores(cripto);
  const daAlice = alice.assinatura.publicKey;
  const doBob = bob.assinatura.publicKey;

  it('12 grupos de 5 dígitos, iguais dos dois lados', () => {
    const visto = numeroDeSeguranca(cripto, daAlice, doBob);
    expect(visto).toHaveLength(GRUPOS_DO_NUMERO);
    for (const grupo of visto) expect(grupo).toMatch(/^\d{5}$/);
    expect(numeroDeSeguranca(cripto, doBob, daAlice)).toEqual(visto);
    expect(visto.join('')).toBe(VETORES.numeroDeSeguranca);
  });

  it('o vetor sai igual pelo BLAKE2b do OpenSSL, com 5200 iterações e o menor lado primeiro', () => {
    expect(ITERACOES_DO_NUMERO).toBe(5200);
    const lados = [digitosPeloOpenssl(daAlice), digitosPeloOpenssl(doBob)].sort();
    expect(lados.join('')).toBe(VETORES.numeroDeSeguranca);
  });

  it('outra chave dá outro número', () => {
    const outra = cripto.crypto_sign_seed_keypair(cripto.randombytes_buf(32)).publicKey;
    expect(numeroDeSeguranca(cripto, daAlice, outra)).not.toEqual(
      numeroDeSeguranca(cripto, daAlice, doBob),
    );
  });

  it('a verificação do aparelho acusa um hash que foge do BLAKE2b-512', async () => {
    const outroHash = Object.assign(Object.create(cripto) as Cripto, {
      crypto_generichash: (tamanho: number, mensagem: Uint8Array, chave: Uint8Array | null) =>
        cripto.crypto_generichash(tamanho === 64 ? 63 : tamanho, mensagem, chave),
    });
    const falhas = (await verificarProtocolo(outroHash)).filter(({ ok }) => !ok);
    expect(falhas.map(({ nome }) => nome)).toEqual(['protocolo.numero-de-seguranca']);
  });
});
