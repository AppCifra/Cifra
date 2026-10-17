import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  Escritor,
  FECHAMENTOS,
  PINGS_SEM_RESPOSTA,
  TAMANHO_DO_PACOTE,
  TAMANHO_MAXIMO_DO_PEDIDO,
  TAXAS,
} from '@cifra/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { ClienteDoRelay } from '../scripts/cliente.ts';
import { sondar } from '../scripts/sonda.ts';
import type { LimitesDoRelay } from '../src/relay.ts';
import {
  abrir,
  codigo,
  novaIdentidade,
  novoPar,
  pacoteAleatorio,
  publicacaoDe,
  sodium,
  subirRelay,
  TAXAS_LIVRES,
  type RelayDeTeste,
  marcaDeTeste,
} from './ajuda.ts';

// RNF-13: o relay não confia no cliente. Cada teste faz o papel de um app modificado, que manda o
// que quiser, e confere que o relay recusa, não grava nada e continua de pé.

let relay: RelayDeTeste;

async function subir(limites: Partial<LimitesDoRelay> = {}) {
  relay = await subirRelay(limites);
  return relay;
}

afterEach(async () => {
  await relay.fechar();
});

/** Pedido montado à mão, sem passar pelo protocolo. */
function cru(tipo: number, numero: number, ...campos: Uint8Array[]): Uint8Array {
  const escritor = new Escritor().uint8(tipo).uint32(numero);
  for (const campo of campos) escritor.bytes(campo);
  return escritor.resultado();
}

const DEPOSITAR = 0x04;

function pacotesNoBanco(): number {
  const [linha] = relay.consultar('SELECT count(*) AS n FROM pacotes');
  return Number(linha?.['n']);
}

describe('cliente modificado (RNF-13)', () => {
  it('pacote sem exatamente 4096 bytes é recusado, a conexão cai e nada é gravado', async () => {
    await subir();
    const dono = await relay.conectar();
    const caixa = novoPar();
    await dono.pedir({ tipo: 'criar-caixa', caixa: caixa.publicKey });

    for (const tamanho of [0, 1, TAMANHO_DO_PACOTE - 1, TAMANHO_DO_PACOTE + 1]) {
      const modificado = await relay.conectar();
      modificado.enviarCru(cru(DEPOSITAR, 7, caixa.publicKey, sodium.randombytes_buf(tamanho)));
      expect(codigo(await modificado.esperar(7)), `${tamanho} bytes`).toBe('formato-invalido');
      expect(await modificado.fechamento).toBe(FECHAMENTOS.formatoInvalido);
    }
    expect(pacotesNoBanco()).toBe(0);

    // O depósito certo, na mesma caixa, continua funcionando.
    expect(
      codigo(
        await dono.pedir({
          tipo: 'depositar',
          caixa: caixa.publicKey,
          pacote: pacoteAleatorio(),
          marca: marcaDeTeste(),
        }),
      ),
    ).toBe('ok');
    expect(pacotesNoBanco()).toBe(1);
  });

  it('mensagem maior que o maior pedido possível é cortada antes de ser lida (1009)', async () => {
    await subir();
    const modificado = await relay.conectar();
    modificado.enviarCru(new Uint8Array(TAMANHO_MAXIMO_DO_PEDIDO + 1));
    expect(await modificado.fechamento).toBe(1009);
  });

  it('texto em vez de binário fecha a conexão (1003)', async () => {
    await subir();
    const modificado = await relay.conectar();
    modificado.enviarCru('{"tipo":"depositar"}');
    expect(await modificado.fechamento).toBe(1003);
  });

  it('tipo desconhecido, falta e sobra de bytes: formato-invalido e conexão fechada', async () => {
    await subir();
    const caixa = sodium.randombytes_buf(32);
    const casos = [
      cru(0x07, 1, caixa),
      cru(0x81, 2, caixa),
      cru(0x03, 3, caixa.subarray(0, 31)),
      cru(0x03, 4, caixa, new Uint8Array(1)),
      cru(0x06, 5, new Uint8Array([0])),
    ];
    for (const [i, bytes] of casos.entries()) {
      const modificado = await relay.conectar();
      modificado.enviarCru(bytes);
      expect(codigo(await modificado.esperar(i + 1)), `caso ${i + 1}`).toBe('formato-invalido');
      expect(await modificado.fechamento).toBe(FECHAMENTOS.formatoInvalido);
    }
    // Sem nem o número do pedido: a conexão cai sem resposta.
    const curto = await relay.conectar();
    curto.enviarCru(new Uint8Array([0x04, 0, 0]));
    expect(await curto.fechamento).toBe(FECHAMENTOS.formatoInvalido);
    expect(relay.consultar('SELECT count(*) AS n FROM caixas')).toEqual([{ n: 0 }]);
  });

  it(`depósito acima da taxa: taxa-excedida, sem gravar; as fichas voltam com o tempo`, async () => {
    await subir();
    const [dono, apressado] = [await relay.conectar(), await relay.conectar()];
    const caixa = novoPar();
    await dono.pedir({ tipo: 'criar-caixa', caixa: caixa.publicKey });
    const depositar = () =>
      apressado.pedir({
        tipo: 'depositar',
        caixa: caixa.publicKey,
        pacote: pacoteAleatorio(),
        marca: marcaDeTeste(),
      });

    const { rajada, porMinuto } = TAXAS.depositar;
    const respostas = await Promise.all(Array.from({ length: rajada + 5 }, depositar));
    const codigos = respostas.map(codigo);
    expect(codigos.filter((c) => c === 'ok')).toHaveLength(rajada);
    expect(codigos.filter((c) => c === 'taxa-excedida')).toHaveLength(5);
    expect(pacotesNoBanco()).toBe(rajada);

    // Depois de 3 s, voltam 3 fichas (60 por minuto).
    relay.relogio.avancar((3 * 60_000) / porMinuto);
    const depois = (await Promise.all(Array.from({ length: 4 }, depositar))).map(codigo);
    expect(depois).toEqual(['ok', 'ok', 'ok', 'taxa-excedida']);
  });

  it('busca, publicação e criação de caixa também têm taxa por conexão', async () => {
    await subir();
    const cliente = await relay.conectar();
    const buscas = await Promise.all(
      Array.from({ length: TAXAS.buscarCartao.rajada + 1 }, () =>
        cliente.pedir({ tipo: 'buscar-cartao', id: novaIdentidade().id }),
      ),
    );
    expect(buscas.map(codigo).at(-1)).toBe('taxa-excedida');

    const publicacoes = await Promise.all(
      Array.from({ length: TAXAS.publicarCartao.rajada + 1 }, () =>
        cliente.pedir({ tipo: 'publicar-cartao', publicacao: publicacaoDe(novaIdentidade()) }),
      ),
    );
    expect(publicacoes.map(codigo).at(-1)).toBe('taxa-excedida');

    const criacoes = await Promise.all(
      Array.from({ length: TAXAS.criarCaixa.rajada + 1 }, () =>
        cliente.pedir({ tipo: 'criar-caixa', caixa: novoPar().publicKey }),
      ),
    );
    expect(criacoes.map(codigo)).toEqual([
      ...Array<string>(TAXAS.criarCaixa.rajada).fill('ok'),
      'taxa-excedida',
    ]);
    expect(relay.consultar('SELECT count(*) AS n FROM caixas')).toEqual([
      { n: TAXAS.criarCaixa.rajada },
    ]);
  });

  it('quem insiste além da taxa de mensagens tem a conexão fechada', async () => {
    await subir();
    const insistente = await relay.conectar();
    const confirmar = cru(0x06, 1, new Uint8Array([1]), new Uint8Array(16));
    for (let i = 0; i <= TAXAS.mensagens.rajada; i++) insistente.enviarCru(confirmar);
    expect(await insistente.fechamento).toBe(FECHAMENTOS.taxaExcedida);
  });

  it('conexões demais: o relay recusa a nova antes do WebSocket', async () => {
    await subir({ conexoes: 2 });
    await relay.conectar();
    await relay.conectar();
    await expect(ClienteDoRelay.conectar(relay.endereco)).rejects.toThrow(/503/);
  });

  it('caminho diferente de / e HTTP fora dos anexos não chegam a lugar nenhum', async () => {
    await subir();
    await expect(ClienteDoRelay.conectar(`${relay.endereco}/outro`)).rejects.toThrow(/404/);
    const { port } = relay.relay.servidor.address() as AddressInfo;
    const status = await new Promise<number | undefined>((pronto, falhou) => {
      request({ host: '127.0.0.1', port, path: '/' }, (resposta) => {
        resposta.resume();
        pronto(resposta.statusCode);
      })
        .on('error', falhou)
        .end();
    });
    expect(status).toBe(404);
  });

  it('bytes aleatórios não derrubam o relay: ele segue atendendo um app de verdade', async () => {
    await subir(TAXAS_LIVRES);
    for (let rodada = 0; rodada < 40; rodada++) {
      const modificado = await relay.conectar();
      const tamanho = rodada % 3 === 0 ? 4133 : Math.floor(Math.random() * 300);
      const lixo = sodium.randombytes_buf(tamanho);
      // Às vezes o primeiro byte é de um tipo válido, para o lixo ir mais fundo na leitura.
      if (lixo.length > 0 && rodada % 2 === 0) lixo[0] = 1 + (rodada % 6);
      modificado.enviarCru(lixo);
      const fechou = await Promise.race([
        modificado.fechamento,
        new Promise<null>((pronto) => setTimeout(pronto, 200, null)),
      ]);
      if (fechou === null) await modificado.fechar();
    }
    // A sonda data o cartão com o relógio de verdade.
    relay.relogio.agora = Date.now();
    const passos = await sondar(relay.endereco);
    expect(passos.map(({ passo }) => passo)).toContain('confirmar');
  });

  it('o relay não mexe em nada com uma abertura recusada', async () => {
    await subir();
    const cliente = await relay.conectar();
    const caixa = novoPar();
    await cliente.pedir({ tipo: 'criar-caixa', caixa: caixa.publicKey });
    await cliente.pedir({
      tipo: 'depositar',
      caixa: caixa.publicKey,
      pacote: pacoteAleatorio(),
      marca: marcaDeTeste(),
    });
    const modificado = await relay.conectar();
    const assinaturaErrada = sodium.randombytes_buf(64);
    modificado.enviarCru(cru(0x05, 9, caixa.publicKey, assinaturaErrada));
    expect(codigo(await modificado.esperar(9))).toBe('assinatura-invalida');
    expect(await modificado.fechamento).toBe(FECHAMENTOS.assinaturaInvalida);
    expect(pacotesNoBanco()).toBe(1);
    const dono = await relay.conectar();
    expect(codigo(await abrir(dono, caixa))).toBe('ok');
  });
});

describe('conexões ociosas e mortas', () => {
  it('sem caixa aberta e sem mensagem por 5 min, a conexão fecha; com caixa aberta, fica', async () => {
    await subir();
    const [parada, comCaixa] = [await relay.conectar(), await relay.conectar()];
    const caixa = novoPar();
    await comCaixa.pedir({ tipo: 'criar-caixa', caixa: caixa.publicKey });
    await abrir(comCaixa, caixa);

    relay.relogio.avancar(299_000);
    relay.relay.vigiar();
    await new Promise((pronto) => setTimeout(pronto, 50));
    relay.relogio.avancar(1_000);
    relay.relay.vigiar();
    expect(await parada.fechamento).toBe(FECHAMENTOS.ociosa);
    const pacote = pacoteAleatorio();
    const outro = await relay.conectar();
    await outro.pedir({ tipo: 'depositar', caixa: caixa.publicKey, pacote, marca: marcaDeTeste() });
    expect((await comCaixa.proximoAviso()).tipo).toBe('em-dia');
    const aviso = await comCaixa.proximoAviso();
    expect(aviso.tipo === 'pacote' && aviso.pacote).toEqual(pacote);
  });

  it(`quem deixa ${PINGS_SEM_RESPOSTA} pings seguidos sem resposta é derrubado`, async () => {
    await subir();
    const morta = await relay.conectar({ responderAoPing: false });
    const lenta = await relay.conectar({ responderAoPing: false });
    const viva = await relay.conectar();
    const vigiar = async () => {
      relay.relay.vigiar();
      await new Promise((pronto) => setTimeout(pronto, 100));
    };

    for (let ping = 0; ping < PINGS_SEM_RESPOSTA; ping++) await vigiar();
    // Pelo Tor, a resposta pode demorar: uma mensagem qualquer também conta como sinal de vida.
    await lenta.pedir({ tipo: 'buscar-cartao', id: novaIdentidade().id });
    await vigiar();

    expect(await morta.fechamento).toBe(1006);
    for (const conexao of [lenta, viva]) {
      const resposta = await conexao.pedir({ tipo: 'buscar-cartao', id: novaIdentidade().id });
      expect(codigo(resposta)).toBe('cartao-inexistente');
    }
  });
});
