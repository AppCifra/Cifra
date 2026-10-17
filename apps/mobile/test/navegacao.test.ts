import { criarI18n } from '@cifra/i18n';
import type { Mensagem, ResumoDaConversa } from '@cifra/core';
import { describe, expect, it } from 'vitest';
import {
  hora,
  horarioDaLista,
  instanteDaMensagem,
  nomeDaConversa,
  previaDaConversa,
  textoDaPrevia,
} from '../src/formato-da-conversa.ts';
import { empilhar, PILHA_INICIAL, semAConversa, voltar } from '../src/navegacao.ts';

// A pilha de telas e o que a lista mostra de cada conversa (RF-11): nome, prévia e horário.

const ID = 'K4RO-7Q2M-ZX9P-D3TA';

describe('pilha de telas', () => {
  it('abre por cima, não repete a tela do topo e o voltar para na lista', () => {
    const conversa = empilhar(PILHA_INICIAL, { tipo: 'conversa', id: ID });
    expect(empilhar(conversa, { tipo: 'conversa', id: ID })).toBe(conversa);
    const seguranca = empilhar(conversa, { tipo: 'seguranca', id: ID });
    expect(seguranca.map((tela) => tela.tipo)).toEqual(['conversas', 'conversa', 'seguranca']);
    expect(voltar(voltar(voltar(seguranca)))).toEqual(PILHA_INICIAL);
  });

  it('um pedido recusado sai da pilha com a segurança dele', () => {
    const pilha = empilhar(
      empilhar(empilhar(PILHA_INICIAL, { tipo: 'pedidos' }), { tipo: 'conversa', id: ID }),
      { tipo: 'seguranca', id: ID },
    );
    expect(semAConversa(pilha, ID)).toEqual([{ tipo: 'conversas' }, { tipo: 'pedidos' }]);
  });
});

function mensagem(campos: Partial<Mensagem>): Mensagem {
  return {
    id: new Uint8Array(16),
    conversa: new Uint8Array(10),
    deMim: false,
    tipo: 'texto',
    texto: 'oi',
    resposta: null,
    enviadaEm: 0,
    recebidaEm: 0,
    ttl: 0,
    expiraEm: null,
    status: 'recebida',
    ...campos,
  };
}

function resumo(campos: Partial<ResumoDaConversa>): ResumoDaConversa {
  return {
    id: ID,
    tipo: 'contato',
    apelido: null,
    verificado: false,
    bloqueado: false,
    printsBloqueados: false,
    timer: 0,
    ultima: null,
    naoLidas: 0,
    atividade: 0,
    ...campos,
  };
}

describe('linha da lista de conversas (RF-11)', () => {
  const pt = criarI18n('pt-BR').t;
  const en = criarI18n('en').t;

  it('nome: o apelido, ou anon e o começo do ID; a nota pessoal pelo nome dela', () => {
    expect(nomeDaConversa(pt, resumo({}))).toBe('anon·K4RO');
    expect(nomeDaConversa(pt, resumo({ apelido: 'k4ro' }))).toBe('k4ro');
    expect(nomeDaConversa(pt, resumo({ tipo: 'nota' }))).toBe('nota pessoal');
    expect(nomeDaConversa(en, resumo({ tipo: 'nota' }))).toBe('note to self');
  });

  it('prévia numa linha, com "você:" nas suas, menos na nota pessoal', () => {
    expect(previaDaConversa(pt, resumo({}))).toBe('sem mensagens');
    const minha = mensagem({ deMim: true, texto: 'chegou.\nhash confere.' });
    expect(previaDaConversa(pt, resumo({ ultima: minha }))).toBe('você: chegou. hash confere.');
    expect(previaDaConversa(en, resumo({ ultima: minha }))).toBe('you: chegou. hash confere.');
    expect(previaDaConversa(pt, resumo({ tipo: 'nota', ultima: minha }))).toBe(
      'chegou. hash confere.',
    );
  });

  it('prévia de anexo: foto, vídeo ou documento, com a legenda depois, se houver', () => {
    const foto = mensagem({ tipo: 'imagem', texto: '' });
    expect(previaDaConversa(pt, resumo({ ultima: foto }))).toBe('foto');
    expect(previaDaConversa(en, resumo({ ultima: foto }))).toBe('photo');
    const video = mensagem({ tipo: 'video', texto: 'o portão\ndos fundos', deMim: true });
    expect(previaDaConversa(pt, resumo({ ultima: video }))).toBe(
      'você: vídeo · o portão dos fundos',
    );
    expect(textoDaPrevia(pt, mensagem({ tipo: 'documento', texto: '' }))).toBe('documento');
  });

  it('horário: hoje, ontem, dia da semana e data, no relógio deste aparelho', () => {
    const agora = new Date(2026, 9, 2, 18, 30).getTime();
    expect(horarioDaLista(pt, new Date(2026, 9, 2, 14, 2).getTime(), agora)).toBe('14:02');
    expect(horarioDaLista(pt, new Date(2026, 9, 1, 23, 59).getTime(), agora)).toBe('ontem');
    expect(horarioDaLista(pt, new Date(2026, 8, 28, 9, 0).getTime(), agora)).toBe('seg');
    expect(horarioDaLista(en, new Date(2026, 8, 28, 9, 0).getTime(), agora)).toBe('mon');
    expect(horarioDaLista(pt, new Date(2026, 8, 12, 9, 0).getTime(), agora)).toBe('12/09');
    expect(horarioDaLista(en, new Date(2026, 8, 12, 9, 0).getTime(), agora)).toBe('09/12');
    expect(horarioDaLista(pt, new Date(2025, 11, 31, 9, 0).getTime(), agora)).toBe('31/12/25');
    expect(hora(new Date(2026, 9, 2, 7, 5).getTime())).toBe('07:05');
  });

  it('a hora da mensagem: a de saída nas suas, a de chegada nas recebidas', () => {
    expect(instanteDaMensagem(mensagem({ deMim: true, enviadaEm: 5, recebidaEm: null }))).toBe(5);
    expect(instanteDaMensagem(mensagem({ enviadaEm: 5, recebidaEm: 9 }))).toBe(9);
  });
});
