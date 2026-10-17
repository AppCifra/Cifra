import { request } from 'node:http';
import {
  caminhoDoAnexo,
  RETENCAO_DO_ANEXO_EM_DIAS,
  TAMANHO_MAXIMO_DO_ANEXO,
  tamanhoDoAnexo,
} from '@cifra/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { LimitesDoRelay } from '../src/relay.ts';
import { contem, DIA, HORA, sodium, subirRelay, TAXAS_LIVRES, type RelayDeTeste } from './ajuda.ts';

// Anexos no relay (RF-35, RNF-13, RNF-14): o relay guarda o blob cifrado até quem tem o token
// baixar e apagar, ou até vencer. Valida tamanho, caminho e limites; o banco não guarda o token.

let relay: RelayDeTeste;

afterEach(async () => {
  await relay.fechar();
});

const LIMITES: Partial<LimitesDoRelay> = {
  ...TAXAS_LIVRES,
  anexos: { subindo: 4, transferencias: 8, espaco: 64 * 1024 * 1024, parada: 5000 },
};

async function subir(limites: Partial<LimitesDoRelay> = LIMITES) {
  relay = await subirRelay(limites);
}

const token = () => sodium.randombytes_buf(32);
const url = (t: Uint8Array) => relay.endereco.replace('ws://', 'http://') + caminhoDoAnexo(t);
const blob = (tamanho: number) => sodium.randombytes_buf(tamanho);

async function pedir(metodo: string, t: Uint8Array, corpo?: Uint8Array) {
  const resposta = await fetch(url(t), { method: metodo, ...(corpo ? { body: corpo } : {}) });
  return { status: resposta.status, corpo: new Uint8Array(await resposta.arrayBuffer()) };
}

/** Manda só parte do corpo e corta a conexão, como uma queda de rede no meio do envio. */
function subirCortado(t: Uint8Array, declarado: number, enviado: number): Promise<void> {
  return new Promise((pronto) => {
    const pedido = request(url(t), {
      method: 'PUT',
      headers: { 'Content-Length': declarado },
    });
    pedido.on('error', () => {
      pronto();
    });
    pedido.write(blob(enviado), () => {
      setTimeout(() => {
        pedido.destroy();
        setTimeout(pronto, 50);
      }, 50);
    });
  });
}

describe('anexos no relay (RF-35)', () => {
  it('sobe, baixa igual e, depois de apagado, não existe mais', async () => {
    await subir();
    const t = token();
    const dados = blob(tamanhoDoAnexo(200_000));
    expect((await pedir('PUT', t, dados)).status).toBe(201);
    const baixado = await pedir('GET', t);
    expect(baixado.status).toBe(200);
    expect(baixado.corpo).toEqual(dados);
    expect((await pedir('DELETE', t)).status).toBe(204);
    expect((await pedir('GET', t)).status).toBe(404);
    expect((await pedir('DELETE', t)).status).toBe(404);
  });

  it('o banco guarda o hash do token, não o token; o que sai do banco sai do arquivo', async () => {
    await subir();
    const t = token();
    const dados = blob(tamanhoDoAnexo(100_000));
    await pedir('PUT', t, dados);
    const trecho = dados.subarray(70_000, 70_064);
    expect(contem(relay.bytesDoBanco(), trecho)).toBe(true);
    expect(contem(relay.bytesDoBanco(), t)).toBe(false);
    const [linha] = relay.consultar('SELECT id, expira_em FROM anexos');
    expect(linha?.['id']).toEqual(sodium.crypto_generichash(32, t, null));
    // Datas só na hora cheia, como o resto do banco do relay.
    expect(Number(linha?.['expira_em']) % HORA).toBe(0);
    await pedir('DELETE', t);
    expect(relay.consultar('SELECT count(*) AS n FROM pedacos')[0]?.['n']).toBe(0);
    expect(contem(relay.bytesDoBanco(), trecho)).toBe(false);
  });

  it('anexo não baixado some em 14 dias (RNF-14)', async () => {
    await subir();
    const t = token();
    await pedir('PUT', t, blob(4096));
    relay.relogio.avancar(RETENCAO_DO_ANEXO_EM_DIAS * DIA - 2 * HORA);
    relay.relay.limpar();
    expect((await pedir('GET', t)).status).toBe(200);
    relay.relogio.avancar(3 * HORA);
    relay.relay.limpar();
    expect((await pedir('GET', t)).status).toBe(404);
  });

  it('o reenvio de um anexo que já subiu responde 409 e não muda nada', async () => {
    await subir();
    const t = token();
    const dados = blob(4096);
    await pedir('PUT', t, dados);
    expect((await pedir('PUT', t, blob(4096))).status).toBe(409);
    expect((await pedir('GET', t)).corpo).toEqual(dados);
  });
});

describe('o relay não confia no cliente nos anexos (RNF-13)', () => {
  it('recusa tamanho fora das faixas, acima de 25 MiB ou sem Content-Length', async () => {
    await subir();
    expect((await pedir('PUT', token(), blob(4095))).status).toBe(413);
    expect((await pedir('PUT', token(), blob(5121))).status).toBe(413);
    const grande = await new Promise<number>((pronto) => {
      const pedido = request(url(token()), {
        method: 'PUT',
        headers: { 'Content-Length': TAMANHO_MAXIMO_DO_ANEXO + 1 },
      });
      pedido.on('response', (resposta) => {
        pronto(resposta.statusCode ?? 0);
      });
      pedido.on('error', () => undefined);
      pedido.end();
    });
    expect(grande).toBe(413);
    const semTamanho = await new Promise<number>((pronto) => {
      const pedido = request(url(token()), { method: 'PUT' });
      pedido.on('response', (resposta) => {
        pronto(resposta.statusCode ?? 0);
      });
      pedido.on('error', () => undefined);
      pedido.write(blob(4096));
      pedido.end();
    });
    expect(semTamanho).toBe(411);
    expect(relay.consultar('SELECT count(*) AS n FROM anexos')[0]?.['n']).toBe(0);
  });

  it('corpo cortado no meio não fica, e ninguém baixa o que ainda está subindo', async () => {
    await subir();
    const t = token();
    await subirCortado(t, tamanhoDoAnexo(300_000), 100_000);
    expect(relay.consultar('SELECT count(*) AS n FROM anexos')[0]?.['n']).toBe(0);
    expect(relay.consultar('SELECT count(*) AS n FROM pedacos')[0]?.['n']).toBe(0);
    expect((await pedir('GET', t)).status).toBe(404);
  });

  it('caminho que não é anexo, método desconhecido e pedido sem anexo', async () => {
    await subir();
    const base = relay.endereco.replace('ws://', 'http://');
    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/anexos/abc`)).status).toBe(404);
    expect((await fetch(`${url(token())}?x=1`)).status).toBe(404);
    expect((await fetch(url(token()), { method: 'POST', body: blob(10) })).status).toBe(405);
    expect((await pedir('GET', token())).status).toBe(404);
  });

  it('espaço cheio: o relay recusa o anexo novo (507), e o app tenta depois', async () => {
    await subir({
      ...LIMITES,
      anexos: { subindo: 4, transferencias: 8, espaco: 8192, parada: 5000 },
    });
    expect((await pedir('PUT', token(), blob(4096))).status).toBe(201);
    expect((await pedir('PUT', token(), blob(4096))).status).toBe(201);
    expect((await pedir('PUT', token(), blob(4096))).status).toBe(507);
  });

  it('acima dos envios ao mesmo tempo, recusa (503); baixar continua', async () => {
    await subir({
      ...LIMITES,
      anexos: { subindo: 0, transferencias: 8, espaco: 8192, parada: 5000 },
    });
    expect((await pedir('PUT', token(), blob(4096))).status).toBe(503);
    expect((await pedir('GET', token())).status).toBe(404);
  });

  it('o relay não escreve a data do servidor na resposta', async () => {
    await subir();
    const resposta = await fetch(url(token()));
    expect(resposta.headers.get('date')).toBeNull();
  });
});
