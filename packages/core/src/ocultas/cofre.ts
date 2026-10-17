// O cofre das conversas ocultas aberto (RF-20 a RF-24): um segundo banco, com o mesmo esquema do
// principal, aberto pelo código secreto. Ele tem a própria agenda (sem a nota pessoal), o próprio
// correio (sem caixa principal, com a caixa de cada conversa oculta) e a própria limpeza das
// temporárias. O banco principal não guarda nada das ocultas.
//
// Ocultar: o contato recebe um aviso de caixa nova, uma caixa criada anonimamente no relay, e a
// conversa muda do principal para o cofre. Reexibir é o espelho. Só com conexão: o aviso precisa
// chegar ao relay antes da mudança. Se não chegar, nada muda; se a resposta do relay se perdeu e o
// aviso chegou, um aviso de volta sai pela fila. Se o app parar no meio, a marca da mudança faz a
// próxima abertura terminar ou desfazer.
//
// Travas: sempre a do principal primeiro, depois a do cofre. Nunca o contrário, senão uma espera a
// outra para sempre.
import { iguais, idDaChave, lerId } from '@cifra/protocol';
import { gravarLinhaDosAjustes, linhaDosAjustes } from '../ajustes/repositorio.ts';
import { criarExclusivo, type Exclusivo } from '../banco/exclusivo.ts';
import { encolherBanco } from '../banco/preparo.ts';
import { Agenda } from '../contatos/agenda.ts';
import { contatoDe } from '../contatos/repositorio.ts';
import { Correio, ErroDoCorreio } from '../correio.ts';
import type { Identidade } from '../identidade/identidade.ts';
import { enfileirarAvisoDeCaixa, type Contexto } from '../mensagens/correspondencia.ts';
import { Temporarias } from '../mensagens/temporarias.ts';
import type { Armazenamento } from '../portas/armazenamento.ts';
import type { Cripto } from '../portas/cripto.ts';
import type { Relogio } from '../portas/relogio.ts';
import type { Transporte } from '../portas/transporte.ts';
import type { GerarPar } from '../sessao/catraca.ts';
import { sessoesDe } from '../sessao/repositorio.ts';
import { BLOCO_DO_COFRE, cofreEmBlocos, completarBloco } from './blocos.ts';
import { apagarConversaDoBanco, copiarConversa } from './mudanca.ts';
import {
  apagarCaixaOculta,
  guardarCaixaOculta,
  marcarCopiada,
  marcarMudanca,
  mudancaDe,
  mudancas,
  sementeDaCaixaOculta,
  tirarMudanca,
} from './repositorio.ts';

/**
 * - `nao-pode`: só uma conversa com contato aceito, não bloqueado e com sessão; nunca a nota pessoal
 *   nem um pedido de conversa.
 * - `desconhecida`: a conversa não está onde devia: não existe, ou já mudou.
 * - `duplicada`: o outro banco já tem uma conversa com o mesmo ID (o contato foi adicionado de novo,
 *   ou escreveu de outro aparelho, com as ocultas fechadas).
 * - `relay-inacessivel`: sem conexão com o relay agora. Nada mudou.
 */
export type CodigoDasOcultas = 'nao-pode' | 'desconhecida' | 'duplicada' | 'relay-inacessivel';

export class ErroDasOcultas extends Error {
  readonly codigo: CodigoDasOcultas;

  constructor(codigo: CodigoDasOcultas) {
    super(codigo);
    this.codigo = codigo;
  }
}

/** O banco principal e o que usa ele, para mudar conversas de banco. */
export interface Principal {
  readonly banco: Armazenamento;
  readonly exclusivo: Exclusivo;
  /** Sem relay, `null`: nada muda de banco. */
  readonly correio: Correio | null;
}

export interface OpcoesDoCofre {
  readonly cripto: Cripto;
  readonly relogio: Relogio;
  readonly identidade: Identidade;
  /** O banco do cofre, já preparado (`prepararCofre`). O cofre completa o bloco sozinho. */
  readonly banco: Armazenamento;
  /** O tamanho do bloco; os testes usam um menor. */
  readonly bloco?: number;
  /** Sem relay, o cofre só mostra o que já tem: nada sai nem chega, e nada muda de banco. */
  readonly transporte: Transporte | null;
  readonly relay: string | null;
  readonly principal: Principal;
  /** Só nos testes: o sorteio dos pares X25519. */
  readonly gerarPar?: GerarPar;
}

export class Cofre {
  readonly #o: OpcoesDoCofre;
  /** O banco do cofre, que completa o bloco depois de cada escrita. */
  readonly #banco: Armazenamento;
  readonly #contexto: Contexto;
  readonly #meuId: Uint8Array;
  /** A hora do último aviso de caixa: o seguinte vem sempre depois. */
  #ultimoAviso = 0;

  /** Um acesso ao banco do cofre por vez, dividido entre a agenda, o correio e a limpeza. */
  readonly exclusivo: Exclusivo;
  readonly agenda: Agenda;
  readonly correio: Correio | null;
  readonly temporarias: Temporarias;

  constructor(opcoes: OpcoesDoCofre) {
    this.#o = opcoes;
    const { cripto, relogio, identidade, transporte, relay } = opcoes;
    this.#banco = cofreEmBlocos(opcoes.banco, opcoes.bloco ?? BLOCO_DO_COFRE);
    this.#contexto = {
      cripto,
      identidade,
      gerarPar: opcoes.gerarPar ?? (() => cripto.crypto_box_keypair()),
    };
    this.#meuId = idDaChave(cripto, identidade.assinatura.publicKey);
    this.exclusivo = criarExclusivo();
    const banco = this.#banco;
    const { exclusivo } = this;
    this.agenda = new Agenda({ cripto, banco, relogio, identidade, exclusivo, comNota: false });
    this.temporarias = new Temporarias({ banco, relogio, exclusivo });
    this.correio =
      transporte && relay
        ? new Correio({
            cripto,
            banco,
            transporte,
            relogio,
            identidade,
            relay,
            exclusivo,
            ...(opcoes.gerarPar ? { gerarPar: opcoes.gerarPar } : {}),
          })
        : null;
  }

  /**
   * Termina ou desfaz a mudança que o app deixou no meio, copia os ajustes do principal, limpa o que
   * venceu com o cofre fechado e liga o correio e a limpeza.
   */
  async iniciar(): Promise<void> {
    await this.#resolverMudancas();
    await this.copiarAjustes();
    this.temporarias.iniciar();
    this.correio?.iniciar();
  }

  /** Para o correio e a limpeza e completa o bloco. Quem fecha o arquivo é quem abriu. */
  async fechar(): Promise<void> {
    await this.temporarias.parar();
    await this.correio?.parar();
    await this.exclusivo(() => completarBloco(this.#o.banco, this.#o.bloco ?? BLOCO_DO_COFRE));
  }

  /** O cofre usa os mesmos ajustes do principal: timer padrão, baixar sozinho, leitura… */
  async copiarAjustes(): Promise<void> {
    const { principal } = this.#o;
    const linha = await principal.exclusivo(() => linhaDosAjustes(principal.banco));
    await this.exclusivo(() => gravarLinhaDosAjustes(this.#banco, linha));
  }

  /** O ID é de uma conversa oculta. */
  async conhece(id: string): Promise<boolean> {
    const contato = lerId(id);
    if (!contato) return false;
    return (await this.exclusivo(() => contatoDe(this.#banco, contato))) !== null;
  }

  /**
   * Oculta a conversa (RF-20): cria a caixa nova no relay, avisa o contato e muda a conversa do
   * principal para o cofre. Do principal, nada dela fica.
   */
  async ocultar(id: string): Promise<void> {
    const contato = this.#contatoDe(id);
    const { cripto, principal } = this.#o;
    const correioPrincipal = principal.correio;
    const correioDoCofre = this.correio;
    if (!correioPrincipal || !correioDoCofre) throw new ErroDasOcultas('relay-inacessivel');
    await principal.exclusivo(async () => {
      const situacao = await contatoDe(principal.banco, contato);
      if (!situacao) throw new ErroDasOcultas('desconhecida');
      const sessoes = await sessoesDe(principal.banco, contato);
      if (!situacao.aceito || situacao.bloqueado || sessoes.length === 0) {
        throw new ErroDasOcultas('nao-pode');
      }
    });
    if (await this.conhece(id)) throw new ErroDasOcultas('duplicada');

    const semente = cripto.randombytes_buf(cripto.crypto_sign_SEEDBYTES);
    let caixa: Uint8Array;
    try {
      const par = cripto.crypto_sign_seed_keypair(semente);
      cripto.memzero(par.privateKey);
      caixa = par.publicKey;
      await this.#rede(() => correioDoCofre.criarCaixa(semente));
      await this.exclusivo(() =>
        this.#banco.transacao(async (t) => {
          await guardarCaixaOculta(t, contato, semente);
          await marcarMudanca(t, contato, 'ocultar');
        }),
      );
    } finally {
      cripto.memzero(semente);
    }

    try {
      await this.#rede(() => correioPrincipal.avisarCaixa(id, caixa, this.#instanteDoAviso()));
    } catch (erro) {
      // O relay pode ter aceitado o aviso e a resposta ter se perdido: o contato volta para a
      // caixa do cartão pela fila. A caixa nova fica para trás e some do relay pelo prazo.
      await principal.exclusivo(() => this.exclusivo(() => this.#desfazerOcultar(contato)));
      correioPrincipal.conferir();
      throw erro;
    }

    // Nada do principal anda enquanto a conversa muda: nem download terminando, nem pacote chegando.
    await correioPrincipal.parar();
    try {
      await principal.exclusivo(() =>
        this.exclusivo(async () => {
          try {
            await copiarConversa(principal.banco, this.#banco, contato, (t) =>
              marcarCopiada(t, contato),
            );
          } catch {
            // A cópia não entrou: a conversa fica no principal, e o contato volta para lá.
            await this.#desfazerOcultar(contato);
            throw new ErroDasOcultas('duplicada');
          }
          await apagarConversaDoBanco(principal.banco, contato);
          await encolherBanco(principal.banco);
          await this.#banco.transacao((t) => tirarMudanca(t, contato));
        }),
      );
    } finally {
      correioPrincipal.iniciar();
    }
    await correioDoCofre.conferirCaixas();
  }

  /**
   * Reexibe a conversa (RF-20): avisa o contato que ela volta para a caixa do cartão e muda a
   * conversa do cofre para o principal. A caixa oculta fica para trás e some do relay pelo prazo.
   */
  async reexibir(id: string): Promise<void> {
    const contato = this.#contatoDe(id);
    const { principal } = this.#o;
    const correioPrincipal = principal.correio;
    const correioDoCofre = this.correio;
    if (!correioPrincipal || !correioDoCofre) throw new ErroDasOcultas('relay-inacessivel');
    const situacao = await this.exclusivo(() => contatoDe(this.#banco, contato));
    if (!situacao) throw new ErroDasOcultas('desconhecida');
    if (!situacao.aceito || situacao.bloqueado) throw new ErroDasOcultas('nao-pode');
    const doPrincipal = await principal.exclusivo(() => contatoDe(principal.banco, contato));
    if (doPrincipal) throw new ErroDasOcultas('duplicada');

    await this.exclusivo(() => this.#banco.transacao((t) => marcarMudanca(t, contato, 'reexibir')));
    try {
      await this.#rede(() => correioDoCofre.avisarCaixa(id, null, this.#instanteDoAviso()));
    } catch (erro) {
      // Como no ocultar: se o aviso chegou e a resposta se perdeu, o contato volta para a caixa
      // oculta pela fila.
      await this.exclusivo(() => this.#desfazerReexibir(contato));
      correioDoCofre.conferir();
      throw erro;
    }

    await correioDoCofre.parar();
    try {
      await principal.exclusivo(() =>
        this.exclusivo(async () => {
          try {
            await copiarConversa(this.#banco, principal.banco, contato, (t) =>
              marcarMudanca(t, contato, 'reexibir', true),
            );
          } catch {
            await this.#desfazerReexibir(contato);
            throw new ErroDasOcultas('duplicada');
          }
          await this.#apagarDoCofre(contato);
          await principal.banco.transacao((t) => tirarMudanca(t, contato));
        }),
      );
    } finally {
      correioDoCofre.iniciar();
    }
    correioPrincipal.conferir();
  }

  // ---------------------------------------------------------------- uso interno
  //
  // Os métodos abaixo não pegam trava nenhuma: quem chama já está com as travas de que eles
  // precisam, na ordem certa.

  #contatoDe(id: string): Uint8Array {
    const contato = lerId(id);
    if (!contato || iguais(contato, this.#meuId)) throw new ErroDasOcultas('nao-pode');
    return contato;
  }

  /** A hora do próximo aviso de caixa: depois do anterior, mesmo no mesmo milissegundo. */
  #instanteDoAviso(): number {
    this.#ultimoAviso = Math.max(this.#o.relogio.agora(), this.#ultimoAviso + 1);
    return this.#ultimoAviso;
  }

  /** O que depende da rede: a falha vira `relay-inacessivel`, ou `nao-pode` se o contato não aceita. */
  async #rede<T>(operacao: () => Promise<T>): Promise<T> {
    try {
      return await operacao();
    } catch (erro) {
      if (erro instanceof ErroDoCorreio && erro.codigo !== 'relay-inacessivel') {
        throw new ErroDasOcultas('nao-pode');
      }
      throw new ErroDasOcultas('relay-inacessivel');
    }
  }

  /**
   * Põe o aviso de caixa na fila do banco onde a conversa está. Sem sessão, ou com o contato
   * bloqueado, não há a quem avisar. Precisa da trava desse banco.
   */
  async #avisarPelaFila(
    banco: Armazenamento,
    contato: Uint8Array,
    caixa: Uint8Array | null,
  ): Promise<void> {
    const instante = this.#instanteDoAviso();
    const agora = this.#o.relogio.agora();
    await banco
      .transacao((t) => enfileirarAvisoDeCaixa(this.#contexto, t, contato, caixa, instante, agora))
      .catch(() => undefined);
  }

  /** A caixa pública da conversa oculta com o contato. Precisa da trava do cofre. */
  async #caixaOculta(contato: Uint8Array): Promise<Uint8Array | null> {
    const { cripto } = this.#o;
    const semente = await sementeDaCaixaOculta(this.#banco, contato);
    if (!semente) return null;
    const par = cripto.crypto_sign_seed_keypair(semente);
    cripto.memzero(par.privateKey);
    cripto.memzero(semente);
    return par.publicKey;
  }

  /**
   * Ocultar não terminou: o contato volta para a caixa do cartão, e a caixa nova sai do cofre.
   * Precisa das duas travas.
   */
  async #desfazerOcultar(contato: Uint8Array): Promise<void> {
    await this.#avisarPelaFila(this.#o.principal.banco, contato, null);
    await this.#banco.transacao(async (t) => {
      await apagarCaixaOculta(t, contato);
      await tirarMudanca(t, contato);
    });
  }

  /**
   * Reexibir não terminou: o contato volta para a caixa oculta, e a conversa fica no cofre. Precisa
   * da trava do cofre.
   */
  async #desfazerReexibir(contato: Uint8Array): Promise<void> {
    const caixa = await this.#caixaOculta(contato);
    if (caixa) await this.#avisarPelaFila(this.#banco, contato, caixa);
    await this.#banco.transacao((t) => tirarMudanca(t, contato));
  }

  /** A conversa sai do cofre, com a caixa oculta e a marca. Precisa da trava do cofre. */
  async #apagarDoCofre(contato: Uint8Array): Promise<void> {
    await apagarConversaDoBanco(this.#banco, contato, async (t) => {
      await apagarCaixaOculta(t, contato);
      await tirarMudanca(t, contato);
    });
  }

  /**
   * A mudança que o app deixou no meio, pela marca: se a cópia já tinha entrado no destino, termina
   * (a origem é apagada, e o aviso de caixa vai de novo); se não, desfaz (o contato volta para a
   * caixa de onde a conversa não saiu). O contato manda de novo o que pode ter se perdido: repetir o
   * aviso não duplica nada.
   */
  async #resolverMudancas(): Promise<void> {
    const { principal } = this.#o;
    const pendentes = await this.exclusivo(() => mudancas(this.#banco));
    await principal.exclusivo(() =>
      this.exclusivo(async () => {
        for (const { contato, tipo, copiada } of pendentes) {
          if (tipo === 'ocultar' && copiada) {
            await apagarConversaDoBanco(principal.banco, contato);
            await encolherBanco(principal.banco);
            await this.#avisarPelaFila(this.#banco, contato, await this.#caixaOculta(contato));
            await this.#banco.transacao((t) => tirarMudanca(t, contato));
          } else if (tipo === 'ocultar') {
            await this.#desfazerOcultar(contato);
          } else if ((await mudancaDe(principal.banco, contato))?.copiada) {
            await this.#apagarDoCofre(contato);
            await this.#avisarPelaFila(principal.banco, contato, null);
          } else {
            await this.#desfazerReexibir(contato);
          }
        }
        // A marca que sobrou no principal é de uma volta que terminou: a conversa já está lá.
        await principal.banco.transacao((t) => t.executar('DELETE FROM mudancas'));
      }),
    );
    if (pendentes.length > 0) principal.correio?.conferir();
  }
}
