// O que os balões dos anexos mostram, sem React: o tamanho ("1,8 MB"), a duração do vídeo ("0:42"),
// o SHA-256 curto que as duas pessoas comparam ("3f9a…c21e"), a extensão do documento e o tipo de
// anexo de um arquivo escolhido. O documento chega sem o nome original: só "documento.<ext>", com
// a extensão tirada do tipo dele.
import { formatoValido, paraHex, type TipoDeArquivo } from '@cifra/protocol';

const KB = 1024;
const MB = 1024 * KB;

/**
 * O tamanho em B, KB ou MB (de 1024), com a vírgula ou o ponto do idioma: "1,8 MB", "380 KB". O
 * limite dos anexos, 25 MB, aparece como 25 MB.
 */
export function tamanhoLegivel(bytes: number, separador: string): string {
  if (bytes < KB) return `${String(bytes)} B`;
  if (bytes < MB) return `${String(Math.max(1, Math.round(bytes / KB)))} KB`;
  const mb = Math.round((bytes / MB) * 10) / 10;
  const inteiro = mb >= 100 || Number.isInteger(mb);
  const texto = inteiro ? String(Math.round(mb)) : mb.toFixed(1).replace('.', separador);
  return `${texto} MB`;
}

/** O separador decimal do idioma da interface. */
export function separadorDecimal(idioma: string): string {
  return idioma.startsWith('pt') ? ',' : '.';
}

/** A duração do vídeo: "0:42", "12:30", "1:02:03". */
export function duracaoLegivel(milissegundos: number): string {
  const total = Math.max(0, Math.round(milissegundos / 1000));
  const horas = Math.floor(total / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  const segundos = String(total % 60).padStart(2, '0');
  if (horas === 0) return `${String(minutos)}:${segundos}`;
  return `${String(horas)}:${String(minutos).padStart(2, '0')}:${segundos}`;
}

/** O começo e o fim do SHA-256, em hexadecimal: "3f9a…c21e". */
export function sha256Curto(sha256: Uint8Array): string {
  const hex = paraHex(sha256);
  return `${hex.slice(0, 4)}…${hex.slice(-4)}`;
}

/** As extensões dos tipos de documento mais comuns. O que não está aqui fica sem extensão. */
const EXTENSOES: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/json': 'json',
  'application/rtf': 'rtf',
  'application/epub+zip': 'epub',
  'application/msword': 'doc',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/x-7z-compressed': '7z',
  'application/x-tar': 'tar',
  'application/gzip': 'gz',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'text/markdown': 'md',
  'text/html': 'html',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/webm': 'webm',
};

/** A extensão do documento pelo tipo, ou `null` se ele não é um dos conhecidos. */
export function extensaoDoFormato(formato: string): string | null {
  return EXTENSOES[formato.toLowerCase()] ?? null;
}

/**
 * O tipo de anexo de um arquivo escolhido: foto e vídeo passam pela limpeza da foto e do vídeo,
 * mesmo escolhidos como arquivo; o resto vai como documento.
 */
export function tipoDoArquivoEscolhido(formato: string): TipoDeArquivo {
  const tipo = formato.toLowerCase();
  if (tipo.startsWith('image/')) return 'imagem';
  if (tipo.startsWith('video/')) return 'video';
  return 'documento';
}

/**
 * O tipo do documento como vai na mensagem: em minúsculas, sem parâmetros ("; charset=…"). O que
 * não segue o formato de tipo vira o genérico.
 */
export function formatoDoDocumento(formato: string): string {
  const limpo = formato.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return formatoValido('documento', limpo) ? limpo : 'application/octet-stream';
}

/** A proporção da área da imagem no balão, entre 3:4 e 16:9, como a foto que vai chegar. */
export function proporcaoDoBalao(largura: number, altura: number): number {
  if (largura < 1 || altura < 1) return 4 / 3;
  return Math.min(16 / 9, Math.max(3 / 4, largura / altura));
}
