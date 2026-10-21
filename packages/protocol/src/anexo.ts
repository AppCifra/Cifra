// Anexos (SPEC, "Anexos"): o arquivo vai cifrado ao relay, por HTTP no mesmo servidor do WebSocket,
// e a mensagem leva o que abre ele: o token, a chave e o hash. O relay só vê um blob aleatório de
// um tamanho arredondado para uma faixa fixa (Padmé), sem saber de quem é nem para quem vai.
//
// Blob no relay:
//   cabeçalho do crypto_secretstream     24 bytes
//   pedaços cifrados                     o texto claro em pedaços de 64 KiB, cada um com 17 bytes a
//                                        mais; o último leva a etiqueta final
//   preenchimento                        bytes aleatórios até a faixa; o hash do blob, que vai na
//                                        mensagem cifrada, cobre também eles
//
// O texto claro é a capa (um quadro do vídeo, em JPEG; só no vídeo) seguida do arquivo.
//
// Caminho no relay: /anexos/<token em hexadecimal minúsculo>. O endereço sai do endereço do relay:
// ws:// vira http:// (só .onion) e wss:// vira https://.
import { paraHex } from './bytes.ts';

/** O token que aponta o anexo no relay: sorteado por quem envia, só os dois conhecem. */
export const BYTES_DO_TOKEN = 32;

/** A chave do crypto_secretstream_xchacha20poly1305, sorteada para cada anexo. */
export const BYTES_DA_CHAVE_DO_ANEXO = 32;

/** O BLAKE2b do blob inteiro, como chegou ao relay. */
export const BYTES_DO_HASH_DO_ANEXO = 32;

/** crypto_secretstream_xchacha20poly1305_HEADERBYTES. */
export const BYTES_DO_CABECALHO_DO_FLUXO = 24;

/** crypto_secretstream_xchacha20poly1305_ABYTES: o que cada pedaço ganha ao ser cifrado. */
export const BYTES_A_MAIS_POR_PEDACO = 17;

/** O texto claro é cifrado em pedaços deste tamanho; o último pode ser menor. */
export const BYTES_DO_PEDACO = 65_536;

/** O menor blob: arquivo pequeno não revela o tamanho exato. */
export const TAMANHO_MINIMO_DO_ANEXO = 4096;

/** O maior blob que o relay aceita: 25 MiB. É o limite de uma faixa do Padmé. */
export const TAMANHO_MAXIMO_DO_ANEXO = 25 * 1024 * 1024;

/**
 * Padmé (Nikitin et al., "Reducing Metadata Leakage from Encrypted Files and Communication with
 * PURBs", PETS 2019): arredonda o tamanho para cima, zerando os bits baixos. A sobra fica abaixo de
 * 12%, e o tamanho arredondado revela só O(log log L) bits.
 */
export function padme(tamanho: number): number {
  if (!Number.isSafeInteger(tamanho) || tamanho < 2) throw new RangeError('tamanho inválido');
  const expoente = Math.floor(Math.log2(tamanho));
  const bitsDoExpoente = Math.floor(Math.log2(expoente)) + 1;
  const zerados = expoente - bitsDoExpoente;
  const passo = 2 ** zerados;
  return Math.ceil(tamanho / passo) * passo;
}

/** Quantos pedaços tem um texto claro: sempre pelo menos um, para levar a etiqueta final. */
export function pedacosDoClaro(claro: number): number {
  return Math.max(1, Math.ceil(claro / BYTES_DO_PEDACO));
}

/** O tamanho do fluxo cifrado, antes do preenchimento. */
export function tamanhoCifrado(claro: number): number {
  return BYTES_DO_CABECALHO_DO_FLUXO + claro + BYTES_A_MAIS_POR_PEDACO * pedacosDoClaro(claro);
}

/** O tamanho do blob no relay para um texto claro de `claro` bytes. */
export function tamanhoDoAnexo(claro: number): number {
  if (!Number.isSafeInteger(claro) || claro < 1) throw new RangeError('anexo vazio');
  return padme(Math.max(tamanhoCifrado(claro), TAMANHO_MINIMO_DO_ANEXO));
}

/** O relay só aceita blob de tamanho que alguma faixa produz, entre o mínimo e o máximo. */
export function tamanhoDeAnexoValido(blob: number): boolean {
  return (
    Number.isSafeInteger(blob) &&
    blob >= TAMANHO_MINIMO_DO_ANEXO &&
    blob <= TAMANHO_MAXIMO_DO_ANEXO &&
    padme(blob) === blob
  );
}

/** O maior texto claro (capa mais arquivo) que cabe no maior blob. */
export const TAMANHO_MAXIMO_DO_CLARO = ((): number => {
  let claro = TAMANHO_MAXIMO_DO_ANEXO - BYTES_DO_CABECALHO_DO_FLUXO;
  while (claro > 0 && tamanhoCifrado(claro) > TAMANHO_MAXIMO_DO_ANEXO) claro--;
  return claro;
})();

const HEXADECIMAL = /^[0-9a-f]*$/;

/** O caminho do anexo no relay. */
export function caminhoDoAnexo(token: Uint8Array): string {
  if (token.length !== BYTES_DO_TOKEN) throw new RangeError(`o token tem ${BYTES_DO_TOKEN} bytes`);
  return `/anexos/${paraHex(token)}`;
}

/** O token de um caminho que o relay recebeu, ou `null` se o caminho não é exatamente um anexo. */
export function lerCaminhoDoAnexo(caminho: string): Uint8Array | null {
  const prefixo = '/anexos/';
  if (!caminho.startsWith(prefixo)) return null;
  const hex = caminho.slice(prefixo.length);
  if (hex.length !== BYTES_DO_TOKEN * 2 || !HEXADECIMAL.test(hex)) return null;
  return Uint8Array.from({ length: BYTES_DO_TOKEN }, (_, i) =>
    parseInt(hex.slice(i * 2, i * 2 + 2), 16),
  );
}

/**
 * O endereço HTTP do anexo no relay de `relay` (o endereço do cartão, ws:// ou wss://). O caminho do
 * relay, se houver, vem antes de /anexos: um proxy reverso pode servir o relay num subcaminho.
 */
export function enderecoDoAnexo(relay: string, token: Uint8Array): string {
  const achado = /^(wss?):\/\/([^/]+)(\/.*)?$/.exec(relay);
  if (!achado) throw new RangeError('endereço de relay inválido');
  const [, esquema, host = '', caminho = ''] = achado;
  const base = caminho.replace(/\/+$/, '');
  return `${esquema === 'wss' ? 'https' : 'http'}://${host}${base}${caminhoDoAnexo(token)}`;
}
