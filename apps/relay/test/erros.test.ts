import { FECHAMENTOS } from '@cifra/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClienteDoRelay } from '../scripts/cliente.ts';
import type { Banco } from '../src/banco.ts';
import {
  abrir,
  codigo,
  falhando,
  marcaDeTeste,
  novoPar,
  pacoteAleatorio,
  sodium,
  subirRelay,
  TAXAS_LIVRES,
  type ParDeTeste,
  type RelayDeTeste,
} from './ajuda.ts';

// Um erro do banco no meio de um pedido (disco cheio, arquivo danificado) não derruba o relay: só
// a conexão daquele pedido cai, e as outras continuam (RNF-13).

let relay: RelayDeTeste;
let falhar: keyof Banco | null = null;

async function subir() {
  falhar = null;
  relay = await subirRelay(TAXAS_LIVRES, (banco) => falhando(banco, () => falhar));
}

afterEach(async () => {
  falhar = null;
  await relay.fechar();
});

function depositar(cliente: ClienteDoRelay, caixa: ParDeTeste) {
  return cliente.pedir({
    tipo: 'depositar',
    caixa: caixa.publicKey,
    pacote: pacoteAleatorio(),
    marca: marcaDeTeste(),
  });
}

const urlDoAnexo = () =>
  relay.endereco.replace('ws://', 'http://') +
  '/anexos/' +
  Buffer.from(sodium.randombytes_buf(32)).toString('hex');

describe('erro do banco num pedido (RNF-13)', () => {
  it('fecha só a conexão que pediu; as outras continuam', async () => {
    await subir();
    const caixa = novoPar();
    const dono = await relay.conectar();
    expect(codigo(await dono.pedir({ tipo: 'criar-caixa', caixa: caixa.publicKey }))).toBe('ok');
    expect(codigo(await abrir(dono, caixa))).toBe('ok');
    expect((await dono.proximoAviso()).tipo).toBe('em-dia');

    const quem = await relay.conectar();
    falhar = 'depositar';
    await expect(depositar(quem, caixa)).rejects.toThrow('conexão fechada');
    expect(await quem.fechamento).toBe(FECHAMENTOS.erroInterno);

    falhar = null;
    const outro = await relay.conectar();
    expect(codigo(await depositar(outro, caixa))).toBe('ok');
    expect((await dono.proximoAviso()).tipo).toBe('pacote');
  });

  it('nos anexos, responde 500 e o relay continua', async () => {
    await subir();
    falhar = 'comecarAnexo';
    const envio = await fetch(urlDoAnexo(), {
      method: 'PUT',
      body: sodium.randombytes_buf(4096),
    });
    expect(envio.status).toBe(500);
    falhar = 'anexo';
    expect((await fetch(urlDoAnexo())).status).toBe(500);
    falhar = 'apagarAnexo';
    expect((await fetch(urlDoAnexo(), { method: 'DELETE' })).status).toBe(500);

    falhar = null;
    expect((await fetch(urlDoAnexo())).status).toBe(404);
    const cliente = await relay.conectar();
    expect(codigo(await cliente.pedir({ tipo: 'criar-caixa', caixa: novoPar().publicKey }))).toBe(
      'ok',
    );
  });

  it('a limpeza que falha não derruba o relay; a próxima tenta de novo', async () => {
    await subir();
    falhar = 'apagarVencidos';
    expect(() => {
      relay.relay.limpar();
    }).not.toThrow();
    falhar = null;
    expect(() => {
      relay.relay.limpar();
    }).not.toThrow();
  });
});
