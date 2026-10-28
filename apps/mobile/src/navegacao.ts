// A pilha de telas da identidade aberta, sem React: a lista de conversas embaixo, e por cima a
// conversa, a segurança do contato, os pedidos, os ajustes, o código secreto, a política de
// privacidade, os termos de uso e o encaminhar. O voltar do Android tira a de cima.

export type TelaDoApp =
  | { readonly tipo: 'conversas' }
  | { readonly tipo: 'conversa'; readonly id: string }
  | { readonly tipo: 'seguranca'; readonly id: string }
  | { readonly tipo: 'pedidos' }
  | { readonly tipo: 'ajustes' }
  /** O código secreto das conversas ocultas. */
  | { readonly tipo: 'codigo' }
  /** A política de privacidade (RF-61). */
  | { readonly tipo: 'politica' }
  /** Os termos de uso (RF-62). */
  | { readonly tipo: 'termos' }
  /** Encaminhar as mensagens da conversa `id` (os IDs em hexadecimal). */
  | { readonly tipo: 'encaminhar'; readonly id: string; readonly mensagens: readonly string[] };

export type Pilha = readonly TelaDoApp[];

export const PILHA_INICIAL: Pilha = [{ tipo: 'conversas' }];

const mesma = (a: TelaDoApp, b: TelaDoApp) =>
  a.tipo === b.tipo && ('id' in a ? 'id' in b && a.id === b.id : true);

/** Abre a tela por cima. Tocar duas vezes não empilha a mesma tela duas vezes. */
export function empilhar(pilha: Pilha, tela: TelaDoApp): Pilha {
  const topo = pilha.at(-1);
  return topo && mesma(topo, tela) ? pilha : [...pilha, tela];
}

/** Tira a tela de cima. A lista de conversas fica sempre. */
export function voltar(pilha: Pilha): Pilha {
  return pilha.length > 1 ? pilha.slice(0, -1) : pilha;
}

/** Tira as telas de uma conversa que deixou de existir (pedido recusado, por exemplo). */
export function semAConversa(pilha: Pilha, id: string): Pilha {
  const restante = pilha.filter((tela) => !('id' in tela) || tela.id !== id);
  return restante.length > 0 ? restante : PILHA_INICIAL;
}

/** As ocultas fecharam: as telas das conversas delas saem da pilha (RF-24). */
export function semAsConversas(pilha: Pilha, ids: ReadonlySet<string>): Pilha {
  const restante = pilha.filter((tela) => !('id' in tela) || !ids.has(tela.id));
  return restante.length > 0 ? restante : PILHA_INICIAL;
}
