import {
  codificarMensagemDoRelay,
  lerPedido,
  VERSAO_DO_PROTOCOLO,
  type MensagemDoRelay,
} from '@cifra/protocol';
import { describe, expect, it } from 'vitest';
import type { Conexao, Transporte } from '../src/index.ts';
import { ConexaoComORelay, ConexaoPerdida, PRAZO_DO_RELAY } from '../src/relay/conexao.ts';
import { RelogioDeTeste } from './adaptadores/relogio.ts';

// O cliente do relay no app não confia no relay: `ola` de outra versão, mensagem fora do formato,
// resposta a pedido que não existe e pedido sem resposta no prazo derrubam a conexão.

/** Um relay de mentira: o teste diz o que ele manda e vê o que chegou. */
function relayDeMentira() {
  const recebidos: Uint8Array[] = [];
  let entregar: (dados: Uint8Array) => void = () => undefined;
  let avisarFechamento: () => void = () => undefined;
  let fechada = false;
  const conexao: Conexao = {
    enviar(dados) {
      if (fechada) return Promise.reject(new Error('conexao-fechada'));
      recebidos.push(dados);
      return Promise.resolve();
    },
    aoReceber(ouvinte) {
      entregar = ouvinte;
      return () => undefined;
    },
    aoFechar(ouvinte) {
      avisarFechamento = ouvinte;
      return () => undefined;
    },
    fechar() {
      if (!fechada) {
        fechada = true;
        avisarFechamento();
      }
      return Promise.resolve();
    },
  };
  const transporte: Transporte = {
    conectar: () => Promise.resolve(conexao),
    pedirHttp: () => Promise.reject(new Error('sem http')),
  };
  return {
    transporte,
    recebidos,
    get fechada() {
      return fechada;
    },
    mandar(mensagem: MensagemDoRelay | Uint8Array) {
      entregar(mensagem instanceof Uint8Array ? mensagem : codificarMensagemDoRelay(mensagem));
    },
  };
}

const desafio = new Uint8Array(32).fill(7);
const ola = { tipo: 'ola', versao: VERSAO_DO_PROTOCOLO, desafio } as const;
const pausa = () => new Promise((pronto) => setTimeout(pronto, 0));

async function conectado(relogio = new RelogioDeTeste()) {
  const relay = relayDeMentira();
  const abrindo = ConexaoComORelay.abrir(relay.transporte, 'ws://x.onion', 'c', relogio);
  await pausa();
  relay.mandar(ola);
  return { relay, conexao: await abrindo, relogio };
}

describe('cliente do relay sobre a porta Transporte', () => {
  it('espera o ola, numera os pedidos e casa cada resposta com o seu', async () => {
    const { relay, conexao } = await conectado();
    expect(conexao.desafio).toEqual(desafio);
    const primeiro = conexao.pedir({ tipo: 'criar-caixa', caixa: new Uint8Array(32) });
    const segundo = conexao.pedir({ tipo: 'buscar-cartao', id: new Uint8Array(10) });
    await pausa();
    const numeros = relay.recebidos.map((bytes) => {
      const leitura = lerPedido(bytes);
      return leitura.ok ? leitura.pedido.numero : -1;
    });
    expect(numeros).toEqual([1, 2]);
    relay.mandar({ tipo: 'resposta', numero: 2, codigo: 'cartao-inexistente' });
    relay.mandar({ tipo: 'resposta', numero: 1, codigo: 'ok' });
    expect(await primeiro).toEqual({ tipo: 'resposta', numero: 1, codigo: 'ok' });
    expect(await segundo).toEqual({ tipo: 'resposta', numero: 2, codigo: 'cartao-inexistente' });
  });

  it('repassa pacotes e em-dia a quem ouve', async () => {
    const { relay, conexao } = await conectado();
    const avisos: string[] = [];
    conexao.aoAvisar((aviso) => avisos.push(aviso.tipo));
    relay.mandar({
      tipo: 'pacote',
      id: new Uint8Array(16),
      pacote: new Uint8Array(4096),
      marca: new Uint8Array(49),
    });
    relay.mandar({ tipo: 'em-dia' });
    expect(avisos).toEqual(['pacote', 'em-dia']);
  });

  it('ola de outra versão ou que não chega no prazo: não conecta', async () => {
    const outra = relayDeMentira();
    const abrindo = ConexaoComORelay.abrir(
      outra.transporte,
      'ws://x.onion',
      'c',
      new RelogioDeTeste(),
    );
    await pausa();
    outra.mandar({ ...ola, versao: VERSAO_DO_PROTOCOLO + 1 });
    await expect(abrindo).rejects.toBeInstanceOf(ConexaoPerdida);
    expect(outra.fechada).toBe(true);

    const calada = relayDeMentira();
    const relogio = new RelogioDeTeste();
    const esperando = ConexaoComORelay.abrir(calada.transporte, 'ws://x.onion', 'c', relogio);
    await pausa();
    relogio.avancar(PRAZO_DO_RELAY);
    await expect(esperando).rejects.toBeInstanceOf(ConexaoPerdida);
    expect(calada.fechada).toBe(true);
  });

  it('mensagem fora do formato ou resposta a pedido que não existe: a conexão cai', async () => {
    for (const intrusa of [
      new Uint8Array([0x99, 1, 2]),
      codificarMensagemDoRelay({ tipo: 'resposta', numero: 77, codigo: 'ok' }),
    ]) {
      const { relay, conexao } = await conectado();
      let caiu = false;
      conexao.aoFechar(() => {
        caiu = true;
      });
      const pendente = conexao.pedir({ tipo: 'criar-caixa', caixa: new Uint8Array(32) });
      relay.mandar(intrusa);
      await expect(pendente).rejects.toBeInstanceOf(ConexaoPerdida);
      expect(caiu).toBe(true);
      expect(conexao.aberta).toBe(false);
      await expect(
        conexao.pedir({ tipo: 'criar-caixa', caixa: new Uint8Array(32) }),
      ).rejects.toBeInstanceOf(ConexaoPerdida);
    }
  });

  it('pedido sem resposta no prazo derruba a conexão', async () => {
    const { relay, conexao, relogio } = await conectado();
    const pendente = conexao.pedir({ tipo: 'criar-caixa', caixa: new Uint8Array(32) });
    relogio.avancar(PRAZO_DO_RELAY - 1);
    await pausa();
    expect(relay.fechada).toBe(false);
    relogio.avancar(1);
    await expect(pendente).rejects.toBeInstanceOf(ConexaoPerdida);
    expect(relay.fechada).toBe(true);
  });

  it('o ola chega uma vez só: um segundo derruba a conexão', async () => {
    const { relay, conexao } = await conectado();
    relay.mandar(ola);
    expect(conexao.aberta).toBe(false);
  });
});
