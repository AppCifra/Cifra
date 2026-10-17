// Leitura dos arquivos do próprio relay, para os testes de política.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ_DO_RELAY = fileURLToPath(new URL('..', import.meta.url));

/** Conteúdo de um arquivo, com o caminho relativo à pasta do relay. */
export function lerTexto(caminho: string): string {
  return readFileSync(join(RAIZ_DO_RELAY, caminho), 'utf8');
}

/** Arquivos de uma pasta do relay e das subpastas, com caminho relativo e `/`. */
export function listarArquivos(pasta: string, extensao: string): string[] {
  return readdirSync(join(RAIZ_DO_RELAY, pasta), { withFileTypes: true }).flatMap((item) => {
    const caminho = `${pasta}/${item.name}`;
    if (item.isDirectory()) return listarArquivos(caminho, extensao);
    return item.name.endsWith(extensao) ? [caminho] : [];
  });
}
