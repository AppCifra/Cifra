// Double Ratchet (Signal, revisão 1), com as derivações de derivacao.ts e XChaCha20-Poly1305. As
// funções seguem o pseudocódigo da especificação, com uma diferença de forma: nenhuma muda o
// estado que recebe. Cifrar e decifrar devolvem um estado novo, e quem chama só guarda o novo
// quando tudo deu certo. É o que a especificação pede quando uma mensagem não decifra: as mudanças
// no estado são descartadas.
import {
  codificarCabecalho,
  ErroDeFormato,
  Escritor,
  iguais,
  juntar,
  Leitor,
  type CabecalhoDaCatraca,
} from '@cifra/protocol';
import type { Cripto, ParDeChaves } from '../portas/cripto.ts';
import { derivarCadeia, derivarCifra, derivarRaiz } from './derivacao.ts';

/**
 * MAX_SKIP: quantas chaves uma mensagem pode mandar pular numa cadeia, o mesmo do Signal. Não é o
 * teto de pacotes da caixa: numa caixa sem leitura, o relay apaga os pacotes de 14 dias e aceita
 * os novos, e a distância cresce.
 */
export const SALTO_MAXIMO = 25_000;

/** Chaves puladas guardadas numa sessão; acima disso, as mais antigas saem. */
export const CHAVES_PULADAS_GUARDADAS = 2000;

/** Uma chave de mensagem que ficou para trás: a mensagem fora de ordem ainda pode chegar. */
export interface ChavePulada {
  /** A chave da catraca do outro lado naquela cadeia. */
  readonly chave: Uint8Array;
  readonly numero: number;
  readonly mensagem: Uint8Array;
}

/** O estado da especificação, com os nomes dela entre parênteses. */
export interface EstadoDaCatraca {
  /** (DHs) O par da catraca deste lado. */
  readonly enviando: ParDeChaves;
  /** (DHr) A chave da catraca do outro lado; nula até a primeira mensagem dele. */
  readonly recebendo: Uint8Array | null;
  /** (RK) */
  readonly raiz: Uint8Array;
  /** (CKs) */
  readonly cadeiaDeEnvio: Uint8Array | null;
  /** (CKr) */
  readonly cadeiaDeRecebimento: Uint8Array | null;
  /** (Ns) */
  readonly enviadas: number;
  /** (Nr) */
  readonly recebidas: number;
  /** (PN) */
  readonly anteriores: number;
  /** (MKSKIPPED) Na ordem em que foram puladas. */
  readonly puladas: readonly ChavePulada[];
}

/** Sorteia um par X25519. Os vetores passam uma sequência fixa. */
export type GerarPar = () => ParDeChaves;

/** Só as duas chaves: a libsodium-wrappers põe outros campos no par, que o banco não guarda. */
function chaves(par: ParDeChaves): ParDeChaves {
  return { privateKey: par.privateKey, publicKey: par.publicKey };
}

/** DH seguido de KDF_RK. A saída do DH é zerada logo depois de usada. */
function passoDaRaiz(cripto: Cripto, raiz: Uint8Array, par: ParDeChaves, publica: Uint8Array) {
  const saida = cripto.crypto_scalarmult(par.privateKey, publica);
  try {
    return derivarRaiz(cripto, raiz, saida);
  } finally {
    cripto.memzero(saida);
  }
}

/** RatchetInitAlice: quem abriu a sessão, com o SK do X3DH e a prekey assinada do outro lado. */
export function iniciarQuemAbre(
  cripto: Cripto,
  segredo: Uint8Array,
  prekeyDoOutro: Uint8Array,
  gerarPar: GerarPar,
): EstadoDaCatraca {
  const enviando = chaves(gerarPar());
  const { raiz, cadeia } = passoDaRaiz(cripto, segredo, enviando, prekeyDoOutro);
  return {
    enviando,
    recebendo: prekeyDoOutro,
    raiz,
    cadeiaDeEnvio: cadeia,
    cadeiaDeRecebimento: null,
    enviadas: 0,
    recebidas: 0,
    anteriores: 0,
    puladas: [],
  };
}

/** RatchetInitBob: quem respondeu, com o SK do X3DH e o par da própria prekey assinada. */
export function iniciarQuemResponde(
  segredo: Uint8Array,
  prekeyAssinada: ParDeChaves,
): EstadoDaCatraca {
  return {
    enviando: chaves(prekeyAssinada),
    recebendo: null,
    raiz: segredo,
    cadeiaDeEnvio: null,
    cadeiaDeRecebimento: null,
    enviadas: 0,
    recebidas: 0,
    anteriores: 0,
    puladas: [],
  };
}

/** CONCAT(AD, header): o AD tem tamanho fixo, então a junção se lê de um jeito só. */
function dadosDaMensagem(dadosAssociados: Uint8Array, cabecalho: CabecalhoDaCatraca): Uint8Array {
  return juntar(dadosAssociados, codificarCabecalho(cabecalho));
}

function cifrarComChave(cripto: Cripto, mk: Uint8Array, texto: Uint8Array, dados: Uint8Array) {
  const { chave, nonce } = derivarCifra(cripto, mk);
  try {
    return cripto.crypto_aead_xchacha20poly1305_ietf_encrypt(texto, dados, null, nonce, chave);
  } finally {
    cripto.memzero(chave);
  }
}

/** Lança se o cifrado ou os dados associados foram adulterados. */
function decifrarComChave(cripto: Cripto, mk: Uint8Array, cifrado: Uint8Array, dados: Uint8Array) {
  const { chave, nonce } = derivarCifra(cripto, mk);
  try {
    return cripto.crypto_aead_xchacha20poly1305_ietf_decrypt(null, cifrado, dados, nonce, chave);
  } finally {
    cripto.memzero(chave);
  }
}

/** RatchetEncrypt. Lança se este lado ainda não pode enviar (quem respondeu, antes de receber). */
export function cifrar(
  cripto: Cripto,
  estado: EstadoDaCatraca,
  texto: Uint8Array,
  dadosAssociados: Uint8Array,
): {
  readonly estado: EstadoDaCatraca;
  readonly cabecalho: CabecalhoDaCatraca;
  readonly cifrado: Uint8Array;
} {
  if (!estado.cadeiaDeEnvio) throw new Error('a catraca ainda não envia');
  if (estado.enviadas >= 0xffffffff) throw new RangeError('cadeia de envio esgotada');
  const { mensagem, cadeia } = derivarCadeia(cripto, estado.cadeiaDeEnvio);
  const cabecalho = {
    chave: estado.enviando.publicKey,
    anteriores: estado.anteriores,
    numero: estado.enviadas,
  };
  try {
    return {
      estado: { ...estado, cadeiaDeEnvio: cadeia, enviadas: estado.enviadas + 1 },
      cabecalho,
      cifrado: cifrarComChave(cripto, mensagem, texto, dadosDaMensagem(dadosAssociados, cabecalho)),
    };
  } finally {
    cripto.memzero(mensagem);
  }
}

/**
 * SkipMessageKeys: guarda as chaves da cadeia de recebimento até `ate`. Num salto maior que o
 * teto das guardadas, as do começo não entram e são zeradas logo, como as cadeias do meio.
 */
function pular(cripto: Cripto, estado: EstadoDaCatraca, ate: number): EstadoDaCatraca {
  if (estado.recebidas + SALTO_MAXIMO < ate) throw new Error('salto grande demais');
  const { recebendo } = estado;
  if (!estado.cadeiaDeRecebimento || !recebendo || estado.recebidas >= ate) return estado;
  let cadeia = estado.cadeiaDeRecebimento;
  let recebidas = estado.recebidas;
  const novas: ChavePulada[] = [];
  while (recebidas < ate) {
    const passo = derivarCadeia(cripto, cadeia);
    if (recebidas >= ate - CHAVES_PULADAS_GUARDADAS) {
      novas.push({ chave: recebendo, numero: recebidas, mensagem: passo.mensagem });
    } else {
      cripto.memzero(passo.mensagem);
    }
    if (cadeia !== estado.cadeiaDeRecebimento) cripto.memzero(cadeia);
    cadeia = passo.cadeia;
    recebidas++;
  }
  return {
    ...estado,
    cadeiaDeRecebimento: cadeia,
    recebidas,
    puladas: [...estado.puladas, ...novas].slice(-CHAVES_PULADAS_GUARDADAS),
  };
}

/** DHRatchet: a mensagem trouxe uma chave nova do outro lado. */
function passoDh(
  cripto: Cripto,
  estado: EstadoDaCatraca,
  chaveDoOutro: Uint8Array,
  gerarPar: GerarPar,
): EstadoDaCatraca {
  const recebimento = passoDaRaiz(cripto, estado.raiz, estado.enviando, chaveDoOutro);
  const enviando = chaves(gerarPar());
  const envio = passoDaRaiz(cripto, recebimento.raiz, enviando, chaveDoOutro);
  return {
    ...estado,
    anteriores: estado.enviadas,
    enviadas: 0,
    recebidas: 0,
    recebendo: chaveDoOutro,
    raiz: envio.raiz,
    cadeiaDeRecebimento: recebimento.cadeia,
    enviando,
    cadeiaDeEnvio: envio.cadeia,
  };
}

function decifrarOuLancar(
  cripto: Cripto,
  estado: EstadoDaCatraca,
  cabecalho: CabecalhoDaCatraca,
  cifrado: Uint8Array,
  dadosAssociados: Uint8Array,
  gerarPar: GerarPar,
): { readonly estado: EstadoDaCatraca; readonly texto: Uint8Array } {
  const dados = dadosDaMensagem(dadosAssociados, cabecalho);

  // TrySkippedMessageKeys
  const indice = estado.puladas.findIndex(
    (pulada) => pulada.numero === cabecalho.numero && iguais(pulada.chave, cabecalho.chave),
  );
  const pulada = estado.puladas[indice];
  if (pulada) {
    return {
      estado: { ...estado, puladas: estado.puladas.filter((_, i) => i !== indice) },
      texto: decifrarComChave(cripto, pulada.mensagem, cifrado, dados),
    };
  }

  let novo = estado;
  if (!novo.recebendo || !iguais(cabecalho.chave, novo.recebendo)) {
    novo = pular(cripto, novo, cabecalho.anteriores);
    novo = passoDh(cripto, novo, cabecalho.chave, gerarPar);
  }
  novo = pular(cripto, novo, cabecalho.numero);
  if (!novo.cadeiaDeRecebimento) throw new Error('sem cadeia de recebimento');
  const { mensagem, cadeia } = derivarCadeia(cripto, novo.cadeiaDeRecebimento);
  try {
    return {
      estado: { ...novo, cadeiaDeRecebimento: cadeia, recebidas: novo.recebidas + 1 },
      texto: decifrarComChave(cripto, mensagem, cifrado, dados),
    };
  } finally {
    cripto.memzero(mensagem);
  }
}

/**
 * RatchetDecrypt. Devolve `null` quando a mensagem não decifra: adulterada, repetida, de outra
 * sessão, com salto grande demais ou com chave que não serve para acordo. O estado recebido nunca
 * muda.
 */
export function decifrar(
  cripto: Cripto,
  estado: EstadoDaCatraca,
  cabecalho: CabecalhoDaCatraca,
  cifrado: Uint8Array,
  dadosAssociados: Uint8Array,
  gerarPar: GerarPar,
): { readonly estado: EstadoDaCatraca; readonly texto: Uint8Array } | null {
  try {
    return decifrarOuLancar(cripto, estado, cabecalho, cifrado, dadosAssociados, gerarPar);
  } catch {
    return null;
  }
}

// O estado no banco (inteiros em big-endian):
//   par da catraca          privada (32) + pública (32)
//   chave do outro lado     tem (1) [+ 32]
//   raiz                    32
//   cadeia de envio         tem (1) [+ 32]
//   cadeia de recebimento   tem (1) [+ 32]
//   Ns, Nr e PN             4 cada
//   puladas                 quantidade (2) + cada uma: chave (32) + número (4) + mensagem (32)

function escreverOpcional(escritor: Escritor, bytes: Uint8Array | null): void {
  if (bytes) escritor.uint8(1).bytes(bytes);
  else escritor.uint8(0);
}

function lerOpcional(leitor: Leitor): Uint8Array | null {
  const tem = leitor.uint8();
  if (tem > 1) throw new ErroDeFormato('opcional');
  return tem === 1 ? leitor.bytes(32) : null;
}

export function escreverCatraca(escritor: Escritor, estado: EstadoDaCatraca): void {
  escritor.bytes(estado.enviando.privateKey).bytes(estado.enviando.publicKey);
  escreverOpcional(escritor, estado.recebendo);
  escritor.bytes(estado.raiz);
  escreverOpcional(escritor, estado.cadeiaDeEnvio);
  escreverOpcional(escritor, estado.cadeiaDeRecebimento);
  escritor.uint32(estado.enviadas).uint32(estado.recebidas).uint32(estado.anteriores);
  escritor.uint16(estado.puladas.length);
  for (const pulada of estado.puladas) {
    escritor.bytes(pulada.chave).uint32(pulada.numero).bytes(pulada.mensagem);
  }
}

/** Lê o estado guardado. Lança `ErroDeFormato` se os bytes não seguem o formato. */
export function lerCatraca(leitor: Leitor): EstadoDaCatraca {
  const enviando = { privateKey: leitor.bytes(32), publicKey: leitor.bytes(32) };
  const recebendo = lerOpcional(leitor);
  const raiz = leitor.bytes(32);
  const cadeiaDeEnvio = lerOpcional(leitor);
  const cadeiaDeRecebimento = lerOpcional(leitor);
  const enviadas = leitor.uint32();
  const recebidas = leitor.uint32();
  const anteriores = leitor.uint32();
  const quantidade = leitor.uint16();
  if (quantidade > CHAVES_PULADAS_GUARDADAS) throw new ErroDeFormato('puladas');
  const puladas: ChavePulada[] = [];
  for (let i = 0; i < quantidade; i++) {
    puladas.push({ chave: leitor.bytes(32), numero: leitor.uint32(), mensagem: leitor.bytes(32) });
  }
  return {
    enviando,
    recebendo,
    raiz,
    cadeiaDeEnvio,
    cadeiaDeRecebimento,
    enviadas,
    recebidas,
    anteriores,
    puladas,
  };
}
