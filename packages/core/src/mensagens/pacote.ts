// O pacote de 4096 bytes: o interior selado com crypto_box_seal para a chave X25519 de identidade
// do destinatário (SPEC, "Envelope, padding e remetente oculto"). Como no sealed sender do Signal,
// só o destinatário abre, e quem enviou só aparece lá dentro.
import { codificarInterior, lerInterior, TAMANHO_DO_PACOTE, type Interior } from '@cifra/protocol';
import type { Identidade } from '../identidade/identidade.ts';
import type { Cripto } from '../portas/cripto.ts';

/** Sela o interior para o contato. `chaveDoContato` é a Ed25519 do cartão dele. */
export function selarPacote(
  cripto: Cripto,
  interior: Interior,
  chaveDoContato: Uint8Array,
): Uint8Array {
  const destino = cripto.crypto_sign_ed25519_pk_to_curve25519(chaveDoContato);
  const pacote = cripto.crypto_box_seal(codificarInterior(interior), destino);
  if (pacote.length !== TAMANHO_DO_PACOTE) throw new Error('pacote fora do tamanho');
  return pacote;
}

/**
 * Abre o pacote com a chave de identidade deste aparelho. Devolve `null` se ele não foi selado
 * para ela, foi adulterado ou não segue o formato.
 */
export function abrirPacote(
  cripto: Cripto,
  pacote: Uint8Array,
  identidade: Identidade,
): Interior | null {
  if (pacote.length !== TAMANHO_DO_PACOTE) return null;
  let interior: Uint8Array;
  try {
    interior = cripto.crypto_box_seal_open(
      pacote,
      identidade.acordo.publicKey,
      identidade.acordo.privateKey,
    );
  } catch {
    return null;
  }
  return lerInterior(interior);
}
