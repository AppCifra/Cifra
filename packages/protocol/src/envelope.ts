// Interior do pacote de mensagem (SPEC, "Envelope, padding e remetente oculto"). O app sela o
// interior com crypto_box_seal para a chave X25519 de identidade do destinatário: o relay só vê a
// caixa de destino e 4096 bytes que não dizem nada. Quem enviou só aparece aqui dentro.
//
// Interior (4048 bytes; com os 48 do selo, 4096), inteiros em big-endian:
//   versão                                 1 byte
//   tipo                                   1 byte: 1 inicial, 2 sessão
//   inicial, em toda mensagem de quem abriu a sessão, até a primeira resposta (X3DH):
//     chave de identidade de quem envia    32 bytes, Ed25519: o ID sai dela
//     chave efêmera                        32 bytes, X25519
//     número da prekey assinada            4 bytes
//     tem one-time prekey                  1 byte, 0 ou 1
//     número da one-time prekey            4 bytes, 0 quando não tem
//   sessão:
//     ID de quem envia                     10 bytes
//   cabeçalho da catraca:
//     chave da catraca                     32 bytes, X25519
//     PN                                   4 bytes, mensagens da cadeia de envio anterior
//     N                                    4 bytes, número desta mensagem na cadeia
//   cifrado                                conteúdo do tamanho fixo do tipo + 16 de etiqueta
//
// O conteúdo de cada tipo tem o tamanho que completa os 4048 bytes (conteudo.ts).
import { ErroDeFormato, Escritor, Leitor } from './bytes.ts';
import { BYTES_DA_CHAVE } from './cartao.ts';
import { BYTES_DO_ID } from './id.ts';
import { TAMANHO_DO_PACOTE } from './limites.ts';

/** O que o crypto_box_seal acrescenta: a chave efêmera (32) e a etiqueta (16). */
export const BYTES_DO_SELO = 48;

/** O interior selado de todo pacote de mensagem. */
export const BYTES_DO_INTERIOR = TAMANHO_DO_PACOTE - BYTES_DO_SELO;

/** Etiqueta do XChaCha20-Poly1305, no fim do cifrado. */
export const BYTES_DA_ETIQUETA = 16;

/** Cabeçalho da catraca: chave (32), PN (4) e N (4). */
export const BYTES_DO_CABECALHO_DA_CATRACA = BYTES_DA_CHAVE + 4 + 4;

/** Versão do formato do interior. */
export const VERSAO_DO_ENVELOPE = 1;

export type TipoDeEnvelope = 'inicial' | 'sessao';

const TIPOS = { inicial: 1, sessao: 2 } as const satisfies Record<TipoDeEnvelope, number>;

/** Bytes antes do cabeçalho da catraca, em cada tipo. */
const CAMPOS: Readonly<Record<TipoDeEnvelope, number>> = {
  inicial: 1 + 1 + BYTES_DA_CHAVE + BYTES_DA_CHAVE + 4 + 1 + 4,
  sessao: 1 + 1 + BYTES_DO_ID,
};

/** Tamanho fixo do conteúdo, antes de cifrar, em cada tipo de envelope. */
export function capacidadeDoConteudo(tipo: TipoDeEnvelope): number {
  return BYTES_DO_INTERIOR - CAMPOS[tipo] - BYTES_DO_CABECALHO_DA_CATRACA - BYTES_DA_ETIQUETA;
}

export interface CabecalhoDaCatraca {
  /** Chave pública X25519 da catraca de quem envia. */
  readonly chave: Uint8Array;
  /** PN: quantas mensagens a cadeia de envio anterior teve. */
  readonly anteriores: number;
  /** N: o número desta mensagem na cadeia de envio. */
  readonly numero: number;
}

/** O que quem abre a sessão manda em toda mensagem até receber a primeira resposta (X3DH). */
export interface AberturaDaSessao {
  /** Ed25519 de quem envia: o ID sai dela. */
  readonly chaveDeIdentidade: Uint8Array;
  /** EK, X25519. */
  readonly chaveEfemera: Uint8Array;
  readonly prekeyAssinada: number;
  /** `null` quando o relay entregou o cartão sem one-time prekey. */
  readonly prekeyAvulsa: number | null;
}

export type Interior =
  | {
      readonly tipo: 'inicial';
      readonly abertura: AberturaDaSessao;
      readonly cabecalho: CabecalhoDaCatraca;
      readonly cifrado: Uint8Array;
    }
  | {
      readonly tipo: 'sessao';
      /** O ID de quem envia, em bytes. */
      readonly remetente: Uint8Array;
      readonly cabecalho: CabecalhoDaCatraca;
      readonly cifrado: Uint8Array;
    };

function exigir(bytes: Uint8Array, tamanho: number): Uint8Array {
  if (bytes.length !== tamanho) throw new RangeError(`campo de ${tamanho} bytes`);
  return bytes;
}

/** O cabeçalho da catraca em bytes: também entra nos dados associados do AEAD. */
export function codificarCabecalho(cabecalho: CabecalhoDaCatraca): Uint8Array {
  return new Escritor()
    .bytes(exigir(cabecalho.chave, BYTES_DA_CHAVE))
    .uint32(cabecalho.anteriores)
    .uint32(cabecalho.numero)
    .resultado();
}

/** Monta o interior de 4048 bytes. Campo fora do tamanho é erro de quem chama e lança. */
export function codificarInterior(interior: Interior): Uint8Array {
  const escritor = new Escritor().uint8(VERSAO_DO_ENVELOPE).uint8(TIPOS[interior.tipo]);
  if (interior.tipo === 'inicial') {
    const { abertura } = interior;
    escritor
      .bytes(exigir(abertura.chaveDeIdentidade, BYTES_DA_CHAVE))
      .bytes(exigir(abertura.chaveEfemera, BYTES_DA_CHAVE))
      .uint32(abertura.prekeyAssinada)
      .uint8(abertura.prekeyAvulsa === null ? 0 : 1)
      .uint32(abertura.prekeyAvulsa ?? 0);
  } else {
    escritor.bytes(exigir(interior.remetente, BYTES_DO_ID));
  }
  const tamanhoDoCifrado = capacidadeDoConteudo(interior.tipo) + BYTES_DA_ETIQUETA;
  return escritor
    .bytes(codificarCabecalho(interior.cabecalho))
    .bytes(exigir(interior.cifrado, tamanhoDoCifrado))
    .resultado();
}

function lerCabecalho(leitor: Leitor): CabecalhoDaCatraca {
  return {
    chave: leitor.bytes(BYTES_DA_CHAVE),
    anteriores: leitor.uint32(),
    numero: leitor.uint32(),
  };
}

function lerAbertura(leitor: Leitor): AberturaDaSessao {
  const chaveDeIdentidade = leitor.bytes(BYTES_DA_CHAVE);
  const chaveEfemera = leitor.bytes(BYTES_DA_CHAVE);
  const prekeyAssinada = leitor.uint32();
  const temAvulsa = leitor.uint8();
  const numero = leitor.uint32();
  if (temAvulsa > 1 || (temAvulsa === 0 && numero !== 0)) throw new ErroDeFormato('one-time');
  return {
    chaveDeIdentidade,
    chaveEfemera,
    prekeyAssinada,
    prekeyAvulsa: temAvulsa === 1 ? numero : null,
  };
}

/** Lê o interior que o selo guardava. Devolve `null` se o formato não bate. */
export function lerInterior(bytes: Uint8Array): Interior | null {
  if (bytes.length !== BYTES_DO_INTERIOR) return null;
  try {
    const leitor = new Leitor(bytes);
    if (leitor.uint8() !== VERSAO_DO_ENVELOPE) return null;
    const codigo = leitor.uint8();
    let interior: Interior;
    if (codigo === TIPOS.inicial) {
      const abertura = lerAbertura(leitor);
      const cabecalho = lerCabecalho(leitor);
      const cifrado = leitor.bytes(capacidadeDoConteudo('inicial') + BYTES_DA_ETIQUETA);
      interior = { tipo: 'inicial', abertura, cabecalho, cifrado };
    } else if (codigo === TIPOS.sessao) {
      const remetente = leitor.bytes(BYTES_DO_ID);
      const cabecalho = lerCabecalho(leitor);
      const cifrado = leitor.bytes(capacidadeDoConteudo('sessao') + BYTES_DA_ETIQUETA);
      interior = { tipo: 'sessao', remetente, cabecalho, cifrado };
    } else {
      return null;
    }
    leitor.fim();
    return interior;
  } catch (erro) {
    if (erro instanceof ErroDeFormato) return null;
    throw erro;
  }
}
