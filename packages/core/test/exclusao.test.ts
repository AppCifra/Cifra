import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { BYTES_DO_ID, TAMANHO_DO_PACOTE } from '@cifra/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import {
  apagarDeVerdade,
  buscarMensagens,
  guardarMensagem,
  migrar,
  prepararBanco,
  VERSAO_DO_ESQUEMA,
  type Armazenamento,
  type Mensagem,
} from '../src/index.ts';
import { adiar, enfileirar, itensDaFila, tirarDaFila } from '../src/mensagens/fila.ts';
import { guardarNota } from '../src/mensagens/notas.ts';
import { cripto } from './adaptadores/sodium-node.ts';
import {
  abrirBancoDeTeste,
  abrirBancoNoArquivo,
  pastaTemporaria,
  type BancoDeTeste,
  type BancoNoArquivo,
} from './adaptadores/sqlite-node.ts';

// A exclusão real (RNF-08). O banco destes testes não é cifrado, para dar para procurar o texto
// apagado nos bytes do arquivo. No aparelho, o mesmo esquema roda sob o SQLCipher, e a
// verificação técnica repete o teste do arquivo no SQLite de lá.

const pastas: string[] = [];
const abertos: (BancoDeTeste | BancoNoArquivo)[] = [];

afterEach(() => {
  for (const aberto of abertos.splice(0)) aberto.fechar();
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true });
});

const ALICE = cripto.randombytes_buf(BYTES_DO_ID);
const BOB = cripto.randombytes_buf(BYTES_DO_ID);

function mensagem(conversa: Uint8Array, texto: string, enviadaEm = 1): Mensagem {
  return {
    id: cripto.randombytes_buf(16),
    conversa,
    deMim: true,
    tipo: 'texto',
    texto,
    resposta: null,
    enviadaEm,
    recebidaEm: null,
    ttl: 0,
    expiraEm: null,
    status: 'pendente',
  };
}

async function bancoNovo(): Promise<Armazenamento> {
  const aberto = abrirBancoDeTeste();
  abertos.push(aberto);
  await prepararBanco(aberto.banco);
  return aberto.banco;
}

/** Guarda a mensagem e, se for minha e pendente, o pacote dela na fila. */
async function guardar(banco: Armazenamento, nova: Mensagem): Promise<Mensagem> {
  await guardarMensagem(banco, nova);
  if (nova.status === 'pendente') {
    await enfileirar(banco, nova.conversa, nova.id, new Uint8Array(TAMANHO_DO_PACOTE), 0);
  }
  return nova;
}

const contar = async (banco: Armazenamento, sql: string) => (await banco.consultar(sql))[0]?.['n'];

const textos = async (banco: Armazenamento, busca: string) =>
  (await buscarMensagens(banco, busca)).map((m) => m.texto);

describe('exclusão real no arquivo do banco (RNF-08)', () => {
  /** Um arquivo novo, numa pasta apagada no fim do teste. */
  function arquivo(): string {
    const pasta = pastaTemporaria();
    pastas.push(pasta);
    return join(pasta, 'cifra.sqlite');
  }

  // Maiúscula no texto: o índice guarda o termo em minúsculas, e os dois precisam sumir.
  const ALVO = 'Zebrafantasmaqk';

  /**
   * Grava 50 mensagens, a do meio com o alvo, e apaga ela. Diz se o texto e o termo do índice
   * aparecem nos bytes do arquivo antes e depois. `preparar` liga ou desliga o que a exclusão
   * real exige.
   */
  async function rastro(preparar: (banco: Armazenamento) => Promise<void>) {
    const caminho = arquivo();
    const aberto = abrirBancoNoArquivo(caminho);
    abertos.push(aberto);
    const { banco } = aberto;
    await preparar(banco);
    // Numa transação só: 50 gravações com o journal de cada uma levam segundos no Windows.
    const { id } = await banco.transacao(async (t) => {
      let alvo: Mensagem | undefined;
      for (let i = 0; i < 50; i++) {
        const nova = await guardar(
          t,
          mensagem(ALICE, i === 25 ? `mensagem ${ALVO} apagável` : `mensagem comum número ${i}`),
        );
        if (i === 25) alvo = nova;
      }
      if (!alvo) throw new Error('sem alvo');
      return alvo;
    });
    const bytes = () => readFileSync(caminho).toString('latin1');
    const antes = { texto: bytes().includes(ALVO), termo: bytes().includes(ALVO.toLowerCase()) };
    const apagadas = await banco.transacao((t) => apagarDeVerdade(t, { mensagens: [id] }));
    const depois = { texto: bytes().includes(ALVO), termo: bytes().includes(ALVO.toLowerCase()) };
    return {
      antes,
      depois,
      apagadas,
      journal: existsSync(`${caminho}-journal`) || existsSync(`${caminho}-wal`),
      banco,
    };
  }

  it('o texto e os termos da mensagem apagada somem do arquivo, sem journal sobrando', async () => {
    const { antes, depois, apagadas, journal, banco } = await rastro(prepararBanco);
    expect(antes).toEqual({ texto: true, termo: true });
    expect(apagadas).toBe(1);
    expect(depois).toEqual({ texto: false, termo: false });
    expect(journal).toBe(false);
    expect(await textos(banco, ALVO)).toEqual([]);
    expect(await buscarMensagens(banco, 'comum')).toHaveLength(49);
  });

  it('controle: sem secure_delete e sem o secure-delete do FTS5, o apagado fica no arquivo', async () => {
    const { antes, depois } = await rastro(async (banco) => {
      await banco.executar('PRAGMA secure_delete = OFF');
      await migrar(banco);
      await banco.executar("INSERT INTO busca (busca, rank) VALUES ('secure-delete', 0)");
    });
    expect(antes).toEqual({ texto: true, termo: true });
    expect(depois).toEqual({ texto: true, termo: true });
  });

  it('controle: só com o secure_delete, o termo continua no índice de busca', async () => {
    const { depois } = await rastro(async (banco) => {
      await prepararBanco(banco);
      await banco.executar("INSERT INTO busca (busca, rank) VALUES ('secure-delete', 0)");
    });
    expect(depois).toEqual({ texto: false, termo: true });
  });
});

describe('apagarDeVerdade (RNF-08)', () => {
  it('pelo ID: sai a mensagem, o termo na busca e o pacote que esperava na fila', async () => {
    const banco = await bancoNovo();
    const apagar = await guardar(banco, mensagem(ALICE, 'encontro na praça'));
    const fica = await guardar(banco, mensagem(ALICE, 'encontro no café'));

    const apagadas = await banco.transacao((t) => apagarDeVerdade(t, { mensagens: [apagar.id] }));

    expect(apagadas).toBe(1);
    expect(await textos(banco, 'encontro')).toEqual(['encontro no café']);
    const fila = await banco.consultar('SELECT mensagem FROM fila');
    expect(fila.map((linha) => linha['mensagem'])).toEqual([fica.id]);
  });

  it('a conversa inteira: as outras conversas e os pacotes de controle ficam', async () => {
    const banco = await bancoNovo();
    for (const texto of ['um', 'dois', 'três']) await guardar(banco, mensagem(ALICE, texto));
    const doBob = await guardar(banco, mensagem(BOB, 'um do bob'));
    // Um controle (confirmação de leitura) para a Alice: não é mensagem, continua saindo.
    await enfileirar(banco, ALICE, null, new Uint8Array(TAMANHO_DO_PACOTE), 0);

    const apagadas = await banco.transacao((t) => apagarDeVerdade(t, { conversa: ALICE }));

    expect(apagadas).toBe(3);
    expect(await textos(banco, 'um')).toEqual(['um do bob']);
    const fila = await banco.consultar('SELECT contato, mensagem FROM fila ORDER BY ordem');
    expect(fila).toEqual([
      { contato: BOB, mensagem: doBob.id },
      { contato: ALICE, mensagem: null },
    ]);
  });

  it('a conversa inteira leva as notas de sistema dela; as de outra conversa ficam', async () => {
    const banco = await bancoNovo();
    await guardar(banco, mensagem(ALICE, 'com nota'));
    await guardarNota(banco, ALICE, {
      tipo: 'timer',
      segundos: 3600,
      anteriores: false,
      instante: 2,
    });
    await guardarNota(banco, ALICE, { tipo: 'expirou', instante: 3 });
    await guardarNota(banco, BOB, { tipo: 'expirou', instante: 4 });

    await banco.transacao((t) => apagarDeVerdade(t, { conversa: ALICE }));

    expect(await banco.consultar('SELECT conversa, tipo FROM notas')).toEqual([
      { conversa: BOB, tipo: 'expirou' },
    ]);
  });

  it('apagada a caminho do relay: a próxima mensagem, com a mesma ordem na fila, continua lá', async () => {
    const banco = await bancoNovo();
    const apagada = await guardar(banco, mensagem(ALICE, 'a caminho'));
    // O correio leu o item e foi ao relay; enquanto isso, a mensagem sai e outra entra.
    const [lido] = await itensDaFila(banco);
    if (!lido) throw new Error('fila vazia');
    await banco.transacao((t) => apagarDeVerdade(t, { mensagens: [apagada.id] }));
    const outra = mensagem(ALICE, 'nova');
    await guardarMensagem(banco, outra);
    await enfileirar(banco, ALICE, outra.id, cripto.randombytes_buf(TAMANHO_DO_PACOTE), 0);
    const [nova] = await itensDaFila(banco);
    expect(nova?.ordem).toBe(lido.ordem);

    // A volta do relay com o item antigo não mexe no novo.
    await adiar(banco, lido, 0);
    await tirarDaFila(banco, lido);
    expect(await itensDaFila(banco)).toEqual([nova]);
  });

  it('ID que não existe não muda nada; ID de tamanho errado é recusado', async () => {
    const banco = await bancoNovo();
    await guardar(banco, mensagem(ALICE, 'fica'));
    expect(await apagarDeVerdade(banco, { mensagens: [cripto.randombytes_buf(16)] })).toBe(0);
    expect(await apagarDeVerdade(banco, { conversa: BOB })).toBe(0);
    await expect(apagarDeVerdade(banco, { mensagens: [new Uint8Array(15)] })).rejects.toThrow();
    await expect(apagarDeVerdade(banco, { conversa: new Uint8Array(9) })).rejects.toThrow();
    expect(await contar(banco, 'SELECT count(*) AS n FROM mensagens')).toBe(1);
  });

  it('roda na transação de quem chama: se ela desfaz, nada sai', async () => {
    const banco = await bancoNovo();
    const nova = await guardar(banco, mensagem(ALICE, 'continua aqui'));
    await expect(
      banco.transacao(async (t) => {
        await apagarDeVerdade(t, { mensagens: [nova.id] });
        throw new Error('falha depois de apagar');
      }),
    ).rejects.toThrow('falha depois de apagar');
    expect(await textos(banco, 'continua')).toEqual(['continua aqui']);
    expect(await contar(banco, 'SELECT count(*) AS n FROM fila')).toBe(1);
  });
});

describe('o banco só abre com o que a exclusão real exige', () => {
  it('com secure_delete, journal DELETE e temporários na memória, migra até a versão atual', async () => {
    const banco = await bancoNovo();
    expect(await contar(banco, 'SELECT user_version AS n FROM pragma_user_version')).toBe(
      VERSAO_DO_ESQUEMA,
    );
  });

  it.each([
    ['PRAGMA secure_delete = OFF', 'secure_delete'],
    ['PRAGMA secure_delete = FAST', 'secure_delete'],
    ['PRAGMA journal_mode = WAL', 'journal_mode'],
    ['PRAGMA temp_store = FILE', 'temp_store'],
  ])('com "%s", recusa sem migrar', async (pragma, falta) => {
    const aberto = abrirBancoDeTeste();
    abertos.push(aberto);
    await aberto.banco.executar(pragma);
    await expect(prepararBanco(aberto.banco)).rejects.toThrow(`banco sem ${falta}`);
    expect(await contar(aberto.banco, 'SELECT user_version AS n FROM pragma_user_version')).toBe(0);
  });
});
