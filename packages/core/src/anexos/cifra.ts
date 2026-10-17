// A cifra do anexo (RF-35): cada arquivo tem uma chave aleatória própria e é cifrado em fluxo
// (crypto_secretstream_xchacha20poly1305, em pedaços de 64 KiB) antes de subir. O blob é completado
// com bytes aleatórios até a faixa de tamanho, e o BLAKE2b dele inteiro vai na mensagem: quem
// recebe confere tamanho e hash antes de decifrar. O formato do blob está em
// packages/protocol/src/anexo.ts.
//
// O texto claro é a capa (só no vídeo) seguida do arquivo. A capa cabe no primeiro pedaço: para
// mostrá-la, basta decifrar ele.
import {
  anexoValido,
  BYTES_DA_CHAVE_DO_ANEXO,
  BYTES_DO_TOKEN,
  BYTES_DO_CABECALHO_DO_FLUXO,
  BYTES_DO_HASH_DO_ANEXO,
  BYTES_DO_PEDACO,
  BYTES_A_MAIS_POR_PEDACO,
  iguais,
  pedacosDoClaro,
  tamanhoDoAnexo,
  type DadosDoAnexo,
  type TipoDeArquivo,
} from '@cifra/protocol';
import type { Cripto } from '../portas/cripto.ts';

export interface AnexoCifrado {
  /** O que sobe ao relay: fluxo cifrado e preenchimento aleatório. */
  readonly blob: Uint8Array;
  readonly chave: Uint8Array;
  readonly hash: Uint8Array;
}

/** Cifra o texto claro (capa e arquivo) com uma chave nova. */
export function cifrarAnexo(cripto: Cripto, claro: Uint8Array): AnexoCifrado {
  const chave = cripto.randombytes_buf(cripto.crypto_secretstream_xchacha20poly1305_KEYBYTES);
  const blob = new Uint8Array(tamanhoDoAnexo(claro.length));
  const { state, header } = cripto.crypto_secretstream_xchacha20poly1305_init_push(chave);
  blob.set(header, 0);
  let posicao = header.length;
  const pedacos = pedacosDoClaro(claro.length);
  for (let i = 0; i < pedacos; i++) {
    const pedaco = claro.slice(i * BYTES_DO_PEDACO, (i + 1) * BYTES_DO_PEDACO);
    const ultimo = i === pedacos - 1;
    const cifrado = cripto.crypto_secretstream_xchacha20poly1305_push(
      state,
      pedaco,
      null,
      ultimo
        ? cripto.crypto_secretstream_xchacha20poly1305_TAG_FINAL
        : cripto.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE,
    );
    blob.set(cifrado, posicao);
    posicao += cifrado.length;
  }
  // O preenchimento é aleatório: zeros mostrariam ao relay onde o fluxo acaba.
  if (posicao < blob.length) blob.set(cripto.randombytes_buf(blob.length - posicao), posicao);
  return { blob, chave, hash: cripto.crypto_generichash(BYTES_DO_HASH_DO_ANEXO, blob, null) };
}

/** O blob tem o tamanho da faixa do texto claro e o hash que a mensagem diz. */
export function anexoConfere(
  cripto: Cripto,
  blob: Uint8Array,
  hash: Uint8Array,
  claro: number,
): boolean {
  return (
    blob.length === tamanhoDoAnexo(claro) &&
    iguais(cripto.crypto_generichash(BYTES_DO_HASH_DO_ANEXO, blob, null), hash)
  );
}

/**
 * Decifra os primeiros `ate` bytes do texto claro, que tem `claro` bytes no total. Sem `ate`, tudo,
 * e aí o fluxo precisa terminar na etiqueta final, no ponto certo. Devolve `null` se o blob não
 * confere ou foi adulterado.
 */
export function decifrarAnexo(
  cripto: Cripto,
  blob: Uint8Array,
  chave: Uint8Array,
  claro: number,
  ate: number = claro,
): Uint8Array | null {
  if (blob.length !== tamanhoDoAnexo(claro) || ate < 0 || ate > claro) return null;
  let estado;
  try {
    estado = cripto.crypto_secretstream_xchacha20poly1305_init_pull(
      blob.slice(0, BYTES_DO_CABECALHO_DO_FLUXO),
      chave,
    );
  } catch {
    return null;
  }
  const saida = new Uint8Array(ate);
  const pedacos = pedacosDoClaro(claro);
  const parcial = ate < claro;
  let posicao = BYTES_DO_CABECALHO_DO_FLUXO;
  let feitos = 0;
  for (let i = 0; i < pedacos; i++) {
    if (parcial && feitos >= ate) break;
    const tamanho = Math.min(BYTES_DO_PEDACO, claro - i * BYTES_DO_PEDACO);
    const cifrado = blob.slice(posicao, posicao + tamanho + BYTES_A_MAIS_POR_PEDACO);
    posicao += cifrado.length;
    const aberto = cripto.crypto_secretstream_xchacha20poly1305_pull(estado, cifrado, null);
    if (aberto === false || aberto.message.length !== tamanho) return null;
    const final = aberto.tag === cripto.crypto_secretstream_xchacha20poly1305_TAG_FINAL;
    // A etiqueta final vem no último pedaço, e só nele: nem fluxo cortado, nem fluxo emendado.
    if (final !== (i === pedacos - 1)) return null;
    const parte = aberto.message.subarray(0, Math.min(tamanho, ate - feitos));
    saida.set(parte, feitos);
    feitos += parte.length;
  }
  return saida;
}

/** O arquivo que a pessoa escolheu, já limpo pela plataforma (RF-32 a RF-34). */
export interface ArquivoParaEnviar {
  readonly arquivo: TipoDeArquivo;
  /** O tipo MIME: image/jpeg ou image/png, video/mp4, ou o do documento. */
  readonly formato: string;
  readonly bytes: Uint8Array;
  /** Só no vídeo: um quadro, em JPEG, que vai no começo do texto claro. */
  readonly capa?: Uint8Array;
  /** JPEG pequeno, que vai dentro da mensagem; nada no documento. */
  readonly miniatura?: Uint8Array;
  readonly largura?: number;
  readonly altura?: number;
  /** Milissegundos, no vídeo. */
  readonly duracao?: number;
}

export interface AnexoPreparado {
  readonly anexo: DadosDoAnexo;
  readonly blob: Uint8Array;
  /** SHA-256 do arquivo: o que as duas pessoas comparam. */
  readonly sha256: Uint8Array;
}

/**
 * Cifra o arquivo com chave nova e sorteia o token. Devolve `null` se o arquivo não segue o formato:
 * tamanho, tipo MIME, capa, miniatura ou medidas.
 */
export function prepararAnexo(cripto: Cripto, arquivo: ArquivoParaEnviar): AnexoPreparado | null {
  const capa = arquivo.capa ?? new Uint8Array(0);
  const parcial: DadosDoAnexo = {
    arquivo: arquivo.arquivo,
    formato: arquivo.formato,
    tamanho: arquivo.bytes.length,
    capa: capa.length,
    largura: arquivo.largura ?? 0,
    altura: arquivo.altura ?? 0,
    duracao: arquivo.duracao ?? 0,
    token: new Uint8Array(BYTES_DO_TOKEN),
    chave: new Uint8Array(BYTES_DA_CHAVE_DO_ANEXO),
    hash: new Uint8Array(BYTES_DO_HASH_DO_ANEXO),
    miniatura: arquivo.miniatura ?? new Uint8Array(0),
  };
  if (!anexoValido(parcial)) return null;
  const claro = new Uint8Array(capa.length + arquivo.bytes.length);
  claro.set(capa, 0);
  claro.set(arquivo.bytes, capa.length);
  const { blob, chave, hash } = cifrarAnexo(cripto, claro);
  cripto.memzero(claro);
  return {
    anexo: { ...parcial, token: cripto.randombytes_buf(BYTES_DO_TOKEN), chave, hash },
    blob,
    sha256: cripto.crypto_hash_sha256(arquivo.bytes),
  };
}
