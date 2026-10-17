// Endereço de relay, como aparece no cartão. `ws://` só para .onion, porque o Tor já cifra e
// autentica o serviço; fora isso, `wss://`. Sempre em minúsculas: cada relay tem uma grafia só.

/** Tamanho máximo de um endereço, em bytes: cabe no byte de tamanho do formato do cartão. */
export const LIMITE_DO_ENDERECO = 255;

const ROTULO = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';
const ENDERECO = new RegExp(`^(wss?)://((?:${ROTULO}\\.)*${ROTULO})(?::([0-9]{1,5}))?(/[!-~]*)?$`);

export function enderecoDeRelayValido(endereco: string): boolean {
  if (endereco.length > LIMITE_DO_ENDERECO) return false;
  const achado = ENDERECO.exec(endereco);
  if (!achado) return false;
  const [, esquema, host = '', porta] = achado;
  if (porta !== undefined && (Number(porta) < 1 || Number(porta) > 65535)) return false;
  return esquema === 'wss' || host.endsWith('.onion');
}
