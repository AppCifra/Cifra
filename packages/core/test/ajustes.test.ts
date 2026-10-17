import { afterEach, describe, expect, it } from 'vitest';
import {
  Agenda,
  compararNumero,
  criarExclusivo,
  ErroDaAgenda,
  gerarIdentidade,
  migrar,
  numeroDeSeguranca,
  PRAZOS_DO_BLOQUEIO,
} from '../src/index.ts';
import { RelogioDeTeste } from './adaptadores/relogio.ts';
import { cripto } from './adaptadores/sodium-node.ts';
import { abrirBancoDeTeste, type BancoDeTeste } from './adaptadores/sqlite-node.ts';

// Ajustes de privacidade: confirmação de leitura (RF-17) e indicador de digitação (RF-18)
// desligados por padrão, bloqueio sozinho em 5 minutos (RF-40) e prints bloqueados (RF-41). E a
// comparação do número de segurança colado (SPEC, "Colar e comparar").

let aberto: BancoDeTeste | undefined;

afterEach(() => {
  aberto?.fechar();
  aberto = undefined;
});

async function agendaNova(): Promise<Agenda> {
  aberto = abrirBancoDeTeste();
  await migrar(aberto.banco);
  return new Agenda({
    cripto,
    banco: aberto.banco,
    relogio: new RelogioDeTeste(),
    identidade: gerarIdentidade(cripto, 'portugues').identidade,
    exclusivo: criarExclusivo(),
  });
}

describe('ajustes de privacidade (RF-17, RF-18, RF-40, RF-41)', () => {
  it('leitura e digitação desligadas, bloqueio em 5 minutos e prints bloqueados por padrão', async () => {
    const agenda = await agendaNova();
    expect(await agenda.ajustesDePrivacidade()).toEqual({
      confirmacoesDeLeitura: false,
      indicadorDeDigitacao: false,
      bloquearSozinho: 300,
      bloquearCapturas: true,
    });
  });

  it('quem atualiza da migração 6 ganha os mesmos padrões, e o resto dos ajustes fica', async () => {
    aberto = abrirBancoDeTeste();
    const { banco } = aberto;
    await migrar(banco, 6);
    await banco.executar('UPDATE ajustes SET timer_padrao = 3600, baixar_sozinho = 0');
    await migrar(banco);
    expect(
      await banco.consultar(
        `SELECT timer_padrao, baixar_sozinho, confirmacoes_de_leitura, indicador_de_digitacao,
           bloquear_sozinho, bloquear_capturas FROM ajustes`,
      ),
    ).toEqual([
      {
        timer_padrao: 3600,
        baixar_sozinho: 0,
        confirmacoes_de_leitura: 0,
        indicador_de_digitacao: 0,
        bloquear_sozinho: 300,
        bloquear_capturas: 1,
      },
    ]);
    // O banco recusa valor fora do formato.
    await expect(
      banco.executar('UPDATE ajustes SET confirmacoes_de_leitura = 2'),
    ).rejects.toThrow();
    await expect(banco.executar('UPDATE ajustes SET bloquear_sozinho = -1')).rejects.toThrow();
  });

  it('muda só o que vier, e o prazo do bloqueio é um dos do app', async () => {
    const agenda = await agendaNova();
    await agenda.mudarAjustesDePrivacidade({ confirmacoesDeLeitura: true });
    await agenda.mudarAjustesDePrivacidade({ indicadorDeDigitacao: true, bloquearSozinho: 0 });
    await agenda.mudarAjustesDePrivacidade({ bloquearCapturas: false });
    expect(await agenda.ajustesDePrivacidade()).toEqual({
      confirmacoesDeLeitura: true,
      indicadorDeDigitacao: true,
      bloquearSozinho: 0,
      bloquearCapturas: false,
    });

    expect(PRAZOS_DO_BLOQUEIO).toEqual([0, 60, 300, 900, 3600]);
    for (const prazo of PRAZOS_DO_BLOQUEIO) {
      await agenda.mudarAjustesDePrivacidade({ bloquearSozinho: prazo });
      expect((await agenda.ajustesDePrivacidade()).bloquearSozinho).toBe(prazo);
    }
    for (const prazo of [1, 120, 86_400, -60, 1.5]) {
      await expect(agenda.mudarAjustesDePrivacidade({ bloquearSozinho: prazo })).rejects.toEqual(
        new ErroDaAgenda('ajuste-invalido'),
      );
    }
    expect((await agenda.ajustesDePrivacidade()).bloquearSozinho).toBe(3600);
  });
});

describe('colar e comparar o número de segurança (RF-37, RF-38)', () => {
  const minha = cripto.crypto_sign_seed_keypair(cripto.randombytes_buf(32)).publicKey;
  const dele = cripto.crypto_sign_seed_keypair(cripto.randombytes_buf(32)).publicKey;
  const grupos = numeroDeSeguranca(cripto, minha, dele);
  const digitos = grupos.join('');

  it('confere com os 60 dígitos, com ou sem espaços e quebras de linha', () => {
    expect(compararNumero(digitos, grupos)).toBe('confere');
    expect(compararNumero(grupos.join(' '), grupos)).toBe('confere');
    expect(
      compararNumero(` ${grupos.slice(0, 4).join(' ')}\n${grupos.slice(4).join('  ')} `, grupos),
    ).toBe('confere');
  });

  it('vazio e começo do número não acusam nada; o resto é diferente', () => {
    expect(compararNumero('', grupos)).toBe('vazio');
    expect(compararNumero('  \n ', grupos)).toBe('vazio');
    expect(compararNumero(digitos.slice(0, 59), grupos)).toBe('incompleto');
    expect(compararNumero(`${digitos}0`, grupos)).toBe('diferente');
    expect(compararNumero(`número: ${digitos}`, grupos)).toBe('diferente');
    expect(
      compararNumero(
        digitos.replace(/^./, (d) => String((Number(d) + 1) % 10)),
        grupos,
      ),
    ).toBe('diferente');
  });

  it('o número de outro contato não confere', () => {
    const outro = cripto.crypto_sign_seed_keypair(cripto.randombytes_buf(32)).publicKey;
    expect(compararNumero(numeroDeSeguranca(cripto, minha, outro).join(' '), grupos)).toBe(
      'diferente',
    );
  });
});
