// Identidade (SPEC, seção "Identidade"). As 12 palavras guardam a entropia; a semente é o
// BLAKE2b-256 da entropia; a chave Ed25519 sai da semente; a chave X25519 de acordo sai da
// Ed25519; o ID são os primeiros 80 bits do BLAKE2b-256 da chave pública Ed25519. Nenhum dado
// pessoal entra: só a entropia sorteada neste aparelho.
import { formatarId, idDaChave } from '@cifra/protocol';
import type { Cripto, ParDeChaves } from '../portas/cripto.ts';
import {
  BYTES_DA_ENTROPIA,
  lerPalavras,
  palavrasDaEntropia,
  type IdiomaDasPalavras,
  type ProblemaNasPalavras,
} from './palavras.ts';

export const BYTES_DA_SEMENTE = 32;

export interface Identidade {
  /** Fica só no banco cifrado: é ela que cifra o backup. Gera todas as chaves. */
  readonly semente: Uint8Array;
  /** Ed25519: assina o cartão e o X3DH. */
  readonly assinatura: ParDeChaves;
  /** X25519 derivada da Ed25519: acordo de chaves. */
  readonly acordo: ParDeChaves;
  /** XXXX-XXXX-XXXX-XXXX */
  readonly id: string;
}

export interface IdentidadeNova {
  readonly identidade: Identidade;
  /** As 12 palavras, no idioma pedido. Aparecem uma vez e nunca são guardadas. */
  readonly palavras: readonly string[];
}

export type Restauracao =
  | { readonly ok: true; readonly identidade: Identidade }
  | { readonly ok: false; readonly problema: ProblemaNasPalavras };

/** O ID de uma chave pública Ed25519. A derivação é a do protocolo, a mesma do relay. */
export function idDaChavePublica(cripto: Cripto, chavePublica: Uint8Array): string {
  return formatarId(idDaChave(cripto, chavePublica));
}

/** Refaz as chaves e o ID a partir da semente guardada. A identidade fica com a semente. */
export function identidadeDaSemente(cripto: Cripto, semente: Uint8Array): Identidade {
  if (semente.length !== BYTES_DA_SEMENTE) {
    throw new Error(`a semente tem ${BYTES_DA_SEMENTE} bytes`);
  }
  const assinatura = cripto.crypto_sign_seed_keypair(semente);
  return {
    semente,
    assinatura,
    acordo: {
      publicKey: cripto.crypto_sign_ed25519_pk_to_curve25519(assinatura.publicKey),
      privateKey: cripto.crypto_sign_ed25519_sk_to_curve25519(assinatura.privateKey),
    },
    id: idDaChavePublica(cripto, assinatura.publicKey),
  };
}

export function identidadeDaEntropia(cripto: Cripto, entropia: Uint8Array): Identidade {
  if (entropia.length !== BYTES_DA_ENTROPIA) {
    throw new Error(`a entropia tem ${BYTES_DA_ENTROPIA} bytes`);
  }
  return identidadeDaSemente(cripto, cripto.crypto_generichash(BYTES_DA_SEMENTE, entropia, null));
}

/** Sorteia uma identidade nova. As palavras saem na lista do idioma da interface. */
export function gerarIdentidade(cripto: Cripto, idioma: IdiomaDasPalavras): IdentidadeNova {
  const entropia = cripto.randombytes_buf(BYTES_DA_ENTROPIA);
  try {
    return {
      identidade: identidadeDaEntropia(cripto, entropia),
      palavras: palavrasDaEntropia(cripto, entropia, idioma),
    };
  } finally {
    cripto.memzero(entropia);
  }
}

/** Refaz a identidade a partir das 12 palavras, em português ou em inglês. */
export function restaurarIdentidade(cripto: Cripto, texto: string): Restauracao {
  const leitura = lerPalavras(cripto, texto);
  if (!leitura.ok) return leitura;
  try {
    return { ok: true, identidade: identidadeDaEntropia(cripto, leitura.entropia) };
  } finally {
    cripto.memzero(leitura.entropia);
  }
}
