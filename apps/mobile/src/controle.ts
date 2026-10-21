// O estado do app e o bloqueio criptográfico (RNF-07), sem React: a tela desenha o estado e chama
// as ações. Os testes rodam no Node.
//
// Bloquear não é só esconder a tela: o que usa a sessão (agenda e correio) para, o banco fecha (o
// SQLCipher apaga a cópia nativa da chave) e os segredos da memória são zerados. Abrir de novo pede
// a biometria ou a senha. O app bloqueia sozinho depois do prazo parado (RF-40, 5 minutos por
// padrão, ajustável): sem tocar nem digitar com ele na frente, ou fora dele (outro app ou tela
// apagada). Na frente, um timer confere; fora, um alarme do sistema acorda o aparelho no prazo, e
// ao voltar o tempo é conferido de novo antes de qualquer tela. Com o prazo "ao sair do app", ele
// bloqueia na hora de sair.
//
// Com o app bloqueado, o vigia abre a caixa só com a chave dela e avisa de mensagem nova sem abrir
// nada (RF-42). Ao desbloquear, ele para antes de o correio abrir a caixa.
//
// Um aparelho por ID (RF-05): quando a identidade é restaurada em outro aparelho, este para tudo,
// fecha a sessão e mostra o aviso; daí só resta começar de novo, gerando ou restaurando.
//
// Pânico (RF-48): a tela volta na hora ao começo, e os segredos do Keystore são destruídos antes de
// qualquer outra coisa. Daí em diante, o banco e o cofre não abrem mais: o que sobrar no chip é
// ruído. Depois o app para, fecha o banco, zera a memória e apaga os arquivos; por último, em
// segundo plano, pede ao relay para apagar o cartão e a caixa.
import type { ConteudoDoBackup, Identidade, ParDeChaves } from '@cifra/core';
import {
  abrirSessao,
  criarSessao,
  encerrarSessao,
  ErroNaAbertura,
  type Plataforma,
  type Sessao,
} from './sessao.ts';

/** O que usa a sessão aberta e precisa parar antes de o banco fechar: a agenda e o correio. */
export interface EmUso {
  parar(): Promise<void>;
  /** Fecha as conversas ocultas (RF-24), se estiverem abertas. */
  fecharOcultas?(): Promise<void>;
  /** Segundos parado até bloquear sozinho (RF-40); 0 é ao sair do app. Sem ele, 5 minutos. */
  readonly prazoDoBloqueio?: number;
}

/** O que mede o tempo parado (RF-40). */
export interface BloqueioSozinho {
  /** Milissegundos que só andam para frente, contando o aparelho dormindo. */
  decorrido(): number;
  /** Timer com o app na frente. */
  agendar(atraso: number, tarefa: () => void): () => void;
  /** O alarme que acorda o aparelho no prazo, com o app fora da frente. */
  armar(ms: number): void;
  desarmar(): void;
}

/** O prazo padrão do bloqueio sozinho, e o do seletor do sistema com o prazo "ao sair". */
export const PRAZO_PADRAO = 300_000;

/** Com o app na frente, o tempo parado é conferido de tanto em tanto: o prazo pode mudar. */
const CONFERENCIA_DO_PARADO = 30_000;

export type EstadoDoApp<U extends EmUso = EmUso> =
  | { readonly tipo: 'abrindo' }
  /** `falhou`: a última tentativa deu erro, e não foi a pessoa cancelando. */
  | { readonly tipo: 'bloqueado'; readonly falhou: boolean }
  /** `apagado`: o pânico acabou de apagar tudo (RF-48); a tela diz isso uma vez. */
  | { readonly tipo: 'onboarding'; readonly apagado?: boolean }
  /**
   * Os dados deste aparelho não abrem mais: o aparelho apagou a chave (`chave`) ou o banco não
   * abre com ela (`arquivo`). Só resta começar de novo, gerando ou restaurando a identidade.
   */
  | { readonly tipo: 'dados-perdidos'; readonly motivo: 'chave' | 'arquivo' }
  /** A identidade foi restaurada em outro aparelho, e este não envia nem recebe mais (RF-05). */
  | { readonly tipo: 'substituido' }
  | { readonly tipo: 'pronto'; readonly sessao: Sessao; readonly uso: U };

export interface OpcoesDoControle<U extends EmUso> {
  readonly plataforma: Plataforma;
  /**
   * Liga o que usa a sessão aberta. `aoSubstituir` avisa que a identidade foi restaurada em outro
   * aparelho (RF-05).
   */
  readonly iniciar: (sessao: Sessao, aoSubstituir: () => void) => U;
  /** Se o app está na frente agora. */
  readonly emPrimeiroPlano: () => boolean;
  /** O tempo parado (RF-40). Sem ele, o app bloqueia ao sair da frente. */
  readonly bloqueio?: BloqueioSozinho;
  /**
   * Liga o vigia do app bloqueado (RF-42) e devolve o que para ele; `null` quando as notificações
   * estão desligadas.
   */
  readonly vigiar?: () => Promise<EmUso | null>;
  /**
   * Pânico: pede ao relay para apagar o cartão e a caixa desta identidade, com uma cópia do par de
   * assinatura e da semente da caixa, que o controle zera quando o pedido termina. Sem ela, nada
   * sai para o relay.
   */
  readonly apagarNoRelay?: (
    assinatura: ParDeChaves,
    sementeDaCaixa: Uint8Array,
  ) => Promise<unknown>;
  /** Pânico: o app esquece o que fica fora do banco (tema, idioma, avisos), na hora. */
  readonly aoApagar?: () => void;
}

function estadoDaFalha<U extends EmUso>(erro: unknown): EstadoDoApp<U> {
  const falha = erro instanceof ErroNaAbertura ? erro.falha : 'falhou';
  switch (falha) {
    case 'cancelado':
      return { tipo: 'bloqueado', falhou: false };
    case 'chave-perdida':
      return { tipo: 'dados-perdidos', motivo: 'chave' };
    case 'banco-ilegivel':
      return { tipo: 'dados-perdidos', motivo: 'arquivo' };
    case 'falhou':
      return { tipo: 'bloqueado', falhou: true };
  }
}

export class ControleDoApp<U extends EmUso = EmUso> {
  readonly #o: OpcoesDoControle<U>;
  #estado: EstadoDoApp<U> = { tipo: 'abrindo' };
  readonly #ouvintes = new Set<() => void>();
  /** Abrir, guardar e bloquear rodam um de cada vez, na ordem em que foram pedidos. */
  #fila: Promise<unknown> = Promise.resolve();
  /** O app bloqueou ao sair da frente: ao voltar, pede a biometria uma vez. */
  #pedirAoVoltar = false;
  /** Seletores do sistema (fotos, arquivos) abertos pelo próprio app. */
  #seletoresAbertos = 0;
  /** Quando a pessoa tocou ou digitou pela última vez, no relógio do bloqueio. */
  #ultimoUso = 0;
  #cancelarConferencia: (() => void) | null = null;
  /** Com o app fora da frente, quando o prazo vence. */
  #venceEm: number | null = null;
  #vigia: EmUso | null = null;
  #ligandoVigia: Promise<void> | null = null;
  /** Cada parada do vigia muda a vez: o vigia que termina de ligar depois disso é parado. */
  #vezDoVigia = 0;
  /** O pedido do pânico ao relay, que corre depois de apagar o que está no aparelho. */
  #noRelay: Promise<void> = Promise.resolve();

  constructor(opcoes: OpcoesDoControle<U>) {
    this.#o = opcoes;
  }

  get estado(): EstadoDoApp<U> {
    return this.#estado;
  }

  /** Registra quem é avisado quando o estado muda. Devolve a função que cancela. */
  aoMudar = (ouvinte: () => void): (() => void) => {
    this.#ouvintes.add(ouvinte);
    return () => this.#ouvintes.delete(ouvinte);
  };

  /** Pede a biometria ou a senha e abre a identidade guardada. Sem identidade, vai ao onboarding. */
  abrir(): Promise<void> {
    return this.#emFila(async () => {
      if (this.#estado.tipo === 'pronto') return;
      this.#mudar({ tipo: 'abrindo' });
      let sessao: Sessao | null;
      try {
        sessao = await abrirSessao(this.#o.plataforma);
      } catch (erro) {
        this.#mudar(estadoDaFalha(erro));
        return;
      }
      if (sessao) {
        // A caixa passa do vigia para o correio: quem abre por último fica com ela.
        await this.#pararVigia();
        this.#entrar(sessao);
      } else {
        this.#mudar({ tipo: 'onboarding' });
      }
    });
  }

  /**
   * Guarda a identidade do onboarding e entra. Com `backup` (a restauração, RF-47), os contatos e os
   * ajustes dele entram junto. Rejeita se não conseguir guardar.
   */
  concluirOnboarding(
    identidade: Identidade,
    backup: ConteudoDoBackup | null = null,
  ): Promise<void> {
    return this.#emFila(async () => {
      this.#entrar(await criarSessao(this.#o.plataforma, identidade, backup));
    });
  }

  /**
   * Pânico (RF-48): apaga tudo deste aparelho. Só com a identidade aberta. Volta quando o que estava
   * no aparelho já saiu; o pedido ao relay continua em segundo plano (`apagandoNoRelay`).
   */
  panico(): Promise<void> {
    return this.#emFila(async () => {
      const estado = this.#estado;
      if (estado.tipo !== 'pronto') return;
      const { plataforma } = this.#o;
      const { cripto, cofre } = plataforma;
      this.#pararConferencia();
      this.#venceEm = null;
      this.#pedirAoVoltar = false;
      this.#o.bloqueio?.desarmar();
      this.#mudar({ tipo: 'onboarding', apagado: true });
      this.#o.aoApagar?.();
      // Primeiro as chaves: sem elas, nada do banco nem do cofre abre de novo.
      await cofre
        .destruirTudo()
        .catch(() => cofre.destruirTudo())
        .catch(() => undefined);
      const { assinatura } = estado.sessao.identidade;
      const par = {
        publicKey: assinatura.publicKey.slice(),
        privateKey: assinatura.privateKey.slice(),
      };
      const sementeDaCaixa = estado.sessao.sementeDaCaixa.slice();
      try {
        await estado.uso.parar();
      } catch {
        // O que usava a sessão para de qualquer jeito: o banco fecha logo abaixo.
      } finally {
        encerrarSessao(cripto, estado.sessao);
      }
      await plataforma.apagarArquivos().catch(() => undefined);
      const { apagarNoRelay } = this.#o;
      this.#noRelay = (apagarNoRelay ? apagarNoRelay(par, sementeDaCaixa) : Promise.resolve())
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => {
          cripto.memzero(par.privateKey);
          cripto.memzero(sementeDaCaixa);
        });
    });
  }

  /** O pedido do pânico ao relay: resolve quando terminou, tenha dado certo ou não. */
  get apagandoNoRelay(): Promise<void> {
    return this.#noRelay;
  }

  /** Da tela de dados perdidos, ou do aviso de outro aparelho, para o onboarding. */
  recomecar(): void {
    const { tipo } = this.#estado;
    if (tipo === 'dados-perdidos' || tipo === 'substituido') this.#mudar({ tipo: 'onboarding' });
  }

  /** Esconde a tela na hora, para o que usa a sessão, fecha o banco e zera os segredos. */
  bloquear(): Promise<void> {
    return this.#fechar({ tipo: 'bloqueado', falhou: false });
  }

  /**
   * O app saiu da frente (outro app ou tela apagada): com a identidade aberta, bloqueia. Durante o
   * pedido de biometria não faz nada: a senha do aparelho pode tirar o app da frente.
   */
  irParaSegundoPlano(): Promise<void> {
    const { tipo } = this.#estado;
    if (tipo === 'bloqueado') {
      this.#pedirAoVoltar = true;
      return Promise.resolve();
    }
    if (tipo !== 'pronto') return Promise.resolve();
    this.#pararConferencia();
    const { bloqueio } = this.#o;
    // As ocultas fecham ao sair da frente (RF-24), fora quando o seletor do próprio app está aberto.
    if (this.#seletoresAbertos === 0)
      void this.#estado.uso.fecharOcultas?.().catch(() => undefined);
    void this.#o.plataforma.tocarCofre().catch(() => undefined);
    // O seletor de fotos ou de arquivos que o app abriu tira o app da frente: o prazo conta, mas o
    // "ao sair do app" não vale para ele.
    if (!bloqueio && this.#seletoresAbertos > 0) return Promise.resolve();
    const prazo = this.#seletoresAbertos > 0 ? this.#prazo() || PRAZO_PADRAO : this.#prazo();
    if (!bloqueio || prazo === 0) {
      this.#pedirAoVoltar = true;
      return this.bloquear();
    }
    this.#venceEm = bloqueio.decorrido() + prazo;
    bloqueio.armar(prazo);
    return Promise.resolve();
  }

  /**
   * Roda a ação (o seletor de fotos ou de arquivos do sistema) sem bloquear quando o app sai da
   * frente por causa dela. Sair do app de outro jeito enquanto o seletor está aberto também não
   * bloqueia: o prazo do bloqueio sozinho (RF-40) cobre esse caso.
   */
  async semBloquear<T>(acao: () => Promise<T>): Promise<T> {
    this.#seletoresAbertos++;
    try {
      return await acao();
    } finally {
      this.#seletoresAbertos--;
    }
  }

  /**
   * O app voltou para a frente: se bloqueou ao sair, pede a biometria uma vez. Se a pessoa
   * cancelar, fica no bloqueio sem pedir de novo sozinho.
   */
  async voltarAoPrimeiroPlano(): Promise<void> {
    const { bloqueio } = this.#o;
    if (this.#venceEm !== null && bloqueio) {
      const venceu = bloqueio.decorrido() >= this.#venceEm;
      this.#venceEm = null;
      bloqueio.desarmar();
      if (venceu) {
        this.#pedirAoVoltar = true;
        await this.bloquear();
      } else {
        this.usar();
      }
    }
    if (!this.#pedirAoVoltar) return;
    this.#pedirAoVoltar = false;
    return this.abrir();
  }

  /** O prazo venceu (o alarme do sistema, ou a volta depois dele): bloqueia. */
  prazoVenceu(): Promise<void> {
    if (this.#estado.tipo !== 'pronto') return Promise.resolve();
    this.#venceEm = null;
    this.#o.bloqueio?.desarmar();
    // Venceu fora da frente: a volta pede a biometria uma vez.
    this.#pedirAoVoltar = true;
    return this.bloquear();
  }

  /** A pessoa tocou na tela ou digitou: o tempo parado recomeça. */
  usar(): void {
    const { bloqueio } = this.#o;
    if (!bloqueio || this.#estado.tipo !== 'pronto' || this.#venceEm !== null) return;
    this.#ultimoUso = bloqueio.decorrido();
    if (!this.#cancelarConferencia) this.#agendarConferencia();
  }

  /** Espera terminar o que já foi pedido. */
  esperar(): Promise<void> {
    return this.#emFila(() => Promise.resolve());
  }

  #entrar(sessao: Sessao): void {
    const aoSubstituir = () => {
      void this.#substituido(sessao);
    };
    this.#mudar({ tipo: 'pronto', sessao, uso: this.#o.iniciar(sessao, aoSubstituir) });
    // A pessoa saiu do app enquanto o pedido de biometria terminava: bloqueia de novo.
    if (!this.#o.emPrimeiroPlano()) {
      void this.irParaSegundoPlano();
      return;
    }
    this.usar();
  }

  /** O prazo do bloqueio sozinho agora, em milissegundos. */
  #prazo(): number {
    const estado = this.#estado;
    if (estado.tipo !== 'pronto') return PRAZO_PADRAO;
    const segundos = estado.uso.prazoDoBloqueio;
    return segundos === undefined ? PRAZO_PADRAO : segundos * 1000;
  }

  /** Com o app na frente, confere o tempo parado de tanto em tanto. */
  #agendarConferencia(): void {
    const { bloqueio } = this.#o;
    if (!bloqueio) return;
    const prazo = this.#prazo();
    // "Ao sair do app": na frente, quem apaga a tela parada é o próprio celular. A conferência
    // segue mesmo assim: a pessoa pode trocar o prazo e não tocar mais na tela.
    const restante =
      prazo === 0 ? CONFERENCIA_DO_PARADO : this.#ultimoUso + prazo - bloqueio.decorrido();
    if (restante <= 0) {
      // Parado na frente: a tela de bloqueio aparece sem pedir a biometria sozinha.
      void this.bloquear();
      return;
    }
    this.#cancelarConferencia = bloqueio.agendar(Math.min(restante, CONFERENCIA_DO_PARADO), () => {
      this.#cancelarConferencia = null;
      if (this.#estado.tipo === 'pronto' && this.#venceEm === null) this.#agendarConferencia();
    });
  }

  #pararConferencia(): void {
    this.#cancelarConferencia?.();
    this.#cancelarConferencia = null;
  }

  /** Liga o vigia do app bloqueado, se as notificações estão ligadas (RF-42). */
  #ligarVigia(): void {
    const { vigiar } = this.#o;
    if (!vigiar || this.#vigia || this.#ligandoVigia) return;
    const vez = this.#vezDoVigia;
    this.#ligandoVigia = vigiar()
      .then(async (vigia) => {
        if (!vigia) return;
        if (vez !== this.#vezDoVigia || this.#estado.tipo !== 'bloqueado') {
          await vigia.parar();
          return;
        }
        this.#vigia = vigia;
      })
      .catch(() => undefined)
      .finally(() => {
        this.#ligandoVigia = null;
      });
  }

  /** Para o vigia e espera: depois disso, a caixa está livre para o correio. */
  async #pararVigia(): Promise<void> {
    this.#vezDoVigia++;
    await this.#ligandoVigia;
    const vigia = this.#vigia;
    this.#vigia = null;
    await vigia?.parar().catch(() => undefined);
  }

  /** Outro aparelho assumiu a identidade: fecha esta sessão e mostra o aviso (RF-05). */
  #substituido(sessao: Sessao): Promise<void> {
    return this.#emFila(async () => {
      const estado = this.#estado;
      // O aviso de uma sessão que já fechou não muda nada; a próxima abertura avisa de novo.
      if (estado.tipo !== 'pronto' || estado.sessao !== sessao) return;
      await this.#encerrar(estado, { tipo: 'substituido' });
    });
  }

  #fechar(proximo: EstadoDoApp<U>): Promise<void> {
    return this.#emFila(async () => {
      const estado = this.#estado;
      if (estado.tipo !== 'pronto') return;
      await this.#encerrar(estado, proximo);
    });
  }

  /** A tela muda na hora; depois para o que usa a sessão, fecha o banco e zera os segredos. */
  async #encerrar(
    estado: Extract<EstadoDoApp<U>, { tipo: 'pronto' }>,
    proximo: EstadoDoApp<U>,
  ): Promise<void> {
    this.#pararConferencia();
    this.#venceEm = null;
    this.#o.bloqueio?.desarmar();
    this.#mudar(proximo);
    try {
      await estado.uso.parar();
    } catch {
      // O que usava a sessão para de qualquer jeito: o banco fecha logo abaixo.
    } finally {
      encerrarSessao(this.#o.plataforma.cripto, estado.sessao);
    }
    // A data do cofre muda a cada bloqueio, com ou sem ocultas abertas.
    await this.#o.plataforma.tocarCofre().catch(() => undefined);
    // O correio fechou a caixa: o vigia pode abrir.
    if (this.#estado.tipo === 'bloqueado') this.#ligarVigia();
  }

  #mudar(estado: EstadoDoApp<U>): void {
    const antes = this.#estado.tipo;
    this.#estado = estado;
    for (const ouvinte of [...this.#ouvintes]) ouvinte();
    // Bloqueado sem ter passado pela sessão (a pessoa cancelou a biometria ao abrir): o vigia já
    // pode abrir a caixa. Saindo da identidade (onboarding, dados perdidos, outro aparelho), para.
    if (estado.tipo === 'bloqueado' && antes !== 'pronto') this.#ligarVigia();
    const semIdentidade = ['onboarding', 'dados-perdidos', 'substituido'];
    if (semIdentidade.includes(estado.tipo)) void this.#pararVigia();
  }

  #emFila<T>(acao: () => Promise<T>): Promise<T> {
    const resultado = this.#fila.then(acao);
    this.#fila = resultado.catch(() => undefined);
    return resultado;
  }
}
