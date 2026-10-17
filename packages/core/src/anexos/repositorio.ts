// Os anexos no banco cifrado (migração 6). Cada um pertence a uma mensagem (pelo ID) e guarda o que
// abre o arquivo: token, chave, hash e, quando já está aqui, o blob cifrado como passou pelo relay.
// O blob só sai do banco quando alguém vai mostrar, salvar ou enviar o arquivo.
import type { DadosDoAnexo, TipoDeArquivo } from '@cifra/protocol';
import { baixarSozinho } from '../ajustes/repositorio.ts';
import { bytesDe, numeroDe, textoDe } from '../banco/linhas.ts';
import type { Armazenamento, LinhaSql } from '../portas/armazenamento.ts';

/**
 * - `enviar`: o blob sobe ao relay antes de a mensagem sair; `enviado`: subiu.
 * - `local`: na nota pessoal, não sobe.
 * - `baixar`: chegou a mensagem, falta o blob (de um pedido de conversa, só baixa depois de aceito);
 *   `manual`: só baixa quando a pessoa tocar (cancelou, ou o baixar sozinho está desligado, RF-57).
 * - `apagar-no-relay`: baixou e conferiu; falta pedir ao relay para apagar; `baixado`: pronto.
 * - `indisponivel`: o relay não tem mais o blob; `invalido`: o blob não conferiu.
 */
export type EstadoDoAnexo =
  | 'enviar'
  | 'enviado'
  | 'local'
  | 'baixar'
  | 'manual'
  | 'apagar-no-relay'
  | 'baixado'
  | 'indisponivel'
  | 'invalido';

const ESTADOS: readonly EstadoDoAnexo[] = [
  'enviar',
  'enviado',
  'local',
  'baixar',
  'manual',
  'apagar-no-relay',
  'baixado',
  'indisponivel',
  'invalido',
];

/** Estados em que o blob está neste aparelho. */
export const COM_BLOB: readonly EstadoDoAnexo[] = [
  'enviar',
  'enviado',
  'local',
  'apagar-no-relay',
  'baixado',
];

export interface Anexo extends DadosDoAnexo {
  readonly mensagem: Uint8Array;
  /** SHA-256 do arquivo (sem a capa), para as duas pessoas compararem; nulo até baixar. */
  readonly sha256: Uint8Array | null;
  readonly estado: EstadoDoAnexo;
  readonly tentativas: number;
  readonly proximaTentativa: number;
}

const COLUNAS = `a.mensagem, m.tipo AS arquivo, a.formato, a.tamanho, a.capa, a.largura, a.altura,
  a.duracao, a.token, a.chave, a.hash, a.sha256, a.miniatura, a.estado, a.tentativas,
  a.proxima_tentativa`;

function arquivoDe(texto: string): TipoDeArquivo {
  if (texto === 'imagem' || texto === 'video' || texto === 'documento') return texto;
  throw new Error('anexo de mensagem sem arquivo');
}

function estadoDe(texto: string): EstadoDoAnexo {
  const estado = ESTADOS.find((e) => e === texto);
  if (!estado) throw new Error('estado de anexo ilegível no banco');
  return estado;
}

export function anexoDaLinha(linha: LinhaSql): Anexo {
  return {
    mensagem: bytesDe(linha, 'mensagem'),
    arquivo: arquivoDe(textoDe(linha, 'arquivo')),
    formato: textoDe(linha, 'formato'),
    tamanho: numeroDe(linha, 'tamanho'),
    capa: numeroDe(linha, 'capa'),
    largura: numeroDe(linha, 'largura'),
    altura: numeroDe(linha, 'altura'),
    duracao: numeroDe(linha, 'duracao'),
    token: bytesDe(linha, 'token'),
    chave: bytesDe(linha, 'chave'),
    hash: bytesDe(linha, 'hash'),
    sha256: linha['sha256'] === null ? null : bytesDe(linha, 'sha256'),
    miniatura: bytesDe(linha, 'miniatura'),
    estado: estadoDe(textoDe(linha, 'estado')),
    tentativas: numeroDe(linha, 'tentativas'),
    proximaTentativa: numeroDe(linha, 'proxima_tentativa'),
  };
}

/** Guarda o anexo da mensagem, que precisa existir com o tipo do arquivo. */
export async function guardarAnexo(
  banco: Armazenamento,
  mensagem: Uint8Array,
  dados: DadosDoAnexo,
  estado: EstadoDoAnexo,
  extras: {
    readonly blob?: Uint8Array;
    readonly sha256?: Uint8Array;
    readonly agora?: number;
  } = {},
): Promise<void> {
  await banco.executar(
    `INSERT INTO anexos (mensagem, formato, tamanho, capa, largura, altura, duracao, token, chave,
       hash, sha256, miniatura, estado, proxima_tentativa, blob)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      mensagem,
      dados.formato,
      dados.tamanho,
      dados.capa,
      dados.largura,
      dados.altura,
      dados.duracao,
      dados.token,
      dados.chave,
      dados.hash,
      extras.sha256 ?? null,
      dados.miniatura,
      estado,
      extras.agora ?? 0,
      extras.blob ?? null,
    ],
  );
}

/** O anexo da mensagem, sem o blob. */
export async function anexoDe(banco: Armazenamento, mensagem: Uint8Array): Promise<Anexo | null> {
  const [linha] = await banco.consultar(
    `SELECT ${COLUNAS} FROM anexos a JOIN mensagens m ON m.id = a.mensagem WHERE a.mensagem = ?`,
    [mensagem],
  );
  return linha ? anexoDaLinha(linha) : null;
}

/** Os anexos das mensagens, sem o blob. */
export async function anexosDe(
  banco: Armazenamento,
  mensagens: readonly Uint8Array[],
): Promise<Anexo[]> {
  const anexos: Anexo[] = [];
  for (const mensagem of mensagens) {
    const anexo = await anexoDe(banco, mensagem);
    if (anexo) anexos.push(anexo);
  }
  return anexos;
}

/** O blob cifrado da mensagem, se ele está neste aparelho. */
export async function blobDe(
  banco: Armazenamento,
  mensagem: Uint8Array,
): Promise<Uint8Array | null> {
  const [linha] = await banco.consultar(
    'SELECT blob FROM anexos WHERE mensagem = ? AND blob IS NOT NULL',
    [mensagem],
  );
  return linha ? bytesDe(linha, 'blob') : null;
}

/** O blob baixado e conferido entra; o anexo passa a `apagar-no-relay`. */
export async function guardarBaixado(
  banco: Armazenamento,
  mensagem: Uint8Array,
  blob: Uint8Array,
  sha256: Uint8Array,
): Promise<boolean> {
  const { linhasAlteradas } = await banco.executar(
    `UPDATE anexos SET blob = ?, sha256 = ?, estado = 'apagar-no-relay', tentativas = 0,
       proxima_tentativa = 0
     WHERE mensagem = ? AND estado = 'baixar'`,
    [blob, sha256, mensagem],
  );
  return linhasAlteradas === 1;
}

/** Muda o estado se ele estiver entre `de`. Devolve `true` se mudou. */
export async function mudarEstadoDoAnexo(
  banco: Armazenamento,
  mensagem: Uint8Array,
  de: readonly EstadoDoAnexo[],
  para: EstadoDoAnexo,
  proximaTentativa = 0,
): Promise<boolean> {
  const { linhasAlteradas } = await banco.executar(
    `UPDATE anexos SET estado = ?, tentativas = 0, proxima_tentativa = ?
      WHERE mensagem = ? AND estado IN (${de.map(() => '?').join(', ')})`,
    [para, proximaTentativa, mensagem, ...de],
  );
  return linhasAlteradas === 1;
}

/** Mais uma tentativa que falhou: a próxima fica para `quando`. */
export async function adiarAnexo(
  banco: Armazenamento,
  mensagem: Uint8Array,
  tentativas: number,
  quando: number,
): Promise<void> {
  await banco.executar(
    'UPDATE anexos SET tentativas = ?, proxima_tentativa = ? WHERE mensagem = ?',
    [tentativas, quando, mensagem],
  );
}

export interface AnexoNaConversa {
  readonly anexo: Anexo;
  readonly conversa: Uint8Array;
}

/**
 * Os anexos que esperam rede: baixar e pedir ao relay para apagar. Só de contatos aceitos e não
 * bloqueados: o anexo de um pedido de conversa não baixa sozinho (RF-07).
 */
export async function anexosPendentes(banco: Armazenamento): Promise<AnexoNaConversa[]> {
  const linhas = await banco.consultar(
    `SELECT ${COLUNAS}, m.conversa FROM anexos a
       JOIN mensagens m ON m.id = a.mensagem
       JOIN contatos c ON c.contato = m.conversa
      WHERE a.estado IN ('baixar', 'apagar-no-relay') AND c.aceito = 1 AND c.bloqueado = 0
      ORDER BY m.ordem`,
  );
  return linhas.map((linha) => ({
    anexo: anexoDaLinha(linha),
    conversa: bytesDe(linha, 'conversa'),
  }));
}

/** Como entra o anexo que chega: baixa sozinho, ou espera a pessoa tocar (RF-57). */
export async function estadoDoQueChega(banco: Armazenamento): Promise<'baixar' | 'manual'> {
  return (await baixarSozinho(banco)) ? 'baixar' : 'manual';
}

/**
 * O pedido de conversa foi aceito: os anexos dele, que esperavam sem baixar (RF-07), passam a
 * baixar sozinhos ou a esperar a pessoa tocar, pelo ajuste de agora (RF-57).
 */
export async function anexosDoPedidoAceito(
  banco: Armazenamento,
  conversa: Uint8Array,
): Promise<void> {
  await banco.executar(
    `UPDATE anexos SET estado = ?, tentativas = 0, proxima_tentativa = 0
      WHERE estado IN ('baixar', 'manual')
        AND mensagem IN (SELECT id FROM mensagens WHERE conversa = ?)`,
    [await estadoDoQueChega(banco), conversa],
  );
}

/** O relay voltou: o que esperava rede tenta agora. */
export async function anexosTentamAgora(banco: Armazenamento): Promise<void> {
  await banco.executar(
    `UPDATE anexos SET tentativas = 0, proxima_tentativa = 0
      WHERE estado IN ('baixar', 'apagar-no-relay')`,
  );
}
