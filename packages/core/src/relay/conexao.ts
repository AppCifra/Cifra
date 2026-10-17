// Cliente do relay no app, sobre a porta Transporte (SPEC, "Especificação do relay"). Numera os
// pedidos, casa cada resposta com o seu pedido e repassa o que o relay manda sem pedido: os pacotes
// da caixa aberta e os avisos de que ela está em dia ou foi substituída. O app também não confia
// no relay: mensagem fora do formato, `ola` de outra versão, resposta a pedido que não existe ou
// pedido sem resposta no prazo derrubam a conexão.
import {
  codificarPedido,
  lerMensagemDoRelay,
  VERSAO_DO_PROTOCOLO,
  type MensagemDoRelay,
  type PedidoAoRelay,
} from '@cifra/protocol';
import type { Relogio } from '../portas/relogio.ts';
import type { Conexao, Transporte } from '../portas/transporte.ts';

type SemNumero<T> = T extends { readonly numero: number } ? Omit<T, 'numero'> : never;

/** Um pedido ainda sem número: a conexão numera. */
export type Pedido = SemNumero<PedidoAoRelay>;

/** O que responde a um pedido. */
export type Resposta = Extract<MensagemDoRelay, { readonly numero: number }>;

/**
 * O que o relay manda sem pedido: os pacotes da caixa aberta, o aviso de que estão em dia e o de
 * que a caixa foi substituída por outra no cartão (outro aparelho restaurou a identidade).
 */
export type Aviso = Extract<
  MensagemDoRelay,
  { readonly tipo: 'pacote' | 'em-dia' | 'caixa-substituida' }
>;

/** Prazo do `ola` e de cada resposta. Pelo Tor, uma ida e volta passa de 30 s nos piores momentos. */
export const PRAZO_DO_RELAY = 60_000;

/** A conexão caiu, ou o relay não respondeu como devia. Nada aqui traz endereço ou conteúdo. */
export class ConexaoPerdida extends Error {}

interface Espera {
  readonly pronto: (resposta: Resposta) => void;
  readonly falhou: (erro: Error) => void;
  readonly cancelarPrazo: () => void;
}

export class ConexaoComORelay {
  readonly #conexao: Conexao;
  readonly #relogio: Relogio;
  #desafio: Uint8Array | null = null;
  #proximoNumero = 1;
  readonly #esperando = new Map<number, Espera>();
  readonly #aoAvisar = new Set<(aviso: Aviso) => void>();
  readonly #aoFechar = new Set<() => void>();
  #fechada = false;
  #fechamento: Promise<void> = Promise.resolve();
  readonly #ola: Promise<void>;
  #aoChegarOla: (erro: Error | null) => void = () => undefined;

  private constructor(conexao: Conexao, relogio: Relogio) {
    this.#conexao = conexao;
    this.#relogio = relogio;
    this.#ola = new Promise((pronto, falhou) => {
      const cancelarPrazo = relogio.agendar(PRAZO_DO_RELAY, () => {
        this.#cair();
      });
      this.#aoChegarOla = (erro) => {
        cancelarPrazo();
        if (erro) falhou(erro);
        else pronto();
      };
    });
    // Um ouvinte só, desde o começo: o `ola` e o resto passam pelo mesmo caminho.
    conexao.aoReceber((dados) => {
      this.#receber(dados);
    });
    conexao.aoFechar(() => {
      this.#cair();
    });
  }

  /** Conecta e espera o `ola` desta versão do protocolo. */
  static async abrir(
    transporte: Transporte,
    endereco: string,
    circuito: string,
    relogio: Relogio,
  ): Promise<ConexaoComORelay> {
    const conexao = await transporte.conectar(endereco, circuito);
    const relay = new ConexaoComORelay(conexao, relogio);
    await relay.#ola;
    return relay;
  }

  /** O desafio que o relay mandou no `ola` desta conexão: só vale para abrir caixa nela. */
  get desafio(): Uint8Array {
    if (!this.#desafio) throw new ConexaoPerdida('sem ola');
    return this.#desafio;
  }

  get aberta(): boolean {
    return !this.#fechada;
  }

  /** Numera, manda e espera a resposta. Rejeita com `ConexaoPerdida` se a conexão cair antes. */
  pedir(pedido: Pedido): Promise<Resposta> {
    if (this.#fechada) return Promise.reject(new ConexaoPerdida('conexão fechada'));
    const numero = this.#proximoNumero++;
    // Campo fora do tamanho é erro de quem chama: lança antes de esperar qualquer coisa.
    const bytes = codificarPedido({ ...pedido, numero });
    const resposta = new Promise<Resposta>((pronto, falhou) => {
      const cancelarPrazo = this.#relogio.agendar(PRAZO_DO_RELAY, () => {
        this.#cair();
      });
      this.#esperando.set(numero, { pronto, falhou, cancelarPrazo });
    });
    void (async () => {
      try {
        await this.#conexao.enviar(bytes);
      } catch {
        this.#cair();
      }
    })();
    return resposta;
  }

  /** Registra quem recebe os avisos do relay. Devolve a função que cancela. */
  aoAvisar(ouvinte: (aviso: Aviso) => void): () => void {
    this.#aoAvisar.add(ouvinte);
    return () => this.#aoAvisar.delete(ouvinte);
  }

  /** Registra quem é avisado quando a conexão cai. Devolve a função que cancela. */
  aoFechar(ouvinte: () => void): () => void {
    this.#aoFechar.add(ouvinte);
    return () => this.#aoFechar.delete(ouvinte);
  }

  async fechar(): Promise<void> {
    this.#cair();
    await this.#fechamento;
  }

  #receber(dados: Uint8Array): void {
    if (this.#fechada) return;
    const mensagem = lerMensagemDoRelay(dados);
    if (!mensagem) {
      this.#cair();
      return;
    }
    if (mensagem.tipo === 'ola') {
      if (this.#desafio || mensagem.versao !== VERSAO_DO_PROTOCOLO) {
        this.#cair();
        return;
      }
      this.#desafio = mensagem.desafio;
      this.#aoChegarOla(null);
      return;
    }
    if (!this.#desafio) {
      this.#cair();
      return;
    }
    if (
      mensagem.tipo === 'pacote' ||
      mensagem.tipo === 'em-dia' ||
      mensagem.tipo === 'caixa-substituida'
    ) {
      for (const ouvinte of [...this.#aoAvisar]) ouvinte(mensagem);
      return;
    }
    const espera = this.#esperando.get(mensagem.numero);
    if (!espera) {
      this.#cair();
      return;
    }
    this.#esperando.delete(mensagem.numero);
    espera.cancelarPrazo();
    espera.pronto(mensagem);
  }

  /** A conexão acabou: por queda, prazo, mensagem fora do formato ou porque quem usa fechou. */
  #cair(): void {
    if (this.#fechada) return;
    this.#fechada = true;
    this.#aoChegarOla(new ConexaoPerdida('sem ola'));
    for (const espera of this.#esperando.values()) {
      espera.cancelarPrazo();
      espera.falhou(new ConexaoPerdida('conexão fechada'));
    }
    this.#esperando.clear();
    this.#fechamento = this.#conexao.fechar().catch(() => undefined);
    for (const ouvinte of [...this.#aoFechar]) ouvinte();
  }
}
