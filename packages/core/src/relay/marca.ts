// Marca de aviso (RF-42): vai junto com cada pacote depositado e diz ao dono da caixa se o pacote é
// uma mensagem, sem abrir o pacote. É 1 byte selado (crypto_box_seal) para a chave X25519 que sai
// da chave da caixa (Ed25519): o relay guarda e repassa sem conseguir abrir, e todo depósito tem o
// mesmo tamanho. Com o app bloqueado, o vigia só tem a chave da caixa, não a identidade: sem a
// marca, ele avisaria também das confirmações de leitura, do "digitando" e dos controles.
import { BYTES_DA_MARCA } from '@cifra/protocol';
import type { Cripto } from '../portas/cripto.ts';

/** A marca de um pacote para a caixa `caixa`: `avisa` só nas mensagens (texto e anexo). */
export function selarMarca(cripto: Cripto, caixa: Uint8Array, avisa: boolean): Uint8Array {
  const destino = cripto.crypto_sign_ed25519_pk_to_curve25519(caixa);
  return cripto.crypto_box_seal(Uint8Array.of(avisa ? 1 : 0), destino);
}

/**
 * Abre a marca com a semente da caixa. Só a marca que abre e diz "não" deixa de avisar: na dúvida
 * (marca adulterada, de outra caixa ou sem marca), o aviso sai.
 */
export function marcaAvisa(cripto: Cripto, marca: Uint8Array, sementeDaCaixa: Uint8Array): boolean {
  if (marca.length !== BYTES_DA_MARCA) return true;
  const par = cripto.crypto_sign_seed_keypair(sementeDaCaixa);
  const privada = cripto.crypto_sign_ed25519_sk_to_curve25519(par.privateKey);
  try {
    const aberta = cripto.crypto_box_seal_open(
      marca,
      cripto.crypto_sign_ed25519_pk_to_curve25519(par.publicKey),
      privada,
    );
    return !(aberta.length === 1 && aberta[0] === 0);
  } catch {
    return true;
  } finally {
    cripto.memzero(privada);
    cripto.memzero(par.privateKey);
  }
}
