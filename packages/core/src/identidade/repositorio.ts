// A identidade no banco principal, que é cifrado: só a semente, de onde saem as chaves e o ID.
import type { Armazenamento } from '../portas/armazenamento.ts';
import type { Cripto } from '../portas/cripto.ts';
import { identidadeDaSemente, type Identidade } from './identidade.ts';

/** Guarda a identidade deste aparelho. Só existe uma: guardar outra por cima falha. */
export async function guardarIdentidade(
  banco: Armazenamento,
  identidade: Identidade,
): Promise<void> {
  await banco.executar('INSERT INTO identidade (unica, semente) VALUES (1, ?)', [
    identidade.semente,
  ]);
}

/** A identidade guardada, ou `null` se ainda não há nenhuma. */
export async function carregarIdentidade(
  banco: Armazenamento,
  cripto: Cripto,
): Promise<Identidade | null> {
  const [linha] = await banco.consultar('SELECT semente FROM identidade WHERE unica = 1');
  if (!linha) return null;
  const semente = linha['semente'];
  if (!(semente instanceof Uint8Array)) throw new Error('semente ilegível no banco');
  return identidadeDaSemente(cripto, semente);
}
