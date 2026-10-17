import {
  gerarIdentidade,
  restaurarIdentidade,
  type ConteudoDoBackup,
  type Identidade,
} from '@cifra/core';
import { describe, expect, it } from 'vitest';
import { cripto } from '../../../packages/core/test/adaptadores/sodium-node.ts';
import {
  avancar,
  INICIO,
  type EstadoDoOnboarding,
  type EventoDoOnboarding,
} from '../src/onboarding/fluxo.ts';

const percorrer = (eventos: readonly EventoDoOnboarding[], de = INICIO) =>
  eventos.reduce<EstadoDoOnboarding>(avancar, de);

describe('gerar identidade (RF-01)', () => {
  it('chega a guardar sem nenhum dado digitado: só gerar, continuar e anotar', () => {
    const nova = gerarIdentidade(cripto, 'portugues');
    const fim = percorrer([{ tipo: 'gerada', nova }, { tipo: 'continuar' }, { tipo: 'anotei' }]);
    expect(fim).toEqual({
      tela: 'guardando',
      identidade: nova.identidade,
      origem: 'palavras',
      nova,
      backup: null,
    });
  });

  it('depois de gerar, a mesma identidade aparece na abertura e nas palavras', () => {
    const nova = gerarIdentidade(cripto, 'ingles');
    const gerada = percorrer([{ tipo: 'gerada', nova }]);
    expect(gerada).toEqual({ tela: 'abertura', nova });
    expect(avancar(gerada, { tipo: 'gerada', nova: gerarIdentidade(cripto, 'ingles') })).toBe(
      gerada,
    );
    expect(avancar(gerada, { tipo: 'continuar' })).toEqual({
      tela: 'palavras',
      nova,
      confirmandoPulo: false,
      naoGuardou: false,
    });
  });

  it('continuar não faz nada antes de gerar', () => {
    expect(avancar(INICIO, { tipo: 'continuar' })).toBe(INICIO);
  });
});

describe('pular as palavras (RF-02)', () => {
  const nova = gerarIdentidade(cripto, 'portugues');
  const palavras = percorrer([{ tipo: 'gerada', nova }, { tipo: 'continuar' }]);

  it('pular nunca conclui direto: abre a confirmação', () => {
    const pulando = avancar(palavras, { tipo: 'pular' });
    expect(pulando).toEqual({ ...palavras, confirmandoPulo: true });
    expect(pulando.tela).toBe('palavras');
  });

  it('com a confirmação aberta, só confirmar conclui; anotei não passa por cima', () => {
    const pulando = avancar(palavras, { tipo: 'pular' });
    expect(avancar(pulando, { tipo: 'anotei' })).toBe(pulando);
    expect(avancar(pulando, { tipo: 'confirmarPulo' })).toEqual({
      tela: 'guardando',
      identidade: nova.identidade,
      origem: 'palavras',
      nova,
      backup: null,
    });
  });

  it('cancelar ou voltar fecha a confirmação e deixa as palavras na tela', () => {
    const pulando = avancar(palavras, { tipo: 'pular' });
    expect(avancar(pulando, { tipo: 'cancelarPulo' })).toEqual(palavras);
    expect(avancar(pulando, { tipo: 'voltar' })).toEqual(palavras);
  });

  it('confirmar sem ter pedido para pular não faz nada', () => {
    expect(avancar(palavras, { tipo: 'confirmarPulo' })).toBe(palavras);
  });
});

describe('restaurar identidade (RF-03)', () => {
  it('as palavras levam à mesma identidade, e entrar guarda essa identidade', () => {
    const { identidade, palavras } = gerarIdentidade(cripto, 'ingles');
    const restaurada = percorrer([
      { tipo: 'irParaRestaurar' },
      { tipo: 'restauracao', restauracao: restaurarIdentidade(cripto, palavras.join(' ')) },
    ]);
    expect(restaurada.tela === 'restaurada' && restaurada.identidade.id).toBe(identidade.id);

    const fim = avancar(restaurada, { tipo: 'entrar' });
    expect(fim.tela === 'guardando' && fim.identidade.id).toBe(identidade.id);
  });

  it('palavras com problema continuam na restauração, mostrando o problema', () => {
    const restaurando = percorrer([
      { tipo: 'irParaRestaurar' },
      { tipo: 'restauracao', restauracao: restaurarIdentidade(cripto, 'abacate') },
    ]);
    expect(restaurando).toEqual({
      tela: 'restaurar',
      problema: { tipo: 'quantidade', encontradas: 1 },
    });
    expect(avancar(restaurando, { tipo: 'entrar' })).toBe(restaurando);
  });

  it('voltar sai da restauração sem identidade nenhuma', () => {
    expect(percorrer([{ tipo: 'irParaRestaurar' }, { tipo: 'voltar' }])).toEqual(INICIO);
  });
});

describe('quando não consegue guardar', () => {
  it('volta para as palavras, avisando, e anotei tenta de novo', () => {
    const nova = gerarIdentidade(cripto, 'portugues');
    const voltou = percorrer([
      { tipo: 'gerada', nova },
      { tipo: 'continuar' },
      { tipo: 'anotei' },
      { tipo: 'naoGuardou' },
    ]);
    expect(voltou).toEqual({ tela: 'palavras', nova, confirmandoPulo: false, naoGuardou: true });
    expect(avancar(voltou, { tipo: 'anotei' }).tela).toBe('guardando');
  });

  it('volta para a identidade restaurada, avisando', () => {
    const { identidade, palavras } = gerarIdentidade(cripto, 'portugues');
    const voltou = percorrer([
      { tipo: 'irParaRestaurar' },
      { tipo: 'restauracao', restauracao: restaurarIdentidade(cripto, palavras.join(' ')) },
      { tipo: 'entrar' },
      { tipo: 'naoGuardou' },
    ]);
    expect(voltou.tela === 'restaurada' && voltou.naoGuardou).toBe(true);
    expect(voltou.tela === 'restaurada' && voltou.identidade.id).toBe(identidade.id);
  });
});

describe('restaurar com um backup (RF-47)', () => {
  const backup = (contatos: number): ConteudoDoBackup => ({
    criadoEm: 1,
    ajustes: {
      timer_padrao: 0,
      timer_da_nota: 0,
      baixar_sozinho: 1,
      confirmacoes_de_leitura: 0,
      indicador_de_digitacao: 0,
      bloquear_sozinho: 300,
      bloquear_capturas: 1,
    },
    preferencias: { tema: 'escuro', idioma: null },
    contatos: Array.from({ length: contatos }, (_, i) => ({
      contato: new Uint8Array(10).fill(i + 1),
      aceito: true,
      bloqueado: false,
      verificado: false,
      apelido: null,
      criadoEm: 0,
      timer: 0,
      timerDesde: 0,
      timerPorAvisar: false,
      printsBloqueados: false,
      printsDesde: 0,
      recebidasAte: 0,
      cartao: null,
    })),
  });

  function restaurada(): { estado: EstadoDoOnboarding; identidade: Identidade } {
    const { identidade, palavras } = gerarIdentidade(cripto, 'portugues');
    const estado = percorrer([
      { tipo: 'irParaRestaurar' },
      { tipo: 'restauracao', restauracao: restaurarIdentidade(cripto, palavras.join(' ')) },
    ]);
    return { estado, identidade };
  }

  it('sem backup, entra só com a identidade', () => {
    const { estado } = restaurada();
    expect(estado.tela === 'restaurada' && estado.backup).toBeNull();
    const fim = avancar(estado, { tipo: 'entrar' });
    expect(fim.tela === 'guardando' && fim.backup).toBeNull();
  });

  it('o backup escolhido vai junto ao entrar, e volta se não der para guardar', () => {
    const { estado } = restaurada();
    const escolhido = backup(2);
    const comBackup = avancar(estado, { tipo: 'backup', backup: escolhido });
    expect(comBackup.tela === 'restaurada' && comBackup.backup).toBe(escolhido);
    const guardando = avancar(comBackup, { tipo: 'entrar' });
    expect(guardando.tela === 'guardando' && guardando.backup).toBe(escolhido);
    const voltou = avancar(guardando, { tipo: 'naoGuardou' });
    expect(voltou.tela === 'restaurada' && voltou.backup).toBe(escolhido);
    expect(voltou.tela === 'restaurada' && voltou.naoGuardou).toBe(true);
  });

  it('o arquivo que não abre com estas palavras avisa, sem tirar o que já estava escolhido', () => {
    const { estado } = restaurada();
    const recusado = avancar(estado, { tipo: 'backup', backup: null });
    expect(recusado.tela === 'restaurada' && recusado.backupRecusado).toBe(true);
    expect(recusado.tela === 'restaurada' && recusado.backup).toBeNull();

    const escolhido = backup(1);
    const comBackup = avancar(recusado, { tipo: 'backup', backup: escolhido });
    expect(comBackup.tela === 'restaurada' && comBackup.backupRecusado).toBe(false);
    const outroRecusado = avancar(comBackup, { tipo: 'backup', backup: null });
    expect(outroRecusado.tela === 'restaurada' && outroRecusado.backup).toBe(escolhido);
    expect(outroRecusado.tela === 'restaurada' && outroRecusado.backupRecusado).toBe(true);
  });

  it('voltar para as palavras esquece o backup escolhido', () => {
    const { estado } = restaurada();
    const comBackup = avancar(estado, { tipo: 'backup', backup: backup(1) });
    const palavras = avancar(comBackup, { tipo: 'voltar' });
    expect(palavras).toEqual({ tela: 'restaurar', problema: null });
  });

  it('fora da identidade restaurada, o backup não muda nada', () => {
    const nova = gerarIdentidade(cripto, 'ingles');
    const palavras = percorrer([{ tipo: 'gerada', nova }, { tipo: 'continuar' }]);
    expect(avancar(palavras, { tipo: 'backup', backup: backup(1) })).toBe(palavras);
  });
});
