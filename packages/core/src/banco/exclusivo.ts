// Um acesso ao banco principal por vez. O correio e a agenda usam a mesma conexão do SQLite: sem
// isto, um comando da tela entraria no meio de uma transação do correio, que espera entre um
// comando e outro, e desfazer a transação desfaria o comando também.

/** Roda as operações uma de cada vez, na ordem em que foram pedidas. */
export type Exclusivo = <T>(operacao: () => Promise<T>) => Promise<T>;

export function criarExclusivo(): Exclusivo {
  let fila: Promise<unknown> = Promise.resolve();
  return <T>(operacao: () => Promise<T>): Promise<T> => {
    const resultado = fila.then(operacao);
    // A falha de uma operação é de quem pediu; as seguintes rodam do mesmo jeito.
    fila = resultado.catch(() => undefined);
    return resultado;
  };
}
