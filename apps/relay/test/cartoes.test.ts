import {
  cartaoAutentico,
  FECHAMENTOS,
  idDoCartao,
  TOLERANCIA_DO_RELOGIO_EM_HORAS,
} from '@cifra/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClienteDoRelay, Resposta } from '../scripts/cliente.ts';
import {
  abrir,
  codigo,
  DIA,
  HORA,
  INICIO,
  novaIdentidade,
  novoPar,
  pacoteAleatorio,
  publicacaoDe,
  sodium,
  subirRelay,
  TAXAS_LIVRES,
  type IdentidadeDeTeste,
  type OpcoesDaPublicacao,
  type RelayDeTeste,
  marcaDeTeste,
} from './ajuda.ts';

/** Dá tempo para o relay mandar o que fosse mandar. */
const pausa = () => new Promise((pronto) => setTimeout(pronto, 50));

let relay: RelayDeTeste;
let cliente: ClienteDoRelay;

beforeEach(async () => {
  relay = await subirRelay(TAXAS_LIVRES);
  cliente = await relay.conectar();
});

afterEach(async () => {
  await relay.fechar();
});

function publicar(identidade: IdentidadeDeTeste, opcoes: OpcoesDaPublicacao = {}) {
  return cliente.pedir({ tipo: 'publicar-cartao', publicacao: publicacaoDe(identidade, opcoes) });
}

function buscar(id: Uint8Array) {
  return cliente.pedir({ tipo: 'buscar-cartao', id });
}

function prekeyEntregue(resposta: Resposta): number | null | undefined {
  return resposta.tipo === 'cartao-encontrado' ? (resposta.prekey?.numero ?? null) : undefined;
}

describe('cartões no relay (RF-04)', () => {
  it('guarda o cartão válido e entrega cada one-time prekey uma vez só', async () => {
    const bob = novaIdentidade();
    const publicacao = publicacaoDe(bob, { prekeys: [3, 1, 2] });
    expect(await cliente.pedir({ tipo: 'publicar-cartao', publicacao })).toMatchObject({
      tipo: 'cartao-publicado',
      prekeys: 3,
    });

    const entregues: (number | null | undefined)[] = [];
    for (let busca = 0; busca < 4; busca++) {
      const resposta = await buscar(bob.id);
      if (resposta.tipo !== 'cartao-encontrado') throw new Error(codigo(resposta));
      // Quem busca recebe o cartão como foi assinado e confere o ID e as assinaturas.
      expect(resposta.cartao.bytes).toEqual(publicacao.cartao.bytes);
      expect(cartaoAutentico(sodium, resposta.cartao)).toBe(true);
      expect(idDoCartao(sodium, resposta.cartao)).toEqual(bob.id);
      entregues.push(prekeyEntregue(resposta));
    }
    // Uma prekey por busca; quando acabam, o cartão sai sem nenhuma.
    expect(entregues).toEqual([1, 2, 3, null]);
  });

  it('diz ao dono quantas prekeys restam, e o dono repõe quando acabam', async () => {
    const bob = novaIdentidade();
    await publicar(bob, { prekeys: [1, 2, 3] });
    await buscar(bob.id);
    await buscar(bob.id);
    const reposicao = await publicar(bob, { data: INICIO + 1, prekeys: [4, 5] });
    expect(reposicao).toMatchObject({ tipo: 'cartao-publicado', prekeys: 3 });
    const entregues = [];
    for (let busca = 0; busca < 3; busca++) entregues.push(prekeyEntregue(await buscar(bob.id)));
    expect(entregues).toEqual([3, 4, 5]);
  });

  it('substituir troca o lote inteiro, como na restauração em outro aparelho', async () => {
    const bob = novaIdentidade();
    await publicar(bob, { prekeys: [1, 2, 3] });
    const troca = await publicar(bob, { data: INICIO + 1, prekeys: [10], modo: 'substituir' });
    expect(troca).toMatchObject({ tipo: 'cartao-publicado', prekeys: 1 });
    expect(prekeyEntregue(await buscar(bob.id))).toBe(10);
    expect(prekeyEntregue(await buscar(bob.id))).toBeNull();
  });

  it('vale o cartão mais novo; data igual ou mais velha é recusada', async () => {
    const bob = novaIdentidade();
    await publicar(bob, { data: INICIO, prekeys: [1] });
    const novo = publicacaoDe(bob, { data: INICIO + 1, prekeys: [2] });
    expect(codigo(await cliente.pedir({ tipo: 'publicar-cartao', publicacao: novo }))).toBe(
      'cartao-publicado',
    );
    expect(codigo(await publicar(bob, { data: INICIO + 1, prekeys: [3] }))).toBe('cartao-antigo');
    expect(codigo(await publicar(bob, { data: INICIO - 1, prekeys: [3] }))).toBe('cartao-antigo');
    const atual = await buscar(bob.id);
    expect(atual.tipo === 'cartao-encontrado' && atual.cartao.bytes).toEqual(novo.cartao.bytes);
  });

  it('a mesma publicação repetida não volta: nenhuma prekey consumida reaparece', async () => {
    const bob = novaIdentidade();
    const publicacao = publicacaoDe(bob, { prekeys: [1, 2] });
    await cliente.pedir({ tipo: 'publicar-cartao', publicacao });
    await buscar(bob.id);
    await buscar(bob.id);
    expect(codigo(await cliente.pedir({ tipo: 'publicar-cartao', publicacao }))).toBe(
      'cartao-antigo',
    );
    expect(prekeyEntregue(await buscar(bob.id))).toBeNull();
  });

  it('ninguém além do dono publica, troca o cartão ou injeta prekey', async () => {
    const bob = novaIdentidade();
    const atacante = novoPar();
    await publicar(bob, { prekeys: [1] });
    // Cartão e publicação assinados por outra chave, com a chave de identidade do Bob.
    const forjada = await publicar(bob, {
      data: INICIO + 1,
      prekeys: [2, 3],
      assinante: atacante,
    });
    expect(codigo(forjada)).toBe('assinatura-invalida');
    expect(prekeyEntregue(await buscar(bob.id))).toBe(1);
    expect(prekeyEntregue(await buscar(bob.id))).toBeNull();
  });

  it(`aceita até ${TOLERANCIA_DO_RELOGIO_EM_HORAS} h à frente do relógio do relay, e nada vencido`, async () => {
    const tolerancia = TOLERANCIA_DO_RELOGIO_EM_HORAS * HORA;
    const agora = relay.relogio.agora;
    expect(codigo(await publicar(novaIdentidade(), { data: agora + tolerancia + 1 }))).toBe(
      'cartao-fora-do-prazo',
    );
    expect(codigo(await publicar(novaIdentidade(), { data: agora + tolerancia }))).toBe(
      'cartao-publicado',
    );
    expect(codigo(await publicar(novaIdentidade(), { data: agora - 90 * DIA }))).toBe(
      'cartao-fora-do-prazo',
    );
    expect(codigo(await publicar(novaIdentidade(), { data: agora - 89 * DIA }))).toBe(
      'cartao-publicado',
    );
  });

  it('prekeys acima do máximo ou repetidas são recusadas, e o cartão guardado não muda', async () => {
    const bob = novaIdentidade();
    const cem = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(await publicar(bob, { prekeys: cem })).toMatchObject({ prekeys: 100 });
    expect(codigo(await publicar(bob, { data: INICIO + 1, prekeys: [101] }))).toBe(
      'prekeys-recusadas',
    );
    expect(codigo(await publicar(bob, { data: INICIO + 2, prekeys: [] }))).toBe('cartao-publicado');
    await buscar(bob.id);
    expect(codigo(await publicar(bob, { data: INICIO + 3, prekeys: [50] }))).toBe(
      'prekeys-recusadas',
    );
    // A recusa não gravou a data: um cartão entre a guardada e a recusada ainda entra.
    expect(codigo(await publicar(bob, { data: INICIO + 3, prekeys: [1] }))).toBe(
      'cartao-publicado',
    );
  });

  it('ID sem cartão: cartao-inexistente', async () => {
    expect(codigo(await buscar(novaIdentidade().id))).toBe('cartao-inexistente');
  });
});

describe('um aparelho por ID (RF-05)', () => {
  const caixaDoCartao = async (id: Uint8Array) => {
    const resposta = await buscar(id);
    return resposta.tipo === 'cartao-encontrado' ? resposta.cartao.caixaPrincipal : null;
  };
  const pacotesNaCaixa = (caixa: Uint8Array) =>
    relay.consultar('SELECT count(*) AS n FROM pacotes WHERE caixa = ?', caixa)[0]?.['n'];

  /** O aparelho de antes: cartão publicado, caixa criada e aberta, com dois pacotes esperando. */
  async function aparelhoAntigo(bob: IdentidadeDeTeste) {
    const antigo = await relay.conectar();
    expect(codigo(await publicar(bob, { prekeys: [1, 2] }))).toBe('cartao-publicado');
    await antigo.pedir({ tipo: 'criar-caixa', caixa: bob.caixa.publicKey });
    for (let i = 0; i < 2; i++) {
      await cliente.pedir({
        tipo: 'depositar',
        caixa: bob.caixa.publicKey,
        pacote: pacoteAleatorio(),
        marca: marcaDeTeste(),
      });
    }
    expect(codigo(await abrir(antigo, bob.caixa))).toBe('ok');
    return antigo;
  }

  it('restaurar em outro aparelho troca a caixa: a antiga sai com os pacotes, e o aparelho antigo é avisado e cai', async () => {
    const bob = novaIdentidade();
    const antigo = await aparelhoAntigo(bob);
    expect(pacotesNaCaixa(bob.caixa.publicKey)).toBe(2);

    const novaCaixa = novoPar();
    const restauracao = await publicar(bob, {
      data: INICIO + 1,
      caixa: novaCaixa.publicKey,
      prekeys: [10],
      modo: 'substituir',
    });
    expect(restauracao).toMatchObject({ tipo: 'cartao-publicado', prekeys: 1 });

    // O aparelho antigo recebe o que já esperava, o aviso e perde a conexão.
    const avisos: string[] = [];
    for (;;) {
      const aviso = await antigo.proximoAviso();
      avisos.push(aviso.tipo);
      if (aviso.tipo === 'caixa-substituida') break;
    }
    expect(avisos).toEqual(['pacote', 'pacote', 'em-dia', 'caixa-substituida']);
    expect(await antigo.fechamento).toBe(FECHAMENTOS.caixaSubstituida);

    // A caixa antiga sumiu com os pacotes: quem deposita nela busca o cartão de novo.
    expect(
      relay.consultar('SELECT count(*) AS n FROM caixas WHERE chave = ?', bob.caixa.publicKey),
    ).toEqual([{ n: 0 }]);
    expect(pacotesNaCaixa(bob.caixa.publicKey)).toBe(0);
    const deposito = await cliente.pedir({
      tipo: 'depositar',
      caixa: bob.caixa.publicKey,
      pacote: pacoteAleatorio(),
      marca: marcaDeTeste(),
    });
    expect(codigo(deposito)).toBe('caixa-inexistente');
    expect(await caixaDoCartao(bob.id)).toEqual(novaCaixa.publicKey);
    const deNovo = await relay.conectar();
    expect(codigo(await abrir(deNovo, bob.caixa))).toBe('caixa-inexistente');
  });

  it('o aparelho antigo não volta: renovar com a caixa dele é recusado, mesmo com data mais nova', async () => {
    const bob = novaIdentidade();
    await publicar(bob, { prekeys: [1, 2] });
    const novaCaixa = novoPar().publicKey;
    await publicar(bob, { data: INICIO + 1, caixa: novaCaixa, modo: 'substituir' });

    // Dois dias depois, o aparelho antigo renova o cartão com a caixa dele.
    relay.relogio.avancar(2 * DIA);
    const renovacao = await publicar(bob, { data: relay.relogio.agora, prekeys: [3] });
    expect(codigo(renovacao)).toBe('caixa-substituida');
    expect(await caixaDoCartao(bob.id)).toEqual(novaCaixa);
    // A recusa não mexeu nas prekeys do aparelho novo.
    expect(relay.consultar('SELECT count(*) AS n FROM prekeys')).toEqual([{ n: 0 }]);
  });

  it('acrescentar nunca troca a caixa; substituir com a mesma caixa não apaga nada', async () => {
    const bob = novaIdentidade();
    const antigo = await aparelhoAntigo(bob);
    const outra = novoPar().publicKey;
    expect(codigo(await publicar(bob, { data: INICIO + 1, caixa: outra }))).toBe(
      'caixa-substituida',
    );
    expect(codigo(await publicar(bob, { data: INICIO + 2, modo: 'substituir' }))).toBe(
      'cartao-publicado',
    );
    expect(await caixaDoCartao(bob.id)).toEqual(bob.caixa.publicKey);
    expect(pacotesNaCaixa(bob.caixa.publicKey)).toBe(2);
    await pausa();
    expect(antigo.avisosRecebidos().map((aviso) => aviso.tipo)).toEqual([
      'pacote',
      'pacote',
      'em-dia',
    ]);
  });

  it('substituir com outra caixa e data velha é recusado, e nada sai', async () => {
    const bob = novaIdentidade();
    await aparelhoAntigo(bob);
    const atrasada = await publicar(bob, {
      data: INICIO - 1,
      caixa: novoPar().publicKey,
      modo: 'substituir',
    });
    expect(codigo(atrasada)).toBe('cartao-antigo');
    expect(pacotesNaCaixa(bob.caixa.publicKey)).toBe(2);
    expect(await caixaDoCartao(bob.id)).toEqual(bob.caixa.publicKey);
  });
});
