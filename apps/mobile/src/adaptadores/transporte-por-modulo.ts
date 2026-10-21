// A porta Transporte sobre o módulo nativo do Android: WebSocket binário e o HTTP dos anexos, com
// Tor (Orbot) por padrão. Com Tor ligado e Orbot fora do ar, rejeita com `tor-indisponivel` (RF-44,
// RNF-06). Sem React Native: os testes rodam no Node, com um módulo de mentira.
//
// Circuitos: cada circuito que o núcleo pede vira uma credencial SOCKS sorteada nesta execução. O
// Tor só põe no mesmo circuito conexões com a mesma credencial (IsolateSOCKSAuth, ligado por
// padrão), então o relay não liga a conexão da caixa às de depósito, nem uma conversa a outra.
import type { Conexao, Cripto, Transporte } from '@cifra/core';
import { deBase64, paraHex, problemaNoEndereco } from './formato.ts';

/** Os eventos do módulo nativo. */
export interface EventosDoModulo {
  /** Mensagem binária recebida, em base64 (o evento atravessa a ponte como texto). */
  mensagem: (evento: { id: number; dados: string }) => void;
  /** A conexão caiu sem o app pedir: o relay fechou ou a rede caiu. */
  fechou: (evento: { id: number }) => void;
  /** Quanto do pedido HTTP já foi ou veio, de 0 a 1. */
  progresso: (evento: { numero: number; fracao: number }) => void;
}

/** O que o adaptador usa do módulo nativo do transporte (modules/cifra-plataforma). */
export interface ModuloDoTransporte {
  conectar(endereco: string, portaSocks: number | null, credencial: string | null): Promise<number>;
  enviar(id: number, dados: Uint8Array): void;
  fechar(id: number): Promise<void>;
  http(
    numero: number,
    metodo: string,
    endereco: string,
    portaSocks: number | null,
    credencial: string | null,
    corpo: Uint8Array | null,
    limite: number,
  ): Promise<{ status: number; corpo: Uint8Array }>;
  cancelarHttp(numero: number): void;
  addListener<E extends keyof EventosDoModulo>(
    evento: E,
    ouvinte: EventosDoModulo[E],
  ): { remove(): void };
}

export interface OpcoesDoTransporte {
  /** `null` desliga o Tor: só `wss://` é aceito. */
  readonly portaSocks: number | null;
}

export function transportePorModulo(
  modulo: ModuloDoTransporte,
  cripto: Pick<Cripto, 'randombytes_buf'>,
  { portaSocks }: OpcoesDoTransporte,
): Transporte {
  const credenciais = new Map<string, string>();
  const credencialDe = (circuito: string): string => {
    let credencial = credenciais.get(circuito);
    if (!credencial) {
      credencial = paraHex(cripto.randombytes_buf(16));
      credenciais.set(circuito, credencial);
    }
    return credencial;
  };

  let proximoPedido = 1;

  return {
    // O HTTP dos anexos sai pela mesma credencial do circuito pedido: o envio de um anexo vai pelo
    // circuito de depósito do contato, como os pacotes dele.
    async pedirHttp(pedido) {
      const problema = problemaNoEndereco(pedido.endereco, portaSocks !== null, 'http');
      if (problema) throw new Error(problema);
      const numero = proximoPedido++;
      let terminou = false;
      const { aoProgredir } = pedido;
      const progresso = aoProgredir
        ? modulo.addListener('progresso', (evento) => {
            if (evento.numero === numero) aoProgredir(evento.fracao);
          })
        : null;
      void pedido.cancelar?.then(() => {
        if (!terminou) modulo.cancelarHttp(numero);
      });
      try {
        const resposta = await modulo.http(
          numero,
          pedido.metodo,
          pedido.endereco,
          portaSocks,
          portaSocks === null ? null : credencialDe(pedido.circuito),
          pedido.corpo ?? null,
          pedido.limite,
        );
        return { status: resposta.status, corpo: resposta.corpo };
      } catch (erro) {
        const codigo = (erro as { code?: unknown } | null)?.code;
        const conhecido = codigo === 'tor-indisponivel' || codigo === 'cancelado';
        throw new Error(conhecido ? codigo : 'relay-inacessivel', { cause: erro });
      } finally {
        terminou = true;
        progresso?.remove();
      }
    },

    async conectar(endereco, circuito) {
      const problema = problemaNoEndereco(endereco, portaSocks !== null);
      if (problema) throw new Error(problema);

      let id: number;
      try {
        id = await modulo.conectar(
          endereco,
          portaSocks,
          portaSocks === null ? null : credencialDe(circuito),
        );
      } catch (erro) {
        // O módulo nativo rejeita com um código; a mensagem que o Expo monta em volta não interessa.
        const codigo = (erro as { code?: unknown } | null)?.code;
        throw new Error(codigo === 'tor-indisponivel' ? codigo : 'relay-inacessivel', {
          cause: erro,
        });
      }
      const aoReceber = new Set<(dados: Uint8Array) => void>();
      const aoFechar = new Set<() => void>();
      let fechada = false;

      const mensagens = modulo.addListener('mensagem', (evento) => {
        if (evento.id !== id) return;
        const dados = deBase64(evento.dados);
        for (const ouvinte of [...aoReceber]) ouvinte(dados);
      });
      // O módulo só avisa a queda (o relay fechou, a rede caiu); o fechamento que o app pede passa
      // por aqui direto. Um ou outro, quem ouve é avisado uma vez, e os ouvintes do módulo saem.
      const encerrar = () => {
        if (fechada) return;
        fechada = true;
        mensagens.remove();
        fechamentos.remove();
        for (const ouvinte of [...aoFechar]) ouvinte();
      };
      const fechamentos = modulo.addListener('fechou', (evento) => {
        if (evento.id === id) encerrar();
      });

      const conexao: Conexao = {
        // O módulo lança `conexao-fechada` na hora; aqui isso vira promessa rejeitada, como a
        // porta pede.
        enviar(dados) {
          if (fechada) return Promise.reject(new Error('conexao-fechada'));
          try {
            modulo.enviar(id, dados);
            return Promise.resolve();
          } catch {
            return Promise.reject(new Error('conexao-fechada'));
          }
        },
        aoReceber(ouvinte) {
          aoReceber.add(ouvinte);
          return () => aoReceber.delete(ouvinte);
        },
        aoFechar(ouvinte) {
          aoFechar.add(ouvinte);
          return () => aoFechar.delete(ouvinte);
        },
        fechar() {
          encerrar();
          return modulo.fechar(id);
        },
      };
      return conexao;
    },
  };
}
