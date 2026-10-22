// Adaptador de referência da porta Transporte no Node, sobre o WebSocket e o fetch que vêm no
// Node 24: sem Tor e sem dependência nova. Registra cada conexão (circuito e o que saiu por ela) e
// cada pedido HTTP, para os testes conferirem o que o relay recebeu de cada lado, e sabe quando
// nada está a caminho: os testes só andam o relógio com a rede parada, senão o prazo de um pedido
// venceria antes da resposta.
import { lerMensagemDoRelay, lerPedido } from '@cifra/protocol';
import type { Conexao, MetodoHttp, PedidoHttp, Transporte } from '../../src/index.ts';

export interface PedidoHttpRegistrado {
  readonly circuito: string;
  readonly metodo: MetodoHttp;
  readonly caminho: string;
}

export interface ConexaoRegistrada {
  readonly circuito: string;
  /** Cada mensagem binária que saiu por esta conexão, na ordem. */
  readonly enviadas: Uint8Array[];
  aberta: boolean;
}

export interface TransporteDeTeste extends Transporte {
  readonly conexoes: ConexaoRegistrada[];
  /**
   * Quando devolve `true` para uma mensagem que chega, ela some e a conexão cai logo depois, como
   * numa queda de rede no meio da resposta.
   */
  perderAoReceber: ((dados: Uint8Array) => boolean) | null;
  /**
   * Quando devolve `true` para uma mensagem que chega pela conexão do circuito, ela some e a conexão
   * continua: como um pacote que o relay mandou e não chegou, sem ninguém perceber.
   */
  sumirAoReceber: ((dados: Uint8Array, circuito: string) => boolean) | null;
  /**
   * Quando devolve uma lista para uma mensagem que chega pela conexão do circuito, é a lista que
   * chega no lugar dela: como um relay que responde outra coisa, ou manda um aviso a mais.
   */
  trocarAoReceber: ((dados: Uint8Array, circuito: string) => Uint8Array[] | null) | null;
  /** Quando devolve `true` para uma mensagem que sai, ela não sai e a conexão cai. */
  perderAoEnviar: ((dados: Uint8Array) => boolean) | null;
  /** Quando devolve `true` para o circuito pedido, a conexão falha antes de abrir. */
  falharAoConectar: ((circuito: string) => boolean) | null;
  /** Como o adaptador do Android com o Orbot fora: nada conecta, com `tor-indisponivel`. */
  semTor: boolean;
  /** Cada pedido HTTP, na ordem, com o circuito por onde saiu. */
  readonly http: PedidoHttpRegistrado[];
  /** Quando devolve `true`, o pedido HTTP falha como uma queda de rede. */
  falharHttp: ((pedido: PedidoHttp) => boolean) | null;
  /**
   * Quando devolve uma promessa, o pedido HTTP só sai depois que ela resolver, como uma
   * transferência lenta pelo Tor; cancelado antes, ele rejeita. Enquanto espera, não conta como
   * rede a caminho.
   */
  segurarHttp: ((pedido: PedidoHttp) => Promise<void> | null) | null;
  /** Nenhuma conexão abrindo, nenhum `ola` nem resposta a caminho. */
  ociosa(): boolean;
}

/**
 * `rota` diz para onde cada endereço vai, como o Tor faz com o .onion: os cartões levam um
 * endereço de relay válido, e os testes conectam no relay local.
 */
export function transporteNode(rota: (endereco: string) => string = (e) => e): TransporteDeTeste {
  let abrindo = 0;
  let pedidosHttp = 0;
  /** Por conexão aberta: os números dos pedidos sem resposta, e se o `ola` ainda não chegou. */
  const esperas = new Map<WebSocket, { readonly pedidos: Set<number>; ola: boolean }>();

  const transporte: TransporteDeTeste = {
    conexoes: [],
    perderAoReceber: null,
    sumirAoReceber: null,
    trocarAoReceber: null,
    perderAoEnviar: null,
    falharAoConectar: null,
    semTor: false,
    http: [],
    falharHttp: null,
    segurarHttp: null,

    ociosa() {
      return (
        abrindo === 0 &&
        pedidosHttp === 0 &&
        [...esperas.values()].every((e) => !e.ola && e.pedidos.size === 0)
      );
    },

    async pedirHttp(pedido) {
      // Como o Tor levaria ao onion service: o endereço do relay vai para o relay local.
      const alvo = new URL(pedido.endereco);
      const base = new URL(rota(`ws://${alvo.host}`).replace(/^ws/, 'http'));
      transporte.http.push({
        circuito: pedido.circuito,
        metodo: pedido.metodo,
        caminho: alvo.pathname,
      });
      if (transporte.falharHttp?.(pedido)) throw new Error('relay-inacessivel');
      const segurar = transporte.segurarHttp?.(pedido);
      if (segurar) {
        const solto = await Promise.race([
          segurar.then(() => true),
          ...(pedido.cancelar ? [pedido.cancelar.then(() => false)] : []),
        ]);
        if (!solto) throw new Error('cancelado');
      }
      pedidosHttp++;
      const controle = new AbortController();
      void pedido.cancelar?.then(() => {
        controle.abort();
      });
      try {
        let resposta: Response;
        let corpo: Uint8Array;
        try {
          resposta = await fetch(`${base.origin}${alvo.pathname}`, {
            method: pedido.metodo,
            signal: controle.signal,
            ...(pedido.corpo ? { body: pedido.corpo } : {}),
          });
          corpo = new Uint8Array(await resposta.arrayBuffer());
        } catch (erro) {
          throw new Error(controle.signal.aborted ? 'cancelado' : 'relay-inacessivel', {
            cause: erro,
          });
        }
        if (corpo.length > pedido.limite) throw new Error('resposta-grande-demais');
        pedido.aoProgredir?.(1);
        return { status: resposta.status, corpo };
      } finally {
        pedidosHttp--;
      }
    },

    conectar(endereco, circuito) {
      // Como o Tor quando o circuito novo não fica pronto: falha antes de abrir.
      if (transporte.semTor) return Promise.reject(new Error('tor-indisponivel'));
      if (transporte.falharAoConectar?.(circuito)) {
        return Promise.reject(new Error('relay-inacessivel'));
      }
      const ws = new WebSocket(rota(endereco));
      ws.binaryType = 'arraybuffer';
      const registro: ConexaoRegistrada = { circuito, enviadas: [], aberta: false };
      const espera = { pedidos: new Set<number>(), ola: true };
      const aoReceber = new Set<(dados: Uint8Array) => void>();
      const aoFechar = new Set<() => void>();
      let fechou = false;
      let abrindoAinda = true;
      abrindo++;
      const terminouDeAbrir = () => {
        if (!abrindoAinda) return;
        abrindoAinda = false;
        abrindo--;
      };

      const fechamento = new Promise<void>((pronto) => {
        ws.addEventListener('close', () => {
          terminouDeAbrir();
          fechou = true;
          registro.aberta = false;
          esperas.delete(ws);
          for (const ouvinte of [...aoFechar]) ouvinte();
          pronto();
        });
      });
      ws.addEventListener('message', (evento: MessageEvent) => {
        if (fechou || !(evento.data instanceof ArrayBuffer)) return;
        const dados = new Uint8Array(evento.data);
        const mensagem = lerMensagemDoRelay(dados);
        espera.ola = false;
        if (mensagem && 'numero' in mensagem) espera.pedidos.delete(mensagem.numero);
        if (transporte.perderAoReceber?.(dados)) {
          ws.close();
          return;
        }
        if (transporte.sumirAoReceber?.(dados, circuito)) return;
        for (const cada of transporte.trocarAoReceber?.(dados, circuito) ?? [dados]) {
          for (const ouvinte of [...aoReceber]) ouvinte(cada);
        }
      });

      const conexao: Conexao = {
        enviar(dados) {
          if (fechou || ws.readyState !== WebSocket.OPEN) {
            return Promise.reject(new Error('conexao-fechada'));
          }
          if (transporte.perderAoEnviar?.(dados)) {
            ws.close();
            return Promise.reject(new Error('conexao-fechada'));
          }
          const leitura = lerPedido(dados);
          if (leitura.ok) espera.pedidos.add(leitura.pedido.numero);
          registro.enviadas.push(dados.slice());
          ws.send(dados);
          return Promise.resolve();
        },
        aoReceber(ouvinte) {
          aoReceber.add(ouvinte);
          return () => aoReceber.delete(ouvinte);
        },
        aoFechar(ouvinte) {
          aoFechar.add(ouvinte);
          return () => aoFechar.delete(ouvinte);
        },
        async fechar() {
          if (!fechou) ws.close(1000);
          await fechamento;
        },
      };

      return new Promise((pronto, falhou) => {
        ws.addEventListener('open', () => {
          terminouDeAbrir();
          registro.aberta = true;
          esperas.set(ws, espera);
          transporte.conexoes.push(registro);
          pronto(conexao);
        });
        ws.addEventListener('error', () => {
          if (registro.aberta) return;
          terminouDeAbrir();
          falhou(new Error('relay-inacessivel'));
        });
      });
    },
  };
  return transporte;
}
