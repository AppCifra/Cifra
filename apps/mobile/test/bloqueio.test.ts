import { gerarIdentidade } from '@cifra/core';
import { afterEach, describe, expect, it } from 'vitest';
import { cripto } from '../../../packages/core/test/adaptadores/sodium-node.ts';
import { ControleDoApp, PRAZO_PADRAO, type BloqueioSozinho, type EmUso } from '../src/controle.ts';
import { criarSessao } from '../src/sessao.ts';
import { plataformaDeTeste, type PlataformaDeTeste } from './plataforma.ts';

// O bloqueio sozinho (RF-40) e o vigia do app bloqueado (RF-42), com o Keystore de mentira, o
// SQLite do Node e um relógio que só anda quando o teste manda: na frente, o tempo parado conta
// pelo timer; fora, pelo alarme do sistema, e a volta confere o tempo antes de mostrar a conversa.

const testes: PlataformaDeTeste[] = [];

afterEach(() => {
  for (const teste of testes.splice(0)) {
    for (const banco of teste.bancos) banco.fechar();
    teste.limpar();
  }
});

interface BloqueioDeTeste extends BloqueioSozinho {
  agora: number;
  /** O alarme armado: em quanto tempo, a contar de quando armou. */
  armado: { readonly em: number; readonly ms: number } | null;
  /** Anda o relógio e roda os timers que venceram. */
  andar(ms: number): void;
}

function bloqueioDeTeste(): BloqueioDeTeste {
  let timers: { quando: number; tarefa: () => void; vivo: boolean }[] = [];
  const bloqueio: BloqueioDeTeste = {
    agora: 1_000_000,
    armado: null,
    decorrido: () => bloqueio.agora,
    agendar(atraso, tarefa) {
      const timer = { quando: bloqueio.agora + atraso, tarefa, vivo: true };
      timers.push(timer);
      return () => {
        timer.vivo = false;
      };
    },
    armar(ms) {
      bloqueio.armado = { em: bloqueio.agora, ms };
    },
    desarmar() {
      bloqueio.armado = null;
    },
    andar(ms) {
      const ate = bloqueio.agora + ms;
      for (;;) {
        const proximo = timers
          .filter((t) => t.vivo && t.quando <= ate)
          .sort((a, b) => a.quando - b.quando)[0];
        if (!proximo) break;
        bloqueio.agora = proximo.quando;
        proximo.vivo = false;
        timers = timers.filter((t) => t.vivo);
        proximo.tarefa();
      }
      bloqueio.agora = ate;
    },
  };
  return bloqueio;
}

interface Uso extends EmUso {
  prazoDoBloqueio: number;
}

async function montar({ prazo = 300, pararFalha = false } = {}) {
  const teste = plataformaDeTeste();
  testes.push(teste);
  (
    await criarSessao(teste.plataforma, gerarIdentidade(cripto, 'portugues').identidade)
  ).banco.fechar();
  teste.cofre.pedidos = 0;
  const bloqueio = bloqueioDeTeste();
  const vigias = { ligados: 0, parados: 0, ativos: 0, notificacoes: true };
  /** O prazo dos ajustes, em segundos: o teste pode trocar com o app aberto. */
  const ajuste = { prazo };
  /** Quantas vezes o app pediu para fechar as conversas ocultas (RF-24). */
  const ocultas = { fechadas: 0 };
  let naFrente = true;
  const controle = new ControleDoApp<Uso>({
    plataforma: teste.plataforma,
    iniciar: () => ({
      get prazoDoBloqueio() {
        return ajuste.prazo;
      },
      parar: () => (pararFalha ? Promise.reject(new Error('falhou')) : Promise.resolve()),
      fecharOcultas: () => {
        ocultas.fechadas++;
        return Promise.resolve();
      },
    }),
    emPrimeiroPlano: () => naFrente,
    bloqueio,
    vigiar: () => {
      if (!vigias.notificacoes) return Promise.resolve(null);
      vigias.ligados++;
      vigias.ativos++;
      return Promise.resolve({
        parar: () => {
          vigias.parados++;
          vigias.ativos--;
          return Promise.resolve();
        },
      });
    },
  });
  return {
    teste,
    controle,
    bloqueio,
    vigias,
    ajuste,
    ocultas,
    sair: () => {
      naFrente = false;
      return controle.irParaSegundoPlano();
    },
    voltar: () => {
      naFrente = true;
      return controle.voltarAoPrimeiroPlano();
    },
    esperar: () => controle.esperar().then(() => new Promise((pronto) => setTimeout(pronto, 5))),
  };
}

describe('bloqueio sozinho (RF-40)', () => {
  it('com o app na frente, bloqueia depois de 5 minutos parado; tocar adia', async () => {
    const { controle, bloqueio, esperar, teste } = await montar();
    await controle.abrir();
    expect(controle.estado.tipo).toBe('pronto');
    bloqueio.andar(PRAZO_PADRAO - 10_000);
    controle.usar();
    bloqueio.andar(PRAZO_PADRAO - 10_000);
    await esperar();
    expect(controle.estado.tipo).toBe('pronto');
    bloqueio.andar(10_000);
    await esperar();
    expect(controle.estado).toEqual({ tipo: 'bloqueado', falhou: false });
    // Parado na frente, a tela de bloqueio aparece sem pedir a biometria sozinha.
    expect(teste.cofre.pedidos).toBe(1);
  });

  it('fora da frente: o alarme fica armado com o prazo, e a volta antes dele não bloqueia', async () => {
    const { controle, bloqueio, sair, voltar, teste } = await montar();
    await controle.abrir();
    await sair();
    expect(controle.estado.tipo).toBe('pronto');
    expect(bloqueio.armado).toEqual({ em: bloqueio.agora, ms: PRAZO_PADRAO });
    bloqueio.andar(PRAZO_PADRAO - 1);
    await voltar();
    expect(controle.estado.tipo).toBe('pronto');
    expect(bloqueio.armado).toBeNull();
    expect(teste.cofre.pedidos).toBe(1);
  });

  it('o alarme fora da frente bloqueia, e a volta pede a biometria uma vez', async () => {
    const { controle, bloqueio, sair, voltar, teste } = await montar();
    await controle.abrir();
    await sair();
    bloqueio.andar(PRAZO_PADRAO);
    await controle.prazoVenceu();
    expect(controle.estado).toEqual({ tipo: 'bloqueado', falhou: false });
    await voltar();
    expect(controle.estado.tipo).toBe('pronto');
    expect(teste.cofre.pedidos).toBe(2);
  });

  it('o alarme atrasado: a volta depois do prazo bloqueia antes de mostrar a conversa', async () => {
    const { controle, bloqueio, sair, voltar, teste } = await montar();
    await controle.abrir();
    await sair();
    bloqueio.andar(PRAZO_PADRAO + 60_000);
    teste.cofre.cancelarAoLer = true;
    await voltar();
    expect(controle.estado).toEqual({ tipo: 'bloqueado', falhou: false });
  });

  it('com "ao sair do app", bloqueia na hora de sair, sem alarme', async () => {
    const { controle, bloqueio, sair } = await montar({ prazo: 0 });
    await controle.abrir();
    bloqueio.andar(3_600_000);
    await sair();
    expect(controle.estado).toEqual({ tipo: 'bloqueado', falhou: false });
    expect(bloqueio.armado).toBeNull();
  });

  it('o prazo escolhido vale: 1 minuto parado na frente', async () => {
    const { controle, bloqueio, esperar } = await montar({ prazo: 60 });
    await controle.abrir();
    bloqueio.andar(59_000);
    await esperar();
    expect(controle.estado.tipo).toBe('pronto');
    bloqueio.andar(1_000);
    await esperar();
    expect(controle.estado.tipo).toBe('bloqueado');
  });

  it('trocar "ao sair do app" por 1 minuto vale na frente, sem tocar de novo', async () => {
    const { controle, bloqueio, esperar, ajuste } = await montar({ prazo: 0 });
    await controle.abrir();
    bloqueio.andar(10_000);
    // O toque que escolhe o prazo novo chega antes da troca.
    controle.usar();
    ajuste.prazo = 60;
    bloqueio.andar(59_000);
    await esperar();
    expect(controle.estado.tipo).toBe('pronto');
    bloqueio.andar(1_000);
    await esperar();
    expect(controle.estado).toEqual({ tipo: 'bloqueado', falhou: false });
  });

  it('o seletor de fotos aberto não bloqueia na hora, mas o prazo conta, mesmo com "ao sair"', async () => {
    const { controle, bloqueio, sair } = await montar({ prazo: 0 });
    await controle.abrir();
    let fechar: () => void = () => undefined;
    const seletor = controle.semBloquear(
      () =>
        new Promise<void>((pronto) => {
          fechar = pronto;
        }),
    );
    await sair();
    expect(controle.estado.tipo).toBe('pronto');
    expect(bloqueio.armado?.ms).toBe(PRAZO_PADRAO);
    await controle.prazoVenceu();
    expect(controle.estado.tipo).toBe('bloqueado');
    fechar();
    await seletor;
  });
});

describe('vigia do app bloqueado (RF-42)', () => {
  it('liga quando o app bloqueia e para antes de o correio abrir a caixa', async () => {
    const { controle, vigias, sair, voltar, esperar } = await montar({ prazo: 0 });
    await controle.abrir();
    expect(vigias.ligados).toBe(0);
    await sair();
    await esperar();
    expect(vigias.ativos).toBe(1);
    await voltar();
    expect(controle.estado.tipo).toBe('pronto');
    expect(vigias).toMatchObject({ ligados: 1, parados: 1, ativos: 0 });
  });

  it('cancelar a biometria ao abrir deixa o app bloqueado com o vigia ligado', async () => {
    const { controle, vigias, teste, esperar } = await montar();
    teste.cofre.cancelarAoLer = true;
    await controle.abrir();
    await esperar();
    expect(controle.estado.tipo).toBe('bloqueado');
    expect(vigias.ativos).toBe(1);
  });

  it('com as notificações desligadas, nada abre a caixa com o app bloqueado', async () => {
    const { controle, vigias, sair, esperar } = await montar({ prazo: 0 });
    vigias.notificacoes = false;
    await controle.abrir();
    await sair();
    await esperar();
    expect(vigias.ligados).toBe(0);
  });

  it('um erro ao parar as conversas não segura o bloqueio: o banco fecha e o vigia liga', async () => {
    const { controle, vigias, teste, esperar } = await montar({ pararFalha: true });
    await controle.abrir();
    const estado = controle.estado;
    if (estado.tipo !== 'pronto') throw new Error('não abriu');
    const toques = teste.contagem.tocar;
    await controle.bloquear();
    await esperar();
    expect(controle.estado.tipo).toBe('bloqueado');
    await expect(estado.sessao.banco.banco.consultar('SELECT 1')).rejects.toThrow();
    // A data do cofre muda a cada bloqueio.
    expect(teste.contagem.tocar).toBeGreaterThan(toques);
    expect(vigias.ativos).toBe(1);
  });
});

describe('as conversas ocultas fecham sozinhas (RF-24)', () => {
  it('ao sair da frente, mas não com o seletor do próprio app aberto; a data do cofre muda', async () => {
    const { controle, sair, voltar, esperar, ocultas, teste } = await montar();
    await controle.abrir();
    // Abrir a sessão já tocou a data do cofre.
    const toques = teste.contagem.tocar;
    expect(toques).toBeGreaterThan(0);
    await sair();
    await esperar();
    expect(ocultas.fechadas).toBe(1);
    expect(teste.contagem.tocar).toBe(toques + 1);
    await voltar();
    await esperar();

    let soltar: () => void = () => undefined;
    const seletor = controle.semBloquear(
      () =>
        new Promise<void>((pronto) => {
          soltar = pronto;
        }),
    );
    await sair();
    await esperar();
    expect(ocultas.fechadas).toBe(1);
    soltar();
    await seletor;
    await voltar();
    await esperar();

    // O bloqueio também toca a data, com ou sem ocultas abertas.
    await controle.bloquear();
    expect(controle.estado.tipo).toBe('bloqueado');
    expect(teste.contagem.tocar).toBe(toques + 3);
  });
});
