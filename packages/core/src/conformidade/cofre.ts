// Conformidade do cofre das conversas ocultas (RNF-11): o adaptador que abre o segundo banco. A
// chave certa reabre e lê; a errada falha como `banco-ilegivel`, do mesmo jeito que uma chave
// sorteada (é o que a busca faz a cada texto); as pragmas são as do cofre; o arquivo fica num
// múltiplo exato do bloco; e trocar a chave funciona. Roda num arquivo só dela, apagado no fim.
import { completarBloco, tamanhoDoBanco } from '../ocultas/blocos.ts';
import { prepararCofre } from '../banco/preparo.ts';
import type { Armazenamento } from '../portas/armazenamento.ts';
import type { Cripto } from '../portas/cripto.ts';
import { rodar, type ResultadoDaVerificacao } from './resultado.ts';

/** Um cofre aberto pelo adaptador da plataforma. */
export interface CofreAberto {
  readonly banco: Armazenamento;
  /** Troca a chave do arquivo (no SQLCipher, `PRAGMA rekey`). O cofre continua aberto. */
  trocarChave(chave: Uint8Array): Promise<void>;
  fechar(): void | Promise<void>;
}

export interface ArquivoDoCofre {
  /**
   * Abre (ou cria) o arquivo com a chave. Rejeita com `banco-ilegivel` quando o arquivo existe e não
   * abre com ela, sem escrever nada nele.
   */
  abrir(chave: Uint8Array): Promise<CofreAberto>;
  /** Apaga o arquivo, se existir. */
  apagar(): Promise<void>;
}

/** O bloco das verificações: pequeno, para crescer rápido no aparelho. */
const BLOCO_DA_VERIFICACAO = 64 * 1024;

const chave = (byte: number) => new Uint8Array(32).fill(byte);

async function falhaIlegivel(arquivo: ArquivoDoCofre, outra: Uint8Array): Promise<boolean> {
  try {
    const aberto = await arquivo.abrir(outra);
    await aberto.fechar();
    return false;
  } catch (erro) {
    return erro instanceof Error && erro.message === 'banco-ilegivel';
  }
}

async function noBloco(banco: Armazenamento, bloco: number): Promise<boolean> {
  const tamanho = await tamanhoDoBanco(banco);
  return tamanho >= bloco && tamanho % bloco === 0;
}

export async function verificarCofre(
  cripto: Cripto,
  arquivo: ArquivoDoCofre,
  bloco = BLOCO_DA_VERIFICACAO,
): Promise<ResultadoDaVerificacao[]> {
  await arquivo.apagar();
  const primeira = chave(1);
  try {
    return await rodar({
      'cofre.pragmas': async () => {
        const aberto = await arquivo.abrir(primeira);
        try {
          await prepararCofre(aberto.banco);
          return true;
        } finally {
          await aberto.fechar();
        }
      },

      'cofre.bloco-exato': async () => {
        const aberto = await arquivo.abrir(primeira);
        try {
          await completarBloco(aberto.banco, bloco);
          const vazio = await noBloco(aberto.banco, bloco);
          // Mais de um bloco de dados: o arquivo passa para o bloco seguinte, exato.
          await aberto.banco.executar('CREATE TABLE IF NOT EXISTS conformidade_cofre (x BLOB)');
          await aberto.banco.executar('INSERT INTO conformidade_cofre VALUES (randomblob(?))', [
            bloco + bloco / 2,
          ]);
          await completarBloco(aberto.banco, bloco);
          const tamanho = await tamanhoDoBanco(aberto.banco);
          return vazio && (await noBloco(aberto.banco, bloco)) && tamanho >= 2 * bloco;
        } finally {
          await aberto.fechar();
        }
      },

      'cofre.reabre-com-a-chave': async () => {
        const aberto = await arquivo.abrir(primeira);
        try {
          const [linha] = await aberto.banco.consultar(
            'SELECT count(*) AS n FROM conformidade_cofre',
          );
          return linha?.['n'] === 1;
        } finally {
          await aberto.fechar();
        }
      },

      // A chave errada e a sorteada falham do mesmo jeito: a busca não diz se havia cofre.
      'cofre.chave-errada': async () =>
        (await falhaIlegivel(arquivo, chave(2))) &&
        (await falhaIlegivel(arquivo, cripto.randombytes_buf(32))),

      'cofre.troca-a-chave': async () => {
        const nova = chave(3);
        const aberto = await arquivo.abrir(primeira);
        try {
          await aberto.trocarChave(nova);
        } finally {
          await aberto.fechar();
        }
        if (!(await falhaIlegivel(arquivo, primeira))) return false;
        const reaberto = await arquivo.abrir(nova);
        try {
          const [linha] = await reaberto.banco.consultar(
            'SELECT count(*) AS n FROM conformidade_cofre',
          );
          return linha?.['n'] === 1 && (await noBloco(reaberto.banco, bloco));
        } finally {
          await reaberto.fechar();
        }
      },
    });
  } finally {
    await arquivo.apagar();
  }
}
