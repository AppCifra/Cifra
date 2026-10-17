// Cliente do relay no Node, sobre o ws, para a sonda e para os testes. O cliente do app é outro:
// fica no núcleo, sobre a porta Transporte. Este não esconde nada do relay: manda bytes crus quando
// pedem, para os testes fazerem o papel de um cliente modificado.
import type { Socket } from 'node:net';
import {
  codificarPedido,
  lerMensagemDoRelay,
  TAMANHO_MAXIMO_DA_MENSAGEM_DO_RELAY,
  VERSAO_DO_PROTOCOLO,
  type MensagemDoRelay,
  type PedidoAoRelay,
} from '@cifra/protocol';
import WebSocket, { type RawData } from 'ws';

type SemNumero<T> = T extends { readonly numero: number } ? Omit<T, 'numero'> : never;

/** Um pedido ainda sem número: o cliente numera. */
export type Pedido = SemNumero<PedidoAoRelay>;

/** O que responde a um pedido. */
export type Resposta = Extract<MensagemDoRelay, { readonly numero: number }>;

/**
 * O que o relay manda sem pedido: os pacotes da caixa aberta, o aviso de que estão em dia e o de
 * que a caixa foi substituída por outra no cartão do dono.
 */
export type Aviso = Extract<
  MensagemDoRelay,
  { readonly tipo: 'pacote' | 'em-dia' | 'caixa-substituida' }
>;

export interface OpcoesDoCliente {
  /** Conexão já aberta até o relay, como a que sai de um proxy SOCKS. */
  readonly socket?: Socket;
  /** Com `false`, não responde ao ping do relay: simula uma conexão morta. */
  readonly responderAoPing?: boolean;
}

function comoBytes(dados: RawData): Uint8Array {
  if (Array.isArray(dados)) return Buffer.concat(dados);
  return dados instanceof ArrayBuffer ? new Uint8Array(dados) : dados;
}

export class ClienteDoRelay {
  /** O desafio que o relay mandou no `ola` desta conexão. */
  readonly desafio: Uint8Array;
  /** Resolve com o código de fechamento quando a conexão cai. */
  readonly fechamento: Promise<number>;

  readonly #ws: WebSocket;
  #proximoNumero = 1;
  readonly #respostas = new Map<number, Resposta>();
  readonly #esperando = new Map<number, (resposta: Resposta) => void>();
  readonly #avisos: Aviso[] = [];
  #aoAvisar: (() => void) | null = null;
  #invalidas = 0;

  private constructor(ws: WebSocket, desafio: Uint8Array) {
    this.#ws = ws;
    this.desafio = desafio;
    this.fechamento = new Promise((pronto) => {
      ws.on('close', (codigo) => {
        pronto(codigo);
        this.#aoAvisar?.();
      });
    });
    ws.on('message', (dados) => {
      const mensagem = lerMensagemDoRelay(comoBytes(dados));
      if (!mensagem || mensagem.tipo === 'ola') {
        this.#invalidas++;
        return;
      }
      if (
        mensagem.tipo === 'pacote' ||
        mensagem.tipo === 'em-dia' ||
        mensagem.tipo === 'caixa-substituida'
      ) {
        this.#avisos.push(mensagem);
        this.#aoAvisar?.();
        return;
      }
      const esperando = this.#esperando.get(mensagem.numero);
      if (esperando) {
        this.#esperando.delete(mensagem.numero);
        esperando(mensagem);
      } else {
        this.#respostas.set(mensagem.numero, mensagem);
      }
    });
  }

  /** Conecta e espera o `ola` com a versão do protocolo. */
  static conectar(endereco: string, opcoes: OpcoesDoCliente = {}): Promise<ClienteDoRelay> {
    const { socket } = opcoes;
    const ws = new WebSocket(endereco, {
      perMessageDeflate: false,
      maxPayload: TAMANHO_MAXIMO_DA_MENSAGEM_DO_RELAY,
      autoPong: opcoes.responderAoPing ?? true,
      handshakeTimeout: 60_000,
      ...(socket ? { createConnection: () => socket } : {}),
    });
    return new Promise((pronto, falhou) => {
      const aoFalhar = (erro: Error) => {
        ws.terminate();
        falhou(erro);
      };
      const aoFechar = (codigo: number) => {
        falhou(new Error(`fechou antes do ola (${codigo})`));
      };
      ws.once('error', aoFalhar);
      ws.once('close', aoFechar);
      ws.once('message', (dados) => {
        ws.off('error', aoFalhar);
        ws.off('close', aoFechar);
        // Depois do ola, erro de rede só fecha a conexão; quem usa vê pelo `fechamento`.
        ws.on('error', () => undefined);
        const ola = lerMensagemDoRelay(comoBytes(dados));
        if (ola?.tipo !== 'ola' || ola.versao !== VERSAO_DO_PROTOCOLO) {
          aoFalhar(new Error('o relay não mandou um ola desta versão'));
          return;
        }
        pronto(new ClienteDoRelay(ws, ola.desafio));
      });
    });
  }

  /** Mensagens do relay que não seguiam o formato. */
  get mensagensInvalidas(): number {
    return this.#invalidas;
  }

  /** Numera, manda e espera a resposta do pedido. */
  pedir(pedido: Pedido): Promise<Resposta> {
    const numero = this.#proximoNumero++;
    const resposta = this.esperar(numero);
    this.enviarCru(codificarPedido({ ...pedido, numero }));
    return resposta;
  }

  /** Espera a resposta ao pedido de número `numero`, que pode ter sido mandado cru. */
  esperar(numero: number): Promise<Resposta> {
    const chegou = this.#respostas.get(numero);
    if (chegou) {
      this.#respostas.delete(numero);
      return Promise.resolve(chegou);
    }
    return new Promise((pronto, falhou) => {
      this.#esperando.set(numero, pronto);
      void this.fechamento.then((codigo) => {
        if (this.#esperando.delete(numero)) falhou(new Error(`conexão fechada (${codigo})`));
      });
    });
  }

  /** Manda bytes ou texto do jeito que vierem, sem passar pelo protocolo. */
  enviarCru(dados: Uint8Array | string): void {
    this.#ws.send(dados);
  }

  /** O próximo aviso: pacote, `em-dia` ou `caixa-substituida`. Rejeita se a conexão cair antes. */
  async proximoAviso(): Promise<Aviso> {
    for (;;) {
      const aviso = this.#avisos.shift();
      if (aviso) return aviso;
      if (this.#ws.readyState !== WebSocket.OPEN) throw new Error('conexão fechada');
      await new Promise<void>((pronto) => {
        this.#aoAvisar = pronto;
      });
      this.#aoAvisar = null;
    }
  }

  /** Os avisos que já chegaram e ainda não foram lidos. */
  avisosRecebidos(): Aviso[] {
    return this.#avisos.splice(0);
  }

  /** Fecha a conexão e espera o relay confirmar. */
  async fechar(): Promise<number> {
    if (this.#ws.readyState === WebSocket.OPEN) this.#ws.close(1000);
    return this.fechamento;
  }
}
