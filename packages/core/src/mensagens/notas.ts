// Notas de sistema da conversa: a mudança do timer (RF-25), a mensagem recebida que expirou antes
// de a pessoa abrir (RF-28) e os prints bloqueados ou liberados (RF-58). Ficam numa tabela própria,
// fora do índice de busca, e só guardam o tipo e os números: o texto é montado na hora, no idioma
// da tela. Saem com a conversa, pela exclusão real.
//
// Cada nota guarda o instante e a última mensagem da conversa quando entrou (`depois_de`): ela
// aparece antes das mensagens que entraram depois dela. No mesmo milissegundo, a última mensagem
// desempata.
import { anexoDe, type Anexo } from '../anexos/repositorio.ts';
import { numeroDe, textoDe } from '../banco/linhas.ts';
import type { Armazenamento, LinhaSql } from '../portas/armazenamento.ts';
import {
  COLUNAS_DA_MENSAGEM,
  mensagemDaLinha,
  visivel,
  tipoDe,
  type Mensagem,
  type TipoDaMensagem,
} from './repositorio.ts';

export type NotaDeSistema =
  /** O timer da conversa mudou; 0 desligou. `anteriores`: valeu também para as que já estavam. */
  | {
      readonly tipo: 'timer';
      readonly segundos: number;
      readonly anteriores: boolean;
      readonly instante: number;
    }
  /** Uma mensagem recebida venceu antes de a pessoa abrir. */
  | { readonly tipo: 'expirou'; readonly instante: number }
  /** Os prints da conversa foram bloqueados ou liberados, por qualquer um dos dois (RF-58). */
  | { readonly tipo: 'prints'; readonly bloqueados: boolean; readonly instante: number };

/** O anexo como o balão mostra: sem chave, token nem blob. */
export type ResumoDoAnexo = Pick<
  Anexo,
  | 'arquivo'
  | 'formato'
  | 'tamanho'
  | 'capa'
  | 'largura'
  | 'altura'
  | 'duracao'
  | 'miniatura'
  | 'sha256'
  | 'estado'
>;

/**
 * A mensagem que uma resposta cita, pela cópia deste aparelho (RF-55). Se ela sumiu (timer,
 * apagar pra todos, apagada só aqui), `null` no lugar: nada dela volta pela resposta.
 */
export interface Citacao {
  readonly id: Uint8Array;
  readonly mensagem: {
    readonly deMim: boolean;
    readonly tipo: TipoDaMensagem;
    readonly texto: string;
  } | null;
}

/** Um item da conversa, na ordem em que aparece. */
export type ItemDaConversa =
  | {
      readonly tipo: 'mensagem';
      readonly mensagem: Mensagem;
      readonly anexo: ResumoDoAnexo | null;
      readonly citada: Citacao | null;
    }
  | { readonly tipo: 'nota'; readonly nota: NotaDeSistema };

/**
 * Guarda a nota depois das mensagens que já estão na conversa, ou depois da mensagem `depoisDe`
 * (pela ordem no banco), quando ela vem no lugar de uma mensagem que saiu.
 */
export async function guardarNota(
  banco: Armazenamento,
  conversa: Uint8Array,
  nota: NotaDeSistema,
  depoisDe?: number,
): Promise<void> {
  const timer = nota.tipo === 'timer' ? nota : null;
  await banco.executar(
    `INSERT INTO notas (conversa, tipo, segundos, anteriores, instante, depois_de)
     VALUES (?, ?, ?, ?, ?,
       coalesce(?, (SELECT coalesce(max(ordem), 0) FROM mensagens WHERE conversa = ?)))`,
    [
      conversa,
      nota.tipo === 'prints'
        ? nota.bloqueados
          ? 'prints-bloqueados'
          : 'prints-liberados'
        : nota.tipo,
      timer?.segundos ?? 0,
      timer?.anteriores ? 1 : 0,
      nota.instante,
      depoisDe ?? null,
      conversa,
    ],
  );
}

/** A hora em que a mensagem entrou nesta conversa, neste aparelho. */
export function instanteDe(mensagem: Mensagem): number {
  return mensagem.deMim ? mensagem.enviadaEm : (mensagem.recebidaEm ?? mensagem.enviadaEm);
}

interface NotaNaOrdem {
  readonly nota: NotaDeSistema;
  readonly depoisDe: number;
}

function notaDaLinha(linha: LinhaSql): NotaDeSistema {
  const instante = numeroDe(linha, 'instante');
  const tipo = textoDe(linha, 'tipo');
  if (tipo === 'expirou') return { tipo, instante };
  if (tipo === 'prints-bloqueados') return { tipo: 'prints', bloqueados: true, instante };
  if (tipo === 'prints-liberados') return { tipo: 'prints', bloqueados: false, instante };
  if (tipo !== 'timer') throw new Error('nota ilegível no banco');
  return {
    tipo,
    segundos: numeroDe(linha, 'segundos'),
    anteriores: numeroDe(linha, 'anteriores') === 1,
    instante,
  };
}

function resumoDoAnexo(anexo: Anexo): ResumoDoAnexo {
  const { arquivo, formato, tamanho, capa, largura, altura, duracao, miniatura, sha256, estado } =
    anexo;
  return { arquivo, formato, tamanho, capa, largura, altura, duracao, miniatura, sha256, estado };
}

/** A mensagem citada, pela cópia daqui, se ela é da mesma conversa e ainda aparece. */
async function citacaoDe(
  banco: Armazenamento,
  conversa: Uint8Array,
  id: Uint8Array,
): Promise<Citacao> {
  const [linha] = await banco.consultar(
    `SELECT de_mim, tipo, texto FROM mensagens WHERE id = ? AND conversa = ? AND ${visivel()}`,
    [id, conversa],
  );
  if (!linha) return { id, mensagem: null };
  return {
    id,
    mensagem: {
      deMim: numeroDe(linha, 'de_mim') === 1,
      tipo: tipoDe(textoDe(linha, 'tipo')),
      texto: textoDe(linha, 'texto'),
    },
  };
}

/**
 * A conversa como aparece: as mensagens na ordem em que entraram neste aparelho, e cada nota antes
 * da primeira mensagem que entrou depois dela. As apagadas só neste celular ficam de fora. Cada
 * mensagem vem com o anexo dela (sem a chave nem o blob) e a citação, se responde a outra.
 */
export async function itensDa(
  banco: Armazenamento,
  conversa: Uint8Array,
): Promise<ItemDaConversa[]> {
  const mensagens = (
    await banco.consultar(
      `SELECT ordem, ${COLUNAS_DA_MENSAGEM} FROM mensagens WHERE conversa = ? AND ${visivel()}
        ORDER BY ordem`,
      [conversa],
    )
  ).map((linha) => ({ ordem: numeroDe(linha, 'ordem'), mensagem: mensagemDaLinha(linha) }));
  const extras = new Map<number, { anexo: ResumoDoAnexo | null; citada: Citacao | null }>();
  for (const { ordem, mensagem } of mensagens) {
    const anexo = mensagem.tipo === 'texto' ? null : await anexoDe(banco, mensagem.id);
    const citada = mensagem.resposta ? await citacaoDe(banco, conversa, mensagem.resposta) : null;
    if (anexo || citada) {
      extras.set(ordem, { anexo: anexo ? resumoDoAnexo(anexo) : null, citada });
    }
  }
  const notas: NotaNaOrdem[] = (
    await banco.consultar(
      `SELECT tipo, segundos, anteriores, instante, depois_de FROM notas WHERE conversa = ?
        ORDER BY instante, depois_de, ordem`,
      [conversa],
    )
  ).map((linha) => ({ nota: notaDaLinha(linha), depoisDe: numeroDe(linha, 'depois_de') }));

  const itens: ItemDaConversa[] = [];
  let proxima = 0;
  for (const { ordem, mensagem } of mensagens) {
    const instante = instanteDe(mensagem);
    for (let nota = notas[proxima]; nota; nota = notas[proxima]) {
      const antes =
        nota.nota.instante < instante || (nota.nota.instante === instante && nota.depoisDe < ordem);
      if (!antes) break;
      itens.push({ tipo: 'nota', nota: nota.nota });
      proxima++;
    }
    const extra = extras.get(ordem);
    itens.push({
      tipo: 'mensagem',
      mensagem,
      anexo: extra?.anexo ?? null,
      citada: extra?.citada ?? null,
    });
  }
  for (const { nota } of notas.slice(proxima)) itens.push({ tipo: 'nota', nota });
  return itens;
}
