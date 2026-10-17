// Conteúdo interno de uma mensagem (SPEC, "Sessão e mensagens"): é o que a catraca cifra. Em cada
// tipo de envelope ele tem sempre o mesmo tamanho: o corpo vem seguido de zeros até a capacidade,
// e quem lê exige que o preenchimento seja só zero. Assim todo pacote tem 4096 bytes, seja qual
// for o texto (RNF-04).
//
// Conteúdo (inteiros em big-endian):
//   id          16 bytes, sorteado por quem escreve: a mensagem repetida é descartada por ele
//   tipo         1 byte
//   enviadaEm    8 bytes, milissegundos desde 1970, no relógio de quem escreve
//   ttl          4 bytes, segundos até sumir; 0 é sem timer
//   tamanho      2 bytes, do corpo
//   corpo        conforme o tipo
//   zeros        até a capacidade
//
// Corpos:
//   texto        UTF-8, de 1 a LIMITE_DO_TEXTO bytes
//   leitura      os IDs das mensagens lidas, 16 bytes cada, de 1 a MAXIMO_DE_LIDAS, sem repetir
//   apagar       os IDs das mensagens apagadas para os dois lados, 16 bytes cada, de 1 a
//                MAXIMO_DE_APAGADAS, sem repetir
//   timer        o timer novo da conversa (4 bytes, segundos: 0 desliga, ou de 10 s a 7 dias) e se
//                ele vale também para as mensagens anteriores (1 byte, 0 ou 1; 1 só com timer). A
//                mudança mais nova vale: `enviadaEm` diz quando ela foi feita
//   anexo        o que abre o arquivo no relay (anexo.ts):
//                  arquivo      1 byte: 1 imagem, 2 vídeo, 3 documento
//                  tamanho      4 bytes: do arquivo, antes de cifrar
//                  capa         2 bytes: da capa no começo do texto claro (só vídeo; 0 nos outros)
//                  largura      2 bytes, em pixels (0 no documento)
//                  altura       2 bytes
//                  duração      4 bytes, em milissegundos (só vídeo)
//                  token       32 bytes
//                  chave       32 bytes
//                  hash        32 bytes, BLAKE2b do blob inteiro
//                  resposta     1 byte (0 ou 1) e, com 1, o ID da mensagem respondida (16)
//                  formato      1 byte de tamanho e o tipo MIME, em ASCII
//                  miniatura    2 bytes de tamanho e um JPEG pequeno (vazio no documento)
//                  legenda      o resto do corpo, em UTF-8 (pode ser vazia)
//   resposta     texto em resposta a outra mensagem: o ID dela (16 bytes) e o texto. Só o
//                ID vai: cada lado mostra a própria cópia, e o que sumiu não volta pela resposta
//   digitando    1 byte: 1 começou a escrever (repetido de tanto em tanto), 0 parou
//                (RF-18). Não fica guardado em lugar nenhum
//   prints       1 byte: 1 bloqueados, 0 liberados, nesta conversa e para os dois lados
//                (RF-58). Como no timer, vale a mudança mais nova, pelo `enviadaEm`
//   apagarConversa 8 bytes: o `enviadaEm` mais novo, no relógio de quem recebe, entre as
//                mensagens dele que já tinham chegado a quem apagou; 0 se nenhuma (RF-59)
//   caixa        para onde vai a conversa, daqui em diante: 8 bytes com o `enviadaEm` mais
//                novo, no relógio de quem recebe, entre as mensagens dele que já tinham chegado (0 se
//                nenhuma), seguidos da chave da caixa de uma conversa oculta (32 bytes) ou de nada, e
//                aí é a caixa do cartão. Quem recebe manda de novo, para a caixa nova, as mensagens
//                que mandou depois disso: alguma pode ter ido para a caixa antiga no caminho
//
// Tipo novo entra com o próximo número.
import { deAscii, ErroDeFormato, Escritor, iguais, Leitor } from './bytes.ts';
import {
  BYTES_DA_CHAVE_DO_ANEXO,
  BYTES_DO_HASH_DO_ANEXO,
  BYTES_DO_PEDACO,
  BYTES_DO_TOKEN,
  TAMANHO_MAXIMO_DO_CLARO,
} from './anexo.ts';
import { BYTES_DA_CHAVE } from './cartao.ts';
import { LIMITE_DO_TEXTO, TIMER_MAXIMO_EM_SEGUNDOS, TIMER_MINIMO_EM_SEGUNDOS } from './limites.ts';
import { deUtf8, utf8 } from './utf8.ts';

export const BYTES_DO_ID_DA_MENSAGEM = 16;

/** Confirmações de leitura numa mensagem só. */
export const MAXIMO_DE_LIDAS = 100;

/** Mensagens apagadas para os dois lados numa mensagem só. */
export const MAXIMO_DE_APAGADAS = 100;

/** Bytes do conteúdo antes do corpo. */
export const CABECALHO_DO_CONTEUDO = BYTES_DO_ID_DA_MENSAGEM + 1 + 8 + 4 + 2;

/** Bytes do corpo do timer: os segundos (4) e se vale para as anteriores (1). */
const CORPO_DO_TIMER = 5;

/** Bytes do `ate` do apagar a conversa e da caixa: um `enviadaEm`. */
const BYTES_DO_ATE = 8;

/** A legenda de um anexo, em bytes UTF-8. Divide o pacote com a miniatura. */
export const LIMITE_DA_LEGENDA = 2000;

/** A miniatura que vai dentro da mensagem do anexo, em bytes. */
export const LIMITE_DA_MINIATURA = 1536;

/** A capa do vídeo: cabe no primeiro pedaço do fluxo, então sai decifrando só ele. */
export const LIMITE_DA_CAPA = 61_440;

/** O tipo MIME do anexo, em bytes ASCII. */
export const LIMITE_DO_FORMATO = 127;

export type TipoDeArquivo = 'imagem' | 'video' | 'documento';

/** O que abre o anexo no relay e o que o balão mostra antes de baixar. */
export interface DadosDoAnexo {
  readonly arquivo: TipoDeArquivo;
  /** O tipo MIME: image/jpeg ou image/png na imagem, video/mp4 no vídeo, qualquer um no documento. */
  readonly formato: string;
  /** Bytes do arquivo, antes de cifrar, sem a capa. */
  readonly tamanho: number;
  /** Bytes da capa no começo do texto claro; 0 fora do vídeo. */
  readonly capa: number;
  readonly largura: number;
  readonly altura: number;
  /** Milissegundos; 0 fora do vídeo. */
  readonly duracao: number;
  readonly token: Uint8Array;
  readonly chave: Uint8Array;
  readonly hash: Uint8Array;
  /** JPEG pequeno, mostrado desfocado até o anexo baixar; vazio no documento. */
  readonly miniatura: Uint8Array;
}

const ARQUIVOS = { imagem: 1, video: 2, documento: 3 } as const satisfies Record<
  TipoDeArquivo,
  number
>;

const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

/** Um tipo MIME aceito para o arquivo: o formato que o outro lado sabe mostrar. */
export function formatoValido(arquivo: TipoDeArquivo, formato: string): boolean {
  if (formato.length < 3 || formato.length > LIMITE_DO_FORMATO || !MIME.test(formato)) return false;
  if (arquivo === 'imagem') return formato === 'image/jpeg' || formato === 'image/png';
  if (arquivo === 'video') return formato === 'video/mp4';
  return true;
}

/** Os campos do anexo seguem o formato. */
export function anexoValido(anexo: DadosDoAnexo): boolean {
  const { arquivo, tamanho, capa, largura, altura, duracao, miniatura } = anexo;
  const midia = arquivo !== 'documento';
  const inteiro = (n: number, maximo: number) => Number.isInteger(n) && n >= 0 && n <= maximo;
  return (
    formatoValido(arquivo, anexo.formato) &&
    inteiro(tamanho, TAMANHO_MAXIMO_DO_CLARO) &&
    tamanho >= 1 &&
    inteiro(capa, LIMITE_DA_CAPA) &&
    (arquivo === 'video' || capa === 0) &&
    capa <= BYTES_DO_PEDACO &&
    tamanho + capa <= TAMANHO_MAXIMO_DO_CLARO &&
    inteiro(largura, 0xffff) &&
    inteiro(altura, 0xffff) &&
    (midia ? largura >= 1 && altura >= 1 : largura === 0 && altura === 0) &&
    inteiro(duracao, 0xffffffff) &&
    (arquivo === 'video' || duracao === 0) &&
    anexo.token.length === BYTES_DO_TOKEN &&
    anexo.chave.length === BYTES_DA_CHAVE_DO_ANEXO &&
    anexo.hash.length === BYTES_DO_HASH_DO_ANEXO &&
    miniatura.length <= LIMITE_DA_MINIATURA &&
    (midia || miniatura.length === 0)
  );
}

interface Comum {
  readonly id: Uint8Array;
  /** Milissegundos desde 1970, no relógio de quem escreve. */
  readonly enviadaEm: number;
  /** Segundos até sumir; 0 é sem timer. */
  readonly ttl: number;
}

export type Conteudo =
  /** Com `resposta`, o ID da mensagem respondida: vai como o tipo 6. */
  | (Comum & { readonly tipo: 'texto'; readonly texto: string; readonly resposta?: Uint8Array })
  | (Comum & { readonly tipo: 'leitura'; readonly lidas: readonly Uint8Array[] })
  | (Comum & { readonly tipo: 'apagar'; readonly apagadas: readonly Uint8Array[] })
  | (Comum & {
      readonly tipo: 'timer';
      /** O timer novo da conversa; 0 desliga. */
      readonly segundos: number;
      /** Vale também para as mensagens que já estavam na conversa. */
      readonly anteriores: boolean;
    })
  /** Quem escreve começou (ou continua) a escrever, ou parou (RF-18). */
  | (Comum & { readonly tipo: 'digitando'; readonly digitando: boolean })
  /** Prints bloqueados ou liberados na conversa, para os dois lados (RF-58). */
  | (Comum & { readonly tipo: 'prints'; readonly bloqueados: boolean })
  /**
   * Quem escreve apagou a conversa e pede o mesmo do outro lado (RF-59). `ate`: até onde as
   * mensagens de quem recebe já tinham chegado, pelo `enviadaEm` delas; 0 se nenhuma.
   */
  | (Comum & { readonly tipo: 'apagarConversa'; readonly ate: number })
  /**
   * Para onde vai a conversa daqui em diante: a caixa de uma conversa oculta, ou `null` para a
   * caixa do cartão. `ate`: até onde as mensagens de quem recebe já tinham chegado, pelo
   * `enviadaEm` delas; 0 se nenhuma. As mais novas que isso vão de novo, para a caixa nova.
   */
  | (Comum & { readonly tipo: 'caixa'; readonly caixa: Uint8Array | null; readonly ate: number })
  | (Comum & {
      readonly tipo: 'anexo';
      readonly anexo: DadosDoAnexo;
      /** Pode ser vazia. */
      readonly legenda: string;
      readonly resposta?: Uint8Array;
    });

const TIPOS = {
  texto: 1,
  leitura: 2,
  apagar: 3,
  timer: 4,
  anexo: 5,
  digitando: 7,
  prints: 8,
  apagarConversa: 9,
  caixa: 10,
} as const satisfies Record<Conteudo['tipo'], number>;

/** O texto em resposta a outra mensagem. */
const TEXTO_EM_RESPOSTA = 6;

/** Um timer de mensagens temporárias, em segundos: 0 (sem timer) ou de 10 s a 7 dias. */
export function timerValido(segundos: number): boolean {
  return (
    Number.isInteger(segundos) &&
    (segundos === 0 ||
      (segundos >= TIMER_MINIMO_EM_SEGUNDOS && segundos <= TIMER_MAXIMO_EM_SEGUNDOS))
  );
}

function exigirId(id: Uint8Array): Uint8Array {
  if (id.length !== BYTES_DO_ID_DA_MENSAGEM) {
    throw new RangeError(`o ID da mensagem tem ${BYTES_DO_ID_DA_MENSAGEM} bytes`);
  }
  return id;
}

function repete(ids: readonly Uint8Array[]): boolean {
  return ids.some((id, i) => ids.findIndex((outro) => iguais(outro, id)) !== i);
}

/** Uma lista de IDs de mensagem, de 1 a `maximo`, sem repetir. */
function corpoDosIds(ids: readonly Uint8Array[], maximo: number): Uint8Array {
  if (ids.length < 1 || ids.length > maximo || repete(ids)) {
    throw new RangeError('lista de IDs fora do formato');
  }
  const escritor = new Escritor();
  for (const id of ids) escritor.bytes(exigirId(id));
  return escritor.resultado();
}

function lerIds(corpo: Uint8Array, maximo: number): Uint8Array[] | null {
  const quantidade = corpo.length / BYTES_DO_ID_DA_MENSAGEM;
  if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > maximo) return null;
  const ids = Array.from({ length: quantidade }, (_, i) =>
    corpo.slice(i * BYTES_DO_ID_DA_MENSAGEM, (i + 1) * BYTES_DO_ID_DA_MENSAGEM),
  );
  return repete(ids) ? null : ids;
}

function corpoDoAnexo(conteudo: Extract<Conteudo, { tipo: 'anexo' }>): Uint8Array {
  const { anexo, resposta } = conteudo;
  const legenda = utf8(conteudo.legenda);
  if (!anexoValido(anexo) || legenda.length > LIMITE_DA_LEGENDA) {
    throw new RangeError('anexo fora do formato');
  }
  const escritor = new Escritor()
    .uint8(ARQUIVOS[anexo.arquivo])
    .uint32(anexo.tamanho)
    .uint16(anexo.capa)
    .uint16(anexo.largura)
    .uint16(anexo.altura)
    .uint32(anexo.duracao)
    .bytes(anexo.token)
    .bytes(anexo.chave)
    .bytes(anexo.hash);
  if (resposta) escritor.uint8(1).bytes(exigirId(resposta));
  else escritor.uint8(0);
  return escritor
    .uint8(anexo.formato.length)
    .bytes(Uint8Array.from(anexo.formato, (c) => c.charCodeAt(0)))
    .uint16(anexo.miniatura.length)
    .bytes(anexo.miniatura)
    .bytes(legenda)
    .resultado();
}

function corpoDe(conteudo: Conteudo): Uint8Array {
  switch (conteudo.tipo) {
    case 'texto': {
      const bytes = utf8(conteudo.texto);
      if (bytes.length < 1 || bytes.length > LIMITE_DO_TEXTO) {
        throw new RangeError('texto fora do limite');
      }
      if (!conteudo.resposta) return bytes;
      return new Escritor().bytes(exigirId(conteudo.resposta)).bytes(bytes).resultado();
    }
    case 'anexo':
      return corpoDoAnexo(conteudo);
    case 'digitando':
      return Uint8Array.of(conteudo.digitando ? 1 : 0);
    case 'prints':
      return Uint8Array.of(conteudo.bloqueados ? 1 : 0);
    case 'apagarConversa':
      if (!Number.isSafeInteger(conteudo.ate) || conteudo.ate < 0) {
        throw new RangeError('apagar conversa fora do formato');
      }
      return new Escritor().uint64(conteudo.ate).resultado();
    case 'caixa': {
      const { caixa, ate } = conteudo;
      if (!Number.isSafeInteger(ate) || ate < 0 || (caixa && caixa.length !== BYTES_DA_CHAVE)) {
        throw new RangeError('caixa fora do formato');
      }
      const escritor = new Escritor().uint64(ate);
      if (caixa) escritor.bytes(caixa);
      return escritor.resultado();
    }
    case 'leitura':
      return corpoDosIds(conteudo.lidas, MAXIMO_DE_LIDAS);
    case 'apagar':
      return corpoDosIds(conteudo.apagadas, MAXIMO_DE_APAGADAS);
    case 'timer': {
      const { segundos, anteriores } = conteudo;
      if (!timerValido(segundos) || (anteriores && segundos === 0)) {
        throw new RangeError('timer fora do formato');
      }
      return new Escritor()
        .uint32(segundos)
        .uint8(anteriores ? 1 : 0)
        .resultado();
    }
  }
}

/**
 * Monta o conteúdo com exatamente `capacidade` bytes. Campo fora do formato ou conteúdo que não
 * cabe é erro de quem chama e lança.
 */
export function codificarConteudo(conteudo: Conteudo, capacidade: number): Uint8Array {
  const corpo = corpoDe(conteudo);
  const sobra = capacidade - CABECALHO_DO_CONTEUDO - corpo.length;
  if (sobra < 0) throw new RangeError('conteúdo maior que a capacidade');
  return new Escritor()
    .bytes(exigirId(conteudo.id))
    .uint8(
      conteudo.tipo === 'texto' && conteudo.resposta ? TEXTO_EM_RESPOSTA : TIPOS[conteudo.tipo],
    )
    .uint64(conteudo.enviadaEm)
    .uint32(conteudo.ttl)
    .uint16(corpo.length)
    .bytes(corpo)
    .bytes(new Uint8Array(sobra))
    .resultado();
}

function lerTimer(comum: Comum, corpo: Uint8Array): Conteudo | null {
  if (corpo.length !== CORPO_DO_TIMER) return null;
  const leitor = new Leitor(corpo);
  const segundos = leitor.uint32();
  const anteriores = leitor.uint8();
  if (!timerValido(segundos) || anteriores > 1 || (anteriores === 1 && segundos === 0)) {
    return null;
  }
  return { ...comum, tipo: 'timer', segundos, anteriores: anteriores === 1 };
}

function lerAnexo(comum: Comum, corpo: Uint8Array): Conteudo | null {
  const leitor = new Leitor(corpo);
  const codigo = leitor.uint8();
  const arquivo = (Object.keys(ARQUIVOS) as TipoDeArquivo[]).find((a) => ARQUIVOS[a] === codigo);
  if (!arquivo) return null;
  const tamanho = leitor.uint32();
  const capa = leitor.uint16();
  const largura = leitor.uint16();
  const altura = leitor.uint16();
  const duracao = leitor.uint32();
  const token = leitor.bytes(BYTES_DO_TOKEN);
  const chave = leitor.bytes(BYTES_DA_CHAVE_DO_ANEXO);
  const hash = leitor.bytes(BYTES_DO_HASH_DO_ANEXO);
  const temResposta = leitor.uint8();
  if (temResposta > 1) return null;
  const resposta = temResposta === 1 ? leitor.bytes(BYTES_DO_ID_DA_MENSAGEM) : null;
  const formato = deAscii(leitor.bytes(leitor.uint8()));
  const miniatura = leitor.bytes(leitor.uint16());
  const bytesDaLegenda = leitor.bytes(corpo.length - leitor.posicao);
  leitor.fim();
  const legenda = deUtf8(bytesDaLegenda);
  if (formato === null || legenda === null || bytesDaLegenda.length > LIMITE_DA_LEGENDA)
    return null;
  const anexo: DadosDoAnexo = {
    arquivo,
    formato,
    tamanho,
    capa,
    largura,
    altura,
    duracao,
    token,
    chave,
    hash,
    miniatura,
  };
  if (!anexoValido(anexo)) return null;
  return { ...comum, tipo: 'anexo', anexo, legenda, ...(resposta ? { resposta } : {}) };
}

function lerCorpo(codigo: number, comum: Comum, corpo: Uint8Array): Conteudo | null {
  switch (codigo) {
    case TEXTO_EM_RESPOSTA: {
      const tamanho = corpo.length - BYTES_DO_ID_DA_MENSAGEM;
      if (tamanho < 1 || tamanho > LIMITE_DO_TEXTO) return null;
      const texto = deUtf8(corpo.subarray(BYTES_DO_ID_DA_MENSAGEM));
      const resposta = corpo.slice(0, BYTES_DO_ID_DA_MENSAGEM);
      return texto === null ? null : { ...comum, tipo: 'texto', texto, resposta };
    }
    case TIPOS.anexo:
      return lerAnexo(comum, corpo);
    case TIPOS.texto: {
      if (corpo.length < 1 || corpo.length > LIMITE_DO_TEXTO) return null;
      const texto = deUtf8(corpo);
      return texto === null ? null : { ...comum, tipo: 'texto', texto };
    }
    case TIPOS.leitura: {
      const lidas = lerIds(corpo, MAXIMO_DE_LIDAS);
      return lidas ? { ...comum, tipo: 'leitura', lidas } : null;
    }
    case TIPOS.apagar: {
      const apagadas = lerIds(corpo, MAXIMO_DE_APAGADAS);
      return apagadas ? { ...comum, tipo: 'apagar', apagadas } : null;
    }
    case TIPOS.timer:
      return lerTimer(comum, corpo);
    case TIPOS.digitando: {
      const [valor] = corpo;
      if (corpo.length !== 1 || valor === undefined || valor > 1) return null;
      return { ...comum, tipo: 'digitando', digitando: valor === 1 };
    }
    case TIPOS.prints: {
      const [valor] = corpo;
      if (corpo.length !== 1 || valor === undefined || valor > 1) return null;
      return { ...comum, tipo: 'prints', bloqueados: valor === 1 };
    }
    case TIPOS.apagarConversa: {
      if (corpo.length !== BYTES_DO_ATE) return null;
      const ate = new Leitor(corpo).uint64();
      return Number.isSafeInteger(ate) ? { ...comum, tipo: 'apagarConversa', ate } : null;
    }
    case TIPOS.caixa: {
      if (corpo.length !== BYTES_DO_ATE && corpo.length !== BYTES_DO_ATE + BYTES_DA_CHAVE) {
        return null;
      }
      const ate = new Leitor(corpo).uint64();
      if (!Number.isSafeInteger(ate)) return null;
      const caixa = corpo.length === BYTES_DO_ATE ? null : corpo.slice(BYTES_DO_ATE);
      return { ...comum, tipo: 'caixa', caixa, ate };
    }
    default:
      return null;
  }
}

/**
 * Lê o conteúdo que a catraca decifrou. Devolve `null` se o formato não bate: tipo desconhecido,
 * corpo fora do limite, texto que não é UTF-8 ou preenchimento que não é só zero.
 */
export function lerConteudo(bytes: Uint8Array): Conteudo | null {
  try {
    const leitor = new Leitor(bytes);
    const id = leitor.bytes(BYTES_DO_ID_DA_MENSAGEM);
    const codigo = leitor.uint8();
    const enviadaEm = leitor.uint64();
    const ttl = leitor.uint32();
    const corpo = leitor.bytes(leitor.uint16());
    const preenchimento = leitor.bytes(bytes.length - leitor.posicao);
    leitor.fim();
    if (preenchimento.some((byte) => byte !== 0)) return null;
    return lerCorpo(codigo, { id, enviadaEm, ttl }, corpo);
  } catch (erro) {
    if (erro instanceof ErroDeFormato) return null;
    throw erro;
  }
}
