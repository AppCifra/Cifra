// A agenda do app: lista de conversas, pedidos, busca local, nota pessoal, apelido, verificação e
// bloqueio (RF-07 a RF-12, RF-19, RF-37, RF-38), e a parte local das temporárias e da exclusão
// (RF-25, RF-28, RF-31, RF-50). Tudo aqui é local, sem rede: buscar o cartão de um ID novo, enviar,
// mudar o timer de um contato e apagar pra todos ficam no correio. A agenda divide com o correio o
// acesso exclusivo ao banco.
//
// - A nota pessoal é a conversa com o próprio ID. Nada dela entra na fila: não sai do aparelho.
// - Pedido de conversa: quem escreveu sem ser contato. Fica fora da lista e da busca até ser aceito.
//   Recusar apaga as mensagens dele de verdade; se ele escrever de novo, vira outro pedido.
// - Bloquear um pedido apaga as mensagens dele; um contato bloqueado fica na lista, com o
//   histórico. O correio descarta o que chega de um ID bloqueado.
// - As conversas ocultas ficam em outro banco: nada daqui as encontra.
// - A conversa aparece com as notas de sistema no meio (o timer mudou, uma mensagem expirou). A
//   mensagem apagada só neste celular some de tudo na hora e dá alguns segundos para desfazer.
import {
  BYTES_DO_ID_DA_MENSAGEM,
  formatarId,
  iguais,
  idDaChave,
  lerId,
  timerValido,
  type TipoDeArquivo,
} from '@cifra/protocol';
import { decifrarAnexo, prepararAnexo, type ArquivoParaEnviar } from '../anexos/cifra.ts';
import {
  anexoDe,
  anexosDoPedidoAceito,
  blobDe,
  COM_BLOB,
  guardarAnexo,
  mudarEstadoDoAnexo,
  type Anexo,
} from '../anexos/repositorio.ts';
import {
  ajustesDePrivacidade,
  ajustesDoTimer,
  baixarSozinho,
  mudarAjustesDePrivacidade,
  mudarBaixarSozinho,
  mudarTimerDaNota,
  mudarTimerPadrao,
  prazoDoBloqueioValido,
  type AjustesDePrivacidade,
  type AjustesDoTimer,
} from '../ajustes/repositorio.ts';
import type { Exclusivo } from '../banco/exclusivo.ts';
import { exportarBackup, type PreferenciasDoBackup } from '../backup/backup.ts';
import type { Identidade } from '../identidade/identidade.ts';
import { consultaDaBusca } from '../mensagens/busca.ts';
import { apagarDeVerdade, desfazerApagar, esconderParaApagar } from '../mensagens/exclusao.ts';
import { esvaziarFilaDe } from '../mensagens/fila.ts';
import { guardarNota, itensDa, type ItemDaConversa } from '../mensagens/notas.ts';
import {
  COLUNAS_DA_MENSAGEM,
  guardarMensagem,
  legendaAceita,
  lerRecebidas,
  mensagemDaLinha,
  mensagensDa,
  pendentesDa,
  textoAceito,
  visivel,
  type Mensagem,
} from '../mensagens/repositorio.ts';
import {
  aplicarTimerNasMensagens,
  aplicarTimerPadrao,
  PRAZO_DO_DESFAZER,
  prazoDaEnviada,
  ttlAceito,
} from '../mensagens/temporarias.ts';
import type { Armazenamento, LinhaSql } from '../portas/armazenamento.ts';
import type { Cripto } from '../portas/cripto.ts';
import type { Relogio } from '../portas/relogio.ts';
import { destinoDe, sessoesDe } from '../sessao/repositorio.ts';
import { numeroDeSeguranca } from './numero-de-seguranca.ts';
import {
  aceitarContato,
  apagarContato,
  bloquearContato,
  contatoDaLinha,
  contatoDe,
  desbloquearContato,
  LIMITE_DO_APELIDO,
  marcarVerificado,
  mudarApelido,
  type Contato,
} from './repositorio.ts';

/** Quantas mensagens a busca devolve, no máximo. */
const LIMITE_DA_BUSCA = 50;

/** Na busca pelo ID, só a partir de 4 caracteres: menos que isso acharia quase todo mundo. */
const MINIMO_PARA_BUSCAR_ID = 4;

export interface OpcoesDaAgenda {
  readonly cripto: Cripto;
  readonly banco: Armazenamento;
  readonly relogio: Relogio;
  readonly identidade: Identidade;
  /** O mesmo do correio: um acesso ao banco por vez. */
  readonly exclusivo: Exclusivo;
  /**
   * Com a nota pessoal (o padrão). A agenda do cofre das conversas ocultas não tem: lá só ficam
   * contatos.
   */
  readonly comNota?: boolean;
}

/** `nota`: a conversa consigo mesmo. `pedido`: quem escreveu sem ser contato (RF-07). */
export type TipoDaConversa = 'nota' | 'contato' | 'pedido';

/** Uma linha da lista de conversas (RF-11). */
export interface ResumoDaConversa {
  /** O ID do contato, XXXX-XXXX-XXXX-XXXX; na nota pessoal, o próprio. */
  readonly id: string;
  readonly tipo: TipoDaConversa;
  readonly apelido: string | null;
  readonly verificado: boolean;
  readonly bloqueado: boolean;
  /** O timer das mensagens temporárias da conversa, em segundos; 0 é sem timer (RF-25). */
  readonly timer: number;
  /** Prints bloqueados nesta conversa, nos dois celulares (RF-58); nunca na nota pessoal. */
  readonly printsBloqueados: boolean;
  /** A última mensagem: dá a prévia e o horário. */
  readonly ultima: Mensagem | null;
  readonly naoLidas: number;
  /** A última atividade, no relógio deste aparelho: ordena a lista. */
  readonly atividade: number;
}

export interface ResultadoDaBusca {
  /** As conversas cujo nome ou ID têm o texto. */
  readonly conversas: readonly ResumoDaConversa[];
  /** As mensagens que têm todas as palavras, das mais novas para as mais antigas. */
  readonly mensagens: readonly {
    readonly mensagem: Mensagem;
    readonly conversa: ResumoDaConversa;
  }[];
}

/**
 * - `id-invalido`: o texto não é um ID; `proprio-id`: a nota pessoal não tem contato.
 * - `desconhecido`: nenhuma conversa com o ID.
 * - `nao-e-pedido`: aceitar ou recusar o que não é pedido.
 * - `apelido-invalido`: mais de 40 caracteres ou caractere de controle.
 * - `texto-invalido`: vazio, acima de 3500 bytes ou com caractere que não existe.
 * - `timer-invalido`: fora de 10 s a 7 dias, ou acima do timer da conversa (RF-26).
 * - `anexo-invalido`: o arquivo passa do limite, ou o formato não é um dos aceitos.
 * - `ajuste-invalido`: um prazo do bloqueio sozinho que não está entre os do app (RF-40).
 */
export type CodigoDaAgenda =
  | 'id-invalido'
  | 'proprio-id'
  | 'desconhecido'
  | 'nao-e-pedido'
  | 'apelido-invalido'
  | 'texto-invalido'
  | 'anexo-invalido'
  | 'timer-invalido'
  | 'ajuste-invalido';

/** O anexo aberto na memória: nada dele vai para um arquivo (RF-36). */
export interface AnexoAberto {
  readonly arquivo: TipoDeArquivo;
  readonly formato: string;
  readonly bytes: Uint8Array;
  /** A capa do vídeo, em JPEG; `null` fora do vídeo. */
  readonly capa: Uint8Array | null;
}

/** Para quantas conversas uma mensagem pode ser encaminhada de uma vez (RF-54). */
export const LIMITE_DO_ENCAMINHAR = 5;

/**
 * O que uma mensagem leva quando é encaminhada (RF-54): o texto, ou o arquivo aberto na memória,
 * com a capa, a miniatura, as medidas e a legenda. Vai como mensagem nova, cifrada de novo.
 */
export type ParaEncaminhar =
  | { readonly tipo: 'texto'; readonly texto: string }
  | { readonly tipo: 'anexo'; readonly arquivo: ArquivoParaEnviar; readonly legenda: string };

export class ErroDaAgenda extends Error {
  readonly codigo: CodigoDaAgenda;

  constructor(codigo: CodigoDaAgenda) {
    super(codigo);
    this.codigo = codigo;
  }
}

/** Sem acento e sem diferença de maiúscula, como a busca nas mensagens. */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Para comparar nomes: também sem espaço nem pontuação, e "anon·K4RO" bate com "anon k4ro". */
function chaveDoNome(texto: string): string {
  return normalizar(texto).replace(/[^\p{L}\p{N}]/gu, '');
}

/** Apelido limpo: sem espaço nas pontas; vazio vira `null`, o nome padrão. */
export function lerApelido(texto: string): string | null {
  const apelido = texto.trim();
  if (apelido === '') return null;
  // Conta como o `length` do SQLite, que confere o mesmo limite no banco: por ponto de código.
  if (Array.from(apelido).length > LIMITE_DO_APELIDO || /\p{Cc}/u.test(apelido)) {
    throw new ErroDaAgenda('apelido-invalido');
  }
  return apelido;
}

const COLUNAS_DO_RESUMO = `c.contato, c.aceito, c.bloqueado, c.verificado, c.apelido,
  c.criado_em, c.timer, c.timer_desde, c.timer_por_avisar, c.prints_bloqueados, c.prints_desde,
  c.recebidas_ate, c.caixa, c.caixa_desde, ${COLUNAS_DA_MENSAGEM.split(', ')
    .map((coluna) => `m.${coluna}`)
    .join(', ')},
  (SELECT count(*) FROM mensagens n
    WHERE n.conversa = c.contato AND n.de_mim = 0 AND n.status = 'recebida'
      AND ${visivel('n')}) AS nao_lidas`;

/** A última atividade: a hora da última mensagem neste aparelho, ou de quando o contato entrou. */
function atividadeDe(ultima: Mensagem | null, criadoEm: number): number {
  if (!ultima) return criadoEm;
  return ultima.deMim ? ultima.enviadaEm : (ultima.recebidaEm ?? ultima.enviadaEm);
}

function ultimaDaLinha(linha: LinhaSql): Mensagem | null {
  return linha['id'] === null ? null : mensagemDaLinha(linha);
}

function resumoDaLinha(linha: LinhaSql): ResumoDaConversa {
  const contato: Contato = contatoDaLinha(linha);
  const ultima = ultimaDaLinha(linha);
  const naoLidas = linha['nao_lidas'];
  return {
    id: formatarId(contato.contato),
    tipo: contato.aceito ? 'contato' : 'pedido',
    apelido: contato.apelido,
    verificado: contato.verificado,
    bloqueado: contato.bloqueado,
    timer: contato.timer,
    printsBloqueados: contato.printsBloqueados,
    ultima,
    naoLidas: typeof naoLidas === 'number' ? naoLidas : 0,
    atividade: atividadeDe(ultima, contato.criadoEm),
  };
}

const maisRecentesPrimeiro = (a: ResumoDaConversa, b: ResumoDaConversa) =>
  b.atividade - a.atividade;

export class Agenda {
  readonly #o: OpcoesDaAgenda;
  readonly #meuId: Uint8Array;

  constructor(opcoes: OpcoesDaAgenda) {
    this.#o = opcoes;
    this.#meuId = idDaChave(opcoes.cripto, opcoes.identidade.assinatura.publicKey);
  }

  /** As conversas da lista: os contatos aceitos e a nota pessoal, a mais recente primeiro. */
  conversas(): Promise<ResumoDaConversa[]> {
    return this.#usar(async (banco) => (await this.#daLista(banco)).sort(maisRecentesPrimeiro));
  }

  /** Os pedidos de conversa que esperam resposta (RF-07). */
  pedidos(): Promise<ResumoDaConversa[]> {
    return this.#usar(async (banco) =>
      (await this.#resumos(banco, 'c.aceito = 0 AND c.bloqueado = 0')).sort(maisRecentesPrimeiro),
    );
  }

  /** Os IDs bloqueados que não eram contatos: vieram de pedidos, e aqui dá para desbloquear. */
  bloqueados(): Promise<ResumoDaConversa[]> {
    return this.#usar(async (banco) =>
      (await this.#resumos(banco, 'c.aceito = 0 AND c.bloqueado = 1')).sort(maisRecentesPrimeiro),
    );
  }

  /** A conversa com o ID, ou `null` se não há nenhuma. O próprio ID dá a nota pessoal. */
  conversa(id: string): Promise<ResumoDaConversa | null> {
    const contato = this.#id(id);
    return this.#usar(async (banco) => {
      if (iguais(contato, this.#meuId)) return this.#comNota() ? this.#resumoDaNota(banco) : null;
      const [resumo] = await this.#resumos(banco, 'c.contato = ?', [contato]);
      return resumo ?? null;
    });
  }

  /** As mensagens da conversa, na ordem em que entraram neste aparelho. */
  mensagens(id: string): Promise<Mensagem[]> {
    const contato = this.#id(id);
    return this.#usar((banco) => mensagensDa(banco, contato));
  }

  /** A conversa como aparece: as mensagens, em ordem, com as notas de sistema no meio. */
  itens(id: string): Promise<ItemDaConversa[]> {
    const contato = this.#id(id);
    return this.#usar((banco) => itensDa(banco, contato));
  }

  /**
   * Se a conversa tem mensagens sem timer: ao ligar o timer, a pessoa escolhe se elas também passam
   * a sumir.
   */
  temMensagensSemTimer(id: string): Promise<boolean> {
    const contato = this.#id(id);
    return this.#usar(async (banco) => {
      const linhas = await banco.consultar(
        `SELECT 1 AS existe FROM mensagens
          WHERE conversa = ? AND expira_em IS NULL AND ${visivel()} LIMIT 1`,
        [contato],
      );
      return linhas.length > 0;
    });
  }

  /**
   * Marca como lidas, só neste aparelho, as recebidas da conversa. A confirmação de leitura para o
   * contato sai pelo correio, e nunca para um pedido.
   */
  async marcarLidas(id: string): Promise<void> {
    const contato = this.#id(id);
    await this.#usar((banco) => lerRecebidas(banco, contato));
  }

  /**
   * Busca local, sem rede (RF-12): conversas pelo nome ou pelo ID, mensagens pelo conteúdo. Só
   * nos contatos aceitos e na nota pessoal: pedidos ficam de fora. O nome é o que a tela mostra
   * (`nomeDe`, que depende do idioma): o apelido, ou o nome de quem não tem apelido, como
   * "anon·K4RO", e o da nota pessoal. Sem `nomeDe`, vale só o apelido.
   */
  buscar(texto: string, nomeDe?: (resumo: ResumoDaConversa) => string): Promise<ResultadoDaBusca> {
    return this.#usar(async (banco) => {
      const lista = (await this.#daLista(banco)).sort(maisRecentesPrimeiro);
      const procurado = chaveDoNome(texto);
      const idProcurado = normalizar(texto.trim()).replace(/[\s-]/g, '');
      const nomeDa = (resumo: ResumoDaConversa) => (nomeDe ? nomeDe(resumo) : resumo.apelido);
      const conversas =
        procurado === ''
          ? []
          : lista.filter((resumo) => {
              const nome = nomeDa(resumo);
              if (nome !== null && chaveDoNome(nome).includes(procurado)) return true;
              return (
                resumo.tipo !== 'nota' &&
                idProcurado.length >= MINIMO_PARA_BUSCAR_ID &&
                resumo.id.replace(/-/g, '').toLowerCase().includes(idProcurado)
              );
            });

      const consulta = consultaDaBusca(texto);
      if (consulta === null) return { conversas, mensagens: [] };
      // A nota pessoal entra pelo próprio ID; sem ela, nenhuma mensagem tem essa conversa.
      const linhas = await banco.consultar(
        `SELECT ${COLUNAS_DA_MENSAGEM} FROM mensagens
          WHERE ordem IN (SELECT rowid FROM busca WHERE busca MATCH ?)
            AND (conversa = ? OR conversa IN (SELECT contato FROM contatos WHERE aceito = 1))
            AND ${visivel()}
          ORDER BY ordem DESC LIMIT ?`,
        [consulta, this.#comNota() ? this.#meuId : new Uint8Array(0), LIMITE_DA_BUSCA],
      );
      const porId = new Map(lista.map((resumo) => [resumo.id, resumo]));
      const mensagens = linhas.flatMap((linha) => {
        const mensagem = mensagemDaLinha(linha);
        const conversa = porId.get(formatarId(mensagem.conversa));
        return conversa ? [{ mensagem, conversa }] : [];
      });
      return { conversas, mensagens };
    });
  }

  /**
   * Os 12 grupos de 5 dígitos do número de segurança com o contato (RF-37). A chave dele vem da
   * sessão, ou do cartão conferido: as duas já foram ligadas ao ID.
   */
  async numeroDeSeguranca(id: string): Promise<string[]> {
    const contato = this.#contato(id);
    const chave = await this.#usar(async (banco) => {
      const [sessao] = await sessoesDe(banco, contato);
      return sessao?.chaveDoContato ?? (await destinoDe(banco, contato))?.cartao.chaveDeIdentidade;
    });
    if (!chave) throw new ErroDaAgenda('desconhecido');
    // As iterações rodam fora da vez do banco: o correio não espera por elas.
    const { cripto, identidade } = this.#o;
    return numeroDeSeguranca(cripto, identidade.assinatura.publicKey, chave);
  }

  /** Muda o apelido, que nunca sai do aparelho (RF-09). Vazio volta ao nome padrão. */
  async renomear(id: string, texto: string): Promise<void> {
    const contato = this.#contato(id);
    const apelido = lerApelido(texto);
    if (!(await this.#usar((banco) => mudarApelido(banco, contato, apelido)))) {
      throw new ErroDaAgenda('desconhecido');
    }
  }

  /** Marca ou remove a verificação, depois de comparar o número de segurança (RF-38). */
  async verificar(id: string, verificado: boolean): Promise<void> {
    const contato = this.#contato(id);
    if (!(await this.#usar((banco) => marcarVerificado(banco, contato, verificado)))) {
      throw new ErroDaAgenda('desconhecido');
    }
  }

  /**
   * O pedido passa a contato: entra na lista, e dá para responder. Começa com o timer padrão, se
   * quem escreveu não escolheu timer (RF-50). Os anexos dele passam a baixar pelo ajuste de baixar
   * sozinho (RF-57): o correio confere em seguida, com `conferirAnexos`.
   */
  aceitar(id: string): Promise<void> {
    const contato = this.#contato(id);
    return this.#usar((banco) =>
      banco.transacao(async (t) => {
        const atual = await this.#pedido(t, contato);
        const agora = this.#o.relogio.agora();
        await aceitarContato(t, atual.contato, agora);
        await aplicarTimerPadrao(t, atual.contato, agora);
        await anexosDoPedidoAceito(t, atual.contato);
      }),
    );
  }

  /** Recusa o pedido: as mensagens saem de verdade, e o pedido some (RNF-08). */
  recusar(id: string): Promise<void> {
    const contato = this.#contato(id);
    return this.#usar((banco) =>
      banco.transacao(async (t) => {
        await this.#pedido(t, contato);
        await apagarDeVerdade(t, { conversa: contato });
        await apagarContato(t, contato);
      }),
    );
  }

  /**
   * Bloqueia o ID (RF-08). O que ele mandar depois é descartado, sem aviso a ele, e nada mais sai
   * para ele: a fila dele se esvazia, e as minhas mensagens que o relay ainda não tinha aceitado
   * saem de verdade. Num pedido, as mensagens saem de verdade; num contato, o histórico fica.
   */
  bloquear(id: string): Promise<void> {
    const contato = this.#contato(id);
    return this.#usar((banco) =>
      banco.transacao(async (t) => {
        const atual = await contatoDe(t, contato);
        if (!atual?.aceito) await apagarDeVerdade(t, { conversa: contato });
        else await apagarDeVerdade(t, { mensagens: await pendentesDa(t, contato) });
        await esvaziarFilaDe(t, contato);
        await bloquearContato(t, contato, this.#o.relogio.agora());
      }),
    );
  }

  /** Desbloqueia. Um ID que não era contato volta a ser desconhecido: se escrever, vira pedido. */
  desbloquear(id: string): Promise<void> {
    const contato = this.#contato(id);
    return this.#usar(async (banco) => {
      const atual = await contatoDe(banco, contato);
      if (!atual) return;
      if (atual.aceito) await desbloquearContato(banco, contato);
      else await apagarContato(banco, contato);
    });
  }

  /**
   * Escreve na nota pessoal (RF-19). Fica só neste aparelho: nada entra na fila de saída. Sem `ttl`,
   * vai com o timer da nota; com, ele não passa do timer da nota (RF-26).
   */
  async escreverNota(texto: string, ttl?: number, resposta?: Uint8Array): Promise<Uint8Array> {
    if (!textoAceito(texto)) throw new ErroDaAgenda('texto-invalido');
    const { cripto, relogio } = this.#o;
    const id = cripto.randombytes_buf(BYTES_DO_ID_DA_MENSAGEM);
    await this.#usar(async (banco) => {
      const { timerDaNota } = await ajustesDoTimer(banco);
      const final = ttl ?? timerDaNota;
      if (!ttlAceito(final, timerDaNota)) throw new ErroDaAgenda('timer-invalido');
      const agora = relogio.agora();
      await guardarMensagem(banco, {
        id,
        conversa: this.#meuId,
        deMim: true,
        texto,
        resposta: resposta ?? null,
        enviadaEm: agora,
        recebidaEm: null,
        ttl: final,
        expiraEm: prazoDaEnviada(agora, final),
        // A nota não passa por pendente: já está onde vai ficar.
        status: 'enviada',
      });
    });
    return id;
  }

  /**
   * Guarda um anexo na nota pessoal: cifrado com chave própria, como os outros, mas nunca sobe ao
   * relay (RF-19). Devolve o ID da mensagem.
   */
  async anexarNaNota(
    arquivo: ArquivoParaEnviar,
    opcoes: {
      readonly legenda?: string;
      readonly ttl?: number;
      readonly resposta?: Uint8Array;
    } = {},
  ): Promise<Uint8Array> {
    const legenda = opcoes.legenda ?? '';
    if (!legendaAceita(legenda)) throw new ErroDaAgenda('texto-invalido');
    const preparado = prepararAnexo(this.#o.cripto, arquivo);
    if (!preparado) throw new ErroDaAgenda('anexo-invalido');
    const { cripto, relogio } = this.#o;
    const id = cripto.randombytes_buf(BYTES_DO_ID_DA_MENSAGEM);
    await this.#usar((banco) =>
      banco.transacao(async (t) => {
        const { timerDaNota } = await ajustesDoTimer(t);
        const final = opcoes.ttl ?? timerDaNota;
        if (!ttlAceito(final, timerDaNota)) throw new ErroDaAgenda('timer-invalido');
        const agora = relogio.agora();
        await guardarMensagem(t, {
          id,
          conversa: this.#meuId,
          deMim: true,
          tipo: arquivo.arquivo,
          texto: legenda,
          resposta: opcoes.resposta ?? null,
          enviadaEm: agora,
          recebidaEm: null,
          ttl: final,
          expiraEm: prazoDaEnviada(agora, final),
          status: 'enviada',
        });
        await guardarAnexo(t, id, preparado.anexo, 'local', {
          blob: preparado.blob,
          sha256: preparado.sha256,
        });
      }),
    );
    return id;
  }

  /**
   * Abre o anexo da mensagem na memória: confere e decifra o blob guardado aqui (RF-36). No vídeo,
   * vem também a capa. `null` se o anexo ainda não está aqui, não é desta conversa ou não abre.
   */
  async abrirAnexo(id: string, mensagem: Uint8Array): Promise<AnexoAberto | null> {
    const guardado = await this.#anexoGuardado(id, mensagem);
    if (!guardado) return null;
    const { anexo, blob } = guardado;
    // A decifração roda fora da vez do banco.
    const aberto = decifrarAnexo(this.#o.cripto, blob, anexo.chave, anexo.capa + anexo.tamanho);
    if (!aberto) return null;
    return {
      arquivo: anexo.arquivo,
      formato: anexo.formato,
      bytes: aberto.subarray(anexo.capa),
      capa: anexo.capa > 0 ? aberto.slice(0, anexo.capa) : null,
    };
  }

  /**
   * Só a capa do vídeo, em JPEG: sai do primeiro pedaço, sem decifrar o vídeo inteiro. `null` fora
   * do vídeo, ou se o anexo ainda não está aqui.
   */
  async abrirCapa(id: string, mensagem: Uint8Array): Promise<Uint8Array | null> {
    const guardado = await this.#anexoGuardado(id, mensagem);
    if (!guardado || guardado.anexo.capa === 0) return null;
    const { anexo, blob } = guardado;
    const claro = anexo.capa + anexo.tamanho;
    return decifrarAnexo(this.#o.cripto, blob, anexo.chave, claro, anexo.capa);
  }

  /**
   * O que a mensagem leva quando é encaminhada (RF-54), aberto na memória. `null` se ela não está
   * nesta conversa, ou se o anexo ainda não está aqui.
   */
  async paraEncaminhar(id: string, mensagem: Uint8Array): Promise<ParaEncaminhar | null> {
    const conversa = this.#id(id);
    const original = await this.#usar((banco) => this.#mensagemDa(banco, conversa, mensagem));
    if (!original) return null;
    if (original.tipo === 'texto') return { tipo: 'texto', texto: original.texto };
    const resumo = await this.#usar((banco) => anexoDe(banco, mensagem));
    const aberto = await this.abrirAnexo(id, mensagem);
    if (!resumo || !aberto) return null;
    return {
      tipo: 'anexo',
      arquivo: {
        arquivo: aberto.arquivo,
        formato: aberto.formato,
        bytes: aberto.bytes,
        ...(aberto.capa ? { capa: aberto.capa } : {}),
        ...(resumo.miniatura.length > 0 ? { miniatura: resumo.miniatura } : {}),
        largura: resumo.largura,
        altura: resumo.altura,
        duracao: resumo.duracao,
      },
      legenda: original.texto,
    };
  }

  /**
   * A pessoa tocou para baixar um anexo que estava parado: cancelado, ou que chegou com o baixar
   * sozinho desligado (RF-57). O correio confere em seguida (`conferirAnexos`). Devolve `false` se
   * não havia o que baixar.
   */
  baixarAnexo(id: string, mensagem: Uint8Array): Promise<boolean> {
    const conversa = this.#id(id);
    return this.#usar(async (banco) =>
      (await this.#mensagemDa(banco, conversa, mensagem))
        ? mudarEstadoDoAnexo(banco, mensagem, ['manual'], 'baixar')
        : false,
    );
  }

  /**
   * A pessoa cancelou o download: o anexo para e só volta a baixar quando ela tocar. O que estava
   * vindo é descartado; o correio derruba a transferência (`cancelarTransferencia`).
   */
  pararDownload(id: string, mensagem: Uint8Array): Promise<boolean> {
    const conversa = this.#id(id);
    return this.#usar(async (banco) =>
      (await this.#mensagemDa(banco, conversa, mensagem))
        ? mudarEstadoDoAnexo(banco, mensagem, ['baixar'], 'manual')
        : false,
    );
  }

  /**
   * A pessoa cancelou o envio de um anexo que ainda não subiu: a mensagem sai de verdade, e nada
   * dela chega ao contato. Devolve `false` se o anexo já tinha subido (aí, só apagando).
   */
  cancelarEnvio(id: string, mensagem: Uint8Array): Promise<boolean> {
    const conversa = this.#id(id);
    return this.#usar((banco) =>
      banco.transacao(async (t) => {
        const original = await this.#mensagemDa(t, conversa, mensagem);
        if (!original?.deMim || (await anexoDe(t, mensagem))?.estado !== 'enviar') return false;
        await apagarDeVerdade(t, { mensagens: [mensagem] });
        return true;
      }),
    );
  }

  /**
   * O timer das notas pessoais (RF-25), só neste aparelho. Como numa conversa, o limite novo chega
   * às notas que já estão aqui, e com `anteriores` as sem timer também passam a ter.
   */
  mudarTimerDaNota(segundos: number, anteriores: boolean): Promise<boolean> {
    if (!timerValido(segundos)) return Promise.reject(new ErroDaAgenda('timer-invalido'));
    const comAnteriores = anteriores && segundos > 0;
    return this.#usar((banco) =>
      banco.transacao(async (t) => {
        const { timerDaNota } = await ajustesDoTimer(t);
        if (timerDaNota === segundos && !comAnteriores) return false;
        const agora = this.#o.relogio.agora();
        await mudarTimerDaNota(t, segundos);
        await aplicarTimerNasMensagens(t, this.#meuId, segundos, agora, comAnteriores);
        await guardarNota(t, this.#meuId, {
          tipo: 'timer',
          segundos,
          anteriores: comAnteriores,
          instante: agora,
        });
        return true;
      }),
    );
  }

  /** O timer padrão das conversas novas e o da nota pessoal. */
  ajustesDoTimer(): Promise<AjustesDoTimer> {
    return this.#usar((banco) => ajustesDoTimer(banco));
  }

  /** Toda conversa nova passa a começar com este timer (RF-50); as que já existem não mudam. */
  async mudarTimerPadrao(segundos: number): Promise<void> {
    if (!timerValido(segundos)) throw new ErroDaAgenda('timer-invalido');
    await this.#usar((banco) => mudarTimerPadrao(banco, segundos));
  }

  /** Se os anexos que chegam baixam sozinhos (RF-57). Ligado por padrão. */
  baixarSozinho(): Promise<boolean> {
    return this.#usar((banco) => baixarSozinho(banco));
  }

  /**
   * Liga ou desliga o baixar sozinho. Vale para o que chegar daqui em diante e para os pedidos
   * aceitos depois; o que já chegou fica como está.
   */
  async mudarBaixarSozinho(ligado: boolean): Promise<void> {
    await this.#usar((banco) => mudarBaixarSozinho(banco, ligado));
  }

  /**
   * Confirmação de leitura, indicador de digitação, o prazo do bloqueio sozinho e o bloqueio de
   * prints (RF-17, RF-18, RF-40, RF-41).
   */
  ajustesDePrivacidade(): Promise<AjustesDePrivacidade> {
    return this.#usar((banco) => ajustesDePrivacidade(banco));
  }

  /** Muda só os ajustes de privacidade que vierem. O prazo tem de ser um dos do app. */
  async mudarAjustesDePrivacidade(mudanca: Partial<AjustesDePrivacidade>): Promise<void> {
    const { bloquearSozinho } = mudanca;
    if (bloquearSozinho !== undefined && !prazoDoBloqueioValido(bloquearSozinho)) {
      throw new ErroDaAgenda('ajuste-invalido');
    }
    await this.#usar((banco) => mudarAjustesDePrivacidade(banco, mudanca));
  }

  /**
   * Apaga só neste celular: as mensagens somem na hora e saem de verdade em alguns segundos, se
   * ninguém desfizer. Vale em qualquer conversa, inclusive a nota pessoal. Devolve até quando dá
   * para desfazer.
   */
  async apagarSoAqui(id: string, mensagens: readonly Uint8Array[]): Promise<number> {
    const conversa = this.#id(id);
    const ate = this.#o.relogio.agora() + PRAZO_DO_DESFAZER;
    await this.#usar((banco) =>
      banco.transacao((t) => esconderParaApagar(t, conversa, mensagens, ate)),
    );
    return ate;
  }

  /** Desfaz o apagar só neste celular, se o prazo não acabou. Devolve `true` se elas voltaram. */
  async desfazer(id: string, mensagens: readonly Uint8Array[]): Promise<boolean> {
    const conversa = this.#id(id);
    const voltaram = await this.#usar((banco) =>
      banco.transacao((t) => desfazerApagar(t, conversa, mensagens, this.#o.relogio.agora())),
    );
    return voltaram > 0;
  }

  /**
   * Apaga a conversa deste aparelho (RF-31): as mensagens e as notas saem de verdade, pela mesma
   * exclusão das temporárias. O contato, a sessão e o timer ficam; o outro lado não muda.
   */
  apagarConversa(id: string): Promise<void> {
    const conversa = this.#id(id);
    return this.#usar((banco) =>
      banco.transacao(async (t) => {
        await apagarDeVerdade(t, { conversa });
      }),
    );
  }

  /**
   * O backup deste banco (RF-46): os contatos, os bloqueados, os timers e os ajustes, com o tema e
   * o idioma, cifrados com a chave que sai das palavras. Nunca as mensagens: só o banco principal
   * tem o que vai no backup, e a agenda do cofre não exporta nada.
   */
  exportarBackup(preferencias: PreferenciasDoBackup): Promise<Uint8Array> {
    if (!this.#comNota()) return Promise.reject(new ErroDaAgenda('desconhecido'));
    const { cripto, identidade, relogio } = this.#o;
    return this.#usar((banco) =>
      exportarBackup(cripto, banco, identidade, preferencias, relogio.agora()),
    );
  }

  // ---------------------------------------------------------------- uso interno

  #usar<T>(operacao: (banco: Armazenamento) => Promise<T>): Promise<T> {
    return this.#o.exclusivo(() => operacao(this.#o.banco));
  }

  #comNota(): boolean {
    return this.#o.comNota ?? true;
  }

  /** Os contatos aceitos e, se esta agenda tem, a nota pessoal. */
  async #daLista(banco: Armazenamento): Promise<ResumoDaConversa[]> {
    const contatos = await this.#resumos(banco, 'c.aceito = 1');
    return this.#comNota() ? [...contatos, await this.#resumoDaNota(banco)] : contatos;
  }

  #id(id: string): Uint8Array {
    const bytes = lerId(id);
    if (!bytes) throw new ErroDaAgenda('id-invalido');
    return bytes;
  }

  /** O ID de um contato: a nota pessoal não tem apelido, verificação nem bloqueio. */
  #contato(id: string): Uint8Array {
    const contato = this.#id(id);
    if (iguais(contato, this.#meuId)) throw new ErroDaAgenda('proprio-id');
    return contato;
  }

  /** A mensagem, se ela é desta conversa e aparece. */
  async #mensagemDa(
    banco: Armazenamento,
    conversa: Uint8Array,
    mensagem: Uint8Array,
  ): Promise<Mensagem | null> {
    const [linha] = await banco.consultar(
      `SELECT ${COLUNAS_DA_MENSAGEM} FROM mensagens WHERE id = ? AND conversa = ? AND ${visivel()}`,
      [mensagem, conversa],
    );
    return linha ? mensagemDaLinha(linha) : null;
  }

  /** O anexo da mensagem e o blob dele, se ela é desta conversa e o blob está aqui. */
  #anexoGuardado(
    id: string,
    mensagem: Uint8Array,
  ): Promise<{ readonly anexo: Anexo; readonly blob: Uint8Array } | null> {
    const conversa = this.#id(id);
    return this.#usar(async (banco) => {
      if (!(await this.#mensagemDa(banco, conversa, mensagem))) return null;
      const anexo = await anexoDe(banco, mensagem);
      if (!anexo || !COM_BLOB.includes(anexo.estado)) return null;
      const blob = await blobDe(banco, mensagem);
      return blob ? { anexo, blob } : null;
    });
  }

  async #pedido(banco: Armazenamento, contato: Uint8Array): Promise<Contato> {
    const atual = await contatoDe(banco, contato);
    if (!atual) throw new ErroDaAgenda('desconhecido');
    if (atual.aceito || atual.bloqueado) throw new ErroDaAgenda('nao-e-pedido');
    return atual;
  }

  async #resumos(
    banco: Armazenamento,
    filtro: string,
    parametros: readonly Uint8Array[] = [],
  ): Promise<ResumoDaConversa[]> {
    const linhas = await banco.consultar(
      `SELECT ${COLUNAS_DO_RESUMO} FROM contatos c
         LEFT JOIN mensagens m
           ON m.ordem = (SELECT max(ordem) FROM mensagens
                          WHERE conversa = c.contato AND ${visivel()})
        WHERE ${filtro}`,
      parametros,
    );
    return linhas.map(resumoDaLinha);
  }

  async #resumoDaNota(banco: Armazenamento): Promise<ResumoDaConversa> {
    const [linha] = await banco.consultar(
      `SELECT ${COLUNAS_DA_MENSAGEM} FROM mensagens WHERE conversa = ? AND ${visivel()}
        ORDER BY ordem DESC LIMIT 1`,
      [this.#meuId],
    );
    const ultima = linha ? mensagemDaLinha(linha) : null;
    return {
      id: this.#o.identidade.id,
      tipo: 'nota',
      apelido: null,
      // É você: as chaves são as suas. O design mostra o selo na nota pessoal.
      verificado: true,
      bloqueado: false,
      timer: (await ajustesDoTimer(banco)).timerDaNota,
      printsBloqueados: false,
      ultima,
      naoLidas: 0,
      // Sem notas, a nota pessoal fica no fim da lista.
      atividade: atividadeDe(ultima, 0),
    };
  }
}
