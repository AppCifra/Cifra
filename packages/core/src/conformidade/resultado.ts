// Resultado de cada verificação de conformidade. As mesmas verificações rodam no Node (testes),
// no Android (tela do spike) e, depois, no iOS e na web: um adaptador só entra se passar em todas.

export interface ResultadoDaVerificacao {
  /** Identificador técnico da verificação, como `ed25519.rfc8032-1`. Não é texto de interface. */
  readonly nome: string;
  readonly ok: boolean;
  /** O que deu errado, sem nenhum dado sensível. Vazio quando `ok`. */
  readonly erro: string;
}

/** Uma verificação: lança erro ou devolve `false` quando o adaptador não cumpre o contrato. */
export type Verificacao = () => boolean | Promise<boolean>;

export async function rodar(
  verificacoes: Readonly<Record<string, Verificacao>>,
): Promise<ResultadoDaVerificacao[]> {
  const resultados: ResultadoDaVerificacao[] = [];
  for (const [nome, verificacao] of Object.entries(verificacoes)) {
    try {
      const ok = await verificacao();
      resultados.push({ nome, ok, erro: ok ? '' : 'resultado diferente do esperado' });
    } catch (erro) {
      resultados.push({ nome, ok: false, erro: erro instanceof Error ? erro.message : 'erro' });
    }
  }
  return resultados;
}

/** Bytes de um texto hexadecimal. Só para os vetores fixos das verificações. */
export function hex(texto: string): Uint8Array {
  if (texto.length % 2 !== 0 || !/^[0-9a-f]*$/.test(texto)) throw new Error('hex inválido');
  const bytes = new Uint8Array(texto.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(texto.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** Bytes de um texto ASCII. Os textos dos vetores são todos ASCII. */
export function ascii(texto: string): Uint8Array {
  if (!/^[ -~]*$/.test(texto)) throw new Error('texto fora do ASCII');
  return Uint8Array.from(texto, (caractere) => caractere.charCodeAt(0));
}

export function iguais(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** Roda `operacao` e diz se ela lançou erro. */
export function lanca(operacao: () => unknown): boolean {
  try {
    operacao();
    return false;
  } catch {
    return true;
  }
}
