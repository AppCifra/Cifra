// Envio e recebimento no banco, sem rede: cifrar e pôr na fila, abrir e decifrar o que chegou. Cada
// função roda numa transação de quem chama, e o estado da catraca só muda junto com o resto: se
// algo falha, nada fica pela metade.
//
// Contatos: só sai conteúdo para contato aceito e não bloqueado. O que chega de um ID desconhecido
// vira pedido de conversa (RF-07); o que chega de um ID bloqueado é decifrado só para a sessão
// continuar em dia e é descartado, sem nada guardado (RF-08).
//
// Temporárias e apagar pra todos: o texto sai com o timer da conversa, ou com um menor escolhido
// para ele, e chega com o teto do timer da conversa daqui; o que já chega vencido não é guardado e
// deixa a nota (RF-28). Entre duas mudanças do timer vale a mais nova, pelo relógio de quem mudou
// (no empate, o timer maior): os dois lados acabam no mesmo timer. Apagar pra todos tira as
// mensagens dos dois lados, só dentro da própria conversa (RF-30).
//
// Prints e apagar a conversa: o bloqueio de prints na conversa segue a mesma regra do timer (vale a
// mudança mais nova; no empate, bloqueado), com nota nos dois lados (RF-58). Apagar a conversa nos
// dois tira tudo daqui e, do outro lado, o que veio daqui e o que de lá já tinha chegado aqui
// (RF-59).
//
// Conversas ocultas: o contato que oculta a conversa (ou a reexibe) avisa para qual caixa ela vai
// daqui em diante. Quem recebe guarda a caixa e manda de novo, para ela, o que mandou depois da
// última mensagem que já tinha chegado do outro lado: alguma pode ter ido para a caixa antiga no
// caminho. Do outro lado, a cópia repetida é descartada pelo ID (RF-16), e nenhuma mensagem se
// perde na troca.
import {
  BYTES_DO_ID_DA_MENSAGEM,
  iguais,
  idDaChave,
  MAXIMO_DE_APAGADAS,
  timerValido,
  type AberturaDaSessao,
  type DadosDoAnexo,
  type Cartao,
  type Conteudo,
  type Interior,
  type Prekey,
} from '@cifra/protocol';
import {
  apagarPrekeyAvulsa,
  parDaPrekeyAssinada,
  privadaDaPrekeyAvulsa,
} from '../cartao/publicacao.ts';
import {
  contatoDe,
  esquecerCaixaDoContato,
  marcarRecebidaAte,
  marcarTimerAvisado,
  mudarCaixaDoContato,
  mudarPrintsDoContato,
  mudarTimerDoContato,
  registrarPedido,
  type Contato,
} from '../contatos/repositorio.ts';
import type { Identidade } from '../identidade/identidade.ts';
import type { Armazenamento } from '../portas/armazenamento.ts';
import type { Cripto } from '../portas/cripto.ts';
import type { GerarPar } from '../sessao/catraca.ts';
import {
  baseJaVista,
  destinoDe,
  guardarSessoes,
  marcarDestinoDesatualizado,
  registrarBase,
  sessoesDe,
} from '../sessao/repositorio.ts';
import {
  cifrarNaSessao,
  decifrarNaSessao,
  sessaoDeQuemAbre,
  sessaoDeQuemResponde,
  type Sessao,
} from '../sessao/sessao.ts';
import { anexoDe, estadoDoQueChega, guardarAnexo } from '../anexos/repositorio.ts';
import { apagarDeVerdade } from './exclusao.ts';
import {
  enfileirar,
  itensDaFilaDe,
  tirarDaFila,
  tirarMensagemDaFila,
  trocarPacote,
} from './fila.ts';
import { guardarNota } from './notas.ts';
import { abrirPacote, selarPacote } from './pacote.ts';
import {
  COLUNAS_DA_MENSAGEM,
  guardarMensagem,
  idsDaConversa,
  marcarLidasPeloContato,
  mensagemDaLinha,
  mensagemPeloId,
  visivel,
  type Mensagem,
} from './repositorio.ts';
import {
  aplicarTimerNasMensagens,
  prazoDaEnviada,
  prazoDaRecebida,
  ttlAceito,
} from './temporarias.ts';

export interface Contexto {
  readonly cripto: Cripto;
  readonly identidade: Identidade;
  readonly gerarPar: GerarPar;
}

/** Não há sessão com o contato: é preciso buscar o cartão dele antes (RF-06). */
export class SemSessao extends Error {}

/** O ID não é contato aceito (é um pedido, ou nunca escreveu): aceite antes de responder. */
export class NaoAceito extends Error {}

/** O ID está bloqueado: nada sai para ele. */
export class Bloqueado extends Error {}

/** O timer fora do que a conversa aceita: acima do dela, ou fora de 10 s a 7 dias (RF-26). */
export class TimerInvalido extends Error {}

/** O aviso do timer que o contato ainda não recebeu: o padrão, que espera a primeira mensagem. */
function avisoDoTimer(cripto: Cripto, situacao: Contato): Conteudo {
  return {
    tipo: 'timer',
    id: cripto.randombytes_buf(BYTES_DO_ID_DA_MENSAGEM),
    enviadaEm: situacao.timerDesde,
    ttl: 0,
    segundos: situacao.timer,
    anteriores: false,
  };
}

/**
 * O conteúdo de uma mensagem que já saiu daqui, para cifrar de novo: o mesmo ID, o mesmo envio e o
 * mesmo timer. O anexo vai com a mesma mensagem do anexo: o blob continua no relay. `null` se o
 * anexo não está mais aqui.
 */
async function conteudoGuardado(
  banco: Armazenamento,
  mensagem: Mensagem,
): Promise<Conteudo | null> {
  const comum = { id: mensagem.id, enviadaEm: mensagem.enviadaEm, ttl: mensagem.ttl };
  const resposta = mensagem.resposta ? { resposta: mensagem.resposta } : {};
  if (mensagem.tipo === 'texto') {
    return { ...comum, ...resposta, tipo: 'texto', texto: mensagem.texto };
  }
  const anexo = await anexoDe(banco, mensagem.id);
  return anexo ? { ...comum, ...resposta, tipo: 'anexo', anexo, legenda: mensagem.texto } : null;
}

/**
 * Até onde as mensagens do contato já chegaram aqui: o `enviadaEm` mais novo, no relógio dele; 0 se
 * nenhuma. Mensagens que chegaram antes da migração 8 não marcaram `recebidas_ate`: a maior das que
 * ainda estão aqui completa.
 */
export async function recebidasAte(
  banco: Armazenamento,
  contato: Uint8Array,
  situacao: Contato,
): Promise<number> {
  const [linha] = await banco.consultar(
    'SELECT coalesce(max(enviada_em), 0) AS ate FROM mensagens WHERE conversa = ? AND de_mim = 0',
    [contato],
  );
  const guardada = linha?.['ate'];
  return Math.max(situacao.recebidasAte, typeof guardada === 'number' ? guardada : 0);
}

/**
 * Cifra o conteúdo na sessão atual com o contato, guarda a sessão avançada e põe o pacote na fila.
 * Texto também entra nas mensagens, como pendente. Só para contato aceito e não bloqueado. Se o
 * timer padrão ainda não foi avisado ao contato, o aviso sai antes, na mesma sessão.
 */
export async function enfileirarConteudo(
  { cripto, identidade }: Contexto,
  banco: Armazenamento,
  contato: Uint8Array,
  conteudo: Conteudo,
  agora: number,
): Promise<void> {
  const [atual, ...anteriores] = await sessoesDe(banco, contato);
  if (!atual) throw new SemSessao('sem sessão');
  const situacao = await contatoDe(banco, contato);
  if (situacao?.bloqueado) throw new Bloqueado('bloqueado');
  if (!situacao?.aceito) throw new NaoAceito('não aceito');
  const lista: Conteudo[] = [];
  if (situacao.timerPorAvisar) {
    if (conteudo.tipo !== 'timer') lista.push(avisoDoTimer(cripto, situacao));
    await marcarTimerAvisado(banco, contato);
  }
  lista.push(conteudo);

  let sessao = atual;
  for (const item of lista) {
    const cifrada = cifrarNaSessao(cripto, identidade, sessao, item);
    sessao = cifrada.sessao;
    const pacote = selarPacote(cripto, cifrada.interior, sessao.chaveDoContato);
    const mensagem = item.tipo === 'texto' || item.tipo === 'anexo';
    if (mensagem) {
      await guardarMensagem(banco, {
        id: item.id,
        conversa: contato,
        deMim: true,
        tipo: item.tipo === 'anexo' ? item.anexo.arquivo : 'texto',
        texto: item.tipo === 'anexo' ? item.legenda : item.texto,
        resposta: item.resposta ?? null,
        enviadaEm: item.enviadaEm,
        recebidaEm: null,
        ttl: item.ttl,
        expiraEm: prazoDaEnviada(item.enviadaEm, item.ttl),
        status: 'pendente',
      });
    }
    await enfileirar(banco, contato, mensagem ? item.id : null, pacote, agora);
  }
  await guardarSessoes(banco, contato, [sessao, ...anteriores]);
}

/**
 * O "digitando" para o contato (RF-18): cifrado na sessão atual, que avança e fica guardada, mas
 * fora da fila de saída. Quem chama deposita na hora ou descarta: um "digitando" atrasado não serve
 * para nada, e na fila ele seguraria as mensagens. Só para contato aceito e não bloqueado.
 */
export async function cifrarDigitacao(
  { cripto, identidade }: Contexto,
  banco: Armazenamento,
  contato: Uint8Array,
  digitando: boolean,
  agora: number,
): Promise<Uint8Array> {
  const [atual, ...anteriores] = await sessoesDe(banco, contato);
  if (!atual) throw new SemSessao('sem sessão');
  const situacao = await contatoDe(banco, contato);
  if (situacao?.bloqueado) throw new Bloqueado('bloqueado');
  if (!situacao?.aceito) throw new NaoAceito('não aceito');
  const cifrada = cifrarNaSessao(cripto, identidade, atual, {
    tipo: 'digitando',
    id: cripto.randombytes_buf(BYTES_DO_ID_DA_MENSAGEM),
    enviadaEm: agora,
    ttl: 0,
    digitando,
  });
  await guardarSessoes(banco, contato, [cifrada.sessao, ...anteriores]);
  return selarPacote(cripto, cifrada.interior, cifrada.sessao.chaveDoContato);
}

/**
 * O aviso de caixa para o contato: a conversa vai daqui em diante para `caixa`, a de uma conversa
 * oculta, ou, com `null`, para a caixa do cartão. `enviadaEm` é a hora da mudança: do outro lado
 * vale a mais nova. Leva até onde as mensagens dele já chegaram aqui, e ele manda de novo o que
 * mandou depois. Só para contato aceito e não bloqueado.
 */
async function avisoDeCaixa(
  { cripto }: Contexto,
  banco: Armazenamento,
  contato: Uint8Array,
  caixa: Uint8Array | null,
  enviadaEm: number,
): Promise<Conteudo> {
  const situacao = await contatoDe(banco, contato);
  if (situacao?.bloqueado) throw new Bloqueado('bloqueado');
  if (!situacao?.aceito) throw new NaoAceito('não aceito');
  return {
    tipo: 'caixa',
    id: cripto.randombytes_buf(BYTES_DO_ID_DA_MENSAGEM),
    enviadaEm,
    ttl: 0,
    caixa,
    ate: await recebidasAte(banco, contato, situacao),
  };
}

/**
 * O aviso de caixa cifrado na sessão atual, que avança e fica guardada, fora da fila: quem chama
 * deposita na hora, direto, e espera o relay aceitar antes de mudar a conversa de banco.
 */
export async function cifrarAvisoDeCaixa(
  contexto: Contexto,
  banco: Armazenamento,
  contato: Uint8Array,
  caixa: Uint8Array | null,
  enviadaEm: number,
): Promise<Uint8Array> {
  const conteudo = await avisoDeCaixa(contexto, banco, contato, caixa, enviadaEm);
  const [atual, ...anteriores] = await sessoesDe(banco, contato);
  if (!atual) throw new SemSessao('sem sessão');
  const cifrada = cifrarNaSessao(contexto.cripto, contexto.identidade, atual, conteudo);
  await guardarSessoes(banco, contato, [cifrada.sessao, ...anteriores]);
  return selarPacote(contexto.cripto, cifrada.interior, cifrada.sessao.chaveDoContato);
}

/** O aviso de caixa pela fila: para repetir um aviso que pode não ter chegado, ou desfazer um. */
export async function enfileirarAvisoDeCaixa(
  contexto: Contexto,
  banco: Armazenamento,
  contato: Uint8Array,
  caixa: Uint8Array | null,
  enviadaEm: number,
  agora: number,
): Promise<void> {
  const conteudo = await avisoDeCaixa(contexto, banco, contato, caixa, enviadaEm);
  await enfileirarConteudo(contexto, banco, contato, conteudo, agora);
}

/**
 * O texto que sai para o contato (RF-13, RF-26). Sem `ttl`, vai com o timer da conversa; com, ele
 * não pode passar do timer da conversa, que conta a partir de agora, o envio (RF-27).
 */
export async function enfileirarTexto(
  contexto: Contexto,
  banco: Armazenamento,
  contato: Uint8Array,
  texto: {
    readonly id: Uint8Array;
    readonly texto: string;
    readonly ttl?: number;
    readonly resposta?: Uint8Array;
  },
  agora: number,
): Promise<void> {
  const timer = (await contatoDe(banco, contato))?.timer ?? 0;
  const ttl = texto.ttl ?? timer;
  if (!ttlAceito(ttl, timer)) throw new TimerInvalido('timer');
  await enfileirarConteudo(
    contexto,
    banco,
    contato,
    {
      tipo: 'texto',
      id: texto.id,
      enviadaEm: agora,
      ttl,
      texto: texto.texto,
      ...(texto.resposta ? { resposta: texto.resposta } : {}),
    },
    agora,
  );
}

/** O anexo que sai: o arquivo já cifrado (o blob), com o que abre ele na mensagem. */
export interface AnexoQueSai {
  readonly id: Uint8Array;
  readonly anexo: DadosDoAnexo;
  readonly blob: Uint8Array;
  /** SHA-256 do arquivo, para as duas pessoas compararem. */
  readonly sha256: Uint8Array;
  readonly legenda: string;
  readonly ttl?: number;
  readonly resposta?: Uint8Array;
}

/**
 * O anexo que sai para o contato (RF-32 a RF-35): a mensagem entra na fila, e o blob sobe ao relay
 * antes dela sair (a entrega cuida disso). Timer como no texto (RF-26).
 */
export async function enfileirarAnexo(
  contexto: Contexto,
  banco: Armazenamento,
  contato: Uint8Array,
  saida: AnexoQueSai,
  agora: number,
): Promise<void> {
  const timer = (await contatoDe(banco, contato))?.timer ?? 0;
  const ttl = saida.ttl ?? timer;
  if (!ttlAceito(ttl, timer)) throw new TimerInvalido('timer');
  await enfileirarConteudo(
    contexto,
    banco,
    contato,
    {
      tipo: 'anexo',
      id: saida.id,
      enviadaEm: agora,
      ttl,
      anexo: saida.anexo,
      legenda: saida.legenda,
      ...(saida.resposta ? { resposta: saida.resposta } : {}),
    },
    agora,
  );
  await guardarAnexo(banco, saida.id, saida.anexo, 'enviar', {
    blob: saida.blob,
    sha256: saida.sha256,
  });
}

/**
 * O timer da conversa com o contato muda aqui (RF-25): a nota entra na conversa, o limite novo chega
 * às mensagens que já estão nela e o contato recebe o aviso, para usar o mesmo. Com `anteriores`,
 * as mensagens sem timer também passam a ter. Devolve `false` se nada mudou.
 */
export async function mudarTimerDaConversa(
  contexto: Contexto,
  banco: Armazenamento,
  contato: Uint8Array,
  pedido: { readonly segundos: number; readonly anteriores: boolean },
  agora: number,
): Promise<boolean> {
  const { segundos } = pedido;
  if (!timerValido(segundos)) throw new TimerInvalido('timer');
  const anteriores = pedido.anteriores && segundos > 0;
  const situacao = await contatoDe(banco, contato);
  if (situacao?.bloqueado) throw new Bloqueado('bloqueado');
  if (!situacao?.aceito) throw new NaoAceito('não aceito');
  if (situacao.timer === segundos && !anteriores) return false;
  // A mudança daqui vem depois da última conhecida, mesmo com o relógio do contato adiantado: senão
  // o contato a acharia velha e ficaria com o timer anterior.
  const desde = Math.max(agora, situacao.timerDesde + 1);
  await mudarTimerDoContato(banco, contato, { segundos, desde, porAvisar: false });
  await aplicarTimerNasMensagens(banco, contato, segundos, agora, anteriores);
  await guardarNota(banco, contato, { tipo: 'timer', segundos, anteriores, instante: agora });
  await enfileirarConteudo(
    contexto,
    banco,
    contato,
    {
      tipo: 'timer',
      id: contexto.cripto.randombytes_buf(BYTES_DO_ID_DA_MENSAGEM),
      enviadaEm: desde,
      ttl: 0,
      segundos,
      anteriores,
    },
    agora,
  );
  return true;
}

/**
 * Apaga pra todos (RF-30): as mensagens desta conversa, de qualquer um dos lados e sem limite de
 * tempo, saem daqui de verdade, e o contato recebe o pedido de apagar as dele. Devolve as que
 * saíram; ID de outra conversa é ignorado.
 */
export async function apagarParaOsDois(
  contexto: Contexto,
  banco: Armazenamento,
  contato: Uint8Array,
  mensagens: readonly Uint8Array[],
  agora: number,
): Promise<Uint8Array[]> {
  const situacao = await contatoDe(banco, contato);
  if (situacao?.bloqueado) throw new Bloqueado('bloqueado');
  if (!situacao?.aceito) throw new NaoAceito('não aceito');
  const ids = await idsDaConversa(banco, contato, mensagens);
  if (ids.length === 0) return [];
  await apagarDeVerdade(banco, { mensagens: ids });
  for (let inicio = 0; inicio < ids.length; inicio += MAXIMO_DE_APAGADAS) {
    await enfileirarConteudo(
      contexto,
      banco,
      contato,
      {
        tipo: 'apagar',
        id: contexto.cripto.randombytes_buf(BYTES_DO_ID_DA_MENSAGEM),
        enviadaEm: agora,
        ttl: 0,
        apagadas: ids.slice(inicio, inicio + MAXIMO_DE_APAGADAS),
      },
      agora,
    );
  }
  return ids;
}

/**
 * Os prints da conversa com o contato mudam aqui (RF-58): a nota entra na conversa e o contato
 * recebe o aviso, para valer nos dois celulares. Devolve `false` se nada mudou.
 */
export async function mudarPrintsDaConversa(
  contexto: Contexto,
  banco: Armazenamento,
  contato: Uint8Array,
  bloqueados: boolean,
  agora: number,
): Promise<boolean> {
  const situacao = await contatoDe(banco, contato);
  if (situacao?.bloqueado) throw new Bloqueado('bloqueado');
  if (!situacao?.aceito) throw new NaoAceito('não aceito');
  if (situacao.printsBloqueados === bloqueados) return false;
  // Como no timer: a mudança daqui vem depois da última conhecida, mesmo com o relógio do contato
  // adiantado.
  const desde = Math.max(agora, situacao.printsDesde + 1);
  await mudarPrintsDoContato(banco, contato, { bloqueados, desde });
  await guardarNota(banco, contato, { tipo: 'prints', bloqueados, instante: agora });
  await enfileirarConteudo(
    contexto,
    banco,
    contato,
    {
      tipo: 'prints',
      id: contexto.cripto.randombytes_buf(BYTES_DO_ID_DA_MENSAGEM),
      enviadaEm: desde,
      ttl: 0,
      bloqueados,
    },
    agora,
  );
  return true;
}

/**
 * Apaga a conversa nos dois celulares (RF-59): aqui sai tudo, mensagens e notas, pela exclusão
 * real; o contato recebe o pedido com até onde as mensagens dele já tinham chegado aqui, e apaga o
 * mesmo lá. Contato, sessão, timer e prints ficam.
 */
export async function apagarConversaParaOsDois(
  contexto: Contexto,
  banco: Armazenamento,
  contato: Uint8Array,
  agora: number,
): Promise<void> {
  const situacao = await contatoDe(banco, contato);
  if (situacao?.bloqueado) throw new Bloqueado('bloqueado');
  if (!situacao?.aceito) throw new NaoAceito('não aceito');
  const ate = await recebidasAte(banco, contato, situacao);
  await apagarDeVerdade(banco, { conversa: contato });
  await enfileirarConteudo(
    contexto,
    banco,
    contato,
    {
      tipo: 'apagarConversa',
      id: contexto.cripto.randombytes_buf(BYTES_DO_ID_DA_MENSAGEM),
      enviadaEm: agora,
      ttl: 0,
      ate,
    },
    agora,
  );
}

export type Recebimento =
  /** Não decifrou, não era para este aparelho ou repetiu uma mensagem inicial guardada. */
  | { readonly tipo: 'descartado' }
  /**
   * Decifrou, mas o conteúdo não segue o formato, repete um ID que já chegou, veio de um ID
   * bloqueado ou não muda nada. Nada do conteúdo fica.
   */
  | { readonly tipo: 'ignorado'; readonly contato: Uint8Array }
  /** Texto ou anexo. `pedido`: de quem não é contato aceito (RF-07). */
  | {
      readonly tipo: 'mensagem';
      readonly contato: Uint8Array;
      readonly id: Uint8Array;
      readonly pedido: boolean;
    }
  | {
      readonly tipo: 'leitura';
      readonly contato: Uint8Array;
      readonly lidas: readonly Uint8Array[];
    }
  /** O texto chegou vencido: o conteúdo não fica, só a nota (RF-28). */
  | { readonly tipo: 'expirada'; readonly contato: Uint8Array; readonly pedido: boolean }
  /** O contato apagou pra todos: estas mensagens saíram daqui (RF-30). */
  | {
      readonly tipo: 'apagadas';
      readonly contato: Uint8Array;
      readonly ids: readonly Uint8Array[];
    }
  /** O contato bloqueou ou liberou os prints da conversa, e isso passa a valer aqui (RF-58). */
  | {
      readonly tipo: 'prints';
      readonly contato: Uint8Array;
      readonly bloqueados: boolean;
      readonly pedido: boolean;
    }
  /** O contato apagou a conversa nos dois celulares: ela saiu daqui também (RF-59). */
  | { readonly tipo: 'conversaApagada'; readonly contato: Uint8Array }
  /** O contato está escrevendo, ou parou (RF-18). Nada fica guardado. */
  | { readonly tipo: 'digitando'; readonly contato: Uint8Array; readonly digitando: boolean }
  /**
   * O contato mudou a conversa de caixa: o que sair daqui vai para a nova, e o que pode ter ido
   * para a antiga entrou de novo na fila.
   */
  | { readonly tipo: 'caixa'; readonly contato: Uint8Array }
  /** O contato mudou o timer da conversa, e ele passa a valer aqui (RF-25). */
  | {
      readonly tipo: 'timer';
      readonly contato: Uint8Array;
      readonly segundos: number;
      readonly pedido: boolean;
    };

interface Decifrado {
  readonly contato: Uint8Array;
  readonly sessoes: readonly Sessao[];
  readonly conteudo: Conteudo | null;
  /** O que muda no banco junto com a sessão nova, quando a mensagem abriu uma. */
  readonly depois: (banco: Armazenamento) => Promise<void>;
}

const nada = () => Promise.resolve();

/** Tenta cada sessão do contato, a atual primeiro. A que decifrar passa a ser a atual. */
function decifrarNasSessoes(
  { cripto, gerarPar }: Contexto,
  contato: Uint8Array,
  sessoes: readonly Sessao[],
  interior: Interior,
  escolhidas: (sessao: Sessao) => boolean = () => true,
): Decifrado | null {
  for (const [indice, sessao] of sessoes.entries()) {
    if (!escolhidas(sessao)) continue;
    const decifrada = decifrarNaSessao(cripto, sessao, interior, gerarPar);
    if (!decifrada) continue;
    return {
      contato,
      sessoes: [decifrada.sessao, ...sessoes.filter((_, i) => i !== indice)],
      conteudo: decifrada.conteudo,
      depois: nada,
    };
  }
  return null;
}

/**
 * Mensagem inicial: de uma sessão que já existe aqui (mesma chave efêmera) ou de uma nova, que o
 * X3DH abre com as prekeys que ela diz ter usado.
 */
async function decifrarInicial(
  contexto: Contexto,
  banco: Armazenamento,
  abertura: AberturaDaSessao,
  interior: Interior,
): Promise<Decifrado | null> {
  const { cripto, identidade, gerarPar } = contexto;
  const contato = idDaChave(cripto, abertura.chaveDeIdentidade);
  const sessoes = await sessoesDe(banco, contato);
  const daMesmaBase = (sessao: Sessao) => iguais(sessao.base, abertura.chaveEfemera);
  if (sessoes.some(daMesmaBase)) {
    return decifrarNasSessoes(contexto, contato, sessoes, interior, daMesmaBase);
  }
  // Base já vista e sem sessão: uma mensagem inicial guardada e reenviada. Não reabre nada.
  if (await baseJaVista(banco, abertura.chaveEfemera)) return null;

  const assinada = await parDaPrekeyAssinada(banco, abertura.prekeyAssinada);
  if (!assinada) return null;
  const avulsa =
    abertura.prekeyAvulsa === null
      ? null
      : await privadaDaPrekeyAvulsa(banco, abertura.prekeyAvulsa);
  if (abertura.prekeyAvulsa !== null && !avulsa) return null;

  let nova: Sessao;
  try {
    nova = sessaoDeQuemResponde(cripto, identidade, abertura, assinada, avulsa);
  } catch {
    return null;
  }
  const decifrada = decifrarNaSessao(cripto, nova, interior, gerarPar);
  if (!decifrada) return null;
  return {
    contato,
    sessoes: [decifrada.sessao, ...sessoes],
    conteudo: decifrada.conteudo,
    depois: async (t) => {
      if (abertura.prekeyAvulsa !== null) await apagarPrekeyAvulsa(t, abertura.prekeyAvulsa);
      await registrarBase(t, abertura.chaveEfemera, abertura.prekeyAssinada);
      // Sessão nova do contato: ele pode ter trocado de aparelho, e a caixa dele com isso. O aparelho
      // novo não lê a caixa de conversa que o anterior tinha pedido.
      if (await destinoDe(t, contato)) await marcarDestinoDesatualizado(t, contato);
      await esquecerCaixaDoContato(t, contato);
    },
  };
}

/**
 * O contato mudou o timer da conversa (RF-25). Vale a mudança mais nova, pelo relógio de quem
 * mudou; no empate, o timer maior: assim os dois lados acabam no mesmo, mesmo mudando ao mesmo
 * tempo. De quem não é contato, o timer abre um pedido de conversa.
 */
async function receberTimer(
  banco: Armazenamento,
  contato: Uint8Array,
  situacao: Contato | null,
  conteudo: Extract<Conteudo, { tipo: 'timer' }>,
  agora: number,
): Promise<Recebimento> {
  const { segundos, anteriores, enviadaEm } = conteudo;
  // Desligar não muda nada para quem nunca conversou.
  if (!situacao && segundos === 0) return { tipo: 'ignorado', contato };
  const atual = situacao ?? { aceito: false, timer: 0, timerDesde: 0 };
  const maisNova =
    enviadaEm > atual.timerDesde || (enviadaEm === atual.timerDesde && segundos > atual.timer);
  if (!maisNova) return { tipo: 'ignorado', contato };
  if (!situacao) await registrarPedido(banco, contato, agora);
  await mudarTimerDoContato(banco, contato, { segundos, desde: enviadaEm, porAvisar: false });
  if (segundos === atual.timer && !anteriores) return { tipo: 'ignorado', contato };
  // A mudança conta, no máximo, de agora: um relógio adiantado do outro lado não estica nada.
  await aplicarTimerNasMensagens(banco, contato, segundos, Math.min(enviadaEm, agora), anteriores);
  await guardarNota(banco, contato, { tipo: 'timer', segundos, anteriores, instante: agora });
  return { tipo: 'timer', contato, segundos, pedido: !atual.aceito };
}

/**
 * O contato bloqueou ou liberou os prints da conversa (RF-58). Como no timer, vale a mudança mais
 * nova, pelo relógio de quem mudou; no empate, bloqueado. De quem não é contato, bloquear abre um
 * pedido de conversa, para valer quando ele for aceito.
 */
async function receberPrints(
  banco: Armazenamento,
  contato: Uint8Array,
  situacao: Contato | null,
  conteudo: Extract<Conteudo, { tipo: 'prints' }>,
  agora: number,
): Promise<Recebimento> {
  const { bloqueados, enviadaEm } = conteudo;
  if (!situacao && !bloqueados) return { tipo: 'ignorado', contato };
  const atual = situacao ?? { aceito: false, printsBloqueados: false, printsDesde: 0 };
  const maisNova = enviadaEm > atual.printsDesde || (enviadaEm === atual.printsDesde && bloqueados);
  if (!maisNova) return { tipo: 'ignorado', contato };
  if (!situacao) await registrarPedido(banco, contato, agora);
  await mudarPrintsDoContato(banco, contato, { bloqueados, desde: enviadaEm });
  if (bloqueados === atual.printsBloqueados) return { tipo: 'ignorado', contato };
  await guardarNota(banco, contato, { tipo: 'prints', bloqueados, instante: agora });
  return { tipo: 'prints', contato, bloqueados, pedido: !atual.aceito };
}

/**
 * O que saiu daqui depois de `ate` (o envio, no relógio daqui, da última mensagem que já tinha
 * chegado ao contato) vai de novo, cifrado na sessão atual e com o mesmo ID: pode ter ido para a
 * caixa antiga da conversa, que ninguém lê mais. Só o que o relay já tinha aceitado: o pendente ainda
 * está na fila e sai para a caixa nova. O timer e os prints da conversa também vão de novo; do outro
 * lado vale a mudança mais nova, então repetir não muda nada.
 */
async function reenviarDesde(
  { cripto, identidade }: Contexto,
  banco: Armazenamento,
  contato: Uint8Array,
  situacao: Contato,
  ate: number,
  agora: number,
): Promise<void> {
  const [atual, ...anteriores] = await sessoesDe(banco, contato);
  if (!atual) return;
  const linhas = await banco.consultar(
    `SELECT ${COLUNAS_DA_MENSAGEM} FROM mensagens
      WHERE conversa = ? AND de_mim = 1 AND status = 'enviada' AND enviada_em >= ? AND ${visivel()}
      ORDER BY ordem`,
    [contato, ate],
  );
  let sessao = atual;
  const cifrar = async (conteudo: Conteudo, mensagem: Uint8Array | null) => {
    const cifrada = cifrarNaSessao(cripto, identidade, sessao, conteudo);
    sessao = cifrada.sessao;
    const pacote = selarPacote(cripto, cifrada.interior, sessao.chaveDoContato);
    await enfileirar(banco, contato, mensagem, pacote, agora);
  };
  for (const mensagem of linhas.map(mensagemDaLinha)) {
    const conteudo = await conteudoGuardado(banco, mensagem);
    if (conteudo) await cifrar(conteudo, mensagem.id);
  }
  if (situacao.timerDesde > 0) {
    await cifrar(avisoDoTimer(cripto, situacao), null);
    if (situacao.timerPorAvisar) await marcarTimerAvisado(banco, contato);
  }
  if (situacao.printsDesde > 0) {
    await cifrar(
      {
        tipo: 'prints',
        id: cripto.randombytes_buf(BYTES_DO_ID_DA_MENSAGEM),
        enviadaEm: situacao.printsDesde,
        ttl: 0,
        bloqueados: situacao.printsBloqueados,
      },
      null,
    );
  }
  await guardarSessoes(banco, contato, [sessao, ...anteriores]);
}

/**
 * O contato avisou para qual caixa a conversa vai daqui em diante. Vale o aviso mais novo, pelo
 * relógio dele. De quem não é contato, nada: o aviso não abre pedido de conversa. A caixa fica
 * guardada mesmo com o ID bloqueado, mas nada é reenviado: ao desbloquear, o que sair vai para a
 * caixa certa.
 */
async function receberCaixa(
  contexto: Contexto,
  banco: Armazenamento,
  contato: Uint8Array,
  situacao: Contato | null,
  conteudo: Extract<Conteudo, { tipo: 'caixa' }>,
  agora: number,
): Promise<Recebimento> {
  if (!situacao || conteudo.enviadaEm <= situacao.caixaDesde) return { tipo: 'ignorado', contato };
  await mudarCaixaDoContato(banco, contato, { caixa: conteudo.caixa, desde: conteudo.enviadaEm });
  if (situacao.aceito && !situacao.bloqueado) {
    await reenviarDesde(contexto, banco, contato, situacao, conteudo.ate, agora);
  }
  return { tipo: 'caixa', contato };
}

/**
 * O texto ou o anexo que chegou. Com o timer da conversa daqui como teto; se já chega vencido, o
 * conteúdo não fica e entra a nota (RF-28). De quem não é contato, abre um pedido.
 */
async function receberMensagem(
  banco: Armazenamento,
  contato: Uint8Array,
  situacao: Contato | null,
  conteudo: Extract<Conteudo, { tipo: 'texto' | 'anexo' }>,
  agora: number,
): Promise<Recebimento> {
  if (await mensagemPeloId(banco, conteudo.id)) return { tipo: 'ignorado', contato };
  const pedido = !situacao?.aceito;
  const { ttl, expiraEm } = prazoDaRecebida(
    conteudo.enviadaEm,
    agora,
    conteudo.ttl,
    situacao?.timer ?? 0,
  );
  if (expiraEm !== null && expiraEm <= agora) {
    if (!situacao) await registrarPedido(banco, contato, agora);
    await marcarRecebidaAte(banco, contato, conteudo.enviadaEm);
    await guardarNota(banco, contato, { tipo: 'expirou', instante: agora });
    return { tipo: 'expirada', contato, pedido };
  }
  const anexo = conteudo.tipo === 'anexo' ? conteudo.anexo : null;
  const nova = await guardarMensagem(banco, {
    id: conteudo.id,
    conversa: contato,
    deMim: false,
    tipo: anexo ? anexo.arquivo : 'texto',
    texto: conteudo.tipo === 'anexo' ? conteudo.legenda : conteudo.texto,
    resposta: conteudo.resposta ?? null,
    enviadaEm: conteudo.enviadaEm,
    recebidaEm: agora,
    ttl,
    expiraEm,
    status: 'recebida',
  });
  if (!nova) return { tipo: 'ignorado', contato };
  // O blob fica no relay até baixar: sozinho ou quando a pessoa tocar, pelo ajuste (RF-57); de um
  // pedido, só depois de aceito.
  if (anexo) await guardarAnexo(banco, conteudo.id, anexo, await estadoDoQueChega(banco));
  // De quem não é contato: um pedido de conversa, numa área à parte (RF-07).
  if (!situacao) await registrarPedido(banco, contato, agora);
  await marcarRecebidaAte(banco, contato, conteudo.enviadaEm);
  return { tipo: 'mensagem', contato, id: conteudo.id, pedido };
}

/**
 * Abre, decifra e guarda um pacote que chegou. Repetido, adulterado ou de sessão desconhecida é
 * descartado sem mudar nada; o relay pode apagar do mesmo jeito.
 */
export async function receberPacote(
  contexto: Contexto,
  banco: Armazenamento,
  pacote: Uint8Array,
  agora: number,
): Promise<Recebimento> {
  const { cripto, identidade } = contexto;
  const interior = abrirPacote(cripto, pacote, identidade);
  if (!interior) return { tipo: 'descartado' };
  const meuId = idDaChave(cripto, identidade.assinatura.publicKey);

  let decifrado: Decifrado | null;
  if (interior.tipo === 'inicial') {
    if (iguais(interior.abertura.chaveDeIdentidade, identidade.assinatura.publicKey)) {
      return { tipo: 'descartado' };
    }
    decifrado = await decifrarInicial(contexto, banco, interior.abertura, interior);
  } else {
    if (iguais(interior.remetente, meuId)) return { tipo: 'descartado' };
    const sessoes = await sessoesDe(banco, interior.remetente);
    decifrado = decifrarNasSessoes(contexto, interior.remetente, sessoes, interior);
  }
  if (!decifrado) return { tipo: 'descartado' };

  const { contato, conteudo } = decifrado;
  // A sessão anda mesmo com o ID bloqueado: ao desbloquear, a conversa continua de onde está.
  await guardarSessoes(banco, contato, decifrado.sessoes);
  await decifrado.depois(banco);
  if (!conteudo) return { tipo: 'ignorado', contato };
  const situacao = await contatoDe(banco, contato);
  if (conteudo.tipo === 'caixa') {
    return receberCaixa(contexto, banco, contato, situacao, conteudo, agora);
  }
  if (situacao?.bloqueado) return { tipo: 'ignorado', contato };

  switch (conteudo.tipo) {
    case 'leitura': {
      const lidas = await marcarLidasPeloContato(banco, contato, conteudo.lidas);
      for (const id of lidas) await tirarMensagemDaFila(banco, id);
      return { tipo: 'leitura', contato, lidas };
    }
    case 'apagar': {
      // Só as mensagens desta conversa: um contato não apaga as de outra.
      if (!situacao) return { tipo: 'ignorado', contato };
      const ids = await idsDaConversa(banco, contato, conteudo.apagadas);
      if (ids.length > 0) await apagarDeVerdade(banco, { mensagens: ids });
      return { tipo: 'apagadas', contato, ids };
    }
    case 'timer':
      return receberTimer(banco, contato, situacao, conteudo, agora);
    case 'prints':
      return receberPrints(banco, contato, situacao, conteudo, agora);
    case 'apagarConversa': {
      // Como no apagar pra todos: só a conversa de quem pediu, e só de contato aceito.
      if (!situacao?.aceito) return { tipo: 'ignorado', contato };
      await apagarDeVerdade(banco, { conversa: contato, minhasAte: conteudo.ate });
      return { tipo: 'conversaApagada', contato };
    }
    case 'digitando':
      // Só de contato aceito: o "digitando" não abre pedido de conversa (RF-07).
      if (!situacao?.aceito) return { tipo: 'ignorado', contato };
      return { tipo: 'digitando', contato, digitando: conteudo.digitando };
    case 'texto':
    case 'anexo':
      return receberMensagem(banco, contato, situacao, conteudo, agora);
  }
}

/**
 * O contato trocou de aparelho (restaurou a identidade em outro): o cartão novo tem outra caixa, e
 * o aparelho novo não tem as sessões de antes (RF-05). Abre uma sessão nova com o cartão e a
 * one-time prekey que vieram com ele, e cifra de novo, nela, os textos que esperavam na fila. As
 * confirmações de leitura e os pedidos de apagar que esperavam saem: o aparelho novo não tem
 * aquelas mensagens. O timer da conversa e os prints bloqueados vão de novo, para o aparelho novo
 * usar os mesmos. A caixa de conversa que o aparelho anterior tinha pedido fica para trás: o novo
 * não a lê.
 */
export async function recomecarComAparelhoNovo(
  { cripto, identidade, gerarPar }: Contexto,
  banco: Armazenamento,
  contato: Uint8Array,
  cartao: Cartao,
  prekey: Prekey | null,
  agora: number,
): Promise<void> {
  const anteriores = await sessoesDe(banco, contato);
  await esquecerCaixaDoContato(banco, contato);
  let sessao = sessaoDeQuemAbre(cripto, identidade, cartao, prekey, gerarPar);
  for (const item of await itensDaFilaDe(banco, contato)) {
    const mensagem = item.mensagem && (await mensagemPeloId(banco, item.mensagem));
    const conteudo = mensagem && (await conteudoGuardado(banco, mensagem));
    if (!conteudo) {
      await tirarDaFila(banco, item);
      continue;
    }
    const cifrada = cifrarNaSessao(cripto, identidade, sessao, conteudo);
    sessao = cifrada.sessao;
    await trocarPacote(
      banco,
      item.ordem,
      selarPacote(cripto, cifrada.interior, cartao.chaveDeIdentidade),
      agora,
    );
  }
  const situacao = await contatoDe(banco, contato);
  if (situacao && situacao.timer > 0) {
    const cifrada = cifrarNaSessao(cripto, identidade, sessao, avisoDoTimer(cripto, situacao));
    sessao = cifrada.sessao;
    await enfileirar(
      banco,
      contato,
      null,
      selarPacote(cripto, cifrada.interior, cartao.chaveDeIdentidade),
      agora,
    );
    if (situacao.timerPorAvisar) await marcarTimerAvisado(banco, contato);
  }
  // Os prints bloqueados também vão de novo (RF-58).
  if (situacao?.printsBloqueados) {
    const cifrada = cifrarNaSessao(cripto, identidade, sessao, {
      tipo: 'prints',
      id: cripto.randombytes_buf(BYTES_DO_ID_DA_MENSAGEM),
      enviadaEm: situacao.printsDesde,
      ttl: 0,
      bloqueados: true,
    });
    sessao = cifrada.sessao;
    await enfileirar(
      banco,
      contato,
      null,
      selarPacote(cripto, cifrada.interior, cartao.chaveDeIdentidade),
      agora,
    );
  }
  await guardarSessoes(banco, contato, [sessao, ...anteriores]);
}
