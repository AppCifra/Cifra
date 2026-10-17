import { existsSync, readFileSync, rmSync, statSync, truncateSync } from 'node:fs';
import { join } from 'node:path';
import { Cofre, segredoDoCofre, type CofreAberto, type Cripto } from '@cifra/core';
import { iguais, utf8 } from '@cifra/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { cripto } from '../../../packages/core/test/adaptadores/sodium-node.ts';
import {
  abrirBancoNoArquivo,
  pastaTemporaria,
} from '../../../packages/core/test/adaptadores/sqlite-node.ts';
import {
  ate,
  BLOCO_DE_TESTE,
  conversa,
  RELAY,
  relogio,
  textos,
  type Pessoa,
} from '../../../packages/core/test/correio-de-teste.ts';
import { ConversasDoApp, type OcultasDoApp } from '../src/conversas.ts';

// As conversas ocultas pela tela, sobre o núcleo de verdade e o relay no mesmo processo: o código
// na busca abre o cofre (RF-22), o código nunca fica guardado (RF-21), ocultar tira a conversa da
// lista (RF-20) e fechar tira as telas e limpa a busca (RF-24). O arquivo do cofre é o SQLite do
// Node, sem cifra, que só abre com a chave que o criou.

const pastas: string[] = [];
afterEach(() => {
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true });
});

interface OcultasDeTeste extends OcultasDoApp {
  readonly caminho: string;
  readonly contagem: { truncar: number; tocar: number; derivacoes: number };
}

function ocultasDe(p: Pessoa, base: Cripto = cripto): OcultasDeTeste {
  const pasta = pastaTemporaria();
  pastas.push(pasta);
  const caminho = join(pasta, 'cofre.sqlite');
  let chaveDoArquivo: Uint8Array | null = null;
  const vazio = () => !existsSync(caminho) || statSync(caminho).size === 0;
  const contagem = { truncar: 0, tocar: 0, derivacoes: 0 };
  const espia: Cripto = {
    ...base,
    // Conta cada derivação e roda o Argon2id com o custo mínimo: o nível de verdade (INTERACTIVE, 64
    // MB) é conferido no núcleo, e aqui ele só pesaria nos outros testes, que rodam juntos.
    crypto_pwhash: (tamanho, senha, sal, _operacoes, _memoria, algoritmo) => {
      contagem.derivacoes++;
      return base.crypto_pwhash(tamanho, senha, sal, 1, 8192, algoritmo);
    },
  };
  return {
    caminho,
    contagem,
    cripto: espia,
    segredo: segredoDoCofre(cripto, new Uint8Array(32).fill(9)),
    bloco: BLOCO_DE_TESTE,
    abrir(chave) {
      if (!vazio() && chaveDoArquivo && !iguais(chave, chaveDoArquivo)) {
        return Promise.reject(new Error('banco-ilegivel'));
      }
      if (vazio()) chaveDoArquivo = chave.slice();
      const aberto = abrirBancoNoArquivo(caminho, 'TRUNCATE');
      const cofre: CofreAberto = {
        banco: aberto.banco,
        trocarChave: (nova) => {
          chaveDoArquivo = nova.slice();
          return Promise.resolve();
        },
        fechar: () => {
          aberto.fechar();
        },
      };
      return Promise.resolve(cofre);
    },
    truncar() {
      contagem.truncar++;
      if (existsSync(caminho)) truncateSync(caminho, 0);
      chaveDoArquivo = null;
      return Promise.resolve();
    },
    tocar() {
      contagem.tocar++;
      return Promise.resolve();
    },
    montar: (banco) =>
      new Cofre({
        cripto,
        relogio,
        identidade: p.identidade,
        banco,
        bloco: BLOCO_DE_TESTE,
        transporte: p.transporte,
        relay: RELAY,
        principal: { banco: p.banco.banco, exclusivo: p.exclusivo, correio: p.correio },
      }),
  };
}

function appDe(p: Pessoa, ocultas: OcultasDoApp) {
  const avisos = { mensagens: 0 };
  const app = new ConversasDoApp({
    agenda: p.agenda,
    correio: p.correio,
    temporarias: p.temporarias,
    identidade: p.identidade,
    aoSubstituir: () => undefined,
    ocultas,
  });
  app.aoChegarMensagem(() => {
    avisos.mensagens++;
  });
  return Object.assign(app, { avisos });
}

const CODIGO = 'girassol azul 42';

describe('o código secreto na busca (RF-21, RF-22)', () => {
  it('o código certo abre; outro texto não, sem erro; todo texto aceito passa pela derivação', async () => {
    const [alice] = await conversa();
    const ocultas = ocultasDe(alice);
    const app = appDe(alice, ocultas);
    expect(await app.definirCodigo('curto')).toBe('curto');
    expect(await app.definirCodigo(CODIGO)).toBe('ok');
    expect(app.ocultasAbertas).toBe(true);
    expect(ocultas.contagem.truncar).toBe(1);
    await app.fecharOcultas();
    expect(app.ocultasAbertas).toBe(false);

    const antes = ocultas.contagem.derivacoes;
    expect(await app.tentarAbrirOcultas('outro texto qualquer')).toBe(false);
    expect(await app.tentarAbrirOcultas('cinco')).toBe(false);
    expect(await app.tentarAbrirOcultas('Girassol azul 42')).toBe(false);
    // Os dois textos aceitos derivaram; o curto, não.
    expect(ocultas.contagem.derivacoes - antes).toBe(2);
    expect(app.ocultasAbertas).toBe(false);
    expect(await app.tentarAbrirOcultas(`  ${CODIGO} `)).toBe(true);
    expect(app.ocultasAbertas).toBe(true);
    await app.parar();
  });

  it('o código não fica em lugar nenhum: nem no banco principal, nem no cofre', async () => {
    const [alice] = await conversa();
    const ocultas = ocultasDe(alice);
    const app = appDe(alice, ocultas);
    expect(await app.definirCodigo(CODIGO)).toBe('ok');
    await app.fecharOcultas();
    const procurado = Buffer.from(utf8(CODIGO));
    for (const arquivo of [alice.banco.caminho, ocultas.caminho]) {
      expect(readFileSync(arquivo).includes(procurado)).toBe(false);
    }
  });

  it('trocar o código com as ocultas abertas mantém as ocultas; o código antigo não abre mais', async () => {
    const [alice, bob] = await conversa();
    const ocultas = ocultasDe(alice);
    const app = appDe(alice, ocultas);
    await app.definirCodigo(CODIGO);
    expect(await app.ocultar(bob.id)).toBe('ok');
    expect(await app.trocarCodigo('outro código 7')).toBe('ok');
    await app.fecharOcultas();
    expect(await app.tentarAbrirOcultas(CODIGO)).toBe(false);
    expect(await app.tentarAbrirOcultas('outro código 7')).toBe(true);
    expect((await app.ocultas?.conversas())?.map(({ id }) => id)).toEqual([bob.id]);
    await app.parar();
  });

  it('definir um código novo com as ocultas fechadas apaga as do código anterior', async () => {
    const [alice, bob] = await conversa();
    const ocultas = ocultasDe(alice);
    const app = appDe(alice, ocultas);
    await app.definirCodigo(CODIGO);
    await app.ocultar(bob.id);
    await app.fecharOcultas();
    expect(await app.definirCodigo('código novo 8')).toBe('ok');
    expect(await app.ocultas?.conversas()).toEqual([]);
    expect(statSync(ocultas.caminho).size % BLOCO_DE_TESTE).toBe(0);
    await app.parar();
  });
});

describe('ocultar pela tela (RF-20) e fechar as ocultas (RF-24)', () => {
  it('a conversa some da lista e da busca; a mensagem dela não gera aviso', async () => {
    const [alice, bob] = await conversa();
    const app = appDe(alice, ocultasDe(alice));
    expect(await app.ocultar(bob.id)).toBe('fechadas');
    await app.definirCodigo(CODIGO);
    expect(await app.ocultar(bob.id)).toBe('ok');
    expect(app.oculta(bob.id)).toBe(true);
    expect(app.agendaDe(bob.id)).toBe(app.ocultas);
    expect((await alice.agenda.conversas()).map(({ id }) => id)).toEqual([alice.id]);
    expect(await alice.agenda.buscar('oi')).toEqual({ conversas: [], mensagens: [] });

    await bob.correio.enviarTexto(alice.id, 'para a oculta');
    await ate(
      async () =>
        (await app.agendaDe(bob.id).mensagens(bob.id)).some((m) => m.texto === 'para a oculta'),
      'chega ao cofre',
    );
    expect(app.avisos.mensagens).toBe(0);
    // Responder pela tela vai pelo correio do cofre.
    expect(await app.enviar(bob.id, 'daqui')).toBe('ok');
    await ate(async () => (await textos(bob, alice)).includes('daqui'), 'bob recebe');
    await app.parar();
  });

  it('fechar avisa as telas com os IDs das ocultas e toca a data do cofre', async () => {
    const [alice, bob] = await conversa();
    const ocultas = ocultasDe(alice);
    const app = appDe(alice, ocultas);
    await app.definirCodigo(CODIGO);
    await app.ocultar(bob.id);
    const fechadas: string[][] = [];
    app.aoFecharOcultas((ids) => fechadas.push([...ids]));
    const toques = ocultas.contagem.tocar;
    await app.fecharOcultas();
    expect(fechadas).toEqual([[bob.id]]);
    expect(ocultas.contagem.tocar).toBe(toques + 1);
    expect(app.oculta(bob.id)).toBe(false);
    expect(app.agendaDe(bob.id)).toBe(alice.agenda);
    expect(await alice.agenda.conversa(bob.id)).toBeNull();
    // Reabrir e reexibir traz a conversa de volta.
    expect(await app.tentarAbrirOcultas(CODIGO)).toBe(true);
    expect(await app.reexibir(bob.id)).toBe('ok');
    expect((await alice.agenda.conversa(bob.id))?.tipo).toBe('contato');
    await app.parar();
  });

  it('parar a sessão fecha as ocultas antes', async () => {
    const [alice] = await conversa();
    const ocultas = ocultasDe(alice);
    const app = appDe(alice, ocultas);
    await app.definirCodigo(CODIGO);
    const toques = ocultas.contagem.tocar;
    await app.parar();
    expect(app.ocultasAbertas).toBe(false);
    expect(ocultas.contagem.tocar).toBe(toques + 1);
  });
});
