import { describe, expect, it } from 'vitest';
import {
  duracaoLegivel,
  extensaoDoFormato,
  formatoDoDocumento,
  proporcaoDoBalao,
  separadorDecimal,
  sha256Curto,
  tamanhoLegivel,
  tipoDoArquivoEscolhido,
} from '../src/formato-do-anexo.ts';

describe('o que o balão do anexo mostra', () => {
  it('tamanho com a vírgula do português e o ponto do inglês; 25 MB aparece como 25 MB', () => {
    expect(tamanhoLegivel(512, ',')).toBe('512 B');
    expect(tamanhoLegivel(1024, ',')).toBe('1 KB');
    expect(tamanhoLegivel(380 * 1024, ',')).toBe('380 KB');
    expect(tamanhoLegivel(1.8 * 1024 * 1024, ',')).toBe('1,8 MB');
    expect(tamanhoLegivel(1.8 * 1024 * 1024, '.')).toBe('1.8 MB');
    expect(tamanhoLegivel(25 * 1024 * 1024, ',')).toBe('25 MB');
    expect(separadorDecimal('pt-BR')).toBe(',');
    expect(separadorDecimal('en')).toBe('.');
  });

  it('duração do vídeo em minutos e segundos, e horas quando passa de uma', () => {
    expect(duracaoLegivel(0)).toBe('0:00');
    expect(duracaoLegivel(42_000)).toBe('0:42');
    expect(duracaoLegivel(750_400)).toBe('12:30');
    expect(duracaoLegivel(3_723_000)).toBe('1:02:03');
  });

  it('o SHA-256 curto: os quatro primeiros e os quatro últimos dígitos', () => {
    const sha256 = Uint8Array.from({ length: 32 }, (_, i) => (i === 0 ? 0x3f : i === 1 ? 0x9a : i));
    sha256[30] = 0xc2;
    sha256[31] = 0x1e;
    expect(sha256Curto(sha256)).toBe('3f9a…c21e');
  });

  it('a extensão do documento sai do tipo; o tipo desconhecido fica sem extensão', () => {
    expect(extensaoDoFormato('application/pdf')).toBe('pdf');
    expect(
      extensaoDoFormato('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe('docx');
    expect(extensaoDoFormato('APPLICATION/PDF')).toBe('pdf');
    expect(extensaoDoFormato('application/x-desconhecido')).toBeNull();
  });

  it('o tipo do documento vai em minúsculas e sem parâmetros; o que não serve vira o genérico', () => {
    expect(formatoDoDocumento('Text/Plain; charset=UTF-8')).toBe('text/plain');
    expect(formatoDoDocumento('application/pdf')).toBe('application/pdf');
    expect(formatoDoDocumento('')).toBe('application/octet-stream');
    expect(formatoDoDocumento('sem barra')).toBe('application/octet-stream');
  });

  it('foto e vídeo escolhidos como arquivo passam pela limpeza da foto e do vídeo', () => {
    expect(tipoDoArquivoEscolhido('image/heic')).toBe('imagem');
    expect(tipoDoArquivoEscolhido('video/quicktime')).toBe('video');
    expect(tipoDoArquivoEscolhido('application/pdf')).toBe('documento');
  });

  it('a área da foto no balão fica entre 3:4 e 16:9', () => {
    expect(proporcaoDoBalao(1600, 1200)).toBeCloseTo(4 / 3);
    expect(proporcaoDoBalao(1000, 4000)).toBeCloseTo(3 / 4);
    expect(proporcaoDoBalao(4000, 1000)).toBeCloseTo(16 / 9);
    expect(proporcaoDoBalao(0, 0)).toBeCloseTo(4 / 3);
  });
});
