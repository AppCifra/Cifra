// Adaptador da porta Transporte no Android: WebSocket binário e o HTTP dos anexos pelo módulo
// nativo, com Tor (Orbot) por padrão. Com Tor ligado e Orbot fora do ar, rejeita com
// `tor-indisponivel` (RF-44, RNF-06).
//
// Circuitos: cada circuito que o núcleo pede vira uma credencial SOCKS sorteada nesta execução. O
// Tor só põe no mesmo circuito conexões com a mesma credencial (IsolateSOCKSAuth, ligado por
// padrão), então o relay não liga a conexão da caixa às de depósito, nem uma conversa a outra.
import type { Conexao, Transporte } from '@cifra/core';
import { transporteNativo } from '../../modules/cifra-plataforma/index.ts';
import { cripto } from './cripto.ts';
import { deBase64, paraHex, problemaNoEndereco } from './formato.ts';

/** Porta SOCKS padrão do Orbot. */
export const PORTA_SOCKS_DO_ORBOT = 9050;

export interface OpcoesDoTransporte {
  /** `null` desliga o Tor: só `wss://` é aceito. */
  readonly portaSocks: number | null;
}

export function criarTransporte({ portaSocks }: OpcoesDoTransporte): Transporte {
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
        ? transporteNativo.addListener('progresso', (evento) => {
            if (evento.numero === numero) aoProgredir(evento.fracao);
          })
        : null;
      void pedido.cancelar?.then(() => {
        if (!terminou) transporteNativo.cancelarHttp(numero);
      });
      try {
        const resposta = await transporteNativo.http(
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
        id = await transporteNativo.conectar(
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

      const mensagens = transporteNativo.addListener('mensagem', (evento) => {
        if (evento.id !== id) return;
        const dados = deBase64(evento.dados);
        for (const ouvinte of [...aoReceber]) ouvinte(dados);
      });
      const fechamentos = transporteNativo.addListener('fechou', (evento) => {
        if (evento.id !== id) return;
        mensagens.remove();
        fechamentos.remove();
        for (const ouvinte of [...aoFechar]) ouvinte();
      });

      const conexao: Conexao = {
        // O módulo lança `conexao-fechada` na hora; aqui isso vira promessa rejeitada, como a
        // porta pede.
        enviar(dados) {
          try {
            transporteNativo.enviar(id, dados);
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
        fechar: () => transporteNativo.fechar(id),
      };
      return conexao;
    },
  };
}
