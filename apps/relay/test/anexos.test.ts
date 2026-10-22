import { randomFillSync } from 'node:crypto';
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

// Janela curta e ritmo baixo, para o teste medir em décimos de segundo; o envio normal passa com folga.
const ANEXOS = {
  subindo: 4,
  transferencias: 8,
  espaco: 64 * 1024 * 1024,
  parada: 5000,
  janelaDoRitmo: 200,
  ritmoMinimo: 1024,
  duracao: 20_000,
};

const LIMITES: Partial<LimitesDoRelay> = { ...TAXAS_LIVRES, anexos: ANEXOS };

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

/** Manda a primeira metade do corpo e espera: `terminar` manda o resto e devolve o status. */
function subirAosPoucos(t: Uint8Array, dados: Uint8Array): { terminar: () => Promise<number> } {
  const pedido = request(url(t), { method: 'PUT', headers: { 'Content-Length': dados.length } });
  const status = new Promise<number>((pronto) => {
    pedido.on('response', (resposta) => {
      resposta.resume();
      pronto(resposta.statusCode ?? 0);
    });
    pedido.on('error', () => {
      pronto(0);
    });
  });
  const metade = Math.floor(dados.length / 2);
  pedido.write(dados.subarray(0, metade));
  return {
    terminar: () => {
      pedido.end(dados.subarray(metade));
      return status;
    },
  };
}

/** Espera o relay ter `quantos` anexos, completos ou subindo. */
async function anexosGuardados(quantos: number): Promise<void> {
  const limite = Date.now() + 5000;
  while (relay.consultar('SELECT count(*) AS n FROM anexos')[0]?.['n'] !== quantos) {
    if (Date.now() > limite) throw new Error(`o relay não chegou a ${String(quantos)} anexos`);
    await new Promise((pronto) => setTimeout(pronto, 5));
  }
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

/**
 * Manda `dados` aos poucos: `pedaco` bytes a cada `intervalo` ms. Resolve com o status, ou 0 se a
 * conexão caiu antes da resposta.
 */
function subirNoRitmo(
  t: Uint8Array,
  dados: Uint8Array,
  pedaco: number,
  intervalo: number,
): Promise<number> {
  return new Promise((pronto) => {
    const pedido = request(url(t), { method: 'PUT', headers: { 'Content-Length': dados.length } });
    let encerrou = false;
    const terminar = (status: number) => {
      if (encerrou) return;
      encerrou = true;
      clearInterval(passo);
      pronto(status);
    };
    pedido.on('response', (resposta) => {
      resposta.resume();
      resposta.on('end', () => {
        terminar(resposta.statusCode ?? 0);
      });
    });
    pedido.on('error', () => {
      terminar(0);
    });
    pedido.on('close', () => {
      terminar(0);
    });
    let posicao = 0;
    const passo = setInterval(() => {
      if (encerrou) return;
      const fim = Math.min(posicao + pedaco, dados.length);
      pedido.write(dados.subarray(posicao, fim));
      posicao = fim;
      if (posicao === dados.length) {
        clearInterval(passo);
        pedido.end();
      }
    }, intervalo);
  });
}

/**
 * Baixa devagar: pede um byte a cada 250 ms, e o Node puxa um pedaço do socket (uns 64 KiB) a cada
 * pedido, como um cliente que lê sem parar, mas pouco. `comecou` resolve com o status quando o relay
 * começa a responder; `fim`, com quantos bytes chegaram, quando a conexão acaba.
 */
function baixarDevagar(t: Uint8Array): {
  comecou: Promise<number>;
  fim: Promise<number>;
  desistir: () => void;
} {
  const pedido = request(url(t), { method: 'GET' });
  let recebidos = 0;
  let encerrar: (quantos: number) => void = () => undefined;
  const fim = new Promise<number>((pronto) => {
    encerrar = pronto;
  });
  const comecou = new Promise<number>((pronto) => {
    pedido.on('response', (resposta) => {
      pronto(resposta.statusCode ?? 0);
      resposta.pause();
      const passo = setInterval(() => {
        const byte: unknown = resposta.read(1);
        if (byte instanceof Uint8Array) recebidos += byte.length;
      }, 250);
      const acabou = () => {
        clearInterval(passo);
        encerrar(recebidos);
      };
      resposta.on('close', acabou);
      resposta.on('error', acabou);
    });
    pedido.on('error', () => {
      pronto(0);
      encerrar(recebidos);
    });
    pedido.end();
  });
  return {
    comecou,
    fim,
    desistir: () => {
      pedido.destroy();
    },
  };
}

/** Espera, em tempo de verdade, até a condição valer. */
async function ate(condicao: () => boolean | Promise<boolean>, oQue: string): Promise<void> {
  const limite = Date.now() + 5000;
  while (!(await condicao())) {
    if (Date.now() > limite) throw new Error(`não aconteceu: ${oQue}`);
    await new Promise((pronto) => setTimeout(pronto, 20));
  }
}

describe('ritmo mínimo da transferência (RNF-13)', () => {
  it('download que lê devagar demais cai pelo ritmo, e a vaga volta', async () => {
    // O cliente lê uns 64 KiB a cada 250 ms, sem parar: a parada não corta, e o ritmo pedido aqui
    // (128 KiB por janela de 200 ms) não é alcançado. Uma vaga só, para ver que ela volta.
    await subir({
      ...LIMITES,
      anexos: { ...ANEXOS, transferencias: 1, parada: 30_000, ritmoMinimo: 128 * 1024 },
    });
    const t = token();
    // Blob grande sem passar pelo sodium, que leva segundos para gerar megabytes aleatórios.
    const dados = randomFillSync(new Uint8Array(tamanhoDoAnexo(2 * 1024 * 1024)));
    expect((await pedir('PUT', t, dados)).status).toBe(201);

    const lento = baixarDevagar(t);
    expect(await lento.comecou).toBe(200);
    // A única vaga está com o download lento.
    expect((await pedir('GET', t)).status).toBe(503);
    // Em poucas janelas abaixo do ritmo, o relay corta, e a vaga volta.
    await ate(async () => (await pedir('GET', t)).status === 200, 'a vaga volta');
    lento.desistir();
    expect(await lento.fim).toBeLessThan(dados.length);
  });

  it('envio que manda um byte de vez em quando cai, e o que subiu não fica', async () => {
    await subir({ ...LIMITES, anexos: { ...ANEXOS, subindo: 1, parada: 30_000 } });
    const t = token();
    // Um byte a cada 50 ms zera a parada o tempo todo, mas não chega a 1 KiB por janela.
    expect(await subirNoRitmo(t, blob(tamanhoDoAnexo(300_000)), 1, 50)).toBe(0);
    await ate(
      () => relay.consultar('SELECT count(*) AS n FROM anexos')[0]?.['n'] === 0,
      'o anexo pela metade sai',
    );
    expect(relay.consultar('SELECT count(*) AS n FROM pedacos')[0]?.['n']).toBe(0);
    expect((await pedir('GET', t)).status).toBe(404);
    // A vaga de envio voltou.
    expect((await pedir('PUT', token(), blob(4096))).status).toBe(201);
  });

  it('a transferência que anda no ritmo não cai', async () => {
    await subir();
    const t = token();
    const dados = blob(tamanhoDoAnexo(200_000));
    // 8 KiB a cada 20 ms: uns 80 KiB por janela, bem acima do mínimo.
    expect(await subirNoRitmo(t, dados, 8192, 20)).toBe(201);
    const baixado = await pedir('GET', t);
    expect(baixado.status).toBe(200);
    expect(baixado.corpo).toEqual(dados);
  });

  it('nenhuma transferência passa da duração, mesmo andando', async () => {
    await subir({ ...LIMITES, anexos: { ...ANEXOS, duracao: 300 } });
    const t = token();
    // No ritmo, mas levaria mais de 1 s: cai aos 300 ms, e nada fica.
    expect(await subirNoRitmo(t, blob(tamanhoDoAnexo(512 * 1024)), 8192, 20)).toBe(0);
    await ate(
      () => relay.consultar('SELECT count(*) AS n FROM anexos')[0]?.['n'] === 0,
      'o anexo pela metade sai',
    );
    expect((await pedir('GET', t)).status).toBe(404);
  });
});

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

  it('o reenvio enquanto o primeiro ainda sobe responde 503, e o anexo fica o do primeiro', async () => {
    await subir();
    const t = token();
    const dados = blob(tamanhoDoAnexo(300_000));
    const primeiro = subirAosPoucos(t, dados);
    await anexosGuardados(1);
    expect((await pedir('PUT', t, blob(4096))).status).toBe(503);
    expect(await primeiro.terminar()).toBe(201);
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
      anexos: { ...ANEXOS, espaco: 8192 },
    });
    expect((await pedir('PUT', token(), blob(4096))).status).toBe(201);
    expect((await pedir('PUT', token(), blob(4096))).status).toBe(201);
    expect((await pedir('PUT', token(), blob(4096))).status).toBe(507);
  });

  it('acima dos envios ao mesmo tempo, recusa (503); baixar continua', async () => {
    await subir({
      ...LIMITES,
      anexos: { ...ANEXOS, subindo: 0, espaco: 8192 },
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
