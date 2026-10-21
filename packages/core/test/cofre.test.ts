import { existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BYTES_DO_ID, iguais, lerId } from '@cifra/protocol';
import { describe, expect, it } from 'vitest';
import {
  Agenda,
  chaveDoCofre,
  codigoAceito,
  cofreEmBlocos,
  completarBloco,
  criarExclusivo,
  guardarMensagem,
  normalizarCodigo,
  prepararBanco,
  prepararCofre,
  segredoDoCofre,
  verificarCofre,
  type ArquivoDoCofre,
  type Cripto,
} from '../src/index.ts';
import { aceitarContato } from '../src/contatos/repositorio.ts';
import { apagarConversaDoBanco, copiarConversa } from '../src/ocultas/mudanca.ts';
import { guardarCaixaOculta, marcarCopiada, marcarMudanca } from '../src/ocultas/repositorio.ts';
import { cripto } from './adaptadores/sodium-node.ts';
import {
  abrirBancoDeTeste,
  abrirBancoNoArquivo,
  contandoAsIdas,
  pastaTemporaria,
  type BancoNoArquivo,
} from './adaptadores/sqlite-node.ts';
import {
  ate,
  avancarAte,
  conversa,
  ocultasDe,
  redeParada,
  relay,
  relogio,
  semEspacoParaOBloco,
  textos,
  type OcultasDeTeste,
  type Pessoa,
} from './correio-de-teste.ts';

// O cofre das conversas ocultas por dentro: a chave que sai do código secreto (RF-21, RF-22), o
// arquivo em blocos de tamanho exato (RNF-11), a cópia da conversa de um banco para o outro e a
// mudança que o app deixou no meio.

/** A linha sem as colunas que mudam de um banco para o outro. */
const sem = (linha: Readonly<Record<string, unknown>>, colunas: readonly string[]) =>
  Object.fromEntries(Object.entries(linha).filter(([coluna]) => !colunas.includes(coluna)));

const idDe = (p: Pessoa) => {
  const id = lerId(p.id);
  if (!id) throw new Error('ID');
  return id;
};

describe('o código secreto e a chave do cofre (RF-21, RF-22)', () => {
  const segredo = segredoDoCofre(cripto, new Uint8Array(32).fill(7));

  it('a chave sai do código e do segredo, sempre igual, e muda com qualquer um dos dois', () => {
    const chave = chaveDoCofre(cripto, 'código certo', segredo);
    expect(chave).toHaveLength(32);
    expect(chaveDoCofre(cripto, 'código certo', segredo)).toEqual(chave);
    // Espaço nas pontas e a forma Unicode não mudam o código; maiúscula muda.
    expect(chaveDoCofre(cripto, '  código certo ', segredo)).toEqual(chave);
    expect(chaveDoCofre(cripto, 'código certo', segredo)).toEqual(chave);
    expect(chaveDoCofre(cripto, 'Código certo', segredo)).not.toEqual(chave);
    expect(chaveDoCofre(cripto, 'código errado', segredo)).not.toEqual(chave);
    const outroSegredo = segredoDoCofre(cripto, new Uint8Array(32).fill(8));
    expect(chaveDoCofre(cripto, 'código certo', outroSegredo)).not.toEqual(chave);
    // O segredo sai da chave mestra, e não é ela.
    expect(segredo).not.toEqual(new Uint8Array(32).fill(7));
  });

  it('o código tem de 6 a 64 caracteres; fora disso, não vira chave', () => {
    expect(codigoAceito('12345')).toBe(false);
    expect(codigoAceito('  12345  ')).toBe(false);
    expect(codigoAceito('123456')).toBe(true);
    expect(codigoAceito('x'.repeat(64))).toBe(true);
    expect(codigoAceito('x'.repeat(65))).toBe(false);
    expect(codigoAceito('😀'.repeat(6))).toBe(true);
    expect(normalizarCodigo('  é  ')).toBe('é');
    expect(() => chaveDoCofre(cripto, 'curto', segredo)).toThrow(RangeError);
  });

  it('o Argon2id roda uma vez para cada código, com o nível interativo', () => {
    const chamadas: number[][] = [];
    const espia: Cripto = {
      ...cripto,
      crypto_pwhash: (...argumentos) => {
        chamadas.push([argumentos[3], argumentos[4], argumentos[5]]);
        return cripto.crypto_pwhash(...argumentos);
      },
    };
    chaveDoCofre(espia, 'primeiro código', segredo);
    chaveDoCofre(espia, 'segundo código', segredo);
    expect(chamadas).toEqual([
      [
        cripto.crypto_pwhash_OPSLIMIT_INTERACTIVE,
        cripto.crypto_pwhash_MEMLIMIT_INTERACTIVE,
        cripto.crypto_pwhash_ALG_ARGON2ID13,
      ],
      [
        cripto.crypto_pwhash_OPSLIMIT_INTERACTIVE,
        cripto.crypto_pwhash_MEMLIMIT_INTERACTIVE,
        cripto.crypto_pwhash_ALG_ARGON2ID13,
      ],
    ]);
  });
});

/** Um arquivo de cofre num diretório temporário, apagado no fim. */
function arquivoTemporario(): { caminho: string; apagar(): void } {
  const pasta = pastaTemporaria();
  return {
    caminho: join(pasta, 'cofre.sqlite'),
    apagar: () => {
      rmSync(pasta, { recursive: true, force: true });
    },
  };
}

describe('o arquivo do cofre em blocos (RNF-11)', () => {
  const BLOCO = 64 * 1024;

  it('fica num múltiplo exato do bloco e cresce de bloco em bloco, sem encolher', async () => {
    const temporario = arquivoTemporario();
    const arquivo = abrirBancoNoArquivo(temporario.caminho, 'TRUNCATE');
    try {
      await prepararCofre(arquivo.banco);
      await completarBloco(arquivo.banco, BLOCO);
      const tamanho = () => statSync(temporario.caminho).size;
      expect(tamanho() % BLOCO).toBe(0);
      expect(tamanho()).toBeGreaterThanOrEqual(BLOCO);

      const banco = cofreEmBlocos(arquivo.banco, BLOCO);
      await banco.executar('CREATE TABLE dados (x BLOB)');
      const tamanhos = [tamanho()];
      for (let i = 0; i < 40; i++) {
        await banco.transacao((t) =>
          t.executar('INSERT INTO dados (x) VALUES (randomblob(?))', [3000 + i * 997]),
        );
        tamanhos.push(tamanho());
      }
      expect(tamanhos.every((t) => t % BLOCO === 0)).toBe(true);
      const passos = tamanhos.slice(1).map((t, i) => t - (tamanhos[i] ?? 0));
      expect(passos.every((passo) => passo === 0 || passo === BLOCO)).toBe(true);
      expect(passos.filter((passo) => passo === BLOCO).length).toBeGreaterThan(1);

      // Apagar não encolhe: as páginas ficam livres, e o arquivo continua no mesmo tamanho.
      const antes = tamanho();
      await banco.executar('DELETE FROM dados');
      expect(tamanho()).toBe(antes);
      // O que entra depois ocupa as páginas livres antes de crescer.
      await banco.executar('INSERT INTO dados (x) VALUES (randomblob(20000))');
      expect(tamanho()).toBe(antes);
      expect(existsSync(`${temporario.caminho}-journal`)).toBe(true);
      expect(statSync(`${temporario.caminho}-journal`).size).toBe(0);
    } finally {
      arquivo.fechar();
      temporario.apagar();
    }
  });

  it('sem espaço para completar o bloco, nada entra, e o arquivo fica como estava', async () => {
    const temporario = arquivoTemporario();
    const arquivo = abrirBancoNoArquivo(temporario.caminho, 'TRUNCATE');
    try {
      await prepararCofre(arquivo.banco);
      await completarBloco(arquivo.banco, BLOCO);
      await arquivo.banco.executar('CREATE TABLE dados (x BLOB)');
      await completarBloco(arquivo.banco, BLOCO);
      const tamanho = statSync(temporario.caminho).size;
      const banco = cofreEmBlocos(semEspacoParaOBloco(arquivo.banco), BLOCO);
      const grande = 'INSERT INTO dados (x) VALUES (randomblob(?))';

      await expect(banco.transacao((t) => t.executar(grande, [2 * BLOCO]))).rejects.toThrow(
        'disk is full',
      );
      await expect(banco.executar(grande, [2 * BLOCO])).rejects.toThrow('disk is full');
      expect(await arquivo.banco.consultar('SELECT count(*) AS n FROM dados')).toEqual([{ n: 0 }]);
      expect(statSync(temporario.caminho).size).toBe(tamanho);
    } finally {
      arquivo.fechar();
      temporario.apagar();
    }
  });

  it('aceita a página como o SQLCipher responde: `cipher_page_size`, em texto', async () => {
    const temporario = arquivoTemporario();
    const arquivo = abrirBancoNoArquivo(temporario.caminho, 'TRUNCATE');
    try {
      await prepararCofre(arquivo.banco);
      const comoNoAparelho: typeof arquivo.banco = {
        ...arquivo.banco,
        consultar: (sql, parametros) =>
          sql === 'PRAGMA page_size'
            ? Promise.resolve([{ cipher_page_size: '4096' }])
            : arquivo.banco.consultar(sql, parametros),
      };
      await completarBloco(comoNoAparelho, BLOCO);
      expect(statSync(temporario.caminho).size % BLOCO).toBe(0);
    } finally {
      arquivo.fechar();
      temporario.apagar();
    }
  });

  it('o cofre recusa as pragmas do banco principal', async () => {
    const temporario = arquivoTemporario();
    const arquivo = abrirBancoNoArquivo(temporario.caminho, 'DELETE');
    try {
      await expect(prepararCofre(arquivo.banco)).rejects.toThrow('cofre sem journal_mode');
    } finally {
      arquivo.fechar();
      temporario.apagar();
    }
  });
});

/**
 * Um falso do adaptador do cofre no Node: o arquivo não é cifrado, mas só abre com a chave que o
 * criou (ou a da última troca), e a chave errada falha como no SQLCipher.
 */
function arquivoFalso(caminho: string): ArquivoDoCofre {
  let chaveDoArquivo: Uint8Array | null = null;
  return {
    abrir(chave) {
      if (chaveDoArquivo && !iguais(chave, chaveDoArquivo)) {
        return Promise.reject(new Error('banco-ilegivel'));
      }
      chaveDoArquivo = chave.slice();
      const aberto: BancoNoArquivo = abrirBancoNoArquivo(caminho, 'TRUNCATE');
      return Promise.resolve({
        banco: aberto.banco,
        trocarChave: (nova: Uint8Array) => {
          chaveDoArquivo = nova.slice();
          return Promise.resolve();
        },
        fechar: () => {
          aberto.fechar();
        },
      });
    },
    apagar() {
      rmSync(caminho, { force: true });
      rmSync(`${caminho}-journal`, { force: true });
      chaveDoArquivo = null;
      return Promise.resolve();
    },
  };
}

describe('conformidade do cofre', () => {
  it('passa com o adaptador de referência no Node', async () => {
    const temporario = arquivoTemporario();
    try {
      const resultados = await verificarCofre(cripto, arquivoFalso(temporario.caminho));
      expect(resultados.filter((r) => !r.ok)).toEqual([]);
      expect(resultados.map((r) => r.nome)).toEqual([
        'cofre.pragmas',
        'cofre.bloco-exato',
        'cofre.reabre-com-a-chave',
        'cofre.chave-errada',
        'cofre.troca-a-chave',
      ]);
      expect(existsSync(temporario.caminho)).toBe(false);
    } finally {
      temporario.apagar();
    }
  });
});

describe('a conversa muda de banco', () => {
  const TABELAS = [
    ['contatos', 'contato', 'contato'],
    ['sessoes', 'contato', 'posicao'],
    ['destinos', 'contato', 'contato'],
    ['mensagens', 'conversa', 'ordem'],
    ['notas', 'conversa', 'ordem'],
    ['fila', 'contato', 'ordem'],
  ] as const;

  const linhas = async (
    banco: BancoNoArquivo['banco'],
    [tabela, coluna, ordem]: (typeof TABELAS)[number],
    id: Uint8Array,
  ) =>
    (
      await banco.consultar(`SELECT * FROM ${tabela} WHERE ${coluna} = ? ORDER BY ${ordem}`, [id])
    ).map((linha) => sem(linha, ['ordem', 'depois_de']));

  it('tudo da conversa vai, as notas ficam no lugar, e nada fica na origem', async () => {
    const [alice, bob] = await conversa();
    await alice.correio.mudarTimer(bob.id, 3600, false);
    await bob.correio.enviarTexto(alice.id, 'depois do timer');
    await ate(async () => (await textos(alice, bob)).includes('depois do timer'), 'chega');
    await alice.agenda.renomear(bob.id, 'Bob');
    await alice.correio.enviarAnexo(bob.id, {
      arquivo: 'documento',
      formato: 'application/pdf',
      bytes: cripto.randombytes_buf(5000),
    });
    // O relay cai: o que a Alice manda agora fica na fila, e vai junto.
    await redeParada();
    await relay.derrubar();
    await alice.correio.enviarTexto(bob.id, 'ainda na fila');
    await alice.correio.parar();

    const contato = idDe(bob);
    const origem = alice.banco.banco;
    const itens = await alice.agenda.itens(bob.id);
    const antes = Object.fromEntries(
      await Promise.all(
        TABELAS.map(async (tabela) => [tabela[0], await linhas(origem, tabela, contato)] as const),
      ),
    );
    expect(antes['fila']?.length).toBeGreaterThan(0);
    expect(antes['notas']?.length).toBeGreaterThan(0);
    const anexosAntes = await origem.consultar('SELECT * FROM anexos');
    expect(anexosAntes).toHaveLength(1);

    const temporario = arquivoTemporario();
    const destino = abrirBancoNoArquivo(temporario.caminho, 'TRUNCATE');
    try {
      await prepararCofre(destino.banco);
      await copiarConversa(origem, destino.banco, contato);
      for (const tabela of TABELAS) {
        expect(await linhas(destino.banco, tabela, contato), tabela[0]).toEqual(antes[tabela[0]]);
      }
      const semOrdem = (lista: readonly Record<string, unknown>[]) =>
        lista.map((linha) => sem(linha, ['ordem']));
      expect(semOrdem(await destino.banco.consultar('SELECT * FROM anexos'))).toEqual(
        semOrdem(anexosAntes),
      );
      const agenda = new Agenda({
        cripto,
        banco: destino.banco,
        relogio,
        identidade: alice.identidade,
        exclusivo: criarExclusivo(),
        comNota: false,
      });
      expect(await agenda.itens(bob.id)).toEqual(itens);
      expect(
        await destino.banco.consultar("SELECT count(*) AS n FROM busca WHERE busca MATCH 'timer'"),
      ).toEqual([{ n: 1 }]);

      await apagarConversaDoBanco(origem, contato);
      for (const tabela of TABELAS) {
        expect(await linhas(origem, tabela, contato), tabela[0]).toEqual([]);
      }
      expect(await origem.consultar('SELECT count(*) AS n FROM anexos')).toEqual([{ n: 0 }]);
      expect(
        await origem.consultar("SELECT count(*) AS n FROM busca WHERE busca MATCH 'timer'"),
      ).toEqual([{ n: 0 }]);
    } finally {
      destino.fechar();
      temporario.apagar();
    }
  });

  it('a cópia vai ao destino uma vez por mensagem', async () => {
    const contato = cripto.randombytes_buf(BYTES_DO_ID);
    const origem = abrirBancoDeTeste();
    const destino = abrirBancoDeTeste();
    try {
      await prepararBanco(origem.banco);
      await prepararBanco(destino.banco);
      await origem.banco.transacao(async (t) => {
        await aceitarContato(t, contato, 0);
        for (let i = 0; i < 50; i++) {
          await guardarMensagem(t, {
            id: cripto.randombytes_buf(16),
            conversa: contato,
            deMim: false,
            texto: `mensagem ${String(i)}`,
            enviadaEm: i,
            recebidaEm: i,
            ttl: 0,
            expiraEm: null,
            status: 'recebida',
          });
        }
      });
      const contado = contandoAsIdas(destino.banco);
      await copiarConversa(origem.banco, contado.banco, contato);
      expect(await destino.banco.consultar('SELECT count(*) AS n FROM mensagens')).toEqual([
        { n: 50 },
      ]);
      // O contato e uma ida por mensagem.
      expect(contado.idas()).toBe(1 + 50);
    } finally {
      origem.fechar();
      destino.fechar();
    }
  });
});

describe('a mudança que o app deixou no meio termina ou se desfaz na abertura', () => {
  /** Mexe no arquivo do cofre fechado, como o app teria deixado. */
  async function noCofre(
    ocultas: OcultasDeTeste,
    mexer: (banco: BancoNoArquivo['banco']) => Promise<void>,
  ): Promise<void> {
    const arquivo = abrirBancoNoArquivo(ocultas.caminho, 'TRUNCATE');
    try {
      await prepararCofre(arquivo.banco);
      await mexer(arquivo.banco);
    } finally {
      arquivo.fechar();
    }
  }

  async function caixaPedida(p: Pessoa, de: Pessoa) {
    const [linha] = await p.banco.banco.consultar(
      'SELECT caixa, caixa_desde FROM contatos WHERE contato = ?',
      [idDe(de)],
    );
    return { caixa: linha?.['caixa'] ?? null, desde: Number(linha?.['caixa_desde'] ?? 0) };
  }

  const marcas = async (ocultas: OcultasDeTeste, alice: Pessoa) => {
    const arquivo = abrirBancoNoArquivo(ocultas.caminho, 'TRUNCATE');
    try {
      return {
        cofre: await arquivo.banco.consultar('SELECT count(*) AS n FROM mudancas'),
        caixas: await arquivo.banco.consultar('SELECT count(*) AS n FROM caixas_ocultas'),
        principal: await alice.banco.banco.consultar('SELECT count(*) AS n FROM mudancas'),
      };
    } finally {
      arquivo.fechar();
    }
  };

  it('ocultar parado antes da cópia: desfaz, e o Bob volta para a caixa do cartão', async () => {
    const [alice, bob] = await conversa();
    const ocultas = ocultasDe(alice);
    await noCofre(ocultas, async (banco) => {
      await guardarCaixaOculta(banco, idDe(bob), cripto.randombytes_buf(32));
      await marcarMudanca(banco, idDe(bob), 'ocultar');
    });
    const cofre = await ocultas.abrir();
    expect(await cofre.agenda.conversas()).toEqual([]);
    expect(await textos(alice, bob)).toEqual(['oi', 'oi, alice']);
    await avancarAte(async () => (await caixaPedida(bob, alice)).desde > 0, 'o aviso de volta');
    expect((await caixaPedida(bob, alice)).caixa).toBeNull();
    await ocultas.fechar();
    expect(await marcas(ocultas, alice)).toEqual({
      cofre: [{ n: 0 }],
      caixas: [{ n: 0 }],
      principal: [{ n: 0 }],
    });
  });

  it('ocultar parado depois da cópia: termina, e o Bob passa a escrever para a oculta', async () => {
    const [alice, bob] = await conversa();
    await redeParada();
    const ocultas = ocultasDe(alice);
    await noCofre(ocultas, async (banco) => {
      await guardarCaixaOculta(banco, idDe(bob), cripto.randombytes_buf(32));
      await marcarMudanca(banco, idDe(bob), 'ocultar');
      await copiarConversa(alice.banco.banco, banco, idDe(bob), (t) => marcarCopiada(t, idDe(bob)));
    });
    const cofre = await ocultas.abrir();
    expect(await alice.agenda.conversa(bob.id)).toBeNull();
    expect((await cofre.agenda.mensagens(bob.id)).map((m) => m.texto)).toEqual(['oi', 'oi, alice']);
    await avancarAte(
      async () => (await caixaPedida(bob, alice)).caixa instanceof Uint8Array,
      'o aviso da caixa oculta',
    );
    await bob.correio.enviarTexto(alice.id, 'para a oculta');
    await avancarAte(
      async () => (await cofre.agenda.mensagens(bob.id)).some((m) => m.texto === 'para a oculta'),
      'chega ao cofre',
    );
    await ocultas.fechar();
    expect((await marcas(ocultas, alice)).cofre).toEqual([{ n: 0 }]);
  });

  it('ocultar parado depois da cópia, e a conversa andou no principal: a cópia é refeita', async () => {
    const [alice, bob] = await conversa();
    const ocultas = ocultasDe(alice);
    await noCofre(ocultas, async (banco) => {
      await guardarCaixaOculta(banco, idDe(bob), cripto.randombytes_buf(32));
      await marcarMudanca(banco, idDe(bob), 'ocultar');
      await copiarConversa(alice.banco.banco, banco, idDe(bob), (t) => marcarCopiada(t, idDe(bob)));
    });
    // Até o cofre abrir, a conversa segue no principal: chegam e saem mensagens, e a sessão anda.
    await bob.correio.enviarTexto(alice.id, 'depois da cópia');
    await ate(async () => (await textos(alice, bob)).includes('depois da cópia'), 'chega à Alice');
    await alice.correio.enviarTexto(bob.id, 'do principal');
    await ate(async () => (await textos(bob, alice)).includes('do principal'), 'chega ao Bob');
    await redeParada();

    const cofre = await ocultas.abrir();
    expect(await alice.agenda.conversa(bob.id)).toBeNull();
    expect((await cofre.agenda.mensagens(bob.id)).map((m) => m.texto)).toEqual([
      'oi',
      'oi, alice',
      'depois da cópia',
      'do principal',
    ]);
    // A sessão do cofre é a que andou: o aviso da caixa oculta e o que sai depois abrem do lado do
    // Bob. Com a sessão da cópia, eles repetiriam as chaves do que saiu do principal.
    await avancarAte(
      async () => (await caixaPedida(bob, alice)).caixa instanceof Uint8Array,
      'o aviso da caixa oculta',
    );
    await cofre.correio?.enviarTexto(bob.id, 'do cofre');
    await avancarAte(async () => (await textos(bob, alice)).includes('do cofre'), 'chega ao Bob');
    await bob.correio.enviarTexto(alice.id, 'para a oculta');
    await avancarAte(
      async () => (await cofre.agenda.mensagens(bob.id)).some((m) => m.texto === 'para a oculta'),
      'chega ao cofre',
    );
    await ocultas.fechar();
    expect((await marcas(ocultas, alice)).cofre).toEqual([{ n: 0 }]);
  });

  it('ocultar parado depois da cópia, e o principal tem outra conversa com o contato: nada sai', async () => {
    const [alice, bob] = await conversa();
    const ocultas = ocultasDe(alice);
    await noCofre(ocultas, async (banco) => {
      await guardarCaixaOculta(banco, idDe(bob), cripto.randombytes_buf(32));
      await marcarMudanca(banco, idDe(bob), 'ocultar');
      await copiarConversa(alice.banco.banco, banco, idDe(bob), (t) => marcarCopiada(t, idDe(bob)));
    });
    // O app parou depois de apagar do principal; depois, a Alice adicionou o Bob de novo pelo "+".
    await apagarConversaDoBanco(alice.banco.banco, idDe(bob));
    relogio.avancar(1000);
    await alice.correio.iniciarConversa(bob.id);
    await alice.correio.enviarTexto(bob.id, 'de novo');
    await redeParada();

    const cofre = await ocultas.abrir();
    expect((await cofre.agenda.mensagens(bob.id)).map((m) => m.texto)).toEqual(['oi', 'oi, alice']);
    expect(await textos(alice, bob)).toEqual(['de novo']);
    await ocultas.fechar();
    expect((await marcas(ocultas, alice)).cofre).toEqual([{ n: 0 }]);
  });

  it('reexibir parado depois da cópia: termina, e a conversa sai do cofre', async () => {
    const [alice, bob] = await conversa();
    const ocultas = ocultasDe(alice);
    await (await ocultas.abrir()).ocultar(bob.id);
    await ocultas.fechar();
    await redeParada();
    // O app volta depois de um tempo: o aviso de agora é mais novo que o de quando ocultou.
    relogio.avancar(1000);
    await noCofre(ocultas, async (banco) => {
      await marcarMudanca(banco, idDe(bob), 'reexibir');
      await copiarConversa(banco, alice.banco.banco, idDe(bob), (t) =>
        marcarMudanca(t, idDe(bob), 'reexibir', true),
      );
    });
    const cofre = await ocultas.abrir();
    expect(await cofre.agenda.conversas()).toEqual([]);
    expect(await textos(alice, bob)).toEqual(['oi', 'oi, alice']);
    await avancarAte(async () => (await caixaPedida(bob, alice)).caixa === null, 'o aviso');
    await ocultas.fechar();
    expect(await marcas(ocultas, alice)).toEqual({
      cofre: [{ n: 0 }],
      caixas: [{ n: 0 }],
      principal: [{ n: 0 }],
    });
  });

  it('reexibir parado antes da cópia: desfaz, e a conversa continua oculta', async () => {
    const [alice, bob] = await conversa();
    const ocultas = ocultasDe(alice);
    await (await ocultas.abrir()).ocultar(bob.id);
    await ocultas.fechar();
    const { caixa, desde } = await caixaPedida(bob, alice);
    relogio.avancar(1000);
    await noCofre(ocultas, (banco) => marcarMudanca(banco, idDe(bob), 'reexibir'));
    const cofre = await ocultas.abrir();
    expect((await cofre.agenda.conversas()).map(({ id }) => id)).toEqual([bob.id]);
    expect(await alice.agenda.conversa(bob.id)).toBeNull();
    // O aviso da caixa oculta vai de novo: o Bob continua nela.
    await avancarAte(async () => (await caixaPedida(bob, alice)).desde > desde, 'o aviso de novo');
    expect((await caixaPedida(bob, alice)).caixa).toEqual(caixa);
    await ocultas.fechar();
    expect((await marcas(ocultas, alice)).cofre).toEqual([{ n: 0 }]);
  });
});
