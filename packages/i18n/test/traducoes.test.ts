import { describe, expect, it } from 'vitest';
import { IDIOMAS, TRADUCOES } from '../src/index.ts';
import {
  chavesFaltando,
  folhas,
  problemasDeVoz,
  variaveis,
  voltaTextoCorrigido,
} from './verificacao.ts';

const ptBR = TRADUCOES['pt-BR'];
const { en } = TRADUCOES;

describe('traduções em pt-BR e en (RNF-22)', () => {
  it('en tem todas as chaves do pt-BR', () => {
    expect(chavesFaltando(ptBR, en)).toEqual([]);
  });

  it('pt-BR tem todas as chaves do en', () => {
    expect(chavesFaltando(en, ptBR)).toEqual([]);
  });

  it('a verificação acusa a chave que falta num dos idiomas', () => {
    expect(chavesFaltando({ a: { b: 'x', c: 'y' } }, { a: { b: 'x' } })).toEqual(['a.c']);
    expect(chavesFaltando({ a: 'x' }, { a: { b: 'x' } })).toEqual(['a']);
  });

  it('nenhum texto está vazio', () => {
    const vazios = IDIOMAS.flatMap((idioma) =>
      [...folhas(TRADUCOES[idioma])]
        .filter(([, texto]) => texto.trim() === '')
        .map(([chave]) => `${idioma}: ${chave}`),
    );
    expect(vazios).toEqual([]);
  });

  it('cada chave usa as mesmas variáveis {{...}} nos dois idiomas', () => {
    const textosEmIngles = folhas(en);
    const diferentes = [...folhas(ptBR)]
      .filter(([chave, texto]) => {
        const emIngles = textosEmIngles.get(chave) ?? '';
        return variaveis(texto).join() !== variaveis(emIngles).join();
      })
      .map(([chave]) => chave);
    expect(diferentes).toEqual([]);
  });

  it('a verificação enxerga as variáveis, com ou sem espaço e formatação', () => {
    expect(variaveis('{{ nome }} tem {{count}} mensagens de {{nome}}')).toEqual(['count', 'nome']);
    expect(variaveis('expira em {{data, datetime}}')).toEqual(['data']);
    expect(variaveis('sem variáveis')).toEqual([]);
  });
});

describe('aviso de pular as palavras (RF-02)', () => {
  it('diz, nos dois idiomas, que perder o celular é perder a identidade', () => {
    expect(ptBR.palavras.aviso.descricao).toContain('perder o celular é perder a identidade');
    expect(en.palavras.aviso.descricao).toContain('losing your phone means losing your identity');
  });
});

describe('textos das mensagens temporárias (RF-28, RF-29)', () => {
  it('o seletor avisa, nos dois idiomas, que o timer curto só chega com a conversa aberta', () => {
    expect(ptBR.timer.soAberta).toBe('Só chega se a outra pessoa estiver com a conversa aberta.');
    expect(en.timer.soAberta).toBe('Only arrives if the other person has the chat open.');
  });

  it('a mensagem que chega vencida deixa "uma mensagem expirou antes de você abrir"', () => {
    expect(ptBR.notas.expirou).toBe('uma mensagem expirou antes de você abrir');
    expect(en.notas.expirou).toBe('a message expired before you opened it');
  });
});

describe('voz dos textos (RNF-17)', () => {
  it('nenhum texto tem exclamação nem emoji', () => {
    const problemas = IDIOMAS.flatMap((idioma) =>
      [...folhas(TRADUCOES[idioma])].flatMap(([chave, texto]) =>
        problemasDeVoz(texto).map((problema) => `${idioma}: ${chave} (${problema})`),
      ),
    );
    expect(problemas).toEqual([]);
  });

  it('a verificação de voz acusa exclamação e emoji', () => {
    expect(problemasDeVoz('Pronto!')).toEqual(['exclamação']);
    expect(problemasDeVoz('Pronto \u{1F512}')).toEqual(['emoji']);
    expect(problemasDeVoz('tor · conectado')).toEqual([]);
  });

  it('nenhum texto corrigido pelo SPEC volta', () => {
    const corrigidos = IDIOMAS.flatMap((idioma) =>
      [...folhas(TRADUCOES[idioma])]
        .filter(([, texto]) => voltaTextoCorrigido(texto))
        .map(([chave]) => `${idioma}: ${chave}`),
    );
    expect(corrigidos).toEqual([]);
  });

  it('a verificação reconhece os textos da tabela "Textos a evitar"', () => {
    expect(voltaTextoCorrigido('Sem número. Sem e-mail. Sem metadados.')).toBe(true);
    expect(voltaTextoCorrigido('Irreversível — não há backup em lugar nenhum.')).toBe(true);
    expect(voltaTextoCorrigido('cifra 0.1.0 · GPLv3 · build reproduzível')).toBe(true);
    expect(voltaTextoCorrigido('Também oculta o app no multitarefa')).toBe(true);
    expect(voltaTextoCorrigido('O Cifra é feito sem anúncio e sem coleta de dados.')).toBe(true);
    expect(voltaTextoCorrigido('Cifra is made with no ads and no data collection.')).toBe(true);

    expect(voltaTextoCorrigido('Sem número. Sem e-mail.')).toBe(false);
    expect(voltaTextoCorrigido('O Cifra é feito sem anúncio e sem rastreamento.')).toBe(false);
    expect(voltaTextoCorrigido('cifra 0.1.0 · GPLv3')).toBe(false);
    expect(
      voltaTextoCorrigido('Prints e gravações saem em branco. Também oculta o app no multitarefa.'),
    ).toBe(false);
  });
});
