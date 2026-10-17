// O pânico no relay (RF-48): o app pede ao relay para apagar o cartão desta identidade, as one-time
// prekeys, a caixa principal e o que esperava nela. A assinatura, com a chave de identidade, cobre
// o desafio da conexão: não serve em outra, e só o dono apaga. O pedido sai pela conexão no
// circuito da caixa, que já publicava o cartão: o relay não aprende nada com isso.
//
// O pânico apaga o que está no aparelho antes, sem esperar a rede: isto vem depois, em segundo
// plano. Sem conexão, o cartão e a caixa ficam no relay até o prazo deles (90 dias sem renovação).
import { mensagemDoApagarTudo } from '@cifra/protocol';
import { CIRCUITO_DA_CAIXA } from '../correio.ts';
import { intervaloDeReenvio } from '../mensagens/fila.ts';
import type { Cripto, ParDeChaves } from '../portas/cripto.ts';
import type { Relogio } from '../portas/relogio.ts';
import type { Transporte } from '../portas/transporte.ts';
import { ConexaoComORelay } from './conexao.ts';

/** Tentativas antes de desistir: cada uma abre uma conexão nova. */
export const TENTATIVAS_DO_APAGAR = 3;

export interface OpcoesDoApagar {
  readonly cripto: Cripto;
  readonly transporte: Transporte;
  readonly relogio: Relogio;
  /** O endereço do relay do cartão. */
  readonly relay: string;
  /** O par Ed25519 da identidade. Continua de quem chama, que zera a parte privada depois. */
  readonly assinatura: ParDeChaves;
}

/**
 * Pede ao relay para apagar tudo desta identidade. Devolve `true` quando o relay apagou, ou quando ele
 * já não tinha cartão; `false` se não deu para falar com ele depois das tentativas.
 */
export async function apagarTudoNoRelay(opcoes: OpcoesDoApagar): Promise<boolean> {
  const { cripto, transporte, relogio, relay, assinatura } = opcoes;
  for (let tentativa = 1; ; tentativa++) {
    let conexao: ConexaoComORelay | null = null;
    try {
      conexao = await ConexaoComORelay.abrir(transporte, relay, CIRCUITO_DA_CAIXA, relogio);
      const chave = assinatura.publicKey;
      const resposta = await conexao.pedir({
        tipo: 'apagar-tudo',
        chave,
        assinatura: cripto.crypto_sign_detached(
          mensagemDoApagarTudo(conexao.desafio, chave),
          assinatura.privateKey,
        ),
      });
      if (
        resposta.tipo === 'resposta' &&
        (resposta.codigo === 'ok' || resposta.codigo === 'cartao-inexistente')
      ) {
        return true;
      }
    } catch {
      // A rede caiu, ou o Tor não está ligado: tenta de novo.
    } finally {
      await conexao?.fechar();
    }
    if (tentativa >= TENTATIVAS_DO_APAGAR) return false;
    await new Promise<void>((pronto) => {
      relogio.agendar(intervaloDeReenvio(tentativa), pronto);
    });
  }
}
