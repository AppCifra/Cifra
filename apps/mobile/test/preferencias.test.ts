import { utf8 } from '@cifra/protocol';
import { describe, expect, it } from 'vitest';
import {
  bytesDasPreferencias,
  lerPreferencias,
  PREFERENCIAS_PADRAO,
  PreferenciasDoApp,
} from '../src/preferencias.ts';
import { cofreDeTeste } from './plataforma.ts';

// As preferências que valem com o app bloqueado: tema (RF-39), idioma (RF-49) e notificações
// (RF-42). Ficam no Keystore com proteção `aparelho`, lidas sem biometria.

describe('preferências guardadas fora do banco', () => {
  it('sem nada guardado: escuro, idioma do sistema e notificações ligadas', async () => {
    const cofre = cofreDeTeste();
    const preferencias = new PreferenciasDoApp(cofre);
    expect(await preferencias.carregar()).toEqual(PREFERENCIAS_PADRAO);
    expect(PREFERENCIAS_PADRAO).toEqual({
      tema: 'escuro',
      idioma: null,
      notificacoes: true,
      avisosPedidos: false,
    });
    // Ler não grava nada nem pede biometria.
    expect(cofre.guardados.size).toBe(0);
    expect(cofre.pedidos).toBe(0);
  });

  it('a mudança vale na hora, avisa quem ouve e volta na próxima abertura, sem biometria', async () => {
    const cofre = cofreDeTeste();
    const preferencias = new PreferenciasDoApp(cofre);
    let avisos = 0;
    preferencias.aoMudar(() => avisos++);
    const gravando = preferencias.mudar({ tema: 'claro', idioma: 'en' });
    expect(preferencias.atual.tema).toBe('claro');
    await gravando;
    await preferencias.mudar({ notificacoes: false });
    expect(avisos).toBe(2);
    expect(cofre.guardados.get('preferencias')?.protecao).toBe('aparelho');

    const depois = new PreferenciasDoApp(cofre);
    expect(await depois.carregar()).toEqual({
      tema: 'claro',
      idioma: 'en',
      notificacoes: false,
      avisosPedidos: false,
    });
    expect(cofre.pedidos).toBe(0);
  });

  it('mudar para o mesmo valor não avisa', async () => {
    const preferencias = new PreferenciasDoApp(cofreDeTeste());
    let avisos = 0;
    preferencias.aoMudar(() => avisos++);
    await preferencias.mudar({ tema: 'escuro', notificacoes: true });
    expect(avisos).toBe(0);
  });

  it('o que não segue o formato fica no padrão, campo por campo', () => {
    expect(lerPreferencias(null)).toEqual(PREFERENCIAS_PADRAO);
    expect(lerPreferencias(utf8('não é json'))).toEqual(PREFERENCIAS_PADRAO);
    expect(lerPreferencias(new Uint8Array([0xff, 0xfe]))).toEqual(PREFERENCIAS_PADRAO);
    expect(lerPreferencias(utf8('[1, 2]'))).toEqual(PREFERENCIAS_PADRAO);
    expect(
      lerPreferencias(
        utf8('{"tema":"roxo","idioma":"fr","notificacoes":"sim","avisosPedidos":true}'),
      ),
    ).toEqual({ ...PREFERENCIAS_PADRAO, avisosPedidos: true });
    const todas = {
      tema: 'claro',
      idioma: 'pt-BR',
      notificacoes: false,
      avisosPedidos: true,
    } as const;
    expect(lerPreferencias(bytesDasPreferencias(todas))).toEqual(todas);
  });

  it('Keystore que falha ao ler: fica o padrão; ao gravar: a mudança vale até fechar', async () => {
    const cofre = cofreDeTeste();
    await new PreferenciasDoApp(cofre).mudar({ tema: 'claro' });
    cofre.falharAoLer = true;
    const preferencias = new PreferenciasDoApp(cofre);
    expect(await preferencias.carregar()).toEqual(PREFERENCIAS_PADRAO);

    cofre.falharAoGuardar = true;
    await expect(preferencias.mudar({ notificacoes: false })).rejects.toThrow();
    expect(preferencias.atual.notificacoes).toBe(false);
  });
});

describe('pânico (RF-48)', () => {
  it('esquecer volta aos padrões na hora, avisa quem ouve e não grava nada', async () => {
    const cofre = cofreDeTeste();
    const preferencias = new PreferenciasDoApp(cofre);
    await preferencias.mudar({ tema: 'claro', idioma: 'en', notificacoes: false });
    // O pânico destrói o item do Keystore antes.
    await cofre.destruirTudo();
    let avisos = 0;
    preferencias.aoMudar(() => {
      avisos++;
    });
    preferencias.esquecer();
    expect(preferencias.atual).toEqual(PREFERENCIAS_PADRAO);
    expect(avisos).toBe(1);
    expect(cofre.guardados.size).toBe(0);
  });
});
