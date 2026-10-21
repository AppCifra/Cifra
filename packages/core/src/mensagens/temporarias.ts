// Mensagens temporárias (RF-25 a RF-28, RF-50) e a limpeza do que vence. Toda mensagem guarda
// quando some; a limpeza apaga de verdade o que venceu, pela mesma rotina das outras exclusões.
//
// - Prazo: conta a partir do envio (RF-27). Os dois aparelhos usam o `enviadaEm` de quem escreveu,
//   então a mensagem some dos dois no mesmo horário. Quem recebe usa o menor entre o envio e a
//   chegada: um relógio adiantado do outro lado não faz a mensagem durar mais aqui.
// - Teto: nenhuma mensagem com timer dura mais que o timer da conversa. Quem recebe corta o que
//   vier maior; mensagem nova sem timer numa conversa com timer recebe o timer dela.
// - Mudança do timer: o limite novo conta a partir da mudança. As mensagens que passariam dele
//   são cortadas; as sem timer só ganham timer quando a pessoa escolhe aplicar também às
//   anteriores. Desligar ou aumentar o timer não muda nenhuma mensagem.
// - Timer padrão (RF-50): a conversa nova começa com ele, se ninguém escolheu timer nela. O
//   contato só fica sabendo junto com a primeira mensagem: adicionar alguém não manda nada.
// - Vencida: a recebida que vence sem ter sido lida deixa a nota "expirou antes de você abrir"
//   (RF-28), como a que já chega vencida.
// - Apagar só neste celular: a mensagem fica escondida até o fim do prazo do desfazer e então sai
//   de verdade, nesta mesma limpeza. Ao parar (o app bloqueou), o que estava escondido sai na hora.
//
// A limpeza roda ao abrir, antes de qualquer leitura das telas, no horário do próximo prazo e,
// para pegar mensagem nova, a cada poucos segundos.
import { paraHex, timerValido } from '@cifra/protocol';
import { ajustesDoTimer } from '../ajustes/repositorio.ts';
import type { Exclusivo } from '../banco/exclusivo.ts';
import { bytesDe, numeroDe, numeroOuNulo, textoDe } from '../banco/linhas.ts';
import { encolherBanco } from '../banco/preparo.ts';
import { contatoDe, mudarTimerDoContato } from '../contatos/repositorio.ts';
import type { Armazenamento } from '../portas/armazenamento.ts';
import type { Relogio } from '../portas/relogio.ts';
import { apagarDeVerdade } from './exclusao.ts';
import { guardarNota } from './notas.ts';

/** Quanto tempo dá para desfazer o "apagar só neste celular". */
export const PRAZO_DO_DESFAZER = 5000;

/** Com o app aberto, confere a cada tanto se entrou mensagem com prazo mais cedo. */
const CONFERENCIA = 5000;

/**
 * O timer de uma mensagem que sai (RF-26): numa conversa com timer, de 10 s até o timer dela; sem
 * timer na conversa, nenhum ou de 10 s a 7 dias.
 */
export function ttlAceito(ttl: number, timerDaConversa: number): boolean {
  if (!timerValido(ttl)) return false;
  return timerDaConversa === 0 || (ttl > 0 && ttl <= timerDaConversa);
}

/** Quando some a mensagem que sai daqui: conta do envio (RF-27). */
export function prazoDaEnviada(enviadaEm: number, ttl: number): number | null {
  return ttl > 0 ? enviadaEm + ttl * 1000 : null;
}

/**
 * O timer e o prazo da mensagem que chega: o timer dela, com o teto do timer da conversa daqui, a
 * partir do menor entre o envio e a chegada.
 */
export function prazoDaRecebida(
  enviadaEm: number,
  recebidaEm: number,
  ttl: number,
  timerDaConversa: number,
): { readonly ttl: number; readonly expiraEm: number | null } {
  const efetivo =
    timerDaConversa > 0 ? (ttl > 0 ? Math.min(ttl, timerDaConversa) : timerDaConversa) : ttl;
  return {
    ttl: efetivo,
    expiraEm: efetivo > 0 ? Math.min(enviadaEm, recebidaEm) + efetivo * 1000 : null,
  };
}

// O começo da contagem de cada mensagem: o envio, na que saiu daqui; na que chegou, o menor entre
// o envio e a chegada.
const INICIO = `CASE de_mim WHEN 1 THEN enviada_em
  ELSE min(enviada_em, coalesce(recebida_em, enviada_em)) END`;

/**
 * O timer novo da conversa, mudado em `mudanca`, chega às mensagens que já estão nela. O limite de
 * cada uma conta da mudança, ou do envio, se ela é de depois; a que passaria dele é cortada. As sem
 * timer de antes da mudança só ganham timer com `anteriores`; as de depois, sempre, porque saíram
 * sem saber do timer. Com o timer desligado, nada muda.
 */
export async function aplicarTimerNasMensagens(
  banco: Armazenamento,
  conversa: Uint8Array,
  segundos: number,
  mudanca: number,
  anteriores: boolean,
): Promise<void> {
  if (segundos === 0) return;
  const limite = `max(${INICIO}, ?) + ?`;
  const duracao = segundos * 1000;
  await banco.executar(
    `UPDATE mensagens SET ttl = ?, expira_em = ${limite}
      WHERE conversa = ?
        AND (expira_em > ${limite} OR (expira_em IS NULL AND (? = 1 OR ${INICIO} > ?)))`,
    [segundos, mudanca, duracao, conversa, mudanca, duracao, anteriores ? 1 : 0, mudanca],
  );
}

/**
 * A conversa nova (contato adicionado ou pedido aceito) começa com o timer padrão (RF-50), se
 * ninguém escolheu timer nela. O contato só fica sabendo junto com a primeira mensagem. Devolve
 * `true` se o timer mudou.
 */
export async function aplicarTimerPadrao(
  banco: Armazenamento,
  contato: Uint8Array,
  agora: number,
): Promise<boolean> {
  const situacao = await contatoDe(banco, contato);
  const { timerPadrao } = await ajustesDoTimer(banco);
  if (!situacao || timerPadrao === 0 || situacao.timerDesde !== 0) return false;
  await mudarTimerDoContato(banco, contato, {
    segundos: timerPadrao,
    desde: agora,
    porAvisar: true,
  });
  await aplicarTimerNasMensagens(banco, contato, timerPadrao, agora, false);
  await guardarNota(banco, contato, {
    tipo: 'timer',
    segundos: timerPadrao,
    anteriores: false,
    instante: agora,
  });
  return true;
}

/** As conversas das linhas, sem repetir. */
function conversasDe(linhas: readonly { readonly conversa: Uint8Array }[]): Uint8Array[] {
  return [...new Map(linhas.map(({ conversa }) => [paraHex(conversa), conversa])).values()];
}

/**
 * Apaga de verdade o que venceu e o que estava escondido para o desfazer. A recebida que venceu
 * sem ser lida deixa a nota. Devolve as conversas que mudaram.
 */
export async function limparVencidas(banco: Armazenamento, agora: number): Promise<Uint8Array[]> {
  const linhas = (
    await banco.consultar(
      `SELECT ordem, id, conversa, de_mim, status, enviada_em, recebida_em, desfazer_ate
         FROM mensagens WHERE expira_em <= ? OR desfazer_ate <= ?`,
      [agora, agora],
    )
  ).map((linha) => ({
    ordem: numeroDe(linha, 'ordem'),
    id: bytesDe(linha, 'id'),
    conversa: bytesDe(linha, 'conversa'),
    naoLida:
      numeroDe(linha, 'de_mim') === 0 &&
      textoDe(linha, 'status') === 'recebida' &&
      numeroOuNulo(linha, 'desfazer_ate') === null,
    instante: numeroOuNulo(linha, 'recebida_em') ?? numeroDe(linha, 'enviada_em'),
  }));
  if (linhas.length === 0) return [];
  for (const linha of linhas) {
    // A nota fica no lugar da mensagem que saiu.
    if (linha.naoLida) {
      await guardarNota(
        banco,
        linha.conversa,
        { tipo: 'expirou', instante: linha.instante },
        linha.ordem - 1,
      );
    }
  }
  await apagarDeVerdade(banco, { mensagens: linhas.map(({ id }) => id) });
  return conversasDe(linhas);
}

/** O que estava escondido para o desfazer sai de verdade agora. Devolve as conversas. */
export async function apagarEscondidas(banco: Armazenamento): Promise<Uint8Array[]> {
  const linhas = (
    await banco.consultar('SELECT id, conversa FROM mensagens WHERE desfazer_ate IS NOT NULL')
  ).map((linha) => ({ id: bytesDe(linha, 'id'), conversa: bytesDe(linha, 'conversa') }));
  if (linhas.length === 0) return [];
  await apagarDeVerdade(banco, { mensagens: linhas.map(({ id }) => id) });
  return conversasDe(linhas);
}

/** O próximo prazo, de mensagem temporária ou do desfazer; `null` se não há nenhum. */
export async function proximoPrazo(banco: Armazenamento): Promise<number | null> {
  const [linha] = await banco.consultar(
    `SELECT min(quando) AS quando FROM (
       SELECT min(expira_em) AS quando FROM mensagens WHERE expira_em IS NOT NULL
       UNION ALL
       SELECT min(desfazer_ate) FROM mensagens WHERE desfazer_ate IS NOT NULL)`,
  );
  const quando = linha?.['quando'];
  return typeof quando === 'number' ? quando : null;
}

export interface OpcoesDasTemporarias {
  readonly banco: Armazenamento;
  readonly relogio: Relogio;
  /** O mesmo do correio e da agenda: um acesso ao banco por vez. */
  readonly exclusivo: Exclusivo;
}

/** Limpa o que vence, enquanto o app está aberto, e avisa as conversas que mudaram. */
export class Temporarias {
  readonly #o: OpcoesDasTemporarias;
  #parado = true;
  #cancelar: (() => void) | null = null;
  #ultima: Promise<void> = Promise.resolve();
  readonly #ouvintes = new Set<(conversas: readonly Uint8Array[]) => void>();

  constructor(opcoes: OpcoesDasTemporarias) {
    this.#o = opcoes;
  }

  /**
   * Limpa o que venceu e passa a limpar no horário de cada prazo. A primeira limpeza entra já na
   * vez do banco: as telas, que leem depois, nunca mostram o que venceu com o app fechado.
   */
  iniciar(): void {
    if (!this.#parado) return;
    this.#parado = false;
    this.#limpar();
  }

  /** Para de agendar. O que estava escondido para o desfazer sai de verdade agora. */
  async parar(): Promise<void> {
    this.#parado = true;
    this.#cancelar?.();
    this.#cancelar = null;
    await this.#ultima;
    const { banco, exclusivo } = this.#o;
    const conversas = await exclusivo(() => banco.transacao((t) => apagarEscondidas(t))).catch(
      (): Uint8Array[] => [],
    );
    if (conversas.length > 0) this.#emitir(conversas);
  }

  /** Entrou mensagem com prazo, ou uma foi escondida: confere quando é a próxima limpeza. */
  conferir(): void {
    if (!this.#parado) this.#limpar();
  }

  /** Registra quem é avisado das conversas que mudaram. Devolve a função que cancela. */
  aoApagar(ouvinte: (conversas: readonly Uint8Array[]) => void): () => void {
    this.#ouvintes.add(ouvinte);
    return () => this.#ouvintes.delete(ouvinte);
  }

  #emitir(conversas: readonly Uint8Array[]): void {
    for (const ouvinte of [...this.#ouvintes]) {
      try {
        ouvinte(conversas);
      } catch {
        // Quem ouve não derruba a limpeza.
      }
    }
  }

  #limpar(): void {
    const { banco, relogio, exclusivo } = this.#o;
    // Entra na vez do banco agora, sem esperar a limpeza anterior terminar.
    const limpeza = exclusivo(async () => {
      const resultado = await banco.transacao(async (t) => {
        const conversas = await limparVencidas(t, relogio.agora());
        return { conversas, proximo: await proximoPrazo(t) };
      });
      // As páginas que as exclusões deixaram livres voltam ao sistema.
      await encolherBanco(banco);
      return resultado;
    });
    this.#ultima = limpeza.then(
      ({ conversas, proximo }) => {
        if (conversas.length > 0) this.#emitir(conversas);
        this.#agendar(proximo);
      },
      () => {
        // Erro do banco: tenta de novo na próxima conferência.
        this.#agendar(null);
      },
    );
  }

  #agendar(proximo: number | null): void {
    if (this.#parado) return;
    this.#cancelar?.();
    const agora = this.#o.relogio.agora();
    const quando = Math.min(proximo ?? Number.POSITIVE_INFINITY, agora + CONFERENCIA);
    this.#cancelar = this.#o.relogio.agendar(Math.max(0, quando - agora), () => {
      this.#cancelar = null;
      this.#limpar();
    });
  }
}
