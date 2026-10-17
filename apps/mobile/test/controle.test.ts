import { gerarIdentidade, type Identidade } from '@cifra/core';
import { afterEach, describe, expect, it } from 'vitest';
import { cripto } from '../../../packages/core/test/adaptadores/sodium-node.ts';
import { ControleDoApp, type EmUso, type EstadoDoApp } from '../src/controle.ts';
import { criarSessao, type Sessao } from '../src/sessao.ts';
import { plataformaDeTeste, type PlataformaDeTeste } from './plataforma.ts';

// O estado do app e o bloqueio criptográfico (RNF-07), com o Keystore de mentira e o SQLite do
// Node. O que usa a sessão (agenda e correio, aqui de mentira) anota em que estado o app estava e
// se o banco ainda abria quando parou: ele para antes de o banco fechar.

interface CorreioDeTeste extends EmUso {
  readonly sessao: Sessao;
  /** Como o correio quando a identidade é restaurada em outro aparelho (RF-05). */
  readonly substituir: () => void;
  parado: boolean;
  bancoAbertoAoParar: boolean | null;
  estadoAoParar: EstadoDoApp['tipo'] | null;
}

const testes: PlataformaDeTeste[] = [];

afterEach(() => {
  for (const teste of testes.splice(0)) {
    for (const banco of teste.bancos) banco.fechar();
    teste.limpar();
  }
});

function montar() {
  const teste = plataformaDeTeste();
  testes.push(teste);
  const correios: CorreioDeTeste[] = [];
  let naFrente = true;
  const controle: ControleDoApp<CorreioDeTeste> = new ControleDoApp({
    plataforma: teste.plataforma,
    iniciar: (sessao, aoSubstituir) => {
      const correio: CorreioDeTeste = {
        sessao,
        substituir: aoSubstituir,
        parado: false,
        bancoAbertoAoParar: null,
        estadoAoParar: null,
        async parar() {
          correio.estadoAoParar = controle.estado.tipo;
          correio.bancoAbertoAoParar = await sessao.banco.banco.consultar('SELECT 1').then(
            () => true,
            () => false,
          );
          correio.parado = true;
        },
      };
      correios.push(correio);
      return correio;
    },
    emPrimeiroPlano: () => naFrente,
  });
  // No mesmo objeto da plataforma: `ilegivel` muda o que a abertura do banco faz.
  return Object.assign(teste, {
    controle,
    correios,
    /** O app sai da frente: outro app ou tela apagada. */
    sair: () => {
      naFrente = false;
      return controle.irParaSegundoPlano();
    },
    /** O app volta para a frente. */
    voltar: () => {
      naFrente = true;
      return controle.voltarAoPrimeiroPlano();
    },
  });
}

/** Um aparelho com identidade guardada; nenhum pedido contado ainda. */
async function comIdentidade() {
  const montado = montar();
  const { identidade } = gerarIdentidade(cripto, 'portugues');
  (await criarSessao(montado.plataforma, identidade)).banco.fechar();
  montado.cofre.pedidos = 0;
  return Object.assign(montado, { identidade });
}

function sessaoDe(estado: EstadoDoApp<CorreioDeTeste>): Sessao {
  if (estado.tipo !== 'pronto') throw new Error(`estado ${estado.tipo}`);
  return estado.sessao;
}

const zerado = (bytes: Uint8Array) => bytes.length > 0 && bytes.every((byte) => byte === 0);

describe('abrir o app', () => {
  it('pede a biometria uma vez, abre a identidade e liga o correio', async () => {
    const { controle, cofre, correios, identidade } = await comIdentidade();
    await controle.abrir();
    expect(sessaoDe(controle.estado).identidade.id).toBe(identidade.id);
    expect(cofre.pedidos).toBe(1);
    expect(correios).toHaveLength(1);
  });

  it('sem identidade vai ao onboarding sem pedir nada, e a identidade guardada entra', async () => {
    const { controle, cofre, correios } = montar();
    await controle.abrir();
    expect(controle.estado).toEqual({ tipo: 'onboarding' });
    expect(cofre.pedidos).toBe(0);

    const { identidade } = gerarIdentidade(cripto, 'ingles');
    await controle.concluirOnboarding(identidade);
    expect(sessaoDe(controle.estado).identidade.id).toBe(identidade.id);
    expect(correios).toHaveLength(1);
  });

  it('se não conseguir guardar no fim do onboarding, continua no onboarding', async () => {
    const { controle, cofre } = montar();
    await controle.abrir();
    cofre.falharAoGuardar = true;
    await expect(
      controle.concluirOnboarding(gerarIdentidade(cripto, 'ingles').identidade),
    ).rejects.toThrow();
    expect(controle.estado).toEqual({ tipo: 'onboarding' });
  });

  it('avisa quem desenha a tela a cada mudança de estado', async () => {
    const { controle } = await comIdentidade();
    const vistos: EstadoDoApp['tipo'][] = [];
    const cancelar = controle.aoMudar(() => vistos.push(controle.estado.tipo));
    await controle.abrir();
    await controle.bloquear();
    cancelar();
    await controle.abrir();
    expect(vistos).toEqual(['abrindo', 'pronto', 'bloqueado']);
  });
});

describe('bloqueio criptográfico (RNF-07)', () => {
  it('esconde a tela, para o correio com o banco aberto, fecha o banco e zera os segredos', async () => {
    const { controle, correios } = await comIdentidade();
    await controle.abrir();
    const sessao = sessaoDe(controle.estado);

    await controle.bloquear();

    expect(controle.estado).toEqual({ tipo: 'bloqueado', falhou: false });
    const [correio] = correios;
    expect(correio?.parado).toBe(true);
    // A tela já tinha saído quando o correio parou, e o banco ainda abria.
    expect(correio?.estadoAoParar).toBe('bloqueado');
    expect(correio?.bancoAbertoAoParar).toBe(true);
    // Depois, o banco está fechado e os segredos, zerados.
    await expect(sessao.banco.banco.consultar('SELECT 1')).rejects.toThrow();
    expect(zerado(sessao.identidade.semente)).toBe(true);
    expect(zerado(sessao.identidade.assinatura.privateKey)).toBe(true);
    expect(zerado(sessao.identidade.acordo.privateKey)).toBe(true);
    expect(zerado(sessao.sementeDaCaixa)).toBe(true);
  });

  it('desbloquear pede a biometria de novo e liga um correio novo', async () => {
    const { controle, cofre, correios, identidade } = await comIdentidade();
    await controle.abrir();
    await controle.bloquear();
    await controle.abrir();
    expect(cofre.pedidos).toBe(2);
    expect(sessaoDe(controle.estado).identidade.id).toBe(identidade.id);
    expect(correios.map((c) => c.parado)).toEqual([true, false]);
  });
});

describe('identidade restaurada em outro aparelho (RF-05)', () => {
  it('o aviso fecha a sessão como no bloqueio e mostra a tela de outro aparelho', async () => {
    const { controle, correios } = await comIdentidade();
    await controle.abrir();
    const sessao = sessaoDe(controle.estado);
    correios[0]?.substituir();
    await controle.esperar();

    expect(controle.estado).toEqual({ tipo: 'substituido' });
    expect(correios[0]?.parado).toBe(true);
    expect(correios[0]?.bancoAbertoAoParar).toBe(true);
    await expect(sessao.banco.banco.consultar('SELECT 1')).rejects.toThrow();
    expect(zerado(sessao.identidade.semente)).toBe(true);
  });

  it('continuar leva ao onboarding; o aviso de uma sessão que já fechou não muda nada', async () => {
    const { controle, correios } = await comIdentidade();
    await controle.abrir();
    await controle.bloquear();
    correios[0]?.substituir();
    await controle.esperar();
    expect(controle.estado).toEqual({ tipo: 'bloqueado', falhou: false });

    await controle.abrir();
    correios[1]?.substituir();
    await controle.esperar();
    controle.recomecar();
    expect(controle.estado).toEqual({ tipo: 'onboarding' });
  });
});

describe('sair e voltar ao app', () => {
  it('sair da frente bloqueia; voltar pede a biometria uma vez e abre', async () => {
    const { controle, cofre, sair, voltar } = await comIdentidade();
    await controle.abrir();
    const sessao = sessaoDe(controle.estado);

    await sair();
    expect(controle.estado).toEqual({ tipo: 'bloqueado', falhou: false });
    await expect(sessao.banco.banco.consultar('SELECT 1')).rejects.toThrow();

    await voltar();
    expect(controle.estado.tipo).toBe('pronto');
    expect(cofre.pedidos).toBe(2);
  });

  it('cancelar ao voltar fica no bloqueio, sem pedir de novo sozinho', async () => {
    const { controle, cofre, sair, voltar } = await comIdentidade();
    await controle.abrir();
    await sair();
    cofre.cancelarAoLer = true;
    await voltar();
    expect(controle.estado).toEqual({ tipo: 'bloqueado', falhou: false });
    // A tela da senha do aparelho também tira o app da frente e o devolve: nada de pedido em laço.
    await voltar();
    expect(cofre.pedidos).toBe(2);

    // Sair e voltar de novo pede outra vez, como ao abrir o app.
    cofre.cancelarAoLer = false;
    await sair();
    await voltar();
    expect(controle.estado.tipo).toBe('pronto');
  });

  it('sair durante o pedido de biometria: ao terminar, bloqueia de novo; voltar pede outra vez', async () => {
    const { controle, cofre, correios, sair, voltar } = await comIdentidade();
    const abrindo = controle.abrir();
    // Com o pedido na tela, sair não bloqueia nada: ainda não há o que fechar.
    await sair();
    await abrindo;
    // O pedido terminou com o app fora da frente: a sessão aberta fecha em seguida.
    await controle.esperar();
    expect(controle.estado).toEqual({ tipo: 'bloqueado', falhou: false });
    expect(correios[0]?.parado).toBe(true);
    expect(cofre.pedidos).toBe(1);

    await voltar();
    expect(controle.estado.tipo).toBe('pronto');
    expect(cofre.pedidos).toBe(2);
  });

  it('o seletor de fotos ou de arquivos aberto pelo app não bloqueia; depois dele, volta a bloquear', async () => {
    const { controle, cofre, correios, sair, voltar } = await comIdentidade();
    await controle.abrir();
    const escolhidos = await controle.semBloquear(async () => {
      // O seletor do sistema tira o app da frente e o devolve.
      await sair();
      await voltar();
      return ['foto'];
    });
    expect(escolhidos).toEqual(['foto']);
    expect(controle.estado.tipo).toBe('pronto');
    expect(correios[0]?.parado).toBe(false);
    expect(cofre.pedidos).toBe(1);

    await sair();
    expect(controle.estado).toEqual({ tipo: 'bloqueado', falhou: false });
    // Mesmo se o seletor falhar, o bloqueio volta a valer.
    await voltar();
    await expect(
      controle.semBloquear(() => Promise.reject(new Error('seletor'))),
    ).rejects.toThrow();
    await sair();
    expect(controle.estado.tipo).toBe('bloqueado');
  });

  it('sair e voltar sem identidade aberta não muda nada', async () => {
    const { controle, cofre, sair, voltar } = montar();
    await controle.abrir();
    await sair();
    await voltar();
    expect(controle.estado).toEqual({ tipo: 'onboarding' });
    expect(cofre.pedidos).toBe(0);
  });
});

describe('quando os dados não abrem', () => {
  it('chave apagada pelo aparelho: tela de dados perdidos, sem pedido de biometria', async () => {
    const { controle, cofre } = await comIdentidade();
    cofre.chavesPerdidas = true;
    await controle.abrir();
    expect(controle.estado).toEqual({ tipo: 'dados-perdidos', motivo: 'chave' });
    expect(cofre.pedidos).toBe(0);
  });

  it('continuar leva ao onboarding, e a identidade restaurada abre de novo', async () => {
    const { controle, cofre, identidade } = await comIdentidade();
    cofre.chavesPerdidas = true;
    await controle.abrir();
    controle.recomecar();
    expect(controle.estado).toEqual({ tipo: 'onboarding' });

    cofre.chavesPerdidas = false;
    const restaurada: Identidade = gerarIdentidade(cripto, 'portugues').identidade;
    await controle.concluirOnboarding(restaurada);
    expect(sessaoDe(controle.estado).identidade.id).toBe(restaurada.id);
    expect(restaurada.id).not.toBe(identidade.id);
  });

  it('banco que não abre com a chave: dados perdidos, pelo arquivo', async () => {
    const montado = await comIdentidade();
    montado.ilegivel = true;
    await montado.controle.abrir();
    expect(montado.controle.estado).toEqual({ tipo: 'dados-perdidos', motivo: 'arquivo' });
  });

  it('outro erro: bloqueado com aviso, e tentar de novo abre', async () => {
    const { controle, cofre } = await comIdentidade();
    cofre.falharAoLer = true;
    await controle.abrir();
    expect(controle.estado).toEqual({ tipo: 'bloqueado', falhou: true });
    cofre.falharAoLer = false;
    await controle.abrir();
    expect(controle.estado.tipo).toBe('pronto');
  });

  it('recomeçar só vale na tela de dados perdidos', async () => {
    const { controle } = await comIdentidade();
    await controle.abrir();
    controle.recomecar();
    expect(controle.estado.tipo).toBe('pronto');
  });
});
