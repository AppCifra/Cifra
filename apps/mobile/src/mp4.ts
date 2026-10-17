// O que o MediaMuxer do Android escreve sozinho no MP4 novo (RF-33): a versão do Android de quem
// enviou, nos metadados (`meta` e `udta`), e o instante da limpeza, ao segundo, nas datas do filme,
// das trilhas e das mídias (`mvhd`, `tkhd`, `mdhd`). A limpeza é no lugar, sem mudar nenhum
// tamanho: as caixas de metadados viram `free`, que todo leitor pula, e as datas viram zero. Assim
// os deslocamentos das amostras continuam valendo. Sem React Native: os testes rodam no Node.

const CONTEINERES = new Set(['moov', 'trak', 'mdia']);
const METADADOS = new Set(['meta', 'udta']);
const COM_DATAS = new Set(['mvhd', 'tkhd', 'mdhd']);

const tipoEm = (bytes: Uint8Array, i: number) =>
  String.fromCharCode(bytes[i] ?? 0, bytes[i + 1] ?? 0, bytes[i + 2] ?? 0, bytes[i + 3] ?? 0);

function limparCaixas(bytes: Uint8Array, visao: DataView, inicio: number, fim: number): void {
  let i = inicio;
  while (i + 8 <= fim) {
    let tamanho = visao.getUint32(i);
    let cabecalho = 8;
    if (tamanho === 1) {
      if (i + 16 > fim) return;
      tamanho = Number(visao.getBigUint64(i + 8));
      cabecalho = 16;
    } else if (tamanho === 0) {
      tamanho = fim - i;
    }
    if (tamanho < cabecalho || i + tamanho > fim) return;
    const tipo = tipoEm(bytes, i + 4);
    if (METADADOS.has(tipo)) {
      bytes.set([0x66, 0x72, 0x65, 0x65], i + 4); // 'free'
      bytes.fill(0, i + cabecalho, i + tamanho);
    } else if (COM_DATAS.has(tipo)) {
      const versao = bytes[i + cabecalho] ?? 0;
      const datas = i + cabecalho + 4;
      bytes.fill(0, datas, Math.min(i + tamanho, datas + (versao === 1 ? 16 : 8)));
    } else if (CONTEINERES.has(tipo)) {
      limparCaixas(bytes, visao, i + cabecalho, i + tamanho);
    }
    i += tamanho;
  }
}

/** Tira, no lugar, a versão do Android e as datas que o MediaMuxer põe no MP4. */
export function limparMp4(bytes: Uint8Array): Uint8Array {
  limparCaixas(
    bytes,
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    0,
    bytes.length,
  );
  return bytes;
}
