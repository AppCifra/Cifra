import { afterEach, describe, expect, it, vi } from 'vitest';
import { criarI18n, escolherIdioma, IDIOMA_PADRAO } from '../src/index.ts';

describe('idioma da primeira abertura (RF-49)', () => {
  it('segue o sistema em português, de qualquer região', () => {
    expect(escolherIdioma(['pt-BR'])).toBe('pt-BR');
    expect(escolherIdioma(['pt-PT'])).toBe('pt-BR');
    expect(escolherIdioma(['pt'])).toBe('pt-BR');
    expect(escolherIdioma(['pt_BR'])).toBe('pt-BR');
    expect(escolherIdioma(['PT-br'])).toBe('pt-BR');
  });

  it('segue o sistema em inglês, de qualquer região', () => {
    expect(escolherIdioma(['en-US'])).toBe('en');
    expect(escolherIdioma(['en-GB'])).toBe('en');
    expect(escolherIdioma(['en'])).toBe('en');
  });

  it('usa o primeiro idioma da lista do sistema que o app fala', () => {
    expect(escolherIdioma(['es-ES', 'pt-BR', 'en-US'])).toBe('pt-BR');
    expect(escolherIdioma(['de-DE', 'en-GB', 'pt-BR'])).toBe('en');
  });

  it('abre em inglês quando o sistema não está em português nem em inglês', () => {
    expect(IDIOMA_PADRAO).toBe('en');
    expect(escolherIdioma(['es-ES'])).toBe('en');
    expect(escolherIdioma(['zh-Hans-CN', 'fr-FR'])).toBe('en');
    expect(escolherIdioma([])).toBe('en');
  });
});

describe('troca de idioma (RF-49)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('já nasce pronta, sem esperar carregamento', () => {
    const i18n = criarI18n('en');
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.language).toBe('en');
    expect(i18n.t('ajustes.idioma.titulo')).toBe('Language');
  });

  it('muda os textos na hora, na mesma instância, e avisa quem desenha a interface', async () => {
    const i18n = criarI18n('pt-BR');
    const aoTrocar = vi.fn();
    i18n.on('languageChanged', aoTrocar);
    expect(i18n.t('ajustes.idioma.titulo')).toBe('Idioma');

    await i18n.changeLanguage('en');
    expect(i18n.t('ajustes.idioma.titulo')).toBe('Language');
    expect(aoTrocar).toHaveBeenCalledWith('en');

    await i18n.changeLanguage('pt-BR');
    expect(i18n.t('ajustes.idioma.titulo')).toBe('Idioma');
  });

  it('instâncias são isoladas: trocar o idioma de uma não muda a outra', async () => {
    const primeira = criarI18n('pt-BR');
    const segunda = criarI18n('pt-BR');
    await primeira.changeLanguage('en');
    expect(segunda.t('ajustes.idioma.titulo')).toBe('Idioma');
  });

  it('não escreve nada no console (RNF-05)', async () => {
    const metodos = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const espioes = metodos.map((metodo) =>
      vi.spyOn(console, metodo).mockImplementation(() => undefined),
    );

    const i18n = criarI18n('pt-BR');
    i18n.t('app.nome');
    i18n.exists('chave.que.nao.existe');
    await i18n.changeLanguage('en');
    await i18n.changeLanguage('xx');

    for (const espiao of espioes) expect(espiao).not.toHaveBeenCalled();
  });
});
