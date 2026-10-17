import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TAMANHO_DO_PACOTE } from '@cifra/protocol';
import { criarServidorDeEco, lerQuadro } from '../spike/onion/eco.ts';

// O eco do .onion de teste, conferido sem Tor com o cliente WebSocket do próprio Node.

const servidor = criarServidorDeEco();
let endereco = '';

beforeAll(async () => {
  await new Promise<void>((pronto) => servidor.listen(0, '127.0.0.1', pronto));
  endereco = `ws://127.0.0.1:${String((servidor.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  servidor.closeAllConnections();
  await new Promise((pronto) => servidor.close(pronto));
});

function abrir(): Promise<WebSocket> {
  const ws = new WebSocket(endereco);
  ws.binaryType = 'arraybuffer';
  return new Promise((pronto, falhou) => {
    ws.addEventListener('open', () => {
      pronto(ws);
    });
    ws.addEventListener('error', () => {
      falhou(new Error('não conectou'));
    });
  });
}

describe('eco WebSocket do .onion de teste (RNF-04)', () => {
  it('devolve um pacote de 4096 bytes idêntico', async () => {
    const ws = await abrir();
    const pacote = new Uint8Array(randomBytes(TAMANHO_DO_PACOTE));
    const resposta = new Promise<Uint8Array>((pronto) => {
      ws.addEventListener('message', (evento) => {
        pronto(new Uint8Array(evento.data as ArrayBuffer));
      });
    });
    ws.send(pacote);
    expect(await resposta).toEqual(pacote);
    ws.close();
  });

  it('fecha a conexão com 1003 quando recebe texto', async () => {
    const ws = await abrir();
    const fechou = new Promise<number>((pronto) => {
      ws.addEventListener('close', (evento) => {
        pronto(evento.code);
      });
    });
    ws.send('texto');
    expect(await fechou).toBe(1003);
  });

  it('recusa quadro sem máscara, fragmentado ou grande demais', () => {
    expect(lerQuadro(Buffer.from([0x82, 0x01, 0x00]))).toEqual({ erro: 1002 });
    expect(lerQuadro(Buffer.from([0x02, 0x81, 0, 0, 0, 0, 0]))).toEqual({ erro: 1002 });
    expect(lerQuadro(Buffer.from([0x82, 0xff]))).toEqual({ erro: 1009 });
    expect(lerQuadro(Buffer.from([0x82]))).toBeNull();
  });
});
