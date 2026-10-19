import { existsSync } from 'node:fs';
import { gerarIdentidade, type ParDeChaves } from '@cifra/core';
import { afterEach, describe, expect, it } from 'vitest';
import { cripto } from '../../../packages/core/test/adaptadores/sodium-node.ts';
import { ControleDoApp, type EmUso } from '../src/controle.ts';
import { criarSessao, type Sessao } from '../src/sessao.ts';
import { plataformaDeTeste, type PlataformaDeTeste } from './plataforma.ts';

// O pânico (RF-48), com o Keystore de mentira e o SQLite do Node: segurar 1,6 s na tela chama
// `panico()`. As chaves somem antes de tudo, o que usava a sessão para, o banco fecha, a memória é
// zerada, os arquivos do banco e do cofre saem, e o pedido ao relay vai por último, com uma cópia
// do par de assinatura e da semente da caixa, zeradas no fim.

const testes: PlataformaDeTeste[] = [];

afterEach(() => {
  for (const teste of testes.splice(0)) {
    for (const banco of teste.bancos) banco.fechar();
    teste.limpar();
  }
});

interface UsoDeTeste extends EmUso {
  parado: boolean;
  /** Quantos segredos o Keystore ainda tinha quando o uso parou. */
  segredosAoParar: number | null;
}

async function montar({ falhaNoRelay = false } = {}) {
  const teste = plataformaDeTeste();
  testes.push(teste);
  const { identidade } = gerarIdentidade(cripto, 'portugues');
  (await criarSessao(teste.plataforma, identidade)).banco.fechar();
  const usos: UsoDeTeste[] = [];
  const pedidosAoRelay: {
    publica: Uint8Array;
    privada: Uint8Array;
    copia: Uint8Array;
    semente: Uint8Array;
    copiaDaSemente: Uint8Array;
  }[] = [];
  const esquecidos = { vezes: 0 };
  const controle = new ControleDoApp<UsoDeTeste>({
    plataforma: teste.plataforma,
    iniciar: () => {
      const uso: UsoDeTeste = {
        parado: false,
        segredosAoParar: null,
        parar() {
          uso.parado = true;
          uso.segredosAoParar = teste.cofre.guardados.size;
          return Promise.resolve();
        },
      };
      usos.push(uso);
      return uso;
    },
    emPrimeiroPlano: () => true,
    apagarNoRelay: (assinatura: ParDeChaves, sementeDaCaixa: Uint8Array) => {
      pedidosAoRelay.push({
        publica: assinatura.publicKey,
        privada: assinatura.privateKey,
        copia: assinatura.privateKey.slice(),
        semente: sementeDaCaixa,
        copiaDaSemente: sementeDaCaixa.slice(),
      });
      return falhaNoRelay ? Promise.reject(new Error('sem rede')) : Promise.resolve(true);
    },
    aoApagar: () => {
      esquecidos.vezes++;
    },
  });
  await controle.abrir();
  return { teste, controle, identidade, usos, pedidosAoRelay, esquecidos };
}

const zerado = (bytes: Uint8Array) => bytes.length > 0 && bytes.every((byte) => byte === 0);

function sessaoDe(controle: ControleDoApp<UsoDeTeste>): Sessao {
  const { estado } = controle;
  if (estado.tipo !== 'pronto') throw new Error(`estado ${estado.tipo}`);
  return estado.sessao;
}

describe('pânico (RF-48)', () => {
  it('destrói a chave mestra e as outras chaves, e apaga o banco e o cofre', async () => {
    const { teste, controle, usos } = await montar();
    expect(existsSync(teste.arquivo)).toBe(true);
    expect(existsSync(teste.arquivoDoCofre)).toBe(true);
    expect(teste.cofre.guardados.size).toBeGreaterThan(0);
    const sessao = sessaoDe(controle);

    await controle.panico();

    expect(controle.estado).toEqual({ tipo: 'onboarding', apagado: true });
    // Nenhum segredo fica no Keystore: chave mestra, caixa e preferências.
    expect([...teste.cofre.guardados.keys()]).toEqual([]);
    expect(existsSync(teste.arquivo)).toBe(false);
    expect(existsSync(teste.arquivoDoCofre)).toBe(false);
    expect(teste.contagem.apagar).toBe(1);
    // O que usava a sessão parou, o banco fechou e a memória foi zerada.
    expect(usos[0]?.parado).toBe(true);
    await expect(sessao.banco.banco.consultar('SELECT 1')).rejects.toThrow();
    for (const segredo of [
      sessao.identidade.semente,
      sessao.identidade.assinatura.privateKey,
      sessao.identidade.acordo.privateKey,
      sessao.sementeDaCaixa,
      sessao.segredoDoCofre,
    ]) {
      expect(zerado(segredo)).toBe(true);
    }
  });

  it('as chaves somem antes de tudo: quando o correio para, o Keystore já está vazio', async () => {
    const { controle, usos } = await montar();
    await controle.panico();
    expect(usos[0]?.segredosAoParar).toBe(0);
  });

  it('a tela vai na hora para o começo, e o app esquece tema, idioma e avisos', async () => {
    const { controle, esquecidos } = await montar();
    const estados: string[] = [];
    controle.aoMudar(() => estados.push(controle.estado.tipo));
    const panico = controle.panico();
    // Antes de qualquer espera: a tela já mudou.
    await Promise.resolve();
    await Promise.resolve();
    expect(controle.estado.tipo).toBe('onboarding');
    expect(esquecidos.vezes).toBe(1);
    await panico;
    expect(estados).toEqual(['onboarding']);
  });

  it('o relay recebe o pedido com uma cópia do par de assinatura e da semente da caixa, zeradas no fim', async () => {
    const { controle, identidade, pedidosAoRelay } = await montar();
    const semente = sessaoDe(controle).sementeDaCaixa.slice();
    await controle.panico();
    await controle.apagandoNoRelay;
    expect(pedidosAoRelay).toHaveLength(1);
    const [pedido] = pedidosAoRelay;
    expect(pedido?.publica).toEqual(identidade.assinatura.publicKey);
    // A cópia tinha a chave de verdade, e foi zerada quando o pedido terminou.
    expect(pedido?.copia).toEqual(identidade.assinatura.privateKey);
    expect(zerado(pedido?.privada ?? new Uint8Array(0))).toBe(true);
    expect(pedido?.copiaDaSemente).toEqual(semente);
    expect(zerado(pedido?.semente ?? new Uint8Array(0))).toBe(true);
  });

  it('sem conexão com o relay, o aparelho fica apagado do mesmo jeito', async () => {
    const { teste, controle, pedidosAoRelay } = await montar({ falhaNoRelay: true });
    await controle.panico();
    await controle.apagandoNoRelay;
    expect(controle.estado).toEqual({ tipo: 'onboarding', apagado: true });
    expect([...teste.cofre.guardados.keys()]).toEqual([]);
    expect(existsSync(teste.arquivo)).toBe(false);
    expect(zerado(pedidosAoRelay[0]?.privada ?? new Uint8Array(0))).toBe(true);
  });

  it('depois do pânico, o app abre como numa instalação nova, sem pedir biometria', async () => {
    const { teste, controle } = await montar();
    await controle.panico();
    teste.cofre.pedidos = 0;
    await controle.abrir();
    expect(controle.estado).toEqual({ tipo: 'onboarding' });
    expect(teste.cofre.pedidos).toBe(0);
    // Uma identidade nova entra normalmente.
    await controle.concluirOnboarding(gerarIdentidade(cripto, 'ingles').identidade);
    expect(controle.estado.tipo).toBe('pronto');
  });

  it('só com a identidade aberta: bloqueado, não apaga nada', async () => {
    const { teste, controle, pedidosAoRelay } = await montar();
    await controle.bloquear();
    await controle.panico();
    expect(controle.estado).toEqual({ tipo: 'bloqueado', falhou: false });
    expect(teste.cofre.guardados.has('chave-mestra')).toBe(true);
    expect(existsSync(teste.arquivo)).toBe(true);
    expect(pedidosAoRelay).toEqual([]);
  });
});
