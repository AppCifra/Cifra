// Conversões puras usadas pelos adaptadores. Sem React Native: os testes rodam no Node.
import { paraHex } from '@cifra/protocol';

/**
 * Chave crua de 256 bits no formato que o SQLCipher aceita: `x'<64 hex>'`. Com esse formato o
 * SQLCipher usa a chave direto, sem PBKDF2 (a chave já é aleatória).
 */
export function chaveDoSqlcipher(chave: Uint8Array): string {
  if (chave.length !== 32) throw new Error('a chave do banco tem 32 bytes');
  return `x'${paraHex(chave)}'`;
}

/**
 * Diz se o erro do SQLite é o de um arquivo que não abre com a chave dada. O SQLCipher responde
 * assim tanto à chave errada quanto a um arquivo danificado.
 */
export function arquivoNaoAbre(mensagem: string): boolean {
  return /file is not a database/i.test(mensagem);
}

/**
 * Códigos do pedido de biometria do Android que querem dizer cancelamento: pelo sistema (5, por
 * exemplo quando o app sai da frente), pela pessoa (10) ou no botão de cancelar (13).
 */
const CANCELAMENTOS: ReadonlySet<number> = new Set([5, 10, 13]);

/**
 * Diz se o erro da react-native-keychain é o pedido de biometria ou senha cancelado. A biblioteca
 * monta a mensagem como "code: <número>, msg: <texto do sistema>".
 */
export function pedidoCancelado(mensagem: string): boolean {
  const codigo = /\bcode: (\d+)\b/.exec(mensagem)?.[1];
  return codigo !== undefined && CANCELAMENTOS.has(Number(codigo));
}

/** Bytes de um texto hexadecimal (o ID de uma mensagem na pilha de telas). */
export function deHex(texto: string): Uint8Array {
  return Uint8Array.from({ length: texto.length / 2 }, (_, i) =>
    parseInt(texto.slice(i * 2, i * 2 + 2), 16),
  );
}

/** Bytes convertidos por vez no base64: grande o bastante para ser rápido, sem estourar a pilha. */
const BLOCO_DO_BASE64 = 0x2000;

/** Base64, em blocos: uma foto inteira vira texto sem passar byte a byte. */
export function paraBase64(bytes: Uint8Array): string {
  const partes: string[] = [];
  for (let inicio = 0; inicio < bytes.length; inicio += BLOCO_DO_BASE64) {
    partes.push(String.fromCharCode(...bytes.subarray(inicio, inicio + BLOCO_DO_BASE64)));
  }
  return btoa(partes.join(''));
}

export function deBase64(texto: string): Uint8Array {
  const binario = atob(texto);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

/** A foto aberta na memória, para a tela mostrar sem gravar nada em arquivo (RF-36). */
export function enderecoDeDados(formato: string, bytes: Uint8Array): string {
  return `data:${formato};base64,${paraBase64(bytes)}`;
}

/** Diz se `agulha` aparece dentro de `palheiro`. Usado para procurar texto nos bytes do banco. */
export function contem(palheiro: Uint8Array, agulha: Uint8Array): boolean {
  for (let i = 0; i <= palheiro.length - agulha.length; i++) {
    let j = 0;
    while (j < agulha.length && palheiro[i + j] === agulha[j]) j++;
    if (j === agulha.length) return true;
  }
  return false;
}

export type ProblemaNoEndereco = 'endereco-invalido' | 'texto-claro-fora-do-tor';

/**
 * Valida o endereço do relay antes de conectar. Com Tor: `ws://` só para `.onion` (o Tor já cifra
 * e autentica o serviço) ou `wss://`. Sem Tor: só `wss://`. O HTTP dos anexos segue as mesmas
 * regras, com `http://` e `https://`.
 */
export function problemaNoEndereco(
  endereco: string,
  comTor: boolean,
  protocolo: 'websocket' | 'http' = 'websocket',
): ProblemaNoEndereco | null {
  const achado = /^([a-z]+):\/\/([a-z0-9.-]+)(?::\d{1,5})?(?:\/[^\s]*)?$/i.exec(endereco);
  const esquema = achado?.[1]?.toLowerCase();
  const [claro, seguro] = protocolo === 'websocket' ? ['ws', 'wss'] : ['http', 'https'];
  if (!achado || (esquema !== claro && esquema !== seguro)) return 'endereco-invalido';
  if (esquema === seguro) return null;
  return comTor && achado[2]?.toLowerCase().endsWith('.onion') ? null : 'texto-claro-fora-do-tor';
}
