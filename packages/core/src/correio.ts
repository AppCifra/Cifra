// O correio do app (RF-04 a RF-08, RF-13 a RF-16). Publica e renova o cartão, abre a própria caixa
// e guarda o que chega, cifra o que sai e entrega a fila ao relay, com reenvio em intervalos
// crescentes.
//
// Conexões (SPEC, "Envelope, padding e remetente oculto"):
// - a da caixa abre a caixa principal e publica o cartão; as duas coisas já se ligam pelo cartão;
// - cada contato tem a sua conexão de depósito, num circuito próprio do Tor, por onde passam a
//   busca do cartão dele e os pacotes para ele. O relay não liga quem deposita a quem recebe, nem
//   duas conversas da mesma pessoa.
//
// Um aparelho por ID (RF-05): quando outro aparelho restaura a identidade, o relay troca a caixa
// do cartão e apaga a deste. Este aparelho fica sabendo pelo aviso do relay, pela recusa ao
// renovar o cartão ou pela caixa que sumiu com o cartão apontando outra; aí para de vez e guarda
// isso no banco. Do outro lado, quem escreve para um contato que trocou de aparelho acha a caixa
// nova no cartão e recomeça a sessão com ele.
//
// Banco e catraca mudam um de cada vez (uma operação exclusiva por vez, a mesma da agenda), e
// nunca durante uma espera de rede: a rede pelo Tor leva segundos.
//
// Temporárias e apagar pra todos: o texto sai com o timer da conversa ou um menor (RF-26), a
// mudança do timer vai ao contato (RF-25) e apagar pra todos manda o contato apagar as dele
// (RF-30). Tudo entra na mesma fila, na ordem da conversa.
//
// Anexos: o blob sobe ao relay, por HTTP, no circuito de depósito do contato, antes de a mensagem
// que o abre sair; um envio por vez, fora da rodada de entrega (um vídeo pelo Tor leva minutos, e
// as outras conversas não esperam por ele). O que chega baixa sozinho (RF-57), um por vez, num
// circuito só dos anexos (nunca no de depósito de quem enviou: ligaria as duas conversas). Depois
// de conferido, o relay apaga (RF-35). O anexo de um pedido de conversa só baixa depois de aceito.
// A pessoa pode cancelar uma transferência no meio.
//
// Conversas ocultas: o cofre tem um correio só dele, desta mesma classe, sem caixa principal. Ele
// não publica cartão e abre a caixa de cada conversa oculta, cada uma no seu circuito; os circuitos
// dele têm prefixo próprio, e nada dele passa pelos do principal. O contato fica sabendo da caixa
// nova por um aviso de caixa, e escreve para ela. A fila de cada contato só sai depois que a caixa
// por onde ele escreve ficou em dia nesta conexão: um aviso de caixa nova que esperava lá é lido
// antes, e o que sai vai para a caixa certa.
//
// Backup: o contato que voltou do backup na restauração não tem sessão. O primeiro envio para ele
// busca o cartão e abre a sessão na hora, como "Nova conversa".
import {
  formatarId,
  iguais,
  idDaChave,
  idDoCartao,
  cartaoAutentico,
  JANELA_DE_ENTREGA,
  lerId,
  MAXIMO_DE_LIDAS,
  mensagemDaAbertura,
  paraHex,
  BYTES_DO_ID_DA_MENSAGEM,
  enderecoDoAnexo,
  tamanhoDoAnexo,
  type Cartao,
} from '@cifra/protocol';
import {
  anexoConfere,
  decifrarAnexo,
  prepararAnexo,
  type ArquivoParaEnviar,
} from './anexos/cifra.ts';
import {
  adiarAnexo,
  anexoDe,
  anexosDoPedidoAceito,
  anexosPendentes,
  anexosTentamAgora,
  blobDe,
  guardarBaixado,
  mudarEstadoDoAnexo,
  type Anexo,
} from './anexos/repositorio.ts';
import { criarExclusivo, type Exclusivo } from './banco/exclusivo.ts';
import {
  apagarPrekeysVencidas,
  confirmarPublicacao,
  descartarPublicacao,
  estadoDoCartao,
  estaSubstituido,
  marcarCaixaCriada,
  marcarSubstituido,
  planejarPublicacao,
  planejarReposicao,
  prepararPublicacao,
  type PlanoDePublicacao,
} from './cartao/publicacao.ts';
import { aceitarContato, contatoDe, type Contato } from './contatos/repositorio.ts';
import type { Identidade } from './identidade/identidade.ts';
import {
  apagarConversaParaOsDois,
  apagarParaOsDois,
  Bloqueado,
  cifrarAvisoDeCaixa,
  cifrarDigitacao,
  enfileirarAnexo,
  enfileirarAvisoDeCaixa,
  enfileirarConteudo,
  enfileirarTexto,
  mudarPrintsDaConversa,
  mudarTimerDaConversa,
  NaoAceito,
  receberPacote,
  recomecarComAparelhoNovo,
  SemSessao,
  TimerInvalido,
  type Contexto,
  type Recebimento,
} from './mensagens/correspondencia.ts';
import {
  adiar,
  intervaloDeReenvio,
  itensDaFila,
  MAIOR_INTERVALO,
  naFila,
  proximaTentativa,
  tentarDeNovo,
  tentarTudoAgora,
  tirarDaFila,
  type ItemDaFila,
} from './mensagens/fila.ts';
import {
  legendaAceita,
  lerRecebidas,
  mensagensDa,
  mudarStatus,
  textoAceito,
  type Mensagem,
  type StatusDaMensagem,
} from './mensagens/repositorio.ts';
import { aplicarTimerPadrao } from './mensagens/temporarias.ts';
import { caixasOcultas, sementeDaCaixaOculta } from './ocultas/repositorio.ts';
import type { Armazenamento } from './portas/armazenamento.ts';
import type { Cripto } from './portas/cripto.ts';
import type { Relogio } from './portas/relogio.ts';
import type { PedidoHttp, RespostaHttp, Transporte } from './portas/transporte.ts';
import { ConexaoComORelay, type Aviso, type Resposta } from './relay/conexao.ts';
import { selarMarca } from './relay/marca.ts';
import type { GerarPar } from './sessao/catraca.ts';
import {
  destinoDe,
  guardarDestino,
  guardarSessoes,
  marcarDestinoDesatualizado,
  sessoesDe,
} from './sessao/repositorio.ts';
import { sessaoDeQuemAbre } from './sessao/sessao.ts';

/** O circuito da conexão da caixa. Os de depósito são sorteados por contato a cada execução. */
export const CIRCUITO_DA_CAIXA = 'caixa';

/**
 * O prefixo dos circuitos do correio do cofre: a caixa de cada conversa oculta, os depósitos, os
 * anexos e a criação de caixa nunca passam por um circuito do principal.
 */
export const PREFIXO_DO_COFRE = 'oculta-';

/** Quanto o aviso de caixa espera a caixa por onde o contato escreve ficar em dia. */
const ESPERA_DO_AVISO = 20_000;

/** Tentativas de depositar o aviso de caixa, sempre com os mesmos bytes. */
const TENTATIVAS_DO_AVISO = 3;

/** Com a caixa aberta, confere a cada hora se o cartão precisa ser renovado. */
const CONFERENCIA_DO_CARTAO = 3_600_000;

/** Falhas ao guardar o mesmo pacote recebido antes de descartá-lo. */
const FALHAS_ANTES_DE_DESCARTAR = 3;

/**
 * Tentativas de buscar o cartão ao iniciar uma conversa. O circuito novo do Tor para o contato pode
 * falhar na primeira, com a caixa conectada: o correio tenta de novo antes de dizer que não deu.
 */
const TENTATIVAS_AO_INICIAR = 3;

/** O circuito dos anexos que chegam: nunca o de depósito de quem enviou. */
export const CIRCUITO_DOS_ANEXOS = 'anexos';

/** A resposta do relay a um PUT ou DELETE não tem corpo. */
const LIMITE_SEM_CORPO = 1024;

/** O progresso de uma transferência é avisado a cada tanto, não a cada pedaço. */
const PASSO_DO_PROGRESSO = 0.05;

export interface OpcoesDoEnvio {
  /** Segundos; sem ele, o timer da conversa (RF-26). */
  readonly ttl?: number;
  /** O ID da mensagem respondida (RF-55). */
  readonly resposta?: Uint8Array;
  /** Só no anexo: a legenda, até 2000 bytes. */
  readonly legenda?: string;
}

export interface OpcoesDoCorreio {
  readonly cripto: Cripto;
  readonly banco: Armazenamento;
  readonly transporte: Transporte;
  readonly relogio: Relogio;
  readonly identidade: Identidade;
  /**
   * Semente (32 bytes) do par Ed25519 da caixa principal. Continua de quem chama, que a zera depois
   * de parar o correio. Sem ela, é o correio do cofre das conversas ocultas: não publica cartão e
   * abre a caixa de cada conversa oculta, com a semente guardada no cofre.
   */
  readonly sementeDaCaixa?: Uint8Array;
  /** O endereço do relay: vai no cartão, e é onde o correio conecta. */
  readonly relay: string;
  /** O acesso ao banco dividido com a agenda. Sem ele, o correio usa um só dele. */
  readonly exclusivo?: Exclusivo;
  /** Só nos testes e vetores: o sorteio dos pares X25519. */
  readonly gerarPar?: GerarPar;
}

export type EventoDoCorreio =
  /** `semTor`: a caixa não abriu porque o Tor (Orbot) não está ligado no aparelho (RF-44). */
  | { readonly tipo: 'caixa'; readonly aberta: boolean; readonly semTor?: boolean }
  | { readonly tipo: 'cartao'; readonly prekeysNoRelay: number }
  /** `pedido`: de quem não é contato aceito (RF-07). */
  | {
      readonly tipo: 'mensagem';
      readonly conversa: string;
      readonly id: Uint8Array;
      readonly pedido: boolean;
    }
  | {
      readonly tipo: 'status';
      readonly conversa: string;
      readonly id: Uint8Array;
      readonly status: StatusDaMensagem;
    }
  /** Chegou uma mensagem já vencida: o conteúdo não ficou, só a nota (RF-28). */
  | { readonly tipo: 'expirada'; readonly conversa: string; readonly pedido: boolean }
  /** O contato apagou pra todos, e estas mensagens saíram daqui (RF-30). */
  | { readonly tipo: 'apagadas'; readonly conversa: string; readonly ids: readonly Uint8Array[] }
  /** O contato mudou o timer da conversa (RF-25). */
  | { readonly tipo: 'timer'; readonly conversa: string; readonly segundos: number }
  /** O contato bloqueou ou liberou os prints da conversa (RF-58). */
  | { readonly tipo: 'prints'; readonly conversa: string; readonly bloqueados: boolean }
  /** O contato apagou a conversa nos dois celulares, e ela saiu daqui (RF-59). */
  | { readonly tipo: 'conversaApagada'; readonly conversa: string }
  /** O contato está escrevendo, ou parou (RF-18). Só o que chega com a caixa em dia. */
  | { readonly tipo: 'digitando'; readonly conversa: string; readonly digitando: boolean }
  /** O anexo subiu, baixou ou não está mais disponível. */
  | { readonly tipo: 'anexo'; readonly conversa: string; readonly id: Uint8Array }
  /** Quanto do anexo já foi ou veio, de 0 a 1. */
  | {
      readonly tipo: 'progresso';
      readonly conversa: string;
      readonly id: Uint8Array;
      readonly fracao: number;
    }
  /** A identidade foi restaurada em outro aparelho, e este parou de vez (RF-05). */
  | { readonly tipo: 'substituido' };

/**
 * O que quem chama pode mostrar. Nenhum traz endereço, chave ou conteúdo.
 * - `id-invalido`: o texto não é um ID; `proprio-id`: é o desta identidade (a nota pessoal não sai
 *   do aparelho, RF-19).
 * - `sem-sessao`: ainda não há conversa com o ID; o cartão dele precisa ser buscado antes.
 * - `nao-aceito`: o ID é um pedido de conversa: aceite antes de responder (RF-07).
 * - `bloqueado`: o ID está bloqueado; desbloqueie antes (RF-08).
 * - `texto-invalido`: vazio, acima de 3500 bytes ou com caractere que não existe; ou legenda acima
 *   de 2000 bytes.
 * - `anexo-invalido`: o arquivo passa do limite, ou o formato não é um dos aceitos.
 * - `timer-invalido`: fora de 10 s a 7 dias, ou acima do timer da conversa (RF-26).
 * - `relay-inacessivel`: sem conexão com o relay agora.
 * - `cartao-inexistente`, `cartao-invalido`: o relay não tem cartão para o ID, ou o que ele
 *   entregou não confere (assinatura ou hash).
 * - `relay-recusou`: o relay respondeu outra coisa, como limite de taxa; tente depois.
 * - `substituido`: a identidade está em outro aparelho, e este não conecta mais (RF-05).
 */
export type CodigoDoCorreio =
  | 'id-invalido'
  | 'proprio-id'
  | 'sem-sessao'
  | 'nao-aceito'
  | 'bloqueado'
  | 'texto-invalido'
  | 'anexo-invalido'
  | 'timer-invalido'
  | 'relay-inacessivel'
  | 'cartao-inexistente'
  | 'cartao-invalido'
  | 'relay-recusou'
  | 'substituido';

export class ErroDoCorreio extends Error {
  readonly codigo: CodigoDoCorreio;

  constructor(codigo: CodigoDoCorreio) {
    super(codigo);
    this.codigo = codigo;
  }
}

/** Outro aparelho restaurou a identidade: este para de vez. */
class Substituido extends Error {}

function ok(resposta: Resposta): boolean {
  return resposta.tipo === 'resposta' && resposta.codigo === 'ok';
}

function codigoDe(resposta: Resposta): string {
  return resposta.tipo === 'resposta' ? resposta.codigo : resposta.tipo;
}

/** Uma caixa que o correio abre: a principal, ou a de uma conversa oculta, no cofre. */
interface EstadoDaCaixa {
  readonly publica: Uint8Array;
  /** Na caixa oculta, o contato da conversa; na principal, `null`. */
  readonly contato: Uint8Array | null;
  readonly circuito: string;
  conexao: ConexaoComORelay | null;
  /**
   * O relay já entregou o que esperava na caixa nesta conexão. Só daí em diante sai a fila de quem
   * escreve por ela, e o "digitando" que chega é de agora; o de antes é velho e não aparece (RF-18).
   */
  emDia: boolean;
  conectando: boolean;
  tentativas: number;
  cancelarReconexao: (() => void) | null;
  /** A conversa deixou de ser oculta: a caixa não abre mais. */
  removida: boolean;
  /**
   * O relay avisou que a caixa foi substituída: a próxima reconexão é na hora, para conferir pelo
   * próprio cartão, em vez de esperar o intervalo.
   */
  conferirAgora: boolean;
  /** Quando veio o último aviso de substituição; um relay que repete o aviso espera o intervalo. */
  avisadoEm: number | null;
}

function novaCaixa(
  publica: Uint8Array,
  contato: Uint8Array | null,
  circuito: string,
): EstadoDaCaixa {
  return {
    publica,
    contato,
    circuito,
    conexao: null,
    emDia: false,
    conectando: false,
    tentativas: 0,
    cancelarReconexao: null,
    removida: false,
    conferirAgora: false,
    avisadoEm: null,
  };
}

/**
 * As confirmações de uma conexão da caixa, em lote. O que entra enquanto uma confirmação está a
 * caminho espera e vai junto na seguinte: uma ida e volta pelo Tor serve a vários pacotes, e o
 * relay recebe bem menos pedidos do que a taxa dele aceita.
 */
interface Confirmacoes {
  /** Pacotes que chegaram e ainda não terminaram de entrar. */
  esperando: number;
  /** Os que entraram (ou foram descartados) e falta confirmar. */
  readonly ids: Uint8Array[];
  /** Uma confirmação saiu, e a resposta ainda não voltou. */
  aCaminho: boolean;
}

/** A caixa para onde vai a conversa com o contato. */
interface CaixaDoContato {
  readonly caixa: Uint8Array;
  /** A caixa que o contato pediu para a conversa (uma oculta, do lado dele), e não a do cartão. */
  readonly daConversa: boolean;
}

/** A caixa que o contato pediu para a conversa ou, sem pedido, a do cartão dele. */
function caixaDoContato(situacao: Contato | null, cartao: Cartao): CaixaDoContato {
  return situacao?.caixa
    ? { caixa: situacao.caixa, daConversa: true }
    : { caixa: cartao.caixaPrincipal, daConversa: false };
}

export class Correio {
  readonly #o: OpcoesDoCorreio;
  readonly #contexto: Contexto;
  /**
   * A chave pública da caixa principal; `null` no correio do cofre. A privada só existe enquanto
   * assina a abertura.
   */
  readonly #caixa: Uint8Array | null;
  readonly #meuId: Uint8Array;
  #parado = true;
  /** A identidade foi restaurada em outro aparelho: este não conecta nem envia mais (RF-05). */
  #substituido = false;

  /** As caixas que este correio abre, pela chave pública em hex. */
  readonly #caixas = new Map<string, EstadoDaCaixa>();
  /** Quantas caixas ocultas e criações de caixa já pediram circuito nesta execução. */
  #circuitosDeCaixa = 0;
  #cancelarConferencia: (() => void) | null = null;
  /** Quem espera uma caixa ficar em dia (o aviso de caixa) é chamado a cada mudança. */
  readonly #esperasDaCaixa = new Set<() => void>();

  /** Conexão de depósito de cada contato (ID em hex), já aberta ou abrindo. */
  readonly #depositos = new Map<string, Promise<ConexaoComORelay>>();
  /** Circuito de cada contato nesta execução: nunca o ID, só um número. */
  readonly #circuitos = new Map<string, string>();

  /** Uma operação de banco por vez, na mesma vez da agenda. */
  readonly #exclusivo: Exclusivo;
  /** Os pacotes que chegam são processados um de cada vez, na ordem. */
  #recebimentos: Promise<void> = Promise.resolve();
  /** Falhas ao guardar cada pacote recebido (ID do relay em hex), nesta execução. */
  readonly #falhasAoReceber = new Map<string, number>();
  #entregando = false;
  #entregarDeNovo = false;
  #cancelarEntrega: (() => void) | null = null;

  readonly #ouvintes = new Set<(evento: EventoDoCorreio) => void>();

  /** Um envio de anexo por vez: cada um passa pela memória inteiro. */
  #envios: Promise<unknown> = Promise.resolve();
  /** Os anexos subindo (ID da mensagem em hex), com o contato de cada um. */
  readonly #subindo = new Map<string, Uint8Array>();
  /** As transferências de anexo a caminho (ID da mensagem em hex) e o que cancela cada uma. */
  readonly #transferencias = new Map<string, () => void>();
  /** A rodada de downloads em andamento. */
  #baixando: Promise<void> | null = null;
  #baixarDeNovo = false;
  #cancelarDownloads: (() => void) | null = null;

  constructor(opcoes: OpcoesDoCorreio) {
    this.#o = opcoes;
    this.#exclusivo = opcoes.exclusivo ?? criarExclusivo();
    const { cripto } = opcoes;
    this.#contexto = {
      cripto,
      identidade: opcoes.identidade,
      gerarPar: opcoes.gerarPar ?? (() => cripto.crypto_box_keypair()),
    };
    const semente = opcoes.sementeDaCaixa;
    if (semente) {
      const caixa = cripto.crypto_sign_seed_keypair(semente);
      cripto.memzero(caixa.privateKey);
      this.#caixa = caixa.publicKey;
      this.#caixas.set(
        paraHex(caixa.publicKey),
        novaCaixa(caixa.publicKey, null, CIRCUITO_DA_CAIXA),
      );
    } else {
      this.#caixa = null;
    }
    this.#meuId = idDaChave(cripto, opcoes.identidade.assinatura.publicKey);
  }

  /**
   * Conecta, publica o cartão, abre a caixa e entrega a fila. Reconecta sozinho quando cai. Se a
   * identidade já foi restaurada em outro aparelho, só avisa (`substituido`) e não conecta. No cofre,
   * abre a caixa de cada conversa oculta.
   */
  iniciar(): void {
    if (!this.#parado || this.#substituido) return;
    this.#parado = false;
    void this.#comecar();
  }

  /** Fecha as conexões e espera o que estava no meio terminar. */
  async parar(): Promise<void> {
    this.#parado = true;
    this.#cancelarConferencia?.();
    this.#cancelarConferencia = null;
    this.#cancelarEntrega?.();
    this.#cancelarEntrega = null;
    this.#cancelarDownloads?.();
    this.#cancelarDownloads = null;
    for (const cancelar of [...this.#transferencias.values()]) cancelar();
    const conexoes: ConexaoComORelay[] = [];
    for (const estado of this.#caixas.values()) {
      estado.cancelarReconexao?.();
      estado.cancelarReconexao = null;
      if (estado.conexao) conexoes.push(estado.conexao);
      estado.conexao = null;
      estado.emDia = false;
    }
    conexoes.push(
      ...(await Promise.allSettled(this.#depositos.values()))
        .filter((r) => r.status === 'fulfilled')
        .map((r) => r.value),
    );
    this.#depositos.clear();
    this.#mudouACaixa();
    await Promise.all(conexoes.map((conexao) => conexao.fechar()));
    await this.#recebimentos;
    await this.#envios;
    await this.#baixando;
    await this.#exclusivo(() => Promise.resolve());
  }

  /** O relay pode ter algo novo para este correio: entrega a fila e baixa o que espera, agora. */
  conferir(): void {
    void this.#entregar();
    this.#baixar();
  }

  /**
   * No cofre: lê de novo as conversas ocultas, abre a caixa das novas e fecha a das que deixaram de
   * ser ocultas.
   */
  async conferirCaixas(): Promise<void> {
    if (this.#caixa) return;
    await this.#lerCaixas();
    if (this.#estaParado()) return;
    for (const estado of this.#caixas.values()) void this.#conectarCaixa(estado);
    void this.#entregar();
  }

  /**
   * Cria no relay a caixa de uma conversa oculta, pela semente dela, numa conexão nova, num
   * circuito só para isso, que fecha em seguida: o relay não liga a caixa nova a nada. Tenta de
   * novo num circuito novo, até três vezes, antes de lançar `relay-inacessivel`.
   */
  async criarCaixa(semente: Uint8Array): Promise<void> {
    this.#exigirAtivo();
    const { cripto, transporte, relay, relogio } = this.#o;
    const par = cripto.crypto_sign_seed_keypair(semente);
    cripto.memzero(par.privateKey);
    for (let tentativa = 1; ; tentativa++) {
      let conexao: ConexaoComORelay | null = null;
      try {
        conexao = await ConexaoComORelay.abrir(
          transporte,
          relay,
          `${PREFIXO_DO_COFRE}nova-${String(++this.#circuitosDeCaixa)}`,
          relogio,
        );
        if (ok(await conexao.pedir({ tipo: 'criar-caixa', caixa: par.publicKey }))) return;
      } catch {
        // A rede caiu ou o circuito não abriu: tenta de novo.
      } finally {
        await conexao?.fechar();
      }
      if (tentativa >= TENTATIVAS_AO_INICIAR || this.#estaParado()) {
        throw new ErroDoCorreio('relay-inacessivel');
      }
      await this.#esperar(intervaloDeReenvio(tentativa));
    }
  }

  /**
   * Avisa o contato que a conversa vai, daqui em diante, para `caixa` (a de uma conversa oculta)
   * ou, com `null`, para a caixa do cartão. `enviadaEm` é a hora da mudança: do outro lado vale a
   * mais nova. Antes, espera a caixa por onde o contato escreve ficar em dia: o que ele mandou já
   * chegou, e o aviso diz até onde. Deposita direto na conexão dele, sem fila, e só volta quando o
   * relay aceitou; senão lança `relay-inacessivel`. Só para contato aceito e não bloqueado.
   */
  async avisarCaixa(id: string, caixa: Uint8Array | null, enviadaEm: number): Promise<void> {
    this.#exigirAtivo();
    const contato = this.#contato(id);
    await this.#esperarEmDia(contato);
    const { cripto } = this.#o;
    let pacote: Uint8Array | null = null;
    for (let tentativa = 1; ; tentativa++) {
      try {
        const conexao = await this.#deposito(contato);
        let destino = await this.#caixaDe(contato, conexao);
        if (destino === 'refeita') {
          // O contato trocou de aparelho: o aviso sai na sessão nova.
          pacote = null;
          destino = await this.#caixaDe(contato, conexao);
        }
        if (destino && destino !== 'refeita') {
          pacote ??= await this.#naFila((t) =>
            cifrarAvisoDeCaixa(this.#contexto, t, contato, caixa, enviadaEm),
          );
          // Os mesmos bytes a cada tentativa: o relay não duplica o que já tinha aceitado.
          const resposta = await conexao.pedir({
            tipo: 'depositar',
            caixa: destino.caixa,
            pacote,
            marca: selarMarca(cripto, destino.caixa, false),
          });
          if (ok(resposta)) return;
        }
      } catch (erro) {
        if (erro instanceof ErroDoCorreio) throw erro;
        // A rede caiu: tenta de novo.
      }
      if (tentativa >= TENTATIVAS_DO_AVISO || this.#estaParado()) {
        throw new ErroDoCorreio('relay-inacessivel');
      }
      await this.#esperar(intervaloDeReenvio(tentativa));
    }
  }

  /**
   * O aviso de caixa pela fila: para repetir um aviso que pode não ter chegado, ou desfazer um. Sai
   * na ordem da conversa, com o resto da fila.
   */
  async enfileirarAvisoDeCaixa(
    id: string,
    caixa: Uint8Array | null,
    enviadaEm: number,
  ): Promise<void> {
    this.#exigirAtivo();
    const contato = this.#contato(id);
    await this.#naFila((t, agora) =>
      enfileirarAvisoDeCaixa(this.#contexto, t, contato, caixa, enviadaEm, agora),
    );
    void this.#entregar();
  }

  /** Registra quem é avisado do que muda. Devolve a função que cancela. */
  aoMudar(ouvinte: (evento: EventoDoCorreio) => void): () => void {
    this.#ouvintes.add(ouvinte);
    return () => this.#ouvintes.delete(ouvinte);
  }

  /**
   * Adiciona o contato (RF-06): busca o cartão, confere hash e assinaturas e abre a sessão (X3DH).
   * Precisa do relay; com a sessão aberta, o resto funciona sem rede. Se a sessão já existe (um
   * pedido de conversa, por exemplo), só aceita o contato. ID bloqueado é recusado. A conversa nova
   * começa com o timer padrão (RF-50); o contato só fica sabendo dele com a primeira mensagem.
   */
  async iniciarConversa(id: string): Promise<void> {
    this.#exigirAtivo();
    const contato = this.#contato(id);
    const { banco } = this.#o;
    const [situacao, sessoes] = await this.#exclusivo(async () => [
      await contatoDe(banco, contato),
      await sessoesDe(banco, contato),
    ]);
    if (situacao?.bloqueado) throw new ErroDoCorreio('bloqueado');
    if (sessoes.length > 0) {
      await this.#exclusivo(() => banco.transacao((t) => this.#aceitar(t, contato)));
      this.#baixar();
      return;
    }
    await this.#abrirSessao(contato, (t) => this.#aceitar(t, contato));
  }

  /**
   * Cifra o texto e põe na fila; ele sai quando o relay estiver ao alcance (RF-13, RF-15).
   * Devolve o ID da mensagem, que fica pendente até o relay aceitar (RF-14). Só para contato
   * aceito e não bloqueado. Sem `ttl`, vai com o timer da conversa; com, em segundos, ele não passa
   * do timer da conversa (RF-26).
   */
  async enviarTexto(
    id: string,
    texto: string,
    ttl?: number,
    resposta?: Uint8Array,
  ): Promise<Uint8Array> {
    this.#exigirAtivo();
    const contato = this.#contato(id);
    if (!textoAceito(texto)) throw new ErroDoCorreio('texto-invalido');
    const mensagem = this.#o.cripto.randombytes_buf(BYTES_DO_ID_DA_MENSAGEM);
    await this.#comSessao(contato, () =>
      this.#naFila((t, agora) =>
        enfileirarTexto(
          this.#contexto,
          t,
          contato,
          {
            id: mensagem,
            texto,
            ...(ttl === undefined ? {} : { ttl }),
            ...(resposta ? { resposta } : {}),
          },
          agora,
        ),
      ),
    );
    this.#emitir({
      tipo: 'status',
      conversa: formatarId(contato),
      id: mensagem,
      status: 'pendente',
    });
    void this.#entregar();
    return mensagem;
  }

  /**
   * Cifra o arquivo com chave nova e põe a mensagem na fila; o blob sobe ao relay antes dela sair
   * (RF-32 a RF-35). Devolve o ID da mensagem, pendente até o relay aceitar. Como no texto: só
   * para contato aceito e não bloqueado, com o timer da conversa ou um menor.
   */
  async enviarAnexo(
    id: string,
    arquivo: ArquivoParaEnviar,
    opcoes: OpcoesDoEnvio = {},
  ): Promise<Uint8Array> {
    this.#exigirAtivo();
    const contato = this.#contato(id);
    const legenda = opcoes.legenda ?? '';
    if (!legendaAceita(legenda)) throw new ErroDoCorreio('texto-invalido');
    // A cifra roda fora da vez do banco: o correio não espera por ela.
    const preparado = prepararAnexo(this.#o.cripto, arquivo);
    if (!preparado) throw new ErroDoCorreio('anexo-invalido');
    const mensagem = this.#o.cripto.randombytes_buf(BYTES_DO_ID_DA_MENSAGEM);
    await this.#comSessao(contato, () =>
      this.#naFila((t, agora) =>
        enfileirarAnexo(
          this.#contexto,
          t,
          contato,
          {
            id: mensagem,
            ...preparado,
            legenda,
            ...(opcoes.ttl === undefined ? {} : { ttl: opcoes.ttl }),
            ...(opcoes.resposta ? { resposta: opcoes.resposta } : {}),
          },
          agora,
        ),
      ),
    );
    this.#emitir({
      tipo: 'status',
      conversa: formatarId(contato),
      id: mensagem,
      status: 'pendente',
    });
    void this.#entregar();
    return mensagem;
  }

  /**
   * Confere os anexos que esperam baixar: depois de aceitar um pedido de conversa, ou quando a
   * pessoa toca num que tinha parado.
   */
  conferirAnexos(): void {
    this.#baixar();
  }

  /**
   * Derruba a transferência do anexo da mensagem, se houver uma a caminho: a pessoa cancelou o
   * download (`Agenda.pararDownload`) ou o envio (`Agenda.cancelarEnvio`).
   */
  cancelarTransferencia(mensagem: Uint8Array): void {
    this.#transferencias.get(paraHex(mensagem))?.();
  }

  /**
   * Muda o timer das mensagens temporárias da conversa (RF-25). O contato recebe o aviso e passa a
   * usar o mesmo; o limite novo chega às mensagens que já estão na conversa, contado de agora, e
   * com `anteriores` as sem timer também passam a sumir. Só para contato aceito e não bloqueado.
   * Devolve `false` se nada mudou.
   */
  async mudarTimer(id: string, segundos: number, anteriores: boolean): Promise<boolean> {
    this.#exigirAtivo();
    const contato = this.#contato(id);
    const mudou = await this.#comSessao(contato, () =>
      this.#naFila((t, agora) =>
        mudarTimerDaConversa(this.#contexto, t, contato, { segundos, anteriores }, agora),
      ),
    );
    if (mudou) void this.#entregar();
    return mudou;
  }

  /**
   * Bloqueia ou libera os prints da conversa nos dois celulares (RF-58): a nota entra aqui e o
   * contato recebe o aviso. Só para contato aceito e não bloqueado. Devolve `false` se nada mudou.
   */
  async mudarPrints(id: string, bloqueados: boolean): Promise<boolean> {
    this.#exigirAtivo();
    const contato = this.#contato(id);
    const mudou = await this.#comSessao(contato, () =>
      this.#naFila((t, agora) =>
        mudarPrintsDaConversa(this.#contexto, t, contato, bloqueados, agora),
      ),
    );
    if (mudou) void this.#entregar();
    return mudou;
  }

  /**
   * Apaga a conversa nos dois celulares (RF-59): aqui sai tudo na hora; o contato recebe o pedido e
   * apaga lá, quando estiver no ar. Só para contato aceito e não bloqueado.
   */
  async apagarConversaParaOsDois(id: string): Promise<void> {
    this.#exigirAtivo();
    const contato = this.#contato(id);
    await this.#comSessao(contato, () =>
      this.#naFila((t, agora) => apagarConversaParaOsDois(this.#contexto, t, contato, agora)),
    );
    void this.#entregar();
  }

  /**
   * Apaga pra todos (RF-30): as mensagens saem daqui de verdade, as minhas e as do contato, sem
   * limite de tempo, e ele recebe o pedido de apagar as dele. Com ele fora do ar, o pedido espera
   * no relay e as mensagens somem quando ele voltar. Devolve as que saíram.
   */
  async apagarParaTodos(id: string, mensagens: readonly Uint8Array[]): Promise<Uint8Array[]> {
    this.#exigirAtivo();
    const contato = this.#contato(id);
    const apagadas = await this.#naFila((t, agora) =>
      apagarParaOsDois(this.#contexto, t, contato, mensagens, agora),
    );
    if (apagadas.length > 0) void this.#entregar();
    return apagadas;
  }

  /**
   * Marca como lidas as mensagens recebidas da conversa. Com `avisar`, manda ao contato a
   * confirmação de leitura; quem decide é o ajuste do RF-17, desligado por padrão. Um pedido de
   * conversa ou um ID bloqueado nunca recebe a confirmação (RF-07).
   */
  async marcarLidas(id: string, avisar: boolean): Promise<void> {
    const contato = this.#contato(id);
    const { cripto, relogio } = this.#o;
    let avisadas: number;
    try {
      avisadas = await this.#exclusivo(() =>
        this.#o.banco.transacao(async (t) => {
          const ids = await lerRecebidas(t, contato);
          const situacao = await contatoDe(t, contato);
          const pode = !this.#substituido && !!situacao?.aceito && !situacao.bloqueado;
          if (!avisar || !pode) return 0;
          for (let inicio = 0; inicio < ids.length; inicio += MAXIMO_DE_LIDAS) {
            await enfileirarConteudo(
              this.#contexto,
              t,
              contato,
              {
                tipo: 'leitura',
                id: cripto.randombytes_buf(BYTES_DO_ID_DA_MENSAGEM),
                enviadaEm: relogio.agora(),
                ttl: 0,
                lidas: ids.slice(inicio, inicio + MAXIMO_DE_LIDAS),
              },
              relogio.agora(),
            );
          }
          return ids.length;
        }),
      );
    } catch (erro) {
      if (erro instanceof SemSessao) throw new ErroDoCorreio('sem-sessao');
      throw erro;
    }
    if (avisadas > 0) void this.#entregar();
  }

  /**
   * Avisa o contato que você está escrevendo, ou parou (RF-18): pela conexão de depósito dele (abre
   * se preciso), com a caixa dele conhecida, na hora, sem fila e sem reenvio: o que não sai agora
   * não serve depois. Só cifra com a conexão aberta. Nunca para pedido de conversa nem ID bloqueado
   * (RF-07, RF-08). Vai para a mesma caixa das mensagens: a que o contato pediu para a conversa, ou
   * a do cartão dele.
   */
  async sinalizarDigitacao(id: string, digitando: boolean): Promise<void> {
    if (this.#parado || this.#substituido) return;
    const contato = this.#contato(id);
    try {
      const conexao = await this.#deposito(contato);
      if (!conexao.aberta) return;
      const { banco, cripto, relogio } = this.#o;
      const [destino, situacao] = await this.#exclusivo(
        async () => [await destinoDe(banco, contato), await contatoDe(banco, contato)] as const,
      );
      if (!destino || destino.desatualizado) return;
      const { caixa } = caixaDoContato(situacao, destino.cartao);
      const pacote = await this.#exclusivo(() =>
        banco.transacao((t) =>
          cifrarDigitacao(this.#contexto, t, contato, digitando, relogio.agora()),
        ),
      );
      await conexao.pedir({
        tipo: 'depositar',
        caixa,
        pacote,
        marca: selarMarca(cripto, caixa, false),
      });
    } catch {
      // Sem sessão, pedido, bloqueado ou a rede caiu: o "digitando" não sai, e tudo bem.
    }
  }

  /** As mensagens da conversa, na ordem em que entraram neste aparelho. */
  mensagens(id: string): Promise<Mensagem[]> {
    const contato = this.#contato(id);
    return this.#exclusivo(() => mensagensDa(this.#o.banco, contato));
  }

  // ---------------------------------------------------------------- uso interno

  // Lidos por método: entre um await e outro eles mudam, e o TypeScript não sabe disso.
  #estaParado(): boolean {
    return this.#parado;
  }

  #foiRemovida(estado: EstadoDaCaixa): boolean {
    return estado.removida;
  }

  #pediramDeNovo(): boolean {
    return this.#entregarDeNovo;
  }

  #foiSubstituido(): boolean {
    return this.#substituido;
  }

  /** Depois de substituído, nada mais sai deste aparelho (RF-05). */
  #exigirAtivo(): void {
    if (this.#substituido) throw new ErroDoCorreio('substituido');
  }

  /** A caixa principal; o correio do cofre não tem. */
  #principal(): EstadoDaCaixa | null {
    return this.#caixa ? (this.#caixas.get(paraHex(this.#caixa)) ?? null) : null;
  }

  /** Os circuitos do cofre têm prefixo próprio: nenhum é dividido com o principal. */
  #prefixo(): string {
    return this.#caixa ? '' : PREFIXO_DO_COFRE;
  }

  /**
   * A caixa por onde o contato escreve para este correio: a principal; no cofre, a da conversa
   * oculta com ele, ou nenhuma.
   */
  #caixaPorOndeEscreve(contato: Uint8Array): EstadoDaCaixa | null {
    const principal = this.#principal();
    if (principal) return principal;
    for (const estado of this.#caixas.values()) {
      if (estado.contato && iguais(estado.contato, contato)) return estado;
    }
    return null;
  }

  /** A fila do contato espera a caixa por onde ele escreve ficar em dia nesta conexão. */
  #esperaACaixa(contato: Uint8Array): boolean {
    const estado = this.#caixaPorOndeEscreve(contato);
    return estado !== null && !estado.emDia;
  }

  /** Uma caixa ficou em dia, caiu, ou o correio parou: quem espera confere de novo. */
  #mudouACaixa(): void {
    for (const conferir of [...this.#esperasDaCaixa]) conferir();
  }

  /**
   * Espera a caixa por onde o contato escreve ficar em dia: o que ele mandou e esperava no relay já
   * chegou. Desiste com `relay-inacessivel` no prazo, ou se o correio parar.
   */
  async #esperarEmDia(contato: Uint8Array): Promise<void> {
    if (this.#estaParado()) throw new ErroDoCorreio('relay-inacessivel');
    if (!this.#esperaACaixa(contato)) return;
    await new Promise<void>((pronto, falhou) => {
      const fim = () => {
        cancelar();
        this.#esperasDaCaixa.delete(conferir);
      };
      const conferir = () => {
        if (this.#estaParado()) {
          fim();
          falhou(new ErroDoCorreio('relay-inacessivel'));
        } else if (!this.#esperaACaixa(contato)) {
          fim();
          pronto();
        }
      };
      const cancelar = this.#o.relogio.agendar(ESPERA_DO_AVISO, () => {
        fim();
        falhou(new ErroDoCorreio('relay-inacessivel'));
      });
      this.#esperasDaCaixa.add(conferir);
    });
  }

  #emitir(evento: EventoDoCorreio): void {
    for (const ouvinte of [...this.#ouvintes]) {
      try {
        ouvinte(evento);
      } catch {
        // Quem ouve não derruba o correio.
      }
    }
  }

  #contato(id: string): Uint8Array {
    const contato = lerId(id);
    if (!contato) throw new ErroDoCorreio('id-invalido');
    if (iguais(contato, this.#meuId)) throw new ErroDoCorreio('proprio-id');
    return contato;
  }

  #cartaoConfere(cartao: Cartao, contato: Uint8Array): boolean {
    const { cripto } = this.#o;
    return cartaoAutentico(cripto, cartao) && iguais(idDoCartao(cripto, cartao), contato);
  }

  /**
   * Roda a operação numa transação, na vez do banco, e traduz os erros do envio no que quem chama
   * pode mostrar.
   */
  async #naFila<T>(operacao: (banco: Armazenamento, agora: number) => Promise<T>): Promise<T> {
    try {
      return await this.#exclusivo(() =>
        this.#o.banco.transacao((t) => operacao(t, this.#o.relogio.agora())),
      );
    } catch (erro) {
      if (erro instanceof SemSessao) throw new ErroDoCorreio('sem-sessao');
      if (erro instanceof NaoAceito) throw new ErroDoCorreio('nao-aceito');
      if (erro instanceof Bloqueado) throw new ErroDoCorreio('bloqueado');
      if (erro instanceof TimerInvalido) throw new ErroDoCorreio('timer-invalido');
      throw erro;
    }
  }

  /**
   * O ID passa a contato aceito; se não era, a conversa começa com o timer padrão (RF-50), e os
   * anexos de um pedido passam a baixar pelo ajuste de baixar sozinho (RF-57).
   */
  async #aceitar(banco: Armazenamento, contato: Uint8Array): Promise<void> {
    const agora = this.#o.relogio.agora();
    const novo = !(await contatoDe(banco, contato))?.aceito;
    await aceitarContato(banco, contato, agora);
    if (!novo) return;
    await aplicarTimerPadrao(banco, contato, agora);
    await anexosDoPedidoAceito(banco, contato);
  }

  /**
   * Busca o cartão do contato, confere hash e assinaturas e abre a sessão (X3DH), se ainda não houver
   * uma. `depois` roda na mesma transação. Precisa do relay.
   */
  async #abrirSessao(
    contato: Uint8Array,
    depois?: (banco: Armazenamento) => Promise<void>,
  ): Promise<void> {
    const resposta = await this.#buscarCartao(contato);
    if (resposta.tipo !== 'cartao-encontrado') {
      throw new ErroDoCorreio(
        codigoDe(resposta) === 'cartao-inexistente' ? 'cartao-inexistente' : 'relay-recusou',
      );
    }
    const { cartao, prekey } = resposta;
    if (!this.#cartaoConfere(cartao, contato)) throw new ErroDoCorreio('cartao-invalido');
    await this.#exclusivo(() =>
      this.#o.banco.transacao(async (t) => {
        // Enquanto o cartão vinha, o ID pode ter sido bloqueado, ou uma mensagem dele pode ter
        // aberto a sessão.
        if ((await contatoDe(t, contato))?.bloqueado) throw new ErroDoCorreio('bloqueado');
        if ((await sessoesDe(t, contato)).length === 0) {
          const { cripto, identidade, gerarPar } = this.#contexto;
          await guardarSessoes(t, contato, [
            sessaoDeQuemAbre(cripto, identidade, cartao, prekey, gerarPar),
          ]);
          await guardarDestino(t, contato, cartao);
        }
        await depois?.(t);
      }),
    );
  }

  /**
   * Roda o envio para o contato. O contato que voltou do backup (RF-47) é aceito mas não tem
   * sessão: no primeiro envio, o cartão dele é buscado e a sessão abre, como em `iniciarConversa`,
   * e o envio roda de novo. Sem o relay, nada entra na fila e lança `relay-inacessivel`. Para quem
   * não é contato, continua `sem-sessao`.
   */
  async #comSessao<T>(contato: Uint8Array, envio: () => Promise<T>): Promise<T> {
    try {
      return await envio();
    } catch (erro) {
      if (!(erro instanceof ErroDoCorreio) || erro.codigo !== 'sem-sessao') throw erro;
      const situacao = await this.#exclusivo(() => contatoDe(this.#o.banco, contato));
      if (!situacao?.aceito || situacao.bloqueado) throw erro;
    }
    await this.#abrirSessao(contato);
    return envio();
  }

  /**
   * Busca o cartão do contato na conexão de depósito dele. Se a conexão falha, tenta de novo num
   * circuito novo, até `TENTATIVAS_AO_INICIAR` vezes.
   */
  async #buscarCartao(contato: Uint8Array): Promise<Resposta> {
    for (let tentativa = 1; ; tentativa++) {
      try {
        const conexao = await this.#deposito(contato);
        return await conexao.pedir({ tipo: 'buscar-cartao', id: contato });
      } catch {
        if (tentativa >= TENTATIVAS_AO_INICIAR || this.#estaParado()) {
          throw new ErroDoCorreio('relay-inacessivel');
        }
        await this.#esperar(intervaloDeReenvio(tentativa));
      }
    }
  }

  #esperar(atraso: number): Promise<void> {
    return new Promise((pronto) => {
      this.#o.relogio.agendar(atraso, pronto);
    });
  }

  // ----------------------------------------------------------- caixa e cartão

  /**
   * Confere no banco se este aparelho já foi substituído; se não, conecta e entrega a fila. No
   * cofre, lê as conversas ocultas e abre a caixa de cada uma.
   */
  async #comecar(): Promise<void> {
    if (this.#caixa) {
      let substituido: boolean;
      try {
        substituido = await this.#exclusivo(() => estaSubstituido(this.#o.banco));
      } catch {
        substituido = false;
      }
      if (substituido) {
        this.#substituido = true;
        this.#parado = true;
        this.#emitir({ tipo: 'substituido' });
        return;
      }
    } else {
      await this.#lerCaixas().catch(() => undefined);
    }
    if (this.#estaParado()) return;
    for (const estado of this.#caixas.values()) void this.#conectarCaixa(estado);
    void this.#entregar();
    this.#baixar();
  }

  /**
   * No cofre: as caixas das conversas ocultas, pelo banco. Cada caixa nova ganha um circuito só dela;
   * a de quem deixou de ser oculta fecha. A semente só passa por aqui para dar a chave pública.
   */
  async #lerCaixas(): Promise<void> {
    const { banco, cripto } = this.#o;
    const lidas = await this.#exclusivo(() => caixasOcultas(banco));
    const vistas = new Set<string>();
    for (const { contato, semente } of lidas) {
      const par = cripto.crypto_sign_seed_keypair(semente);
      cripto.memzero(par.privateKey);
      cripto.memzero(semente);
      const chave = paraHex(par.publicKey);
      vistas.add(chave);
      if (!this.#caixas.has(chave)) {
        const circuito = `${PREFIXO_DO_COFRE}caixa-${String(++this.#circuitosDeCaixa)}`;
        this.#caixas.set(chave, novaCaixa(par.publicKey, contato, circuito));
      }
    }
    for (const [chave, estado] of [...this.#caixas]) {
      if (vistas.has(chave)) continue;
      this.#caixas.delete(chave);
      estado.removida = true;
      estado.cancelarReconexao?.();
      estado.cancelarReconexao = null;
      const conexao = estado.conexao;
      estado.conexao = null;
      estado.emDia = false;
      void conexao?.fechar();
    }
    this.#mudouACaixa();
  }

  /**
   * Outro aparelho restaurou a identidade (RF-05): guarda isso no banco, para não conectar nem
   * depois de reiniciar, para tudo e avisa. O que estava na fila fica; não sai mais daqui.
   */
  async #substituir(): Promise<void> {
    if (this.#foiSubstituido()) return;
    this.#substituido = true;
    await this.#exclusivo(() => marcarSubstituido(this.#o.banco)).catch(() => undefined);
    await this.parar();
    this.#emitir({ tipo: 'substituido' });
  }

  /**
   * Abre a caixa numa conexão só dela, no circuito dela. A principal publica o cartão antes; a da
   * conversa oculta, não. Quando cai, tenta de novo com intervalos crescentes.
   */
  async #conectarCaixa(estado: EstadoDaCaixa): Promise<void> {
    if (this.#parado || this.#substituido || estado.removida) return;
    if (estado.conexao || estado.conectando) return;
    estado.conectando = true;
    const principal = estado.contato === null;
    let conexao: ConexaoComORelay | null = null;
    let reconectarAgora = false;
    try {
      const { transporte, relay, relogio } = this.#o;
      conexao = await ConexaoComORelay.abrir(transporte, relay, estado.circuito, relogio);
      const aberta = conexao;
      estado.emDia = false;
      const confirmacoes: Confirmacoes = { esperando: 0, ids: [], aCaminho: false };
      // Ouve antes de abrir a caixa: os pacotes chegam logo depois da resposta.
      aberta.aoAvisar((aviso) => {
        this.#aoAvisar(estado, aberta, confirmacoes, aviso);
      });
      aberta.aoFechar(() => {
        this.#aoCairACaixa(estado, aberta);
      });
      if (this.#estaParado()) throw new Error('parado');
      if (principal) await this.#publicar(aberta);
      await this.#abrirCaixa(estado, aberta);
      if (this.#estaParado() || this.#foiRemovida(estado) || !aberta.aberta) {
        throw new Error('caiu');
      }
      estado.conexao = aberta;
      estado.tentativas = 0;
      if (principal) {
        this.#emitir({ tipo: 'caixa', aberta: true });
        this.#agendarConferencia();
      }
      // O relay está de pé: o que esperava na fila tenta agora.
      await this.#exclusivo(async () => {
        await tentarTudoAgora(this.#o.banco, relogio.agora());
        await anexosTentamAgora(this.#o.banco);
      });
      void this.#entregar();
      this.#baixar();
    } catch (erro) {
      await conexao?.fechar();
      if (principal && erro instanceof Error && erro.message === 'tor-indisponivel') {
        this.#emitir({ tipo: 'caixa', aberta: false, semTor: true });
      }
      if (erro instanceof Substituido) void this.#substituir();
      else if (estado.conferirAgora) {
        // O aviso de substituição chegou antes de a caixa contar como aberta: confere na hora.
        estado.conferirAgora = false;
        reconectarAgora = true;
      } else this.#agendarReconexao(estado);
    } finally {
      estado.conectando = false;
      if (reconectarAgora) void this.#conectarCaixa(estado);
    }
  }

  #aoCairACaixa(estado: EstadoDaCaixa, conexao: ConexaoComORelay): void {
    if (estado.conexao !== conexao) return;
    estado.conexao = null;
    estado.emDia = false;
    this.#mudouACaixa();
    if (estado.contato === null) {
      this.#cancelarConferencia?.();
      this.#cancelarConferencia = null;
      this.#emitir({ tipo: 'caixa', aberta: false });
    }
    // Depois do aviso de substituição, a reconexão é na hora: ou a caixa sumiu e o próprio cartão
    // aponta outra (RF-05), ou o aviso não valia e a caixa abre de novo.
    if (estado.conferirAgora) {
      estado.conferirAgora = false;
      void this.#conectarCaixa(estado);
      return;
    }
    this.#agendarReconexao(estado);
  }

  #agendarReconexao(estado: EstadoDaCaixa): void {
    if (this.#parado || this.#substituido || estado.removida || estado.cancelarReconexao) return;
    estado.tentativas++;
    estado.cancelarReconexao = this.#o.relogio.agendar(
      intervaloDeReenvio(estado.tentativas),
      () => {
        estado.cancelarReconexao = null;
        void this.#conectarCaixa(estado);
      },
    );
  }

  #agendarConferencia(): void {
    this.#cancelarConferencia?.();
    this.#cancelarConferencia = this.#o.relogio.agendar(CONFERENCIA_DO_CARTAO, () => {
      this.#cancelarConferencia = null;
      const conexao = this.#principal()?.conexao;
      if (!conexao) return;
      void this.#publicar(conexao)
        .catch((erro: unknown) => {
          if (erro instanceof Substituido) void this.#substituir();
        })
        .finally(() => {
          if (this.#principal()?.conexao === conexao && !this.#substituido) {
            this.#agendarConferencia();
          }
        });
    });
  }

  /** Cria a caixa (uma vez por relay) e publica o cartão se for a hora. Recusa não derruba nada. */
  async #publicar(conexao: ConexaoComORelay): Promise<void> {
    const caixa = this.#caixa;
    if (!caixa) return;
    const { banco, relay, relogio } = this.#o;
    let estado = await this.#exclusivo(() => estadoDoCartao(banco, relay));
    if (!estado.caixaCriada) {
      const criada = await conexao.pedir({ tipo: 'criar-caixa', caixa });
      if (!ok(criada)) return;
      await this.#exclusivo(() => marcarCaixaCriada(banco));
    }
    let plano: PlanoDePublicacao | null = planejarPublicacao(estado, relogio.agora());
    // No máximo duas publicações: a renovação e, se o relay guarda poucas prekeys, a reposição.
    for (let rodada = 0; plano && rodada < 2; rodada++) {
      const planoAtual = plano;
      const atual = estado;
      // A primeira publicação neste relay substitui o cartão que houver, talvez de outro aparelho
      // (restauração, RF-05), com data mais nova que o relógio deste: a nova vem depois dela.
      const dataMinima =
        planoAtual.modo === 'substituir'
          ? ((await this.#proprioCartao(conexao))?.data ?? -1) + 1
          : 0;
      const preparada = await this.#exclusivo(() =>
        banco.transacao((t) =>
          prepararPublicacao(
            this.#o.cripto,
            t,
            this.#o.identidade,
            caixa,
            atual,
            planoAtual,
            relogio.agora(),
            this.#contexto.gerarPar,
            dataMinima,
          ),
        ),
      );
      // Sem resposta, lança: as chaves geradas ficam, porque o relay pode ter aceitado.
      const resposta = await conexao.pedir({
        tipo: 'publicar-cartao',
        publicacao: preparada.publicacao,
      });
      if (resposta.tipo !== 'cartao-publicado') {
        await this.#exclusivo(() => banco.transacao((t) => descartarPublicacao(t, preparada)));
        // O relay diz que o cartão dele aponta a caixa de outro aparelho com esta identidade
        // (RF-05). A resposta não vem assinada: a prova é o próprio cartão, conferido, apontar
        // outra caixa. Sem ela, a conexão cai e volta como depois de uma queda.
        if (codigoDe(resposta) === 'caixa-substituida') {
          if (await this.#cartaoApontaOutraCaixa(conexao)) throw new Substituido();
          await conexao.fechar();
          throw new Error('substituição sem prova');
        }
        return;
      }
      estado = await this.#exclusivo(() =>
        banco.transacao(async (t) => {
          await confirmarPublicacao(t, atual, preparada, resposta.prekeys, relogio.agora());
          return estadoDoCartao(t, relay);
        }),
      );
      this.#emitir({ tipo: 'cartao', prekeysNoRelay: resposta.prekeys });
      plano = planejarReposicao(resposta.prekeys);
    }
    await this.#exclusivo(() => banco.transacao((t) => apagarPrekeysVencidas(t, relogio.agora())));
  }

  /**
   * Abre a caixa com o desafio desta conexão. Caixa que o relay apagou por prazo é criada de novo.
   * A chave privada da caixa sai da semente só para assinar e é zerada logo depois: no bloqueio,
   * quem chama zera a semente da principal, e nenhuma cópia fica aqui. A semente da caixa oculta é
   * lida do cofre só para isso, e zerada em seguida.
   */
  async #abrirCaixa(estado: EstadoDaCaixa, conexao: ConexaoComORelay): Promise<void> {
    const { cripto, banco } = this.#o;
    const { contato, publica: caixa } = estado;
    const semente = contato
      ? await this.#exclusivo(() => sementeDaCaixaOculta(banco, contato))
      : this.#o.sementeDaCaixa;
    if (!semente) throw new Error('caixa removida');
    const assinar = (mensagem: Uint8Array) => {
      const { privateKey } = cripto.crypto_sign_seed_keypair(semente);
      try {
        return cripto.crypto_sign_detached(mensagem, privateKey);
      } finally {
        cripto.memzero(privateKey);
      }
    };
    const abrir = () =>
      conexao.pedir({
        tipo: 'abrir-caixa',
        caixa,
        assinatura: assinar(mensagemDaAbertura(conexao.desafio, caixa)),
      });
    try {
      let resposta = await abrir();
      if (codigoDe(resposta) === 'caixa-inexistente') {
        // A caixa sumiu: o relay a apagou por prazo, ou outro aparelho restaurou a identidade e o
        // cartão aponta a caixa dele (RF-05). Só no primeiro caso ela volta. A da conversa oculta
        // sempre volta: o contato espera por ela.
        if (!contato && (await this.#cartaoApontaOutraCaixa(conexao))) throw new Substituido();
        if (!ok(await conexao.pedir({ tipo: 'criar-caixa', caixa }))) {
          throw new Error('criar caixa');
        }
        resposta = await abrir();
      }
      if (!ok(resposta)) throw new Error('abrir caixa');
    } finally {
      if (contato) cripto.memzero(semente);
    }
  }

  /**
   * O cartão desta identidade que o relay guarda, conferido, ou `null`. Busca na conexão da caixa,
   * que já publica o cartão: o relay não aprende nada com isso. Gasta uma one-time prekey, mas só
   * acontece na primeira publicação num relay e quando a caixa some.
   */
  async #proprioCartao(conexao: ConexaoComORelay): Promise<Cartao | null> {
    const resposta = await conexao.pedir({ tipo: 'buscar-cartao', id: this.#meuId });
    if (resposta.tipo !== 'cartao-encontrado') return null;
    return this.#cartaoConfere(resposta.cartao, this.#meuId) ? resposta.cartao : null;
  }

  /**
   * A prova da restauração em outro aparelho (RF-05): o próprio cartão, assinado pela identidade,
   * aponta outra caixa principal e é mais novo que o último que este aparelho publicou. Um cartão
   * antigo apontando outra caixa é o relay repetindo um que já valeu, e não prova nada.
   */
  async #cartaoApontaOutraCaixa(conexao: ConexaoComORelay): Promise<boolean> {
    const cartao = await this.#proprioCartao(conexao);
    if (cartao === null || !this.#caixa || iguais(cartao.caixaPrincipal, this.#caixa)) return false;
    const { banco, relay } = this.#o;
    const estado = await this.#exclusivo(() => estadoDoCartao(banco, relay));
    // Sem publicação aceita neste aparelho, não há com o que comparar: um cartão de outro aparelho
    // pode ser só o anterior à restauração.
    return estado.data !== null && cartao.data > estado.data;
  }

  #aoAvisar(
    estado: EstadoDaCaixa,
    conexao: ConexaoComORelay,
    confirmacoes: Confirmacoes,
    aviso: Aviso,
  ): void {
    if (aviso.tipo === 'caixa-substituida') {
      // O relay diz que outro aparelho restaurou a identidade e vai fechar a conexão. O aviso não
      // vem assinado, então não decide nada: a conexão cai e volta na hora, e é a reconexão que
      // confere pelo próprio cartão (RF-05). Só acontece com a caixa do cartão. Um relay que repete
      // o aviso espera o intervalo normal, como depois de qualquer queda.
      if (estado.contato === null) {
        const agora = this.#o.relogio.agora();
        estado.conferirAgora =
          estado.avisadoEm === null || agora - estado.avisadoEm >= MAIOR_INTERVALO;
        estado.avisadoEm = agora;
        void conexao.fechar();
      }
      return;
    }
    if (aviso.tipo === 'em-dia') {
      // Na fila dos pacotes: o que veio antes do aviso ainda é processado como velho.
      this.#recebimentos = this.#recebimentos.then(() => {
        if (!conexao.aberta || (estado.conexao !== conexao && estado.conexao !== null)) return;
        estado.emDia = true;
        this.#mudouACaixa();
        // A fila de quem escreve por esta caixa esperava por isso.
        void this.#entregar();
      });
      return;
    }
    // A marca sozinha só vai para quem vigia a caixa; o correio abre e recebe o pacote inteiro.
    if (aviso.tipo !== 'pacote') return;
    confirmacoes.esperando++;
    this.#recebimentos = this.#recebimentos.then(async () => {
      const confirmar = await this.#receber(estado, conexao, aviso.id, aviso.pacote);
      confirmacoes.esperando--;
      if (confirmar) confirmacoes.ids.push(aviso.id);
      this.#confirmar(conexao, confirmacoes);
    });
  }

  /**
   * Guarda o que chegou e diz se o pacote pode ser confirmado, para o relay apagar. Erro inesperado
   * (do banco, por exemplo) não confirma: a conexão fecha, a caixa abre de novo depois do intervalo
   * de reconexão, e o relay entrega o pacote outra vez. Um pacote que falha assim sem parar ocuparia
   * para sempre uma vaga da janela de entrega: na terceira falha, ele é confirmado e se perde.
   */
  async #receber(
    estado: EstadoDaCaixa,
    conexao: ConexaoComORelay,
    id: Uint8Array,
    pacote: Uint8Array,
  ): Promise<boolean> {
    let recebimento: Recebimento;
    try {
      recebimento = await this.#exclusivo(() =>
        this.#o.banco.transacao((t) =>
          receberPacote(this.#contexto, t, pacote, this.#o.relogio.agora()),
        ),
      );
    } catch {
      const chave = paraHex(id);
      const falhas = (this.#falhasAoReceber.get(chave) ?? 0) + 1;
      if (falhas < FALHAS_ANTES_DE_DESCARTAR) {
        this.#falhasAoReceber.set(chave, falhas);
        await conexao.fechar();
        return false;
      }
      this.#falhasAoReceber.delete(chave);
      return true;
    }
    this.#falhasAoReceber.delete(paraHex(id));
    this.#avisarRecebimento(recebimento, estado);
    return true;
  }

  /**
   * Confirma numa mensagem só o que já entrou, quando nenhuma confirmação está a caminho e nenhum
   * pacote espera a vez: o relay só entrega mais depois de uma confirmação. Com a conexão fechada,
   * os IDs ficam para trás; o relay entrega os pacotes de novo na abertura seguinte, e o repetido
   * é descartado.
   */
  #confirmar(conexao: ConexaoComORelay, confirmacoes: Confirmacoes): void {
    const { ids } = confirmacoes;
    if (confirmacoes.aCaminho || confirmacoes.esperando > 0 || ids.length === 0) return;
    if (!conexao.aberta) {
      ids.length = 0;
      return;
    }
    confirmacoes.aCaminho = true;
    void conexao
      .pedir({ tipo: 'confirmar', ids: ids.splice(0, JANELA_DE_ENTREGA) })
      .catch(() => undefined)
      .then(() => {
        confirmacoes.aCaminho = false;
        this.#confirmar(conexao, confirmacoes);
      });
  }

  /** Avisa quem ouve do que o pacote mudou. */
  #avisarRecebimento(recebimento: Recebimento, estado: EstadoDaCaixa): void {
    switch (recebimento.tipo) {
      case 'mensagem':
        this.#baixar();
        this.#emitir({
          tipo: 'mensagem',
          conversa: formatarId(recebimento.contato),
          id: recebimento.id,
          pedido: recebimento.pedido,
        });
        return;
      case 'leitura':
        for (const lida of recebimento.lidas) {
          this.#emitir({
            tipo: 'status',
            conversa: formatarId(recebimento.contato),
            id: lida,
            status: 'lida',
          });
        }
        return;
      case 'expirada':
        this.#emitir({
          tipo: 'expirada',
          conversa: formatarId(recebimento.contato),
          pedido: recebimento.pedido,
        });
        return;
      case 'apagadas':
        if (recebimento.ids.length === 0) return;
        this.#emitir({
          tipo: 'apagadas',
          conversa: formatarId(recebimento.contato),
          ids: recebimento.ids,
        });
        return;
      case 'timer':
        this.#emitir({
          tipo: 'timer',
          conversa: formatarId(recebimento.contato),
          segundos: recebimento.segundos,
        });
        return;
      case 'prints':
        this.#emitir({
          tipo: 'prints',
          conversa: formatarId(recebimento.contato),
          bloqueados: recebimento.bloqueados,
        });
        return;
      case 'conversaApagada':
        this.#emitir({ tipo: 'conversaApagada', conversa: formatarId(recebimento.contato) });
        return;
      case 'digitando':
        if (!estado.emDia) return;
        this.#emitir({
          tipo: 'digitando',
          conversa: formatarId(recebimento.contato),
          digitando: recebimento.digitando,
        });
        return;
      case 'caixa':
        // A fila do contato vai para a caixa nova, com o que precisava ir de novo.
        void this.#entregar();
        return;
      case 'descartado':
      case 'ignorado':
        return;
    }
  }

  // ---------------------------------------------------------------- entrega

  #circuitoDe(chave: string): string {
    let circuito = this.#circuitos.get(chave);
    if (!circuito) {
      circuito = `${this.#prefixo()}deposito-${String(this.#circuitos.size + 1)}`;
      this.#circuitos.set(chave, circuito);
    }
    return circuito;
  }

  /** O circuito dos anexos que chegam; o do cofre é outro. */
  #circuitoDosAnexos(): string {
    return `${this.#prefixo()}${CIRCUITO_DOS_ANEXOS}`;
  }

  /** A conexão de depósito do contato: abre se não houver, num circuito só dele. */
  #deposito(contato: Uint8Array): Promise<ConexaoComORelay> {
    const chave = paraHex(contato);
    const existente = this.#depositos.get(chave);
    if (existente) return existente;
    const { transporte, relay, relogio } = this.#o;
    const esquecer = () => {
      if (this.#depositos.get(chave) === abrindo) this.#depositos.delete(chave);
    };
    const abrindo: Promise<ConexaoComORelay> = ConexaoComORelay.abrir(
      transporte,
      relay,
      this.#circuitoDe(chave),
      relogio,
    ).then((conexao) => {
      conexao.aoFechar(esquecer);
      if (this.#parado) {
        void conexao.fechar();
        throw new Error('parado');
      }
      return conexao;
    });
    abrindo.catch(esquecer);
    this.#depositos.set(chave, abrindo);
    return abrindo;
  }

  /**
   * A caixa do contato: a que ele pediu para a conversa ou a do cartão conferido. Sem cartão
   * guardado, ou desatualizado, busca de novo na conexão de depósito dele. `null` quando não dá
   * para saber agora. `refeita` quando o cartão novo aponta outra caixa: o contato trocou de
   * aparelho (RF-05), a sessão recomeçou com o aparelho novo e a fila dele foi cifrada de novo; a
   * entrega recomeça com os pacotes novos.
   */
  async #caixaDe(
    contato: Uint8Array,
    conexao: ConexaoComORelay,
  ): Promise<CaixaDoContato | 'refeita' | null> {
    const { banco, relogio } = this.#o;
    const [destino, situacao] = await this.#exclusivo(
      async () => [await destinoDe(banco, contato), await contatoDe(banco, contato)] as const,
    );
    if (destino && !destino.desatualizado) return caixaDoContato(situacao, destino.cartao);
    const resposta = await conexao.pedir({ tipo: 'buscar-cartao', id: contato });
    if (resposta.tipo !== 'cartao-encontrado') return null;
    const { cartao, prekey } = resposta;
    if (!this.#cartaoConfere(cartao, contato)) return null;
    return this.#exclusivo(() =>
      banco.transacao(async (t) => {
        // O cartão tem de ser da mesma identidade da sessão: o ID diz isso, a sessão confere.
        const [atual] = await sessoesDe(t, contato);
        if (atual && !iguais(atual.chaveDoContato, cartao.chaveDeIdentidade)) return null;
        const anterior = await destinoDe(t, contato);
        await guardarDestino(t, contato, cartao);
        if (anterior && !iguais(anterior.cartao.caixaPrincipal, cartao.caixaPrincipal)) {
          const agora = relogio.agora();
          await recomecarComAparelhoNovo(this.#contexto, t, contato, cartao, prekey, agora);
          await this.#avisarCaixaAoAparelhoNovo(t, contato, agora);
          return 'refeita';
        }
        return caixaDoContato(await contatoDe(t, contato), cartao);
      }),
    );
  }

  /**
   * No cofre: o contato da conversa oculta trocou de aparelho, e o aparelho novo não sabe da caixa
   * dela. O aviso entra na fila, depois do que foi cifrado de novo.
   */
  async #avisarCaixaAoAparelhoNovo(
    banco: Armazenamento,
    contato: Uint8Array,
    agora: number,
  ): Promise<void> {
    if (this.#caixa) return;
    const estado = this.#caixaPorOndeEscreve(contato);
    const situacao = await contatoDe(banco, contato);
    if (!estado || !situacao?.aceito || situacao.bloqueado) return;
    await enfileirarAvisoDeCaixa(this.#contexto, banco, contato, estado.publica, agora, agora);
  }

  /** Entrega o que venceu na fila. Uma rodada por vez; o que chegar no meio entra na seguinte. */
  async #entregar(): Promise<void> {
    if (this.#parado) return;
    if (this.#entregando) {
      this.#entregarDeNovo = true;
      return;
    }
    this.#entregando = true;
    let quando: number | null;
    try {
      do {
        this.#entregarDeNovo = false;
        await this.#rodadaDeEntrega();
      } while (this.#pediramDeNovo() && !this.#estaParado());
      // Quem espera um anexo subir volta quando a subida terminar; quem espera a caixa por onde
      // escreve ficar em dia, quando ela ficar.
      const principal = this.#principal();
      if (principal && !principal.emDia) {
        quando = null;
      } else {
        const fora = [
          ...this.#subindo.values(),
          ...[...this.#caixas.values()].flatMap(({ contato, emDia }) =>
            contato && !emDia ? [contato] : [],
          ),
        ];
        quando = await this.#exclusivo(() => proximaTentativa(this.#o.banco, fora));
      }
    } catch {
      // Erro do banco: tenta de novo no primeiro intervalo.
      quando = this.#o.relogio.agora() + intervaloDeReenvio(1);
    } finally {
      this.#entregando = false;
    }
    // Algo entrou na fila enquanto a rodada terminava.
    if (this.#entregarDeNovo) {
      void this.#entregar();
      return;
    }
    this.#agendarEntrega(quando);
  }

  #agendarEntrega(quando: number | null): void {
    this.#cancelarEntrega?.();
    this.#cancelarEntrega = null;
    if (this.#parado || quando === null) return;
    const atraso = Math.max(0, quando - this.#o.relogio.agora());
    this.#cancelarEntrega = this.#o.relogio.agendar(atraso, () => {
      this.#cancelarEntrega = null;
      void this.#entregar();
    });
  }

  async #rodadaDeEntrega(): Promise<void> {
    const itens = await this.#exclusivo(() => itensDaFila(this.#o.banco));
    const porContato = new Map<string, ItemDaFila[]>();
    for (const item of itens) {
      const chave = paraHex(item.contato);
      porContato.set(chave, [...(porContato.get(chave) ?? []), item]);
    }
    await Promise.all([...porContato.values()].map((lista) => this.#entregarAoContato(lista)));
  }

  /**
   * Entrega em ordem; o primeiro que falha segura os seguintes até a próxima tentativa. Só depois
   * que a caixa por onde o contato escreve ficou em dia: um aviso de caixa nova dele que esperava
   * no relay é lido antes, e a fila vai para a caixa certa.
   */
  async #entregarAoContato(lista: readonly ItemDaFila[]): Promise<void> {
    const { banco, relogio } = this.#o;
    const [primeiro] = lista;
    if (!primeiro || primeiro.proximaTentativa > relogio.agora()) return;
    if (this.#esperaACaixa(primeiro.contato)) return;
    const falhou = (item: ItemDaFila) => this.#exclusivo(() => adiar(banco, item, relogio.agora()));

    let conexao: ConexaoComORelay;
    let destino: CaixaDoContato | 'refeita' | null;
    try {
      conexao = await this.#deposito(primeiro.contato);
      destino = await this.#caixaDe(primeiro.contato, conexao);
    } catch {
      await falhou(primeiro);
      return;
    }
    if (destino === 'refeita') {
      // Os pacotes desta lista são os de antes: a próxima rodada lê os novos.
      this.#entregarDeNovo = true;
      return;
    }
    if (!destino) {
      await falhou(primeiro);
      return;
    }
    const { caixa, daConversa } = destino;
    for (const item of lista) {
      if (this.#parado) return;
      // O blob do anexo sobe antes da mensagem que o abre; os pacotes de depois esperam.
      if (item.mensagem && (await this.#esperaSubir(item, item.mensagem))) return;
      // A lista foi lida antes: o item pode ter saído no meio (o contato foi bloqueado, a mensagem
      // foi apagada), e a próxima rodada lê a fila de novo. Confere logo antes de depositar, sem
      // espera no meio. Nada sai para um ID bloqueado (RF-08): o bloqueio esvazia a fila dele, e o
      // que entrasse depois só espera.
      const situacao = await this.#situacaoDoItem(item);
      if (situacao !== 'sai') {
        if (situacao === 'bloqueado') await falhou(item);
        else this.#entregarDeNovo = true;
        return;
      }
      let resposta: Resposta;
      try {
        resposta = await conexao.pedir({
          tipo: 'depositar',
          caixa,
          pacote: item.pacote,
          // Só a mensagem (texto ou anexo) acorda o aviso do aparelho bloqueado (RF-42).
          marca: selarMarca(this.#o.cripto, caixa, item.mensagem !== null),
        });
      } catch {
        await falhou(item);
        return;
      }
      if (!ok(resposta)) {
        // A caixa do cartão sumiu ou mudou: o cartão é buscado de novo na próxima tentativa. A da
        // conversa oculta do contato só espera: ela volta quando o cofre dele abrir, e buscar o
        // cartão a cada tentativa gastaria as prekeys dele.
        if (codigoDe(resposta) === 'caixa-inexistente' && !daConversa) {
          await this.#exclusivo(() => marcarDestinoDesatualizado(banco, item.contato));
        }
        await falhou(item);
        return;
      }
      if (!(await this.#entregue(item, caixa))) {
        this.#entregarDeNovo = true;
        return;
      }
    }
  }

  /** Se o item ainda sai: ele pode ter saído da fila, ou o contato pode estar bloqueado. */
  #situacaoDoItem(item: ItemDaFila): Promise<'sai' | 'saiu' | 'bloqueado'> {
    const { banco } = this.#o;
    return this.#exclusivo(async () => {
      if (!(await naFila(banco, item))) return 'saiu';
      return (await contatoDe(banco, item.contato))?.bloqueado ? 'bloqueado' : 'sai';
    });
  }

  /**
   * O relay aceitou o pacote: sai da fila, e a mensagem passa a enviada (RF-14). Se a conversa mudou
   * de caixa enquanto o pacote ia (chegou um aviso de caixa nova do contato), ele fica na fila e vai
   * de novo, agora para a nova: a cópia repetida é descartada do outro lado pelo ID (RF-16). Devolve
   * `false` nesse caso.
   */
  async #entregue(item: ItemDaFila, caixa: Uint8Array): Promise<boolean> {
    const { banco, relogio } = this.#o;
    const { mensagem } = item;
    const resultado = await this.#exclusivo(() =>
      banco.transacao(async (t) => {
        const [destino, situacao] = [
          await destinoDe(t, item.contato),
          await contatoDe(t, item.contato),
        ];
        const atual = destino ? caixaDoContato(situacao, destino.cartao).caixa : null;
        if (atual && !iguais(atual, caixa)) {
          await tentarDeNovo(t, item, relogio.agora());
          return 'de-novo';
        }
        await tirarDaFila(t, item);
        return mensagem ? mudarStatus(t, mensagem, ['pendente'], 'enviada') : false;
      }),
    );
    if (resultado === 'de-novo') return false;
    if (resultado && mensagem) {
      this.#emitir({
        tipo: 'status',
        conversa: formatarId(item.contato),
        id: mensagem,
        status: 'enviada',
      });
    }
    return true;
  }

  // ---------------------------------------------------------------- anexos

  #pediramDownloadDeNovo(): boolean {
    return this.#baixarDeNovo;
  }

  /** Avisa o progresso de uma transferência, de tanto em tanto. */
  #aoProgredir(contato: Uint8Array, mensagem: Uint8Array): (fracao: number) => void {
    let avisado = -1;
    return (fracao) => {
      if (fracao < 1 && fracao - avisado < PASSO_DO_PROGRESSO) return;
      avisado = fracao;
      this.#emitir({ tipo: 'progresso', conversa: formatarId(contato), id: mensagem, fracao });
    };
  }

  /** Um pedido HTTP do anexo da mensagem, que a pessoa pode cancelar no meio. */
  async #pedirAnexo(
    mensagem: Uint8Array,
    pedido: Omit<PedidoHttp, 'cancelar'>,
  ): Promise<RespostaHttp> {
    const chave = paraHex(mensagem);
    let cancelar: () => void = () => undefined;
    const cancelado = new Promise<void>((pronto) => {
      cancelar = pronto;
    });
    this.#transferencias.set(chave, cancelar);
    try {
      return await this.#o.transporte.pedirHttp({ ...pedido, cancelar: cancelado });
    } finally {
      if (this.#transferencias.get(chave) === cancelar) this.#transferencias.delete(chave);
    }
  }

  /** Pede ao relay para apagar o blob; o que não der, some pelo prazo do relay. */
  async #apagarNoRelay(endereco: string, circuito: string): Promise<boolean> {
    try {
      const { status } = await this.#o.transporte.pedirHttp({
        metodo: 'DELETE',
        endereco,
        circuito,
        limite: LIMITE_SEM_CORPO,
      });
      return status === 204 || status === 404;
    } catch {
      return false;
    }
  }

  /** Um envio por vez: o blob inteiro passa pela memória. */
  #umEnvio<T>(operacao: () => Promise<T>): Promise<T> {
    const resultado = this.#envios.then(operacao);
    this.#envios = resultado.catch(() => undefined);
    return resultado;
  }

  /**
   * Se o anexo da mensagem do item ainda não subiu, ele começa a subir, fora da rodada, e devolve
   * `true`: a mensagem e as seguintes do contato saem na rodada depois da subida.
   */
  async #esperaSubir(item: ItemDaFila, mensagem: Uint8Array): Promise<boolean> {
    const anexo = await this.#exclusivo(() => anexoDe(this.#o.banco, mensagem));
    if (anexo?.estado !== 'enviar') return false;
    const chave = paraHex(mensagem);
    if (!this.#subindo.has(chave)) {
      this.#subindo.set(chave, item.contato);
      void this.#umEnvio(() => this.#subirAnexo(item, mensagem, anexo))
        .catch(() => undefined)
        .finally(() => {
          this.#subindo.delete(chave);
          void this.#entregar();
        });
    }
    return true;
  }

  /**
   * Sobe o blob pelo circuito de depósito do contato. O relay que já tem o blob (o reenvio de quem
   * não viu a resposta) responde 409, e isso também é subir. Se não deu, a mensagem espera o
   * intervalo da fila; se ela foi apagada enquanto subia, o blob sai do relay.
   */
  async #subirAnexo(item: ItemDaFila, mensagem: Uint8Array, anexo: Anexo): Promise<void> {
    if (this.#estaParado()) return;
    const { banco, relay, relogio } = this.#o;
    const { contato } = item;
    const blob = await this.#exclusivo(() => blobDe(banco, mensagem));
    // Apagada enquanto esperava a vez: a mensagem também saiu da fila.
    if (!blob || this.#estaParado()) return;
    const endereco = enderecoDoAnexo(relay, anexo.token);
    const circuito = this.#circuitoDe(paraHex(contato));
    let status = 0;
    try {
      ({ status } = await this.#pedirAnexo(mensagem, {
        metodo: 'PUT',
        endereco,
        circuito,
        corpo: blob,
        limite: LIMITE_SEM_CORPO,
        aoProgredir: this.#aoProgredir(contato, mensagem),
      }));
    } catch {
      // Caiu, cancelado ou parado: decide abaixo.
    }
    if (status === 201 || status === 409) {
      const subiu = await this.#exclusivo(() =>
        mudarEstadoDoAnexo(banco, mensagem, ['enviar'], 'enviado'),
      );
      // Apagada enquanto subia: o blob não serve a ninguém.
      if (!subiu) await this.#apagarNoRelay(endereco, circuito);
      else this.#emitir({ tipo: 'anexo', conversa: formatarId(contato), id: mensagem });
      return;
    }
    if (this.#estaParado()) return;
    // A mensagem cancelada já saiu da fila, e adiar não muda nada.
    await this.#exclusivo(() => adiar(banco, item, relogio.agora()));
  }

  /** Baixa e apaga no relay o que espera, um anexo por vez. */
  #baixar(): void {
    if (this.#parado || this.#substituido) return;
    if (this.#baixando) {
      this.#baixarDeNovo = true;
      return;
    }
    this.#baixando = this.#rodadaDeDownloads().finally(() => {
      this.#baixando = null;
      if (this.#pediramDownloadDeNovo()) this.#baixar();
    });
  }

  async #rodadaDeDownloads(): Promise<void> {
    const { banco, relogio } = this.#o;
    let proximo: number | null;
    try {
      do {
        this.#baixarDeNovo = false;
        proximo = null;
        const pendentes = await this.#exclusivo(() => anexosPendentes(banco));
        for (const { anexo, conversa } of pendentes) {
          if (this.#estaParado()) break;
          if (anexo.proximaTentativa > relogio.agora()) {
            proximo = Math.min(proximo ?? Number.POSITIVE_INFINITY, anexo.proximaTentativa);
            continue;
          }
          const tentarEm = await this.#transferir(anexo, conversa);
          if (tentarEm !== null) proximo = Math.min(proximo ?? Number.POSITIVE_INFINITY, tentarEm);
        }
      } while (this.#pediramDownloadDeNovo() && !this.#estaParado());
    } catch {
      // Erro do banco: tenta de novo no primeiro intervalo.
      proximo = relogio.agora() + intervaloDeReenvio(1);
    }
    // Pediram outra rodada enquanto esta terminava: ela agenda o que faltar.
    if (this.#pediramDownloadDeNovo()) return;
    this.#cancelarDownloads?.();
    this.#cancelarDownloads = null;
    if (this.#estaParado() || proximo === null) return;
    this.#cancelarDownloads = relogio.agendar(Math.max(0, proximo - relogio.agora()), () => {
      this.#cancelarDownloads = null;
      this.#baixar();
    });
  }

  /**
   * Baixa o blob, confere tamanho, hash e o fluxo inteiro, guarda e pede ao relay para apagar
   * (RF-35). Devolve quando tentar de novo, se falhou por rede; `null` se terminou.
   */
  async #transferir(anexo: Anexo, conversa: Uint8Array): Promise<number | null> {
    const { banco, relay, relogio, cripto } = this.#o;
    const { mensagem } = anexo;
    const id = formatarId(conversa);
    const endereco = enderecoDoAnexo(relay, anexo.token);
    const adiar = async () => {
      const tentativas = anexo.tentativas + 1;
      const quando = relogio.agora() + intervaloDeReenvio(tentativas);
      await this.#exclusivo(() => adiarAnexo(banco, mensagem, tentativas, quando));
      return quando;
    };
    if (anexo.estado === 'baixar') {
      const claro = anexo.capa + anexo.tamanho;
      let resposta: RespostaHttp;
      try {
        resposta = await this.#pedirAnexo(mensagem, {
          metodo: 'GET',
          endereco,
          circuito: this.#circuitoDosAnexos(),
          limite: tamanhoDoAnexo(claro),
          aoProgredir: this.#aoProgredir(conversa, mensagem),
        });
      } catch {
        if (this.#estaParado()) return null;
        // Cancelado (passou a `manual`) ou apagado: nada a tentar. Senão, foi a rede.
        const atual = await this.#exclusivo(() => anexoDe(banco, mensagem));
        return atual?.estado === 'baixar' ? adiar() : null;
      }
      if (resposta.status === 404) {
        await this.#exclusivo(() =>
          mudarEstadoDoAnexo(banco, mensagem, ['baixar'], 'indisponivel'),
        );
        this.#emitir({ tipo: 'anexo', conversa: id, id: mensagem });
        return null;
      }
      if (resposta.status !== 200) return adiar();
      const blob = resposta.corpo;
      // O relay também não é confiável: tamanho, hash e o fluxo inteiro, antes de guardar.
      const aberto = anexoConfere(cripto, blob, anexo.hash, claro)
        ? decifrarAnexo(cripto, blob, anexo.chave, claro)
        : null;
      if (!aberto) {
        await this.#exclusivo(() => mudarEstadoDoAnexo(banco, mensagem, ['baixar'], 'invalido'));
        this.#emitir({ tipo: 'anexo', conversa: id, id: mensagem });
        return null;
      }
      const sha256 = cripto.crypto_hash_sha256(aberto.subarray(anexo.capa));
      cripto.memzero(aberto);
      const guardou = await this.#exclusivo(() =>
        banco.transacao((t) => guardarBaixado(t, mensagem, blob, sha256)),
      );
      if (!guardou) {
        // Cancelado no fim: fica no relay para quando a pessoa tocar. Apagado enquanto baixava: o
        // blob não serve a ninguém e sai do relay.
        if (await this.#exclusivo(() => anexoDe(banco, mensagem))) return null;
        await this.#apagarNoRelay(endereco, this.#circuitoDosAnexos());
        return null;
      }
      this.#emitir({ tipo: 'anexo', conversa: id, id: mensagem });
    }
    if (!(await this.#apagarNoRelay(endereco, this.#circuitoDosAnexos()))) return adiar();
    await this.#exclusivo(() =>
      mudarEstadoDoAnexo(banco, mensagem, ['apagar-no-relay'], 'baixado'),
    );
    return null;
  }
}
