// Porta do canal binário até o relay. O adaptador cuida do WebSocket e do Tor (Orbot), e do HTTP
// dos anexos, que passa pelo mesmo caminho: com Tor, pelo circuito pedido.

export interface Transporte {
  /**
   * Abre uma conexão com o relay. Com o Tor ligado e indisponível, rejeita em vez de conectar
   * direto (RF-44, RNF-06).
   *
   * Conexões com `circuito` diferente nunca dividem um circuito do Tor, e o relay não consegue
   * ligar uma à outra. Com o mesmo `circuito`, a conexão nova pode reaproveitar o circuito da
   * anterior. Sem Tor, o relay vê o mesmo endereço em todas, e o `circuito` não muda nada.
   */
  conectar(endereco: string, circuito: string): Promise<Conexao>;
  /**
   * Um pedido HTTP ao relay (os anexos), com as mesmas regras de `conectar`: com Tor, pelo
   * `circuito` pedido e nunca direto. Rejeita se não deu para falar com o relay, se a transferência
   * ficou parada (o adaptador derruba depois de um tempo sem receber nem mandar nada), se a
   * resposta passa de `limite` bytes (o app também não confia no relay) ou se foi cancelado.
   */
  pedirHttp(pedido: PedidoHttp): Promise<RespostaHttp>;
}

export type MetodoHttp = 'GET' | 'PUT' | 'DELETE';

export interface PedidoHttp {
  readonly metodo: MetodoHttp;
  /** http:// (só para .onion, com Tor) ou https://. */
  readonly endereco: string;
  readonly circuito: string;
  readonly corpo?: Uint8Array;
  /** O maior corpo de resposta aceito, em bytes. */
  readonly limite: number;
  /** Quanto já foi (no PUT) ou veio (no GET), de 0 a 1. Chamado de vez em quando, não a cada byte. */
  readonly aoProgredir?: (fracao: number) => void;
  /** Quando resolve, o adaptador derruba o pedido, que rejeita: a pessoa cancelou. */
  readonly cancelar?: Promise<void>;
}

export interface RespostaHttp {
  readonly status: number;
  readonly corpo: Uint8Array;
}

export interface Conexao {
  /** Rejeita se a conexão já caiu. */
  enviar(dados: Uint8Array): Promise<void>;
  /** Registra quem recebe cada mensagem binária. Devolve a função que cancela o registro. */
  aoReceber(ouvinte: (dados: Uint8Array) => void): () => void;
  /** Registra quem é avisado quando a conexão cai. Devolve a função que cancela o registro. */
  aoFechar(ouvinte: () => void): () => void;
  fechar(): Promise<void>;
}
