import { describe, expect, it } from 'vitest';
import {
  BYTES_DO_ID_DA_MENSAGEM,
  CABECALHO_DO_CONTEUDO,
  capacidadeDoConteudo,
  codificarConteudo,
  lerConteudo,
  LIMITE_DA_CAPA,
  LIMITE_DA_LEGENDA,
  LIMITE_DA_MINIATURA,
  LIMITE_DO_TEXTO,
  TAMANHO_MAXIMO_DO_CLARO,
  type Conteudo,
  type DadosDoAnexo,
} from '../src/index.ts';

const CAPACIDADE = capacidadeDoConteudo('sessao');
const ENVIADA = Date.UTC(2026, 9, 3, 14, 0, 0, 7);
const bytes = (tamanho: number, valor: number) => new Uint8Array(tamanho).fill(valor);
const id = (valor: number) => bytes(BYTES_DO_ID_DA_MENSAGEM, valor);

const FOTO: DadosDoAnexo = {
  arquivo: 'imagem',
  formato: 'image/jpeg',
  tamanho: 482_113,
  capa: 0,
  largura: 2048,
  altura: 1536,
  duracao: 0,
  token: bytes(32, 1),
  chave: bytes(32, 2),
  hash: bytes(32, 3),
  miniatura: bytes(900, 4),
};

const VIDEO: DadosDoAnexo = {
  ...FOTO,
  arquivo: 'video',
  formato: 'video/mp4',
  tamanho: 12_000_000,
  capa: 30_000,
  largura: 1080,
  altura: 1920,
  duracao: 42_500,
};

const DOCUMENTO: DadosDoAnexo = {
  ...FOTO,
  arquivo: 'documento',
  formato: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  largura: 0,
  altura: 0,
  miniatura: new Uint8Array(0),
};

function anexo(dados: DadosDoAnexo, mudancas: Partial<Extract<Conteudo, { tipo: 'anexo' }>> = {}) {
  return {
    tipo: 'anexo',
    id: id(1),
    enviadaEm: ENVIADA,
    ttl: 3600,
    anexo: dados,
    legenda: '',
    ...mudancas,
  } as Conteudo;
}

describe('mensagem de anexo (RF-32 a RF-35)', () => {
  it('foto, vídeo e documento: ida e volta com o que abre o arquivo no relay', () => {
    for (const conteudo of [
      anexo(FOTO, { legenda: 'o portão dos fundos' }),
      anexo(VIDEO),
      anexo(DOCUMENTO, { resposta: id(9) }),
    ]) {
      const codificado = codificarConteudo(conteudo, CAPACIDADE);
      expect(codificado).toHaveLength(CAPACIDADE);
      expect(lerConteudo(codificado)).toEqual(conteudo);
    }
  });

  it('a mensagem não leva o nome do arquivo: só tipo, formato, tamanho e o que abre (RF-34)', () => {
    const codificado = codificarConteudo(anexo(DOCUMENTO), CAPACIDADE);
    const corpo = codificado.subarray(CABECALHO_DO_CONTEUDO);
    const texto = Buffer.from(corpo).toString('latin1');
    expect(texto).toContain(DOCUMENTO.formato);
    // Depois do formato e da miniatura vazia, só zeros: nada de nome nem de data.
    const fim = texto.indexOf(DOCUMENTO.formato) + DOCUMENTO.formato.length + 2;
    expect(corpo.subarray(fim).every((b) => b === 0)).toBe(true);
  });

  it('o maior anexo, com a maior legenda e a maior miniatura, cabe nos dois envelopes', () => {
    const maior = anexo(
      { ...VIDEO, formato: `video/mp4`, miniatura: bytes(LIMITE_DA_MINIATURA, 5) },
      { legenda: 'é'.repeat(LIMITE_DA_LEGENDA / 2), resposta: id(3) },
    );
    for (const tipo of ['inicial', 'sessao'] as const) {
      expect(lerConteudo(codificarConteudo(maior, capacidadeDoConteudo(tipo)))).toEqual(maior);
    }
  });

  it('campo fora do formato é erro de quem chama', () => {
    const invalidos: DadosDoAnexo[] = [
      { ...FOTO, formato: 'image/gif' },
      { ...FOTO, formato: 'IMAGE/JPEG' },
      { ...VIDEO, formato: 'video/quicktime' },
      { ...DOCUMENTO, formato: 'sem-barra' },
      { ...DOCUMENTO, miniatura: bytes(10, 1) },
      { ...DOCUMENTO, largura: 10, altura: 10 },
      { ...FOTO, capa: 10 },
      { ...FOTO, duracao: 1000 },
      { ...FOTO, largura: 0 },
      { ...VIDEO, capa: LIMITE_DA_CAPA + 1 },
      { ...FOTO, tamanho: 0 },
      { ...FOTO, tamanho: TAMANHO_MAXIMO_DO_CLARO + 1 },
      { ...FOTO, miniatura: bytes(LIMITE_DA_MINIATURA + 1, 1) },
      { ...FOTO, token: bytes(31, 1) },
    ];
    for (const dados of invalidos) {
      expect(() => codificarConteudo(anexo(dados), CAPACIDADE)).toThrow(RangeError);
    }
    expect(() =>
      codificarConteudo(anexo(FOTO, { legenda: 'x'.repeat(LIMITE_DA_LEGENDA + 1) }), CAPACIDADE),
    ).toThrow(RangeError);
  });

  it('quem lê recusa anexo adulterado: tipo de arquivo desconhecido, legenda que não é UTF-8', () => {
    const codificado = codificarConteudo(anexo(FOTO, { legenda: 'oi' }), CAPACIDADE);
    const tipoErrado = codificado.slice();
    tipoErrado[CABECALHO_DO_CONTEUDO] = 4;
    expect(lerConteudo(tipoErrado)).toBeNull();
    const legendaErrada = codificado.slice();
    const tamanhoDoCorpo =
      (codificado[CABECALHO_DO_CONTEUDO - 2] ?? 0) * 256 +
      (codificado[CABECALHO_DO_CONTEUDO - 1] ?? 0);
    legendaErrada[CABECALHO_DO_CONTEUDO + tamanhoDoCorpo - 1] = 0xff;
    expect(lerConteudo(legendaErrada)).toBeNull();
  });
});

describe('texto em resposta (RF-55)', () => {
  const resposta: Conteudo = {
    tipo: 'texto',
    id: id(2),
    enviadaEm: ENVIADA,
    ttl: 0,
    texto: 'chegou.',
    resposta: id(7),
  };

  it('ida e volta; vai como o tipo 6, com o ID da original e mais nada dela', () => {
    const codificado = codificarConteudo(resposta, CAPACIDADE);
    expect(codificado[BYTES_DO_ID_DA_MENSAGEM]).toBe(6);
    expect(lerConteudo(codificado)).toEqual(resposta);
    const corpo = codificado.subarray(CABECALHO_DO_CONTEUDO, CABECALHO_DO_CONTEUDO + 16 + 7);
    expect(corpo.subarray(0, 16)).toEqual(id(7));
  });

  it('o texto da resposta vai de 1 a 3500 bytes', () => {
    expect(() => codificarConteudo({ ...resposta, texto: '' }, CAPACIDADE)).toThrow(RangeError);
    const longo = { ...resposta, texto: 'x'.repeat(LIMITE_DO_TEXTO) };
    expect(lerConteudo(codificarConteudo(longo, capacidadeDoConteudo('inicial')))).toEqual(longo);
  });
});
