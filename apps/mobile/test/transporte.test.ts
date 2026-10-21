import type { Transporte } from '@cifra/core';
import { describe, expect, it } from 'vitest';
import { cripto } from '../../../packages/core/test/adaptadores/sodium-node.ts';
import {
  transportePorModulo,
  type EventosDoModulo,
  type ModuloDoTransporte,
} from '../src/adaptadores/transporte-por-modulo.ts';

// O transporte do Android sobre o módulo nativo, com um módulo de mentira que age como o Kotlin: o
// evento `fechou` só vem quando a conexão cai sem o app pedir (o relay fechou, a rede caiu).

type Ouvintes = { [E in keyof EventosDoModulo]: Set<EventosDoModulo[E]> };

function moduloDeTeste() {
  const ouvintes: Ouvintes = { mensagem: new Set(), fechou: new Set(), progresso: new Set() };
  const abertas = new Set<number>();
  let proximaConexao = 1;
  const pedidos: number[] = [];
  const respostas: (() => void)[] = [];
  const modulo: ModuloDoTransporte = {
    conectar() {
      const id = proximaConexao++;
      abertas.add(id);
      return Promise.resolve(id);
    },
    enviar(id) {
      if (!abertas.has(id)) throw new Error('conexao-fechada');
    },
    // Como o Kotlin: tira da lista e fecha, sem avisar.
    fechar(id) {
      abertas.delete(id);
      return Promise.resolve();
    },
    http(numero) {
      pedidos.push(numero);
      return new Promise((pronto) => {
        respostas.push(() => {
          pronto({ status: 200, corpo: new Uint8Array() });
        });
      });
    },
    cancelarHttp: () => undefined,
    addListener(evento, ouvinte) {
      const lista: Set<typeof ouvinte> = ouvintes[evento];
      lista.add(ouvinte);
      return {
        remove: () => {
          lista.delete(ouvinte);
        },
      };
    },
  };
  return {
    modulo,
    /** Quantos ouvintes estão registrados no módulo. */
    ouvintes: () => ouvintes.mensagem.size + ouvintes.fechou.size + ouvintes.progresso.size,
    /** Uma mensagem do relay pela conexão, em base64. */
    receber(id: number, dados: string) {
      for (const ouvinte of [...ouvintes.mensagem]) ouvinte({ id, dados });
    },
    /** O relay fechou a conexão: o módulo avisa. */
    cair(id: number) {
      if (!abertas.delete(id)) return;
      for (const ouvinte of [...ouvintes.fechou]) ouvinte({ id });
    },
    /** O número de cada pedido HTTP que chegou ao módulo, na ordem. */
    pedidos,
    /** O progresso do pedido HTTP com este número. */
    progredir(numero: number, fracao: number) {
      for (const ouvinte of [...ouvintes.progresso]) ouvinte({ numero, fracao });
    },
    /** Os pedidos HTTP terminam. */
    responder() {
      for (const pronto of respostas.splice(0)) pronto();
    },
  };
}

const COM_TOR = { portaSocks: 9050 };
const RELAY = 'ws://relay.onion';

/** Uma conexão aberta, com o que chega por ela e quantas vezes avisou que fechou. */
async function conectar(teste: ReturnType<typeof moduloDeTeste>) {
  const conexao = await transportePorModulo(teste.modulo, cripto, COM_TOR).conectar(RELAY, 'a');
  const recebidas: Uint8Array[] = [];
  const avisos = { fechou: 0 };
  conexao.aoReceber((dados) => {
    recebidas.push(dados);
  });
  conexao.aoFechar(() => {
    avisos.fechou++;
  });
  return { conexao, recebidas, avisos };
}

describe('conexão com o relay', () => {
  it('fechar pelo app avisa quem ouve, uma vez só, e solta os ouvintes do módulo', async () => {
    const teste = moduloDeTeste();
    const { conexao, recebidas, avisos } = await conectar(teste);
    expect(teste.ouvintes()).toBe(2);

    await conexao.fechar();
    expect(avisos.fechou).toBe(1);
    expect(teste.ouvintes()).toBe(0);
    // O que o módulo ainda entregar não chega, e nada mais sai.
    teste.receber(1, 'AQI=');
    expect(recebidas).toEqual([]);
    await expect(conexao.enviar(new Uint8Array([1]))).rejects.toThrow('conexao-fechada');
    await conexao.fechar();
    expect(avisos.fechou).toBe(1);
  });

  it('a queda avisada pelo módulo também avisa uma vez só e solta os ouvintes', async () => {
    const teste = moduloDeTeste();
    const { conexao, recebidas, avisos } = await conectar(teste);
    teste.receber(1, 'AQI=');
    expect(recebidas).toEqual([new Uint8Array([1, 2])]);

    teste.cair(1);
    await conexao.fechar();
    expect(avisos.fechou).toBe(1);
    expect(teste.ouvintes()).toBe(0);
  });
});

describe('pedidos HTTP dos anexos', () => {
  it('cada desbloqueio cria um transporte, e o número de um pedido nunca se repete', async () => {
    const teste = moduloDeTeste();
    const progressos = { antes: [] as number[], depois: [] as number[] };
    const pedir = (transporte: Transporte, lado: keyof typeof progressos) =>
      transporte.pedirHttp({
        metodo: 'GET',
        endereco: 'http://relay.onion/anexos/a',
        circuito: 'anexos',
        limite: 1024,
        aoProgredir: (fracao) => {
          progressos[lado].push(fracao);
        },
      });
    const antes = pedir(transportePorModulo(teste.modulo, cripto, COM_TOR), 'antes');
    const depois = pedir(transportePorModulo(teste.modulo, cripto, COM_TOR), 'depois');
    const [primeiro, segundo] = teste.pedidos;
    if (primeiro === undefined || segundo === undefined) throw new Error('sem pedidos');
    expect(primeiro).not.toBe(segundo);
    // O progresso e o cancelamento vão pelo número: um não chega ao pedido do outro.
    teste.progredir(primeiro, 0.5);
    expect(progressos).toEqual({ antes: [0.5], depois: [] });
    teste.responder();
    await Promise.all([antes, depois]);
  });
});
