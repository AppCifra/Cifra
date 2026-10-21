// As conversas da identidade aberta, sem React: junta a agenda (local), o correio (rede) e a limpeza
// das temporárias para as telas. Diz o estado da conexão, avisa a cada mudança (mensagem nova,
// status, contato mexido, mensagem que venceu) e traduz os erros do núcleo no que a tela mostra.
// Os testes rodam no Node, contra o relay de verdade.
//
// Sem relay configurado (só no desenvolvimento), não há correio: a lista, a busca e a nota pessoal
// funcionam, e adicionar, enviar ou mudar o timer de um contato avisa que não há conexão.
//
// Anexos e ações nas mensagens: escolher fotos, vídeos e arquivos (pelo seletor do sistema, sem
// bloquear o app enquanto ele está aberto), preparar (a limpeza é da plataforma), enviar, baixar e
// cancelar, abrir na memória (RF-36), salvar no celular (RF-53), copiar (RF-52), encaminhar (RF-54)
// e responder (RF-55). As fotos abertas ficam na memória para a tela até o app bloquear; nada delas
// vai para arquivo.
//
// Conversas ocultas: o código secreto digitado na busca abre o cofre, com a agenda, o correio e a
// limpeza dele. Cada ação de uma conversa vai para o banco onde ela está. O correio do cofre nunca
// gera aviso de mensagem nova. As ocultas fecham no bloqueio, ao sair da frente e na linha "Fechar
// ocultas"; ao fechar, as telas delas saem e a busca é limpa.
//
// Backup: o arquivo com os contatos e os ajustes sai pelo "salvar como" do sistema, sem bloquear o
// app enquanto ele está aberto. Ele sai só do banco principal: nada das ocultas vai.
import {
  chaveDoCofre,
  codigoAceito,
  completarBloco,
  ErroDaAgenda,
  ErroDasOcultas,
  ErroDoCorreio,
  legendaAceita,
  LIMITE_DO_ENCAMINHAR,
  prepararCofre,
  textoAceito,
  type AjustesDePrivacidade,
  type Agenda,
  type Armazenamento,
  type ArquivoParaEnviar,
  type Cofre,
  type CofreAberto,
  type CodigoDoCorreio,
  type Correio,
  type Cripto,
  type EventoDoCorreio,
  type Identidade,
  type PreferenciasDoBackup,
  type Temporarias,
} from '@cifra/core';
import { formatarId, lerId, type TipoDeArquivo } from '@cifra/protocol';
import { enderecoDeDados } from './adaptadores/formato.ts';

/** `sem-tor`: o Orbot não está ligado; sem ele, o app não conecta (RF-44). */
export type EstadoDaRede = 'conectado' | 'conectando' | 'sem-tor' | 'sem-conexao';

/** Por que um ID não virou conversa, no que a tela mostra (painel "Nova conversa"). */
export type ErroAoAdicionar =
  'id-invalido' | 'inexistente' | 'invalido' | 'sem-conexao' | 'recusou' | 'bloqueado';

export type ResultadoAoAdicionar =
  /** `id`: a conversa a abrir; o próprio ID abre a nota pessoal. */
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly erro: ErroAoAdicionar };

/**
 * `longa`: passa de 3500 bytes (a legenda, de 2000); `timer`: o timer escolhido passa do da
 * conversa; `falhou`: não entrou na fila (sem sessão, sem relay, arquivo fora do formato).
 */
export type ResultadoAoEnviar = 'ok' | 'longa' | 'timer' | 'falhou';

/** Quantas fotos, vídeos ou arquivos a pessoa escolhe de uma vez. Cada um vira uma mensagem. */
export const ITENS_POR_ENVIO = 10;

/** Um arquivo escolhido no seletor do sistema, ainda sem limpar. O endereço nunca é guardado. */
export interface Escolhido {
  readonly endereco: string;
  readonly formato: string;
}

/**
 * Por que um arquivo escolhido não foi preparado: `grande` passa de 25 MB; `nao-abre` está num
 * formato que o celular não lê, ou não abriu.
 */
export type ErroAoPreparar = 'grande' | 'nao-abre';

export class ErroDaMidia extends Error {
  readonly codigo: ErroAoPreparar;

  constructor(codigo: ErroAoPreparar) {
    super(codigo);
    this.codigo = codigo;
  }
}

/** Um anexo aberto, para salvar no celular. */
export interface ArquivoAberto {
  readonly arquivo: TipoDeArquivo;
  readonly formato: string;
  readonly bytes: Uint8Array;
}

/** O que a plataforma faz com fotos, vídeos e arquivos (no Android, o módulo nativo). */
export interface MidiaDoApp {
  /** O seletor de fotos e vídeos do sistema, até `limite` itens. Vazio se a pessoa cancelou. */
  escolherMidia(limite: number): Promise<Escolhido[]>;
  /** O seletor de arquivos do sistema, até `limite` itens. */
  escolherArquivos(limite: number): Promise<Escolhido[]>;
  /**
   * Limpa e prepara (RF-32 a RF-34): a foto recodificada, sem metadados; o vídeo sem metadados,
   * com a capa; o documento como está, sem nome nem datas. Rejeita com `ErroDaMidia`.
   */
  preparar(escolhido: Escolhido): Promise<ArquivoParaEnviar>;
  /** Salva no celular: foto e vídeo na galeria, documento em Download (RF-53). */
  salvar(arquivo: ArquivoAberto): Promise<void>;
  /** Copia o texto marcado como sensível; ele sai da área de transferência sozinho (RF-52). */
  copiar(texto: string): Promise<void>;
  /** O "salvar como" do sistema, com o nome sugerido (o backup). `false` se a pessoa cancelou. */
  salvarArquivo(bytes: Uint8Array, nome: string): Promise<boolean>;
  /** Esquece as imagens que a tela decodificou. */
  esquecerImagens(): void;
}

export interface OpcoesDasConversas {
  readonly agenda: Agenda;
  readonly correio: Correio | null;
  /** A limpeza do que vence e do que foi apagado só neste celular. */
  readonly temporarias: Temporarias;
  readonly identidade: Identidade;
  /** A identidade foi restaurada em outro aparelho (RF-05). */
  readonly aoSubstituir: () => void;
  /** Fotos, vídeos, arquivos e área de transferência. Sem ela, nada disso aparece. */
  readonly midia?: MidiaDoApp | undefined;
  /** Roda o seletor do sistema sem o app bloquear ao sair da frente por causa dele. */
  readonly semBloquear?: (<T>(acao: () => Promise<T>) => Promise<T>) | undefined;
  /**
   * O bloqueio de prints da janela (RF-41). Nasce ligado; com a sessão aberta, segue o ajuste, e
   * volta a ligar quando ela fecha.
   */
  readonly tela?: TelaDoApp | undefined;
  /** O cofre das conversas ocultas. Sem ele, o código não abre nada. */
  readonly ocultas?: OcultasDoApp | undefined;
}

/** O cofre das conversas ocultas: o arquivo, e o que monta o cofre aberto. */
export interface OcultasDoApp {
  readonly cripto: Cripto;
  /** O segredo do cofre, da sessão: com o código, dá a chave. */
  readonly segredo: Uint8Array;
  /** O tamanho do bloco do cofre; sem ele, o do núcleo (16 MiB). */
  readonly bloco?: number;
  /** Abre o arquivo do cofre com a chave. Rejeita com `banco-ilegivel`. */
  abrir(chave: Uint8Array): Promise<CofreAberto>;
  /** Zera o arquivo no lugar. Nada pode estar aberto nele. */
  truncar(): Promise<void>;
  /** A data de agora nos arquivos do cofre. */
  tocar(): Promise<void>;
  /** O cofre aberto (agenda, correio e limpeza) sobre o banco já preparado. */
  montar(banco: Armazenamento): Cofre;
}

/** `curto`: menos de 6 caracteres (ou mais de 64); `falhou`: o cofre não abriu nem mudou. */
export type ResultadoDoCodigo = 'ok' | 'curto' | 'falhou';

/** `cancelado`: a pessoa fechou o "salvar como"; `falhou`: não deu para gravar o arquivo. */
export type ResultadoDoBackup = 'salvo' | 'cancelado' | 'falhou';

/** `fechadas`: as ocultas não estão abertas; `sem-conexao`: o relay não respondeu, nada mudou. */
export type ResultadoDaOcultacao = 'ok' | 'fechadas' | 'sem-conexao' | 'falhou';

/** O que muda conforme a conversa está no principal ou no cofre. */
interface Lado {
  readonly agenda: Agenda;
  readonly correio: Correio | null;
  readonly temporarias: Temporarias;
}

/** A janela do app: prints e gravações saem em branco quando ela está segura. */
export interface TelaDoApp {
  definirSegura(segura: boolean): Promise<void>;
}

export interface OpcoesDoEnvio {
  /** Segundos; sem ele, o timer da conversa (RF-26). */
  readonly ttl?: number | undefined;
  /** A mensagem respondida (RF-55). */
  readonly resposta?: Uint8Array | undefined;
  /** No anexo: a legenda, até 2000 bytes. */
  readonly legenda?: string | undefined;
}

const ERROS_DO_CORREIO: Partial<Record<CodigoDoCorreio, ErroAoAdicionar>> = {
  'id-invalido': 'id-invalido',
  'relay-inacessivel': 'sem-conexao',
  'cartao-inexistente': 'inexistente',
  'cartao-invalido': 'invalido',
  bloqueado: 'bloqueado',
};

const timerInvalido = (erro: unknown) =>
  (erro instanceof ErroDoCorreio || erro instanceof ErroDaAgenda) &&
  erro.codigo === 'timer-invalido';

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/** Os padrões do banco (migração 7), até a leitura terminar. */
const PRIVACIDADE_PADRAO: AjustesDePrivacidade = {
  confirmacoesDeLeitura: false,
  indicadorDeDigitacao: false,
  bloquearSozinho: 300,
  bloquearCapturas: true,
};

/** O "digitando" do contato some sozinho depois disto sem sinal novo (RF-18). */
export const DURACAO_DO_DIGITANDO = 20_000;

/** Quem escreve repete o "digitando" de tanto em tanto, enquanto continua escrevendo. */
export const REPETICAO_DO_DIGITANDO = 15_000;

/** As fotos abertas guardadas para a tela, no máximo: as mais antigas saem. */
const LIMITE_DAS_IMAGENS = 48 * 1024 * 1024;

const sem = () => undefined;

export class ConversasDoApp {
  readonly agenda: Agenda;
  readonly #o: OpcoesDasConversas;
  #rede: EstadoDaRede;
  #versao = 0;
  readonly #ouvintes = new Set<() => void>();
  readonly #cancelar: (() => void)[];
  /** O progresso de cada transferência (ID da mensagem em hex), de 0 a 1. */
  readonly #progresso = new Map<string, number>();
  readonly #ouvintesDoProgresso = new Set<() => void>();
  /** As fotos e capas abertas (data:), pela ordem de uso: as últimas são as mais novas. */
  readonly #imagens = new Map<string, string>();
  #tamanhoDasImagens = 0;
  /** Os ajustes de privacidade, lidos ao abrir; até lá, os padrões. */
  #privacidade: AjustesDePrivacidade = PRIVACIDADE_PADRAO;
  readonly #ouvintesDeMensagem = new Set<() => void>();
  /** As conversas em que o contato está escrevendo, com o que apaga o sinal. */
  readonly #digitando = new Map<string, () => void>();
  readonly #ouvintesDaDigitacao = new Set<() => void>();
  /** Quando o "digitando" saiu para cada conversa, enquanto a pessoa escreve. */
  readonly #escrevendo = new Map<string, number>();
  /** Telas abertas de conversas com prints bloqueados (RF-58): enquanto houver, a janela é segura. */
  #telasProtegidas = 0;
  #parado = false;
  /** O cofre aberto, com o arquivo e o que para de ouvir os eventos dele. */
  #cofre: {
    readonly cofre: Cofre;
    readonly aberto: CofreAberto;
    readonly cancelar: readonly (() => void)[];
  } | null = null;
  /** Os IDs das conversas ocultas, com o cofre aberto. */
  #ocultos: ReadonlySet<string> = new Set();
  /** Abrir, fechar e mudar o cofre, um de cada vez. */
  #vezDasOcultas: Promise<unknown> = Promise.resolve();
  readonly #ouvintesDoFechamento = new Set<(ids: ReadonlySet<string>) => void>();

  constructor(opcoes: OpcoesDasConversas) {
    this.#o = opcoes;
    this.agenda = opcoes.agenda;
    const { correio, temporarias } = opcoes;
    this.#rede = correio ? 'conectando' : 'sem-conexao';
    this.#cancelar = [
      temporarias.aoApagar(() => {
        this.#esquecerImagens();
        this.#avisar();
      }),
      correio?.aoMudar((evento) => {
        this.#aoEvento(evento, temporarias, false);
      }) ?? sem,
    ];
  }

  /**
   * O que o correio avisou, do principal ou do cofre. O do cofre nunca gera aviso de mensagem nova
   * (RF-20), e a rede que a tela mostra é a do principal.
   */
  #aoEvento(evento: EventoDoCorreio, temporarias: Temporarias, doCofre: boolean): void {
    switch (evento.tipo) {
      case 'caixa':
        if (doCofre) return;
        this.#rede = evento.aberta ? 'conectado' : evento.semTor ? 'sem-tor' : 'conectando';
        break;
      case 'substituido':
        if (doCofre) return;
        this.#rede = 'sem-conexao';
        this.#o.aoSubstituir();
        break;
      case 'cartao':
        return;
      case 'progresso':
        this.#progresso.set(hex(evento.id), evento.fracao);
        for (const ouvinte of [...this.#ouvintesDoProgresso]) ouvinte();
        return;
      case 'anexo':
        this.#progresso.delete(hex(evento.id));
        break;
      case 'apagadas':
      case 'conversaApagada':
        this.#esquecerImagens();
        temporarias.conferir();
        break;
      case 'prints':
        break;
      case 'digitando':
        this.#contatoDigitando(evento.conversa, evento.digitando);
        return;
      case 'mensagem':
        // A mensagem chegou: o "digitando" dela acabou.
        this.#contatoDigitando(evento.conversa, false);
        if (!doCofre) for (const ouvinte of [...this.#ouvintesDeMensagem]) ouvinte();
        temporarias.conferir();
        break;
      case 'status':
      case 'expirada':
      case 'timer':
        // Pode ter chegado mensagem com prazo, ou o timer pode ter cortado um.
        temporarias.conferir();
        break;
    }
    this.#avisar();
  }

  /** O banco onde a conversa está: o cofre, se ela é oculta e as ocultas estão abertas. */
  #lado(id: string): Lado {
    const atual = this.#cofre;
    if (atual && this.#ocultos.has(id)) {
      const { agenda, correio, temporarias } = atual.cofre;
      return { agenda, correio, temporarias };
    }
    return { agenda: this.agenda, correio: this.#o.correio, temporarias: this.#o.temporarias };
  }

  /** A agenda do banco onde a conversa está. As telas leem a conversa por ela. */
  agendaDe(id: string): Agenda {
    return this.#lado(id).agenda;
  }

  /** As ocultas estão abertas: a lista mostra a seção delas. */
  get ocultasAbertas(): boolean {
    return this.#cofre !== null;
  }

  /** A agenda do cofre, com as ocultas abertas. */
  get ocultas(): Agenda | null {
    return this.#cofre?.cofre.agenda ?? null;
  }

  /** A conversa é oculta, e as ocultas estão abertas. */
  oculta(id: string): boolean {
    return this.#cofre !== null && this.#ocultos.has(id);
  }

  /**
   * Avisa quando as ocultas fecham, com os IDs delas: as telas delas saem da pilha, e a busca é
   * limpa.
   */
  aoFecharOcultas = (ouvinte: (ids: ReadonlySet<string>) => void): (() => void) => {
    this.#ouvintesDoFechamento.add(ouvinte);
    return () => this.#ouvintesDoFechamento.delete(ouvinte);
  };

  /**
   * O texto da busca pode ser o código secreto (RF-22): todo texto aceito (de 6 a 64 caracteres)
   * passa pela mesma derivação, com o mesmo custo, e só então o cofre tenta abrir. Abriu: devolve
   * `true`, e a lista mostra as ocultas. Não abriu: `false`, e nada muda, sem erro.
   */
  tentarAbrirOcultas(texto: string): Promise<boolean> {
    const { ocultas } = this.#o;
    if (!ocultas || !codigoAceito(texto)) return Promise.resolve(false);
    return this.#naVezDasOcultas(async () => {
      if (this.#cofre || this.#parado) return false;
      const chave = chaveDoCofre(ocultas.cripto, texto, ocultas.segredo);
      let aberto: CofreAberto;
      try {
        aberto = await ocultas.abrir(chave);
      } catch {
        return false;
      } finally {
        ocultas.cripto.memzero(chave);
      }
      return this.#ligarCofre(ocultas, aberto);
    });
  }

  /**
   * Fecha as ocultas (RF-24): o correio e a limpeza do cofre param, o bloco é completado, o arquivo
   * fecha e tem a data tocada. As telas delas saem da pilha, e a busca é limpa.
   */
  fecharOcultas(): Promise<void> {
    return this.#naVezDasOcultas(() => this.#desligarCofre());
  }

  /**
   * Define o código secreto com as ocultas fechadas: o arquivo do cofre é zerado no lugar e nasce
   * ali um cofre novo, já aberto. As ocultas de um código anterior somem.
   */
  definirCodigo(codigo: string): Promise<ResultadoDoCodigo> {
    const { ocultas } = this.#o;
    if (!codigoAceito(codigo)) return Promise.resolve('curto');
    if (!ocultas) return Promise.resolve('falhou');
    return this.#naVezDasOcultas(async () => {
      if (this.#parado) return 'falhou';
      await this.#desligarCofre();
      const chave = chaveDoCofre(ocultas.cripto, codigo, ocultas.segredo);
      try {
        await ocultas.truncar();
        const aberto = await ocultas.abrir(chave);
        return (await this.#ligarCofre(ocultas, aberto)) ? 'ok' : 'falhou';
      } catch {
        return 'falhou';
      } finally {
        ocultas.cripto.memzero(chave);
      }
    });
  }

  /** Troca o código com as ocultas abertas: o cofre ganha a chave nova, e as ocultas continuam. */
  trocarCodigo(codigo: string): Promise<ResultadoDoCodigo> {
    const { ocultas } = this.#o;
    if (!codigoAceito(codigo)) return Promise.resolve('curto');
    if (!ocultas) return Promise.resolve('falhou');
    return this.#naVezDasOcultas(async () => {
      const atual = this.#cofre;
      if (!atual) return 'falhou';
      const chave = chaveDoCofre(ocultas.cripto, codigo, ocultas.segredo);
      try {
        await atual.cofre.exclusivo(() => atual.aberto.trocarChave(chave));
        return 'ok';
      } catch {
        return 'falhou';
      } finally {
        ocultas.cripto.memzero(chave);
      }
    });
  }

  /** Oculta a conversa (RF-20): ela sai da lista e da busca. Só com as ocultas abertas e conexão. */
  ocultar(id: string): Promise<ResultadoDaOcultacao> {
    return this.#mudarDeBanco(id, (cofre) => cofre.ocultar(id));
  }

  /** Reexibe a conversa: ela volta para a lista e para a busca. */
  reexibir(id: string): Promise<ResultadoDaOcultacao> {
    return this.#mudarDeBanco(id, (cofre) => cofre.reexibir(id));
  }

  async #mudarDeBanco(
    id: string,
    mudar: (cofre: Cofre) => Promise<void>,
  ): Promise<ResultadoDaOcultacao> {
    const atual = this.#cofre;
    if (!atual) return 'fechadas';
    this.parouDeEscrever(id);
    try {
      await mudar(atual.cofre);
    } catch (erro) {
      return erro instanceof ErroDasOcultas && erro.codigo === 'relay-inacessivel'
        ? 'sem-conexao'
        : 'falhou';
    } finally {
      await this.#lerOcultas();
      this.#esquecerImagens();
      this.#avisar();
    }
    return 'ok';
  }

  #naVezDasOcultas<T>(acao: () => Promise<T>): Promise<T> {
    const resultado = this.#vezDasOcultas.then(acao);
    this.#vezDasOcultas = resultado.catch(() => undefined);
    return resultado;
  }

  /** Prepara o cofre que abriu, liga o correio e a limpeza dele e mostra as ocultas. */
  async #ligarCofre(ocultas: OcultasDoApp, aberto: CofreAberto): Promise<boolean> {
    let cofre: Cofre;
    try {
      await prepararCofre(aberto.banco);
      await completarBloco(aberto.banco, ...(ocultas.bloco ? [ocultas.bloco] : []));
      cofre = ocultas.montar(aberto.banco);
    } catch {
      await aberto.fechar();
      return false;
    }
    const { temporarias } = cofre;
    const cancelar = [
      temporarias.aoApagar(() => {
        this.#esquecerImagens();
        this.#avisar();
      }),
      cofre.correio?.aoMudar((evento) => {
        this.#aoEvento(evento, temporarias, true);
      }) ?? sem,
    ];
    this.#cofre = { cofre, aberto, cancelar };
    try {
      await cofre.iniciar();
    } catch {
      // Sem a mudança resolvida, as ocultas abrem do mesmo jeito.
    }
    await this.#lerOcultas();
    // A sessão fechou enquanto o cofre abria.
    if (this.#parado) {
      await this.#desligarCofre();
      return false;
    }
    this.#avisar();
    return true;
  }

  async #desligarCofre(): Promise<void> {
    const atual = this.#cofre;
    if (!atual) return;
    const ids = this.#ocultos;
    this.#cofre = null;
    this.#ocultos = new Set();
    for (const cancelar of atual.cancelar) cancelar();
    for (const [conversa, apagar] of [...this.#digitando]) {
      apagar();
      this.#digitando.delete(conversa);
    }
    this.#esquecerImagens();
    for (const ouvinte of [...this.#ouvintesDoFechamento]) ouvinte(ids);
    this.#avisar();
    try {
      await atual.cofre.fechar();
    } finally {
      await atual.aberto.fechar();
      await this.#o.ocultas?.tocar().catch(() => undefined);
    }
  }

  async #lerOcultas(): Promise<void> {
    const atual = this.#cofre;
    if (!atual) return;
    try {
      this.#ocultos = new Set((await atual.cofre.agenda.conversas()).map(({ id }) => id));
    } catch {
      // Fica o que já se sabia.
    }
  }

  /** O ID desta identidade: a nota pessoal, e o que o painel "Nova conversa" mostra. */
  get meuId(): string {
    return this.#o.identidade.id;
  }

  get rede(): EstadoDaRede {
    return this.#rede;
  }

  /** Muda a cada novidade: as telas leem de novo o que mostram. */
  get versao(): number {
    return this.#versao;
  }

  /** Se há fotos, vídeos e arquivos neste aparelho (o módulo nativo). */
  get comMidia(): boolean {
    return this.#o.midia !== undefined;
  }

  aoMudar = (ouvinte: () => void): (() => void) => {
    this.#ouvintes.add(ouvinte);
    return () => this.#ouvintes.delete(ouvinte);
  };

  /** Avisa quando o progresso de alguma transferência muda, sem ler a conversa de novo. */
  aoMudarProgresso = (ouvinte: () => void): (() => void) => {
    this.#ouvintesDoProgresso.add(ouvinte);
    return () => this.#ouvintesDoProgresso.delete(ouvinte);
  };

  /** Quanto do anexo da mensagem já foi ou veio, de 0 a 1, ou `null` se não está a caminho. */
  progresso(mensagem: Uint8Array): number | null {
    return this.#progresso.get(hex(mensagem)) ?? null;
  }

  /**
   * Começa a limpeza das temporárias e o correio. A primeira limpeza entra na vez do banco antes
   * de qualquer leitura das telas: o que venceu com o app fechado não aparece.
   */
  iniciar(): void {
    this.#o.temporarias.iniciar();
    this.#o.correio?.iniciar();
    void this.#lerPrivacidade();
  }

  /**
   * Para o correio e a limpeza; o que estava apagado só neste celular sai de verdade. As fotos
   * abertas saem da memória, e a plataforma esquece as que decodificou. Cada parte para mesmo que
   * outra falhe.
   */
  async parar(): Promise<void> {
    this.#parado = true;
    // As ocultas fecham primeiro: o cofre completa o bloco e fecha antes do banco principal.
    await this.fecharOcultas().catch(() => undefined);
    for (const apagar of this.#digitando.values()) apagar();
    this.#digitando.clear();
    this.#escrevendo.clear();
    // Prints em branco de novo antes de qualquer outra coisa: a sessão está fechando (RF-41).
    await this.#o.tela?.definirSegura(true).catch(() => undefined);
    for (const cancelar of this.#cancelar) cancelar();
    this.#esquecerImagens();
    this.#o.midia?.esquecerImagens();
    await this.#o.correio?.parar().catch(() => undefined);
    await this.#o.temporarias.parar().catch(() => undefined);
  }

  /**
   * O ID colado ou digitado vira conversa (RF-06). Contato e nota pessoal só abrem; um pedido é
   * aceito; um ID novo precisa do relay, que entrega o cartão conferido antes da primeira mensagem.
   */
  async adicionar(texto: string): Promise<ResultadoAoAdicionar> {
    const bytes = lerId(texto);
    if (!bytes) return { ok: false, erro: 'id-invalido' };
    const id = formatarId(bytes);
    if (id === this.meuId || this.oculta(id)) return { ok: true, id };
    const atual = await this.agenda.conversa(id);
    if (atual?.bloqueado) return { ok: false, erro: 'bloqueado' };
    if (atual?.tipo === 'contato') return { ok: true, id };
    if (atual?.tipo === 'pedido') {
      await this.aceitar(id);
      return { ok: true, id };
    }
    const { correio } = this.#o;
    if (!correio) return { ok: false, erro: 'sem-conexao' };
    try {
      await correio.iniciarConversa(id);
    } catch (erro) {
      const codigo = erro instanceof ErroDoCorreio ? ERROS_DO_CORREIO[erro.codigo] : undefined;
      return { ok: false, erro: codigo ?? 'recusou' };
    }
    this.#avisar();
    return { ok: true, id };
  }

  /** Aceita o pedido de conversa (RF-07): os anexos dele passam a baixar pelo ajuste (RF-57). */
  async aceitar(id: string): Promise<void> {
    await this.agenda.aceitar(id);
    this.#o.correio?.conferirAnexos();
    this.#avisar();
  }

  /**
   * Escreve na conversa: na nota pessoal fica aqui; para um contato, entra na fila de saída. Sem
   * `ttl`, vai com o timer da conversa; com, ele vale só para esta mensagem (RF-26). Com
   * `resposta`, responde a outra mensagem (RF-55).
   */
  async enviar(
    id: string,
    texto: string,
    ttl?: number,
    resposta?: Uint8Array,
  ): Promise<ResultadoAoEnviar> {
    if (!textoAceito(texto)) return 'longa';
    try {
      const { correio } = this.#lado(id);
      if (id === this.meuId) await this.agenda.escreverNota(texto, ttl, resposta);
      else if (correio) await correio.enviarTexto(id, texto, ttl, resposta);
      else return 'falhou';
    } catch (erro) {
      return timerInvalido(erro) ? 'timer' : 'falhou';
    }
    this.#mudou(id);
    return 'ok';
  }

  /**
   * Abre o seletor do sistema (fotos e vídeos, ou arquivos), sem bloquear o app enquanto ele está
   * na frente. Devolve o que a pessoa escolheu, até 10 itens.
   */
  async escolher(tipo: 'midia' | 'arquivo'): Promise<Escolhido[]> {
    const { midia } = this.#o;
    if (!midia) return [];
    const abrir = () =>
      tipo === 'midia'
        ? midia.escolherMidia(ITENS_POR_ENVIO)
        : midia.escolherArquivos(ITENS_POR_ENVIO);
    const escolhidos = await (this.#o.semBloquear ? this.#o.semBloquear(abrir) : abrir());
    return escolhidos.slice(0, ITENS_POR_ENVIO);
  }

  /** Limpa e prepara um arquivo escolhido, para a prévia e o envio. */
  async preparar(escolhido: Escolhido): Promise<ArquivoParaEnviar | ErroAoPreparar> {
    const { midia } = this.#o;
    if (!midia) return 'nao-abre';
    try {
      return await midia.preparar(escolhido);
    } catch (erro) {
      return erro instanceof ErroDaMidia ? erro.codigo : 'nao-abre';
    }
  }

  /**
   * Envia o arquivo preparado: na nota pessoal, fica só aqui; para um contato, o blob sobe antes de
   * a mensagem sair (RF-32 a RF-35).
   */
  async enviarAnexo(
    id: string,
    arquivo: ArquivoParaEnviar,
    opcoes: OpcoesDoEnvio = {},
  ): Promise<ResultadoAoEnviar> {
    const legenda = opcoes.legenda ?? '';
    if (!legendaAceita(legenda)) return 'longa';
    const extras = {
      legenda,
      ...(opcoes.ttl === undefined ? {} : { ttl: opcoes.ttl }),
      ...(opcoes.resposta ? { resposta: opcoes.resposta } : {}),
    };
    try {
      const { correio } = this.#lado(id);
      if (id === this.meuId) await this.agenda.anexarNaNota(arquivo, extras);
      else if (correio) await correio.enviarAnexo(id, arquivo, extras);
      else return 'falhou';
    } catch (erro) {
      return timerInvalido(erro) ? 'timer' : 'falhou';
    }
    this.#mudou(id);
    return 'ok';
  }

  /** A foto aberta na memória, para a tela (data:); `null` se ela ainda não está aqui. */
  async imagem(id: string, mensagem: Uint8Array): Promise<string | null> {
    return this.#imagemGuardada(`foto:${hex(mensagem)}`, async () => {
      const aberto = await this.agendaDe(id).abrirAnexo(id, mensagem);
      return aberto?.arquivo === 'imagem' ? enderecoDeDados(aberto.formato, aberto.bytes) : null;
    });
  }

  /** A capa do vídeo, para o balão; sai do primeiro pedaço, sem abrir o vídeo inteiro. */
  async capa(id: string, mensagem: Uint8Array): Promise<string | null> {
    return this.#imagemGuardada(`capa:${hex(mensagem)}`, async () => {
      const capa = await this.agendaDe(id).abrirCapa(id, mensagem);
      return capa ? enderecoDeDados('image/jpeg', capa) : null;
    });
  }

  /** O vídeo aberto na memória, para tocar sem gravar nada em arquivo (RF-36). */
  async video(id: string, mensagem: Uint8Array): Promise<Uint8Array | null> {
    const aberto = await this.agendaDe(id).abrirAnexo(id, mensagem);
    return aberto?.arquivo === 'video' ? aberto.bytes : null;
  }

  /** A pessoa tocou para baixar um anexo parado (cancelado, ou com o baixar sozinho desligado). */
  async baixar(id: string, mensagem: Uint8Array): Promise<void> {
    const { agenda, correio } = this.#lado(id);
    if (await agenda.baixarAnexo(id, mensagem)) correio?.conferirAnexos();
    this.#avisar();
  }

  /** Cancela o download: o anexo para e só volta a baixar quando a pessoa tocar. */
  async pararDownload(id: string, mensagem: Uint8Array): Promise<void> {
    const { agenda, correio } = this.#lado(id);
    await agenda.pararDownload(id, mensagem);
    correio?.cancelarTransferencia(mensagem);
    this.#progresso.delete(hex(mensagem));
    this.#avisar();
  }

  /** Cancela o envio de um anexo que ainda subia: a mensagem sai de verdade. */
  async cancelarEnvio(id: string, mensagem: Uint8Array): Promise<void> {
    const { agenda, correio } = this.#lado(id);
    await agenda.cancelarEnvio(id, mensagem);
    correio?.cancelarTransferencia(mensagem);
    this.#progresso.delete(hex(mensagem));
    this.#avisar();
  }

  /**
   * Salva no celular os anexos das mensagens que já estão aqui, só por pedido da pessoa (RF-53).
   * Devolve quantos foram salvos.
   */
  async salvar(id: string, mensagens: readonly Uint8Array[]): Promise<number> {
    const { midia } = this.#o;
    if (!midia) return 0;
    let salvos = 0;
    for (const mensagem of mensagens) {
      const aberto = await this.agendaDe(id).abrirAnexo(id, mensagem);
      if (!aberto) continue;
      try {
        await midia.salvar(aberto);
        salvos++;
      } catch {
        // O que não deu para salvar fica de fora da contagem.
      }
    }
    return salvos;
  }

  /**
   * Copia os textos e as legendas das mensagens, um por linha, sem nome nem hora, na ordem da
   * conversa (RF-52). Devolve `false` se não havia texto.
   */
  async copiar(id: string, mensagens: readonly Uint8Array[]): Promise<boolean> {
    const { midia } = this.#o;
    if (!midia) return false;
    const escolhidas = new Set(mensagens.map(hex));
    const textos = (await this.agendaDe(id).mensagens(id))
      .filter((m) => escolhidas.has(hex(m.id)) && m.texto.trim() !== '')
      .map((m) => m.texto);
    if (textos.length === 0) return false;
    await midia.copiar(textos.join('\n'));
    return true;
  }

  /**
   * Encaminha as mensagens para até 5 conversas (RF-54): cada uma chega como mensagem nova, sem
   * marca de encaminhada, com o timer do destino; o anexo é cifrado de novo, com chave nova, e
   * sobe de novo. Devolve quantas saíram e quantas não deram.
   */
  async encaminhar(
    origem: string,
    mensagens: readonly Uint8Array[],
    destinos: readonly string[],
  ): Promise<{ readonly enviadas: number; readonly falhas: number }> {
    if (destinos.length > LIMITE_DO_ENCAMINHAR) return { enviadas: 0, falhas: mensagens.length };
    const agendaDaOrigem = this.agendaDe(origem);
    const ordem = await agendaDaOrigem.mensagens(origem);
    const escolhidas = new Set(mensagens.map(hex));
    let enviadas = 0;
    let falhas = 0;
    for (const mensagem of ordem.filter((m) => escolhidas.has(hex(m.id)))) {
      const conteudo = await agendaDaOrigem.paraEncaminhar(origem, mensagem.id);
      for (const destino of destinos) {
        const resultado = !conteudo
          ? 'falhou'
          : conteudo.tipo === 'texto'
            ? await this.enviar(destino, conteudo.texto)
            : await this.enviarAnexo(destino, conteudo.arquivo, { legenda: conteudo.legenda });
        if (resultado === 'ok') enviadas++;
        else falhas++;
      }
    }
    return { enviadas, falhas };
  }

  /**
   * Muda o timer da conversa (RF-25): na nota pessoal, só aqui; com um contato, ele recebe o aviso.
   * `anteriores`: as mensagens que já estão na conversa também passam a sumir. Devolve `false` se
   * não deu (sem conexão configurada, pedido ou ID bloqueado).
   */
  async mudarTimer(id: string, segundos: number, anteriores: boolean): Promise<boolean> {
    try {
      const { correio } = this.#lado(id);
      if (id === this.meuId) await this.agenda.mudarTimerDaNota(segundos, anteriores);
      else if (correio) await correio.mudarTimer(id, segundos, anteriores);
      else return false;
    } catch {
      return false;
    }
    this.#mudou(id);
    return true;
  }

  /**
   * Bloqueia ou libera os prints da conversa nos dois celulares (RF-58). Devolve `false` se não
   * deu: nota pessoal, sem conexão configurada, pedido ou ID bloqueado.
   */
  async mudarPrints(id: string, bloqueados: boolean): Promise<boolean> {
    const { correio } = this.#lado(id);
    if (!correio || id === this.meuId) return false;
    try {
      await correio.mudarPrints(id, bloqueados);
    } catch {
      return false;
    }
    this.#avisar();
    return true;
  }

  /**
   * Apaga a conversa nos dois celulares (RF-59). Devolve `false` se não deu: nota pessoal, sem
   * conexão configurada, pedido ou ID bloqueado.
   */
  async apagarConversaParaOsDois(id: string): Promise<boolean> {
    const { correio } = this.#lado(id);
    if (!correio || id === this.meuId) return false;
    try {
      await correio.apagarConversaParaOsDois(id);
    } catch {
      return false;
    }
    this.#esquecerImagens();
    this.#mudou(id);
    return true;
  }

  /**
   * Uma tela de conversa com prints bloqueados abriu (RF-58): a janela fica segura até a função
   * devolvida ser chamada, mesmo com o ajuste geral desligado.
   */
  protegerTela(): () => void {
    this.#telasProtegidas++;
    void this.#aplicarCapturas();
    let ativa = true;
    return () => {
      if (!ativa) return;
      ativa = false;
      this.#telasProtegidas--;
      void this.#aplicarCapturas();
    };
  }

  /** Apaga pra todos (RF-30). Devolve `false` se não deu: nota pessoal, pedido, bloqueado. */
  async apagarParaTodos(id: string, mensagens: readonly Uint8Array[]): Promise<boolean> {
    const { correio } = this.#lado(id);
    if (!correio || id === this.meuId) return false;
    try {
      await correio.apagarParaTodos(id, mensagens);
    } catch {
      return false;
    }
    this.#esquecerImagens();
    this.#avisar();
    return true;
  }

  /**
   * Apaga só neste celular: some na hora e dá alguns segundos para desfazer. Devolve até quando
   * dá, no relógio do aparelho.
   */
  async apagarSoAqui(id: string, mensagens: readonly Uint8Array[]): Promise<number> {
    const ate = await this.agendaDe(id).apagarSoAqui(id, mensagens);
    this.#mudou(id);
    return ate;
  }

  /** Desfaz o apagar só neste celular, se ainda dá. */
  async desfazer(id: string, mensagens: readonly Uint8Array[]): Promise<boolean> {
    const voltou = await this.agendaDe(id).desfazer(id, mensagens);
    if (voltou) this.#avisar();
    return voltou;
  }

  /**
   * A conversa está na tela: as recebidas passam a lidas. Com a confirmação de leitura ligada
   * (RF-17, desligada por padrão), o contato fica sabendo; pedido de conversa e ID bloqueado nunca
   * ficam (RF-07).
   */
  async ler(id: string): Promise<void> {
    if (id === this.meuId) return;
    const { agenda, correio } = this.#lado(id);
    const antes = (await agenda.conversa(id))?.naoLidas ?? 0;
    if (antes === 0) return;
    try {
      if (!correio) throw new Error('sem correio');
      await correio.marcarLidas(id, this.#privacidade.confirmacoesDeLeitura);
    } catch {
      await agenda.marcarLidas(id);
    }
    this.#avisar();
  }

  /** Segundos parado até o app bloquear sozinho (RF-40); o controle lê na hora de contar. */
  get prazoDoBloqueio(): number {
    return this.#privacidade.bloquearSozinho;
  }

  /**
   * Avisa de cada mensagem que chega, de contato ou de pedido, já decifrada: com o app aberto fora
   * da frente, o aviso de mensagem nova sai daqui, e só para mensagem de verdade (RF-42).
   */
  aoChegarMensagem = (ouvinte: () => void): (() => void) => {
    this.#ouvintesDeMensagem.add(ouvinte);
    return () => this.#ouvintesDeMensagem.delete(ouvinte);
  };

  /** Se o contato está escrevendo agora (RF-18). Só com o indicador de digitação ligado. */
  digitando(id: string): boolean {
    return this.#digitando.has(id);
  }

  /** Avisa quando o "digitando" de alguma conversa muda, sem ler a conversa de novo. */
  aoMudarDigitacao = (ouvinte: () => void): (() => void) => {
    this.#ouvintesDaDigitacao.add(ouvinte);
    return () => this.#ouvintesDaDigitacao.delete(ouvinte);
  };

  /**
   * O campo de escrever mudou (RF-18): com o indicador ligado, o contato fica sabendo que você
   * começou a escrever (de novo a cada tanto, enquanto continua) e quando o campo esvazia. Nunca na
   * nota pessoal; pedido e bloqueado o correio recusa.
   */
  escrevendo(id: string, texto: string): void {
    const { correio } = this.#lado(id);
    if (!correio || id === this.meuId || !this.#privacidade.indicadorDeDigitacao) return;
    const agora = Date.now();
    const desde = this.#escrevendo.get(id);
    if (texto.trim() === '') {
      if (desde === undefined) return;
      this.#escrevendo.delete(id);
      void correio.sinalizarDigitacao(id, false);
      return;
    }
    if (desde !== undefined && agora - desde < REPETICAO_DO_DIGITANDO) return;
    this.#escrevendo.set(id, agora);
    void correio.sinalizarDigitacao(id, true);
  }

  /**
   * A pessoa saiu da conversa (ou mandou a mensagem): o contato fica sabendo que parou, se ainda
   * havia algo no campo. Depois de mandar, a mensagem que chega já apaga o sinal do outro lado.
   */
  parouDeEscrever(id: string, mandou = false): void {
    if (!this.#escrevendo.delete(id) || mandou) return;
    void this.#lado(id).correio?.sinalizarDigitacao(id, false);
  }

  /** Os ajustes de privacidade (RF-17, RF-18, RF-40, RF-41), como estão agora. */
  get privacidade(): AjustesDePrivacidade {
    return this.#privacidade;
  }

  /** Muda os ajustes de privacidade. O bloqueio de prints vale na hora (RF-41). */
  async mudarPrivacidade(mudanca: Partial<AjustesDePrivacidade>): Promise<void> {
    await this.agenda.mudarAjustesDePrivacidade(mudanca);
    this.#privacidade = { ...this.#privacidade, ...mudanca };
    await this.#cofre?.cofre.copiarAjustes().catch(() => undefined);
    if (mudanca.bloquearCapturas !== undefined) await this.#aplicarCapturas();
    this.#avisar();
  }

  /**
   * Copia um texto marcado como sensível, que sai da área de transferência sozinho: o próprio ID
   * (RF-45) ou o número de segurança. Devolve `false` sem como copiar.
   */
  async copiarTexto(texto: string): Promise<boolean> {
    const { midia } = this.#o;
    if (!midia || texto === '') return false;
    await midia.copiar(texto);
    return true;
  }

  /**
   * Exporta o backup (RF-46): os contatos, os bloqueados, os timers e os ajustes do banco principal,
   * com o tema e o idioma, cifrados com a chave que sai das palavras. O "salvar como" do sistema abre
   * sem bloquear o app.
   */
  async exportarBackup(
    preferencias: PreferenciasDoBackup,
    nome: string,
  ): Promise<ResultadoDoBackup> {
    const { midia } = this.#o;
    if (!midia) return 'falhou';
    try {
      const arquivo = await this.agenda.exportarBackup(preferencias);
      const salvar = () => midia.salvarArquivo(arquivo, nome);
      const salvou = await (this.#o.semBloquear ? this.#o.semBloquear(salvar) : salvar());
      return salvou ? 'salvo' : 'cancelado';
    } catch {
      return 'falhou';
    }
  }

  /**
   * Muda um contato pela agenda do banco onde a conversa `id` está, ou, sem `id`, um ajuste do
   * principal (que o cofre copia), e avisa as telas.
   */
  async mudar(acao: (agenda: Agenda) => Promise<unknown>, id?: string): Promise<void> {
    if (id === undefined) {
      await acao(this.agenda);
      await this.#cofre?.cofre.copiarAjustes().catch(() => undefined);
    } else {
      await acao(this.agendaDe(id));
    }
    this.#mudou(id);
  }

  /** A foto ou capa guardada para a tela; se não está, abre e guarda, até o limite. */
  async #imagemGuardada(
    chave: string,
    abrir: () => Promise<string | null>,
  ): Promise<string | null> {
    const guardada = this.#imagens.get(chave);
    if (guardada !== undefined) {
      // Usada agora: vai para o fim da fila.
      this.#imagens.delete(chave);
      this.#imagens.set(chave, guardada);
      return guardada;
    }
    const aberta = await abrir();
    if (aberta === null) return null;
    this.#imagens.set(chave, aberta);
    this.#tamanhoDasImagens += aberta.length;
    for (const [antiga, endereco] of this.#imagens) {
      if (this.#tamanhoDasImagens <= LIMITE_DAS_IMAGENS || antiga === chave) break;
      this.#imagens.delete(antiga);
      this.#tamanhoDasImagens -= endereco.length;
    }
    return aberta;
  }

  #esquecerImagens(): void {
    this.#imagens.clear();
    this.#tamanhoDasImagens = 0;
  }

  /** Algo pode ter ganhado prazo: a limpeza confere, e as telas leem de novo. */
  #mudou(id?: string): void {
    (id === undefined ? this.#o.temporarias : this.#lado(id).temporarias).conferir();
    this.#avisar();
  }

  #contatoDigitando(conversa: string, digitando: boolean): void {
    const antes = this.#digitando.get(conversa);
    if (!digitando && !antes) return;
    antes?.();
    this.#digitando.delete(conversa);
    if (digitando && this.#privacidade.indicadorDeDigitacao && !this.#parado) {
      const timer = setTimeout(() => {
        if (this.#digitando.delete(conversa)) this.#avisarDigitacao();
      }, DURACAO_DO_DIGITANDO);
      this.#digitando.set(conversa, () => {
        clearTimeout(timer);
      });
    }
    this.#avisarDigitacao();
  }

  #avisarDigitacao(): void {
    for (const ouvinte of [...this.#ouvintesDaDigitacao]) ouvinte();
  }

  async #lerPrivacidade(): Promise<void> {
    try {
      this.#privacidade = await this.agenda.ajustesDePrivacidade();
    } catch {
      // Sem ler, ficam os padrões, que são os mais fechados para prints.
    }
    await this.#aplicarCapturas();
    this.#avisar();
  }

  /**
   * A janela segue o ajuste de prints só com a sessão aberta, e fica segura enquanto houver tela de
   * conversa com prints bloqueados (RF-58).
   */
  async #aplicarCapturas(): Promise<void> {
    if (this.#parado) return;
    const segura = this.#privacidade.bloquearCapturas || this.#telasProtegidas > 0;
    await this.#o.tela?.definirSegura(segura).catch(() => undefined);
  }

  #avisar(): void {
    this.#versao++;
    for (const ouvinte of [...this.#ouvintes]) ouvinte();
  }
}
