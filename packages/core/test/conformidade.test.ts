import { afterEach, describe, expect, it } from 'vitest';
import {
  verificarArmazenamento,
  verificarCripto,
  verificarRelogio,
  verificarTransporte,
  type Armazenamento,
  type Cripto,
  type Relogio,
  type ResultadoDaVerificacao,
  type Transporte,
} from '../src/index.ts';
import { relogioDoNode } from './adaptadores/relogio.ts';
import { transporteNode } from './adaptadores/transporte-node.ts';
import { RelayDeTeste } from './relay.ts';
import { cripto } from './adaptadores/sodium-node.ts';
import { abrirBancoDeTeste, type BancoDeTeste } from './adaptadores/sqlite-node.ts';

// Estas verificações rodam também no Android (tela do spike). Aqui elas são conferidas contra
// as implementações de referência e contra implementações sabotadas: se uma sabotagem passasse,
// a verificação não protegeria nada no aparelho.

const falhas = (resultados: readonly ResultadoDaVerificacao[]) =>
  resultados.filter(({ ok }) => !ok).map(({ nome }) => nome);

/** A referência com uma função trocada. */
function sabotar(troca: Partial<Record<keyof Cripto, unknown>>): Cripto {
  return Object.assign(Object.create(cripto) as Cripto, troca);
}

describe('conformidade da porta Cripto (RNF-01, RNF-15)', () => {
  it('a libsodium-wrappers-sumo passa em todas as verificações', async () => {
    const resultados = await verificarCripto(cripto);
    expect(falhas(resultados)).toEqual([]);
    expect(resultados.length).toBeGreaterThanOrEqual(15);
  });

  it('acusa decifração que não confere a etiqueta', async () => {
    const semEtiqueta = sabotar({
      crypto_aead_xchacha20poly1305_ietf_decrypt: (_: null, cifrado: Uint8Array) =>
        cifrado.slice(0, cifrado.length - 16),
    });
    expect(falhas(await verificarCripto(semEtiqueta))).toContain('xchacha20poly1305.draft-a31');
  });

  it('acusa hash diferente do BLAKE2b', async () => {
    const hashErrado = sabotar({
      crypto_generichash: (tamanho: number) => new Uint8Array(tamanho),
    });
    const acusadas = falhas(await verificarCripto(hashErrado));
    expect(acusadas).toContain('blake2b.rfc7693');
    expect(acusadas).toContain('blake2b.com-chave');
  });

  it('acusa outro hash no lugar do SHA-256', async () => {
    const outroHash = sabotar({
      crypto_hash_sha256: (mensagem: Uint8Array) => cripto.crypto_generichash(32, mensagem, null),
    });
    expect(falhas(await verificarCripto(outroHash))).toEqual(['sha256.fips180-2']);
  });

  it('acusa envelope selado que abre adulterado ou com a chave de outro', async () => {
    const abreQualquer = sabotar({
      crypto_box_seal_open: (cifrado: Uint8Array) => cifrado.slice(48),
      crypto_box_seal: (mensagem: Uint8Array) => {
        const selado = new Uint8Array(mensagem.length + 48);
        selado.set(mensagem, 48);
        return selado;
      },
    });
    expect(falhas(await verificarCripto(abreQualquer))).toContain(
      'box-seal.ida-volta-e-adulteracao',
    );
  });

  it('acusa fluxo que aceita pedaço adulterado', async () => {
    const aceitaTudo = sabotar({
      crypto_secretstream_xchacha20poly1305_pull: (_estado: unknown, cifrado: Uint8Array) => ({
        message: cifrado,
        tag: 0,
      }),
    });
    expect(falhas(await verificarCripto(aceitaTudo))).toContain(
      'secretstream.ida-volta-ordem-e-fim',
    );
  });

  it('acusa assinatura que verifica qualquer coisa e memzero que copia', async () => {
    const frouxo = sabotar({
      crypto_sign_verify_detached: () => true,
      memzero: (bytes: Uint8Array) => {
        bytes.slice().fill(0);
      },
    });
    const acusadas = falhas(await verificarCripto(frouxo));
    expect(acusadas).toContain('ed25519.rfc8032-1');
    expect(acusadas).toContain('memzero.zera-no-lugar');
  });

  it('acusa constante errada e aleatoriedade repetida, sem expor bytes no erro', async () => {
    const fraco = sabotar({
      crypto_box_SEALBYTES: 32,
      randombytes_buf: (tamanho: number) => new Uint8Array(tamanho),
    });
    const resultados = await verificarCripto(fraco);
    expect(falhas(resultados)).toEqual(
      expect.arrayContaining(['constantes', 'aleatorio.tamanho-e-variacao']),
    );
    expect(resultados.find(({ nome }) => nome === 'constantes')?.erro).toBe('crypto_box_SEALBYTES');
  });

  it('transforma exceção em falha, sem interromper as outras verificações', async () => {
    const quebrado = sabotar({
      crypto_scalarmult: () => {
        throw new Error('sem binding');
      },
    });
    const resultados = await verificarCripto(quebrado);
    expect(resultados.find(({ nome }) => nome === 'x25519.rfc7748')).toMatchObject({
      ok: false,
      erro: 'sem binding',
    });
    expect(resultados.find(({ nome }) => nome === 'kdf.libsodium')?.ok).toBe(true);
  });
});

describe('conformidade da porta Armazenamento (RNF-08, RF-12)', () => {
  let aberto: BancoDeTeste | undefined;
  afterEach(() => {
    aberto?.fechar();
    aberto = undefined;
  });

  it('o SQLite do Node passa em todas as verificações e as tabelas de teste somem', async () => {
    aberto = abrirBancoDeTeste();
    expect(falhas(await verificarArmazenamento(aberto.banco))).toEqual([]);
    const tabelas = await aberto.banco.consultar(
      "SELECT name FROM sqlite_master WHERE name LIKE 'conformidade%'",
    );
    expect(tabelas).toEqual([]);
  });

  it('acusa banco sem secure_delete, com journal WAL e com temporários em arquivo', async () => {
    aberto = abrirBancoDeTeste();
    await aberto.banco.executar('PRAGMA secure_delete = OFF');
    await aberto.banco.executar('PRAGMA journal_mode = WAL');
    await aberto.banco.executar('PRAGMA temp_store = FILE');
    expect(falhas(await verificarArmazenamento(aberto.banco))).toEqual([
      'pragma.secure-delete',
      'pragma.journal-delete',
      'pragma.temp-store-memoria',
    ]);
  });

  it('acusa índice de conteúdo externo que não sai da busca quando a linha é apagada', async () => {
    aberto = abrirBancoDeTeste();
    const { banco } = aberto;
    // Sabota o gatilho de exclusão: a linha sai da tabela, mas o índice continua achando.
    const semExclusao: Armazenamento = {
      ...banco,
      executar: (sql, parametros) =>
        banco.executar(sql.replace(/INSERT INTO \w+ \(\w+, rowid[^;]*;/, 'SELECT 1;'), parametros),
    };
    expect(falhas(await verificarArmazenamento(semExclusao))).toEqual([
      'fts5.conteudo-externo-com-gatilhos',
    ]);
  });

  it('acusa consulta que não devolve as linhas de um INSERT com RETURNING', async () => {
    aberto = abrirBancoDeTeste();
    const { banco } = aberto;
    // Como um adaptador que manda toda escrita pelo caminho que não lê linhas.
    const semRetorno: Armazenamento = {
      ...banco,
      consultar: async (sql, parametros) => {
        if (!sql.trimStart().startsWith('INSERT')) return banco.consultar(sql, parametros);
        await banco.executar(sql, parametros);
        return [];
      },
    };
    expect(falhas(await verificarArmazenamento(semRetorno))).toEqual(['sql.insert-devolve-linhas']);
  });

  it('acusa transação que não desfaz e BLOB devolvido em outro formato', async () => {
    aberto = abrirBancoDeTeste();
    const { banco } = aberto;
    const ruim: Armazenamento = {
      executar: (sql, parametros) => banco.executar(sql, parametros),
      consultar: async (sql, parametros) =>
        (await banco.consultar(sql, parametros)).map((linha) =>
          Object.fromEntries(
            Object.entries(linha).map(([k, v]) => [
              k,
              v instanceof Uint8Array ? Array.from(v).join(',') : v,
            ]),
          ),
        ),
      transacao: async (operacao) => operacao(ruim),
    };
    expect(falhas(await verificarArmazenamento(ruim))).toEqual([
      'sql.parametros-e-tipos',
      'transacao.desfaz-no-erro',
    ]);
  });
});

describe('conformidade da porta Relogio', () => {
  it('Date.now e setTimeout passam', async () => {
    expect(falhas(await verificarRelogio(relogioDoNode))).toEqual([]);
  });

  it('acusa relógio em segundos e cancelamento que não cancela', async () => {
    const emSegundos: Relogio = { ...relogioDoNode, agora: () => Math.floor(Date.now() / 1000) };
    expect(falhas(await verificarRelogio(emSegundos))).toContain('relogio.agora-em-milissegundos');
    const semCancelar: Relogio = {
      ...relogioDoNode,
      agendar: (atraso, tarefa) => {
        setTimeout(tarefa, atraso);
        return () => undefined;
      },
    };
    expect(falhas(await verificarRelogio(semCancelar))).toEqual(['relogio.cancelar-nao-roda']);
  });
});

describe('conformidade da porta Transporte, contra o relay de verdade', () => {
  let relay: RelayDeTeste | undefined;
  afterEach(async () => {
    await relay?.fechar();
    relay = undefined;
  });

  const relogioCurto: Relogio = {
    agora: () => Date.now(),
    // Prazo curto: o canal que não avisa o fechamento não segura o teste por um minuto.
    agendar: (atraso, tarefa) => relogioDoNode.agendar(Math.min(atraso, 300), tarefa),
  };

  it('o WebSocket do Node passa', async () => {
    relay = await RelayDeTeste.subir(relogioDoNode);
    expect(
      falhas(await verificarTransporte(transporteNode(), relay.endereco, cripto, relogioDoNode)),
    ).toEqual([]);
  });

  it('acusa canal que corta bytes e que não avisa quando o relay fecha', async () => {
    relay = await RelayDeTeste.subir(relogioDoNode);
    const base = transporteNode();
    const cortado: Transporte = {
      pedirHttp: (pedido) => base.pedirHttp(pedido),
      async conectar(endereco, circuito) {
        const conexao = await base.conectar(endereco, circuito);
        return {
          ...conexao,
          // Corta o último byte dos pacotes grandes e nunca avisa que fechou.
          enviar: (dados) => conexao.enviar(dados.length > 4096 ? dados.subarray(0, -1) : dados),
          aoFechar: () => () => undefined,
        };
      },
    };
    const acusadas = falhas(
      await verificarTransporte(cortado, relay.endereco, cripto, relogioCurto),
    );
    expect(acusadas).toContain('transporte.pacote-de-4096-bytes-chega-inteiro');
    expect(acusadas).toContain('transporte.avisa-quando-o-relay-fecha');
  });

  it('acusa canal que não avisa quando o próprio app fecha', async () => {
    relay = await RelayDeTeste.subir(relogioDoNode);
    const base = transporteNode();
    const calado: Transporte = {
      pedirHttp: (pedido) => base.pedirHttp(pedido),
      async conectar(endereco, circuito) {
        const conexao = await base.conectar(endereco, circuito);
        // Avisa a queda, mas o fechamento pedido pelo app passa calado.
        let fechandoPeloApp = false;
        return {
          ...conexao,
          aoFechar: (ouvinte) =>
            conexao.aoFechar(() => {
              if (!fechandoPeloApp) ouvinte();
            }),
          fechar: () => {
            fechandoPeloApp = true;
            return conexao.fechar();
          },
        };
      },
    };
    const acusadas = falhas(
      await verificarTransporte(calado, relay.endereco, cripto, relogioCurto),
    );
    expect(acusadas).toEqual(['transporte.avisa-quando-o-app-fecha']);
  });

  it('acusa HTTP que troca bytes da resposta e que passa do limite', async () => {
    relay = await RelayDeTeste.subir(relogioDoNode);
    const base = transporteNode();
    const descuidado: Transporte = {
      conectar: (endereco, circuito) => base.conectar(endereco, circuito),
      async pedirHttp(pedido) {
        // Ignora o limite e troca o primeiro byte do que vem.
        const resposta = await base.pedirHttp({ ...pedido, limite: Number.MAX_SAFE_INTEGER });
        const corpo = resposta.corpo.slice();
        if (corpo.length > 0) corpo[0] = (corpo[0] ?? 0) ^ 1;
        return { status: resposta.status, corpo };
      },
    };
    const acusadas = falhas(
      await verificarTransporte(descuidado, relay.endereco, cripto, relogioDoNode),
    );
    expect(acusadas).toEqual([
      'transporte.http-baixa-o-anexo-inteiro',
      'transporte.http-recusa-resposta-maior-que-o-limite',
    ]);
  });
});
