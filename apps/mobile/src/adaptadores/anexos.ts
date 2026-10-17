// Fotos, vídeos e arquivos no Android, pelo módulo nativo (RF-32 a RF-36, RF-52, RF-53): os
// seletores do sistema, a limpeza (a foto recodificada, o vídeo num MP4 novo, sem metadados), o
// salvar no celular e a área de transferência. O limite de tamanho vem do protocolo.
import type { ArquivoParaEnviar } from '@cifra/core';
import { TAMANHO_MAXIMO_DO_CLARO } from '@cifra/protocol';
import { anexosNativos, areaDeTransferenciaNativa } from '../../modules/cifra-plataforma/index.ts';
import { ErroDaMidia, type MidiaDoApp } from '../conversas.ts';
import { formatoDoDocumento, tipoDoArquivoEscolhido } from '../formato-do-anexo.ts';
import { limparMp4 } from '../mp4.ts';

/** O texto copiado sai da área de transferência depois deste tempo (RF-52). */
const SEGUNDOS_NA_AREA_DE_TRANSFERENCIA = 60;

function erroDaMidia(erro: unknown): ErroDaMidia {
  const codigo = (erro as { code?: unknown } | null)?.code;
  return new ErroDaMidia(codigo === 'grande' ? 'grande' : 'nao-abre');
}

async function preparar(endereco: string, formato: string): Promise<ArquivoParaEnviar> {
  switch (tipoDoArquivoEscolhido(formato)) {
    case 'imagem': {
      const foto = await anexosNativos.prepararImagem(endereco);
      return {
        arquivo: 'imagem',
        formato: foto.formato,
        bytes: foto.bytes,
        miniatura: foto.miniatura,
        largura: foto.largura,
        altura: foto.altura,
      };
    }
    case 'video': {
      const video = await anexosNativos.prepararVideo(endereco, TAMANHO_MAXIMO_DO_CLARO);
      return {
        arquivo: 'video',
        formato: video.formato,
        bytes: limparMp4(video.bytes),
        capa: video.capa,
        miniatura: video.miniatura,
        largura: video.largura,
        altura: video.altura,
        duracao: Math.round(video.duracao),
      };
    }
    case 'documento': {
      const documento = await anexosNativos.lerDocumento(endereco, TAMANHO_MAXIMO_DO_CLARO);
      return {
        arquivo: 'documento',
        formato: formatoDoDocumento(documento.formato),
        bytes: documento.bytes,
      };
    }
  }
}

export const midiaDoAndroid: MidiaDoApp = {
  escolherMidia: (limite) => anexosNativos.escolher('midia', limite),
  escolherArquivos: (limite) => anexosNativos.escolher('arquivo', limite),
  async preparar({ endereco, formato }) {
    try {
      return await preparar(endereco, formato);
    } catch (erro) {
      throw erroDaMidia(erro);
    }
  },
  salvar: ({ arquivo, formato, bytes }) => anexosNativos.salvarNoCelular(bytes, formato, arquivo),
  copiar: (texto) => areaDeTransferenciaNativa.copiar(texto, SEGUNDOS_NA_AREA_DE_TRANSFERENCIA),
  salvarArquivo: (bytes, nome) => anexosNativos.salvarArquivo(bytes, nome),
  esquecerImagens() {
    anexosNativos.esquecerImagens();
  },
};
