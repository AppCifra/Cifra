// Cartão de identidade (SPEC, "Cartão de identidade"). Fica publicado no relay, assinado pela chave
// de identidade: quem busca confere que o hash da chave dá o ID e que as assinaturas valem. Entre
// dois cartões válidos, vale o mais novo.
//
// Cartão (inteiros em big-endian):
//   versão               1 byte
//   chave de identidade  32 bytes, Ed25519
//   prekey assinada      número (4) + chave X25519 (32) + assinatura (64)
//   caixa principal      32 bytes, a chave pública Ed25519 da caixa
//   data                 8 bytes, milissegundos desde 1970
//   relays               quantidade (1) + cada um: tamanho (1) + endereço em ASCII
//   assinatura           64 bytes, sobre o contexto do cartão + tudo o que vem antes
//
// A assinatura da prekey segue o X3DH, Sig(IK, Encode(SPK)), aqui sobre o contexto da prekey +
// número + chave. As one-time prekeys não fazem parte do cartão: o relay entrega uma por busca,
// sem assinatura própria, como no X3DH. Quem garante que foi o dono que as mandou é a publicação.
//
// Publicação, o que o dono manda ao relay:
//   modo                 1 byte: 0 acrescenta as prekeys às que o relay já tem; 1 substitui todas
//   cartão               como acima
//   one-time prekeys     quantidade (1) + cada uma: número (4) + chave X25519 (32)
//   assinatura           64 bytes, sobre o contexto da publicação + tudo o que vem antes
import { ascii, deAscii, ErroDeFormato, Escritor, juntar, Leitor } from './bytes.ts';
import { CONTEXTOS } from './contextos.ts';
import { enderecoDeRelayValido, LIMITE_DO_ENDERECO } from './endereco.ts';
import { idDaChave } from './id.ts';
import { MAXIMO_DE_PREKEYS, MAXIMO_DE_RELAYS, VERSAO_DO_CARTAO } from './limites.ts';
import type { Assinar, Hash, Verificador } from './verificador.ts';

/** Chave pública Ed25519 ou X25519. */
export const BYTES_DA_CHAVE = 32;

/** Assinatura Ed25519. */
export const BYTES_DA_ASSINATURA = 64;

const BYTES_DA_PREKEY = 4 + BYTES_DA_CHAVE;

export const TAMANHO_MAXIMO_DO_CARTAO =
  1 +
  BYTES_DA_CHAVE +
  BYTES_DA_PREKEY +
  BYTES_DA_ASSINATURA +
  BYTES_DA_CHAVE +
  8 +
  1 +
  MAXIMO_DE_RELAYS * (1 + LIMITE_DO_ENDERECO) +
  BYTES_DA_ASSINATURA;

export const TAMANHO_MAXIMO_DA_PUBLICACAO =
  1 + TAMANHO_MAXIMO_DO_CARTAO + 1 + MAXIMO_DE_PREKEYS * BYTES_DA_PREKEY + BYTES_DA_ASSINATURA;

export interface Prekey {
  /** Escolhido pelo dono, para achar a chave privada quando chegar a primeira mensagem. */
  readonly numero: number;
  /** X25519. */
  readonly chave: Uint8Array;
}

export interface PrekeyAssinada extends Prekey {
  readonly assinatura: Uint8Array;
}

export interface DadosDoCartao {
  readonly chaveDeIdentidade: Uint8Array;
  /** `criarCartao` assina. */
  readonly prekeyAssinada: Prekey;
  readonly caixaPrincipal: Uint8Array;
  /** Milissegundos desde 1970. */
  readonly data: number;
  readonly relays: readonly string[];
}

export interface Cartao extends Omit<DadosDoCartao, 'prekeyAssinada'> {
  readonly versao: number;
  readonly prekeyAssinada: PrekeyAssinada;
  readonly assinatura: Uint8Array;
  /** O cartão inteiro, como foi lido ou criado: é o que o relay guarda e entrega. */
  readonly bytes: Uint8Array;
}

export type ModoDaPublicacao = 'acrescentar' | 'substituir';

const MODOS: readonly ModoDaPublicacao[] = ['acrescentar', 'substituir'];

export interface Publicacao {
  readonly modo: ModoDaPublicacao;
  readonly cartao: Cartao;
  readonly prekeys: readonly Prekey[];
  readonly assinatura: Uint8Array;
  readonly bytes: Uint8Array;
}

/** Os bytes que a assinatura da prekey cobre. */
export function mensagemDaPrekeyAssinada(prekey: Prekey): Uint8Array {
  return new Escritor()
    .bytes(CONTEXTOS.prekeyAssinada)
    .uint32(prekey.numero)
    .bytes(prekey.chave)
    .resultado();
}

function lerPrekey(leitor: Leitor): Prekey {
  return { numero: leitor.uint32(), chave: leitor.bytes(BYTES_DA_CHAVE) };
}

/** Lê um cartão a partir da posição atual. Lança `ErroDeFormato`. */
export function lerCartaoDe(leitor: Leitor): Cartao {
  const inicio = leitor.posicao;
  const versao = leitor.uint8();
  if (versao !== VERSAO_DO_CARTAO) throw new ErroDeFormato('versão do cartão');
  const chaveDeIdentidade = leitor.bytes(BYTES_DA_CHAVE);
  const prekeyAssinada = { ...lerPrekey(leitor), assinatura: leitor.bytes(BYTES_DA_ASSINATURA) };
  const caixaPrincipal = leitor.bytes(BYTES_DA_CHAVE);
  const data = leitor.uint64();
  const quantidade = leitor.uint8();
  if (quantidade < 1 || quantidade > MAXIMO_DE_RELAYS) throw new ErroDeFormato('relays');
  const relays: string[] = [];
  for (let i = 0; i < quantidade; i++) {
    const endereco = deAscii(leitor.bytes(leitor.uint8()));
    if (endereco === null || !enderecoDeRelayValido(endereco) || relays.includes(endereco)) {
      throw new ErroDeFormato('relay');
    }
    relays.push(endereco);
  }
  const assinatura = leitor.bytes(BYTES_DA_ASSINATURA);
  return {
    versao,
    chaveDeIdentidade,
    prekeyAssinada,
    caixaPrincipal,
    data,
    relays,
    assinatura,
    bytes: leitor.trecho(inicio, leitor.posicao),
  };
}

/** Lê uma publicação a partir da posição atual. Lança `ErroDeFormato`. */
export function lerPublicacaoDe(leitor: Leitor): Publicacao {
  const inicio = leitor.posicao;
  const modo = MODOS[leitor.uint8()];
  if (!modo) throw new ErroDeFormato('modo da publicação');
  const cartao = lerCartaoDe(leitor);
  const quantidade = leitor.uint8();
  if (quantidade > MAXIMO_DE_PREKEYS) throw new ErroDeFormato('prekeys demais');
  const prekeys: Prekey[] = [];
  for (let i = 0; i < quantidade; i++) {
    const prekey = lerPrekey(leitor);
    if (prekeys.some(({ numero }) => numero === prekey.numero)) {
      throw new ErroDeFormato('prekey repetida');
    }
    prekeys.push(prekey);
  }
  const assinatura = leitor.bytes(BYTES_DA_ASSINATURA);
  return { modo, cartao, prekeys, assinatura, bytes: leitor.trecho(inicio, leitor.posicao) };
}

function inteiro<T>(bytes: Uint8Array, ler: (leitor: Leitor) => T): T | null {
  try {
    const leitor = new Leitor(bytes);
    const lido = ler(leitor);
    leitor.fim();
    return lido;
  } catch (erro) {
    if (erro instanceof ErroDeFormato) return null;
    throw erro;
  }
}

/** Lê um cartão, sem conferir assinatura. Devolve `null` se o formato não bate. */
export function lerCartao(bytes: Uint8Array): Cartao | null {
  return inteiro(bytes, lerCartaoDe);
}

/** Lê uma publicação, sem conferir assinatura. Devolve `null` se o formato não bate. */
export function lerPublicacao(bytes: Uint8Array): Publicacao | null {
  return inteiro(bytes, lerPublicacaoDe);
}

function semAssinatura(bytes: Uint8Array): Uint8Array {
  return bytes.subarray(0, bytes.length - BYTES_DA_ASSINATURA);
}

function exigirChave(chave: Uint8Array): void {
  if (chave.length !== BYTES_DA_CHAVE) throw new RangeError(`a chave tem ${BYTES_DA_CHAVE} bytes`);
}

/**
 * Monta e assina um cartão com a chave de identidade. Dado fora do formato (chave sem 32 bytes,
 * endereço inválido, relays demais) lança: é erro de quem chama.
 */
export function criarCartao(dados: DadosDoCartao, assinar: Assinar): Cartao {
  for (const chave of [dados.chaveDeIdentidade, dados.prekeyAssinada.chave, dados.caixaPrincipal]) {
    exigirChave(chave);
  }
  const { relays } = dados;
  if (
    relays.length < 1 ||
    relays.length > MAXIMO_DE_RELAYS ||
    relays.some((endereco, i) => !enderecoDeRelayValido(endereco) || relays.indexOf(endereco) !== i)
  ) {
    throw new RangeError('relays fora do formato do cartão');
  }

  const escritor = new Escritor()
    .uint8(VERSAO_DO_CARTAO)
    .bytes(dados.chaveDeIdentidade)
    .uint32(dados.prekeyAssinada.numero)
    .bytes(dados.prekeyAssinada.chave)
    .bytes(assinar(mensagemDaPrekeyAssinada(dados.prekeyAssinada)))
    .bytes(dados.caixaPrincipal)
    .uint64(dados.data)
    .uint8(relays.length);
  for (const endereco of relays) {
    const bytes = ascii(endereco);
    escritor.uint8(bytes.length).bytes(bytes);
  }
  const corpo = escritor.resultado();
  const cartao = lerCartao(juntar(corpo, assinar(juntar(CONTEXTOS.cartao, corpo))));
  // Só falha se `assinar` não devolver uma assinatura de 64 bytes.
  if (!cartao) throw new RangeError('assinatura fora do formato');
  return cartao;
}

/** Monta e assina a publicação de um cartão com one-time prekeys. Dado fora do formato lança. */
export function criarPublicacao(
  modo: ModoDaPublicacao,
  cartao: Cartao,
  prekeys: readonly Prekey[],
  assinar: Assinar,
): Publicacao {
  if (prekeys.length > MAXIMO_DE_PREKEYS) throw new RangeError('prekeys demais');
  const escritor = new Escritor()
    .uint8(MODOS.indexOf(modo))
    .bytes(cartao.bytes)
    .uint8(prekeys.length);
  for (const { numero, chave } of prekeys) {
    exigirChave(chave);
    escritor.uint32(numero).bytes(chave);
  }
  const corpo = escritor.resultado();
  const publicacao = lerPublicacao(juntar(corpo, assinar(juntar(CONTEXTOS.publicacao, corpo))));
  // Falha com cartão fora do formato, prekey repetida ou assinatura sem 64 bytes.
  if (!publicacao) throw new RangeError('publicação fora do formato');
  return publicacao;
}

/**
 * Confere as duas assinaturas do cartão, a da prekey e a do cartão inteiro, com a chave de
 * identidade que ele traz. Confere os bytes do cartão, não os campos do objeto.
 */
export function cartaoAutentico(verificador: Verificador, cartao: Cartao): boolean {
  const lido = lerCartao(cartao.bytes);
  if (!lido) return false;
  const { chaveDeIdentidade, prekeyAssinada, assinatura, bytes } = lido;
  return (
    verificador.crypto_sign_verify_detached(
      prekeyAssinada.assinatura,
      mensagemDaPrekeyAssinada(prekeyAssinada),
      chaveDeIdentidade,
    ) &&
    verificador.crypto_sign_verify_detached(
      assinatura,
      juntar(CONTEXTOS.cartao, semAssinatura(bytes)),
      chaveDeIdentidade,
    )
  );
}

/**
 * Confere a publicação inteira: o cartão e a assinatura da publicação, ambos com a chave de
 * identidade do cartão. Só o dono da identidade publica, acrescenta ou troca prekeys.
 */
export function publicacaoAutentica(verificador: Verificador, publicacao: Publicacao): boolean {
  const lida = lerPublicacao(publicacao.bytes);
  if (!lida) return false;
  return (
    cartaoAutentico(verificador, lida.cartao) &&
    verificador.crypto_sign_verify_detached(
      lida.assinatura,
      juntar(CONTEXTOS.publicacao, semAssinatura(lida.bytes)),
      lida.cartao.chaveDeIdentidade,
    )
  );
}

/** O ID que o cartão anuncia, em bytes: sai da chave de identidade, nunca de um campo à parte. */
export function idDoCartao(hash: Hash, cartao: Cartao): Uint8Array {
  return idDaChave(hash, cartao.chaveDeIdentidade);
}
