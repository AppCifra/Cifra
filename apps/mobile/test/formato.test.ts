import { describe, expect, it } from 'vitest';
import {
  arquivoNaoAbre,
  chaveDoSqlcipher,
  contem,
  deBase64,
  enderecoDeDados,
  paraBase64,
  pedidoCancelado,
  problemaNoEndereco,
} from '../src/adaptadores/formato.ts';

describe('chave do SQLCipher (RNF-07)', () => {
  it("vira chave crua x'<64 hex>', que o SQLCipher usa sem PBKDF2", () => {
    const chave = Uint8Array.from({ length: 32 }, (_, i) => i * 8);
    expect(chaveDoSqlcipher(chave)).toBe(
      "x'0008101820283038404850586068707880889098a0a8b0b8c0c8d0d8e0e8f0f8'",
    );
  });

  it('recusa chave que não tem 256 bits', () => {
    expect(() => chaveDoSqlcipher(new Uint8Array(16))).toThrow();
    expect(() => chaveDoSqlcipher(new Uint8Array(33))).toThrow();
  });
});

describe('falhas ao abrir (RNF-07)', () => {
  it('reconhece o banco que não abre com a chave, no erro do op-sqlite', () => {
    expect(arquivoNaoAbre('[op-sqlite] SQL execution error: file is not a database')).toBe(true);
    expect(arquivoNaoAbre('[op-sqlite] SQL execution error: disk I/O error')).toBe(false);
    expect(arquivoNaoAbre('database is locked')).toBe(false);
  });

  it('reconhece o pedido de biometria cancelado pela pessoa, pelo botão ou pelo sistema', () => {
    expect(pedidoCancelado('code: 13, msg: Cancelar')).toBe(true);
    expect(pedidoCancelado('code: 10, msg: Authentication canceled by user.')).toBe(true);
    expect(pedidoCancelado('code: 5, msg: Authentication canceled.')).toBe(true);
  });

  it('não confunde cancelamento com bloqueio por tentativas nem com outro erro', () => {
    expect(pedidoCancelado('code: 7, msg: Too many attempts. Try again later.')).toBe(false);
    expect(pedidoCancelado('code: 9, msg: Too many attempts.')).toBe(false);
    expect(pedidoCancelado('code: 130, msg: x')).toBe(false);
    expect(pedidoCancelado('Wrapped error: AEADBadTagException')).toBe(false);
    expect(pedidoCancelado('')).toBe(false);
  });
});

describe('segredo em base64 para o Keystore', () => {
  it('ida e volta preserva todos os valores de byte', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(deBase64(paraBase64(bytes))).toEqual(bytes);
    expect(paraBase64(new Uint8Array([0xff, 0x00, 0x10]))).toBe('/wAQ');
  });

  it('uma foto inteira vai e volta, em blocos, igual ao base64 do Node', () => {
    const foto = Uint8Array.from({ length: 1_000_003 }, (_, i) => (i * 31 + 7) % 256);
    const texto = paraBase64(foto);
    expect(texto).toBe(Buffer.from(foto).toString('base64'));
    expect(deBase64(texto)).toEqual(foto);
    expect(enderecoDeDados('image/png', new Uint8Array([1, 2, 3]))).toBe(
      'data:image/png;base64,AQID',
    );
  });
});

describe('busca de marcador nos bytes do banco', () => {
  const texto = (t: string) => Uint8Array.from(t, (c) => c.charCodeAt(0));

  it('acha no começo, no meio e no fim, e não acha o que não está', () => {
    const arquivo = texto('SQLite format 3\0...marcador...fim');
    expect(contem(arquivo, texto('SQLite'))).toBe(true);
    expect(contem(arquivo, texto('marcador'))).toBe(true);
    expect(contem(arquivo, texto('fim'))).toBe(true);
    expect(contem(arquivo, texto('marcadores'))).toBe(false);
    expect(contem(texto('mar'), texto('marcador'))).toBe(false);
  });
});

describe('endereço do relay (RF-44, RNF-06)', () => {
  const onion = 'ws://abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuv.onion';

  it('com Tor, aceita ws:// para .onion e wss:// para qualquer host', () => {
    expect(problemaNoEndereco(onion, true)).toBeNull();
    expect(problemaNoEndereco(`${onion}:80/caixa`, true)).toBeNull();
    expect(problemaNoEndereco('wss://relay.exemplo.org', true)).toBeNull();
  });

  it('nunca aceita ws:// fora do .onion, nem com Tor', () => {
    expect(problemaNoEndereco('ws://relay.exemplo.org', true)).toBe('texto-claro-fora-do-tor');
    expect(problemaNoEndereco('ws://10.0.2.2:8080', true)).toBe('texto-claro-fora-do-tor');
    expect(problemaNoEndereco('ws://falso.onion.exemplo.org', true)).toBe(
      'texto-claro-fora-do-tor',
    );
  });

  it('sem Tor, só aceita wss://', () => {
    expect(problemaNoEndereco(onion, false)).toBe('texto-claro-fora-do-tor');
    expect(problemaNoEndereco('wss://relay.exemplo.org', false)).toBeNull();
  });

  it('recusa o que não é endereço WebSocket', () => {
    expect(problemaNoEndereco('https://relay.exemplo.org', true)).toBe('endereco-invalido');
    expect(problemaNoEndereco('', true)).toBe('endereco-invalido');
    expect(problemaNoEndereco('ws://host com espaço.onion', true)).toBe('endereco-invalido');
  });

  it('o HTTP dos anexos segue as mesmas regras: http:// só para .onion com Tor', () => {
    const anexo = `${onion.replace('ws://', 'http://')}/anexos/${'ab'.repeat(32)}`;
    expect(problemaNoEndereco(anexo, true, 'http')).toBeNull();
    expect(problemaNoEndereco(anexo, false, 'http')).toBe('texto-claro-fora-do-tor');
    expect(problemaNoEndereco('https://relay.exemplo.org/anexos/ab', false, 'http')).toBeNull();
    expect(problemaNoEndereco('http://relay.exemplo.org/anexos/ab', true, 'http')).toBe(
      'texto-claro-fora-do-tor',
    );
    expect(problemaNoEndereco(onion, true, 'http')).toBe('endereco-invalido');
  });
});
