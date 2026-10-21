import { BYTES_DO_ID } from '@cifra/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import {
  guardarMensagem,
  migrar,
  prepararBanco,
  type Armazenamento,
  type Mensagem,
} from '../src/index.ts';
import { aceitarContato, registrarPedido } from '../src/contatos/repositorio.ts';
import { buscarMensagens, consultaDaBusca, LIMITE_DA_BUSCA } from '../src/mensagens/busca.ts';
import { esconderParaApagar } from '../src/mensagens/exclusao.ts';
import { cripto } from './adaptadores/sodium-node.ts';
import { abrirBancoDeTeste, type BancoDeTeste } from './adaptadores/sqlite-node.ts';

// Busca local nas mensagens (RF-12): só o banco deste aparelho, sem rede.

const abertos: BancoDeTeste[] = [];

afterEach(() => {
  for (const aberto of abertos.splice(0)) aberto.fechar();
});

const ALICE = cripto.randombytes_buf(BYTES_DO_ID);
const BOB = cripto.randombytes_buf(BYTES_DO_ID);

/** Um banco com as mensagens recebidas, e a Alice e o Bob aceitos como contatos. */
async function bancoCom(...lista: (readonly [Uint8Array, string])[]): Promise<Armazenamento> {
  const aberto = abrirBancoDeTeste();
  abertos.push(aberto);
  await prepararBanco(aberto.banco);
  // Numa transação só: uma gravação com journal por mensagem é lenta no Windows.
  await aberto.banco.transacao(async (t) => {
    for (const contato of [ALICE, BOB]) await aceitarContato(t, contato, 0);
    for (const [conversa, texto] of lista) await guardarMensagem(t, recebida(conversa, texto));
  });
  return aberto.banco;
}

function recebida(conversa: Uint8Array, texto: string): Mensagem {
  return {
    id: cripto.randombytes_buf(16),
    conversa,
    deMim: false,
    tipo: 'texto',
    texto,
    resposta: null,
    enviadaEm: 1,
    recebidaEm: 2,
    ttl: 0,
    expiraEm: null,
    status: 'recebida',
  };
}

const textos = async (banco: Armazenamento, busca: string) =>
  (await buscarMensagens(banco, busca)).map((m) => m.texto);

describe('busca local nas mensagens (RF-12)', () => {
  it('acha sem acento e sem diferença de maiúscula', async () => {
    const banco = await bancoCom([ALICE, 'Não há café na estação'], [BOB, 'reunião às nove']);
    for (const busca of ['nao', 'CAFÉ', 'Estacao', 'cafe na']) {
      expect(await textos(banco, busca)).toEqual(['Não há café na estação']);
    }
    expect(await textos(banco, 'REUNIAO')).toEqual(['reunião às nove']);
  });

  it('acha pelo começo da palavra, e todas as palavras precisam aparecer, em qualquer ordem', async () => {
    const banco = await bancoCom(
      [ALICE, 'encontro na praça às nove'],
      [ALICE, 'encontro no café'],
      [BOB, 'praça cheia'],
    );
    expect(await textos(banco, 'enc')).toEqual(['encontro no café', 'encontro na praça às nove']);
    expect(await textos(banco, 'praç enc')).toEqual(['encontro na praça às nove']);
    expect(await textos(banco, 'encontro praia')).toEqual([]);
  });

  it('o que a pessoa digita nunca vira comando da busca', async () => {
    const banco = await bancoCom(
      [ALICE, 'alfa'],
      [ALICE, 'beta'],
      [BOB, 'o e-mail chegou'],
      [BOB, 'aspas "duplas" aqui'],
      [BOB, 'texto:campo x*y'],
    );
    // Com OR de verdade, viriam "alfa" e "beta"; aqui OR é só mais uma palavra.
    expect(await textos(banco, 'alfa OR beta')).toEqual([]);
    expect(await textos(banco, 'alfa NOT beta')).toEqual([]);
    expect(await textos(banco, 'e-mail')).toEqual(['o e-mail chegou']);
    expect(await textos(banco, '"duplas"')).toEqual(['aspas "duplas" aqui']);
    expect(await textos(banco, 'texto:campo')).toEqual(['texto:campo x*y']);
    expect(await textos(banco, 'x*y')).toEqual(['texto:campo x*y']);
    for (const busca of ['NEAR(alfa', '(', ')', '^alfa', '{alfa}', 'alfa:', '*']) {
      await expect(buscarMensagens(banco, busca)).resolves.toBeDefined();
    }
  });

  it('texto vazio ou só com símbolos não busca nada e não dá erro', async () => {
    const banco = await bancoCom([ALICE, 'qualquer coisa']);
    for (const busca of ['', '   ', '"', '-', '* " :', '❤']) {
      expect(await textos(banco, busca)).toEqual([]);
      expect(consultaDaBusca(busca)).toBeNull();
    }
  });

  it('devolve a mensagem inteira, das mais novas para as mais antigas, até o limite', async () => {
    const lista = Array.from(
      { length: LIMITE_DA_BUSCA + 5 },
      (_, i) => [i % 2 === 0 ? ALICE : BOB, `aviso ${String(i)}`] as const,
    );
    const banco = await bancoCom(...lista);
    const achadas = await buscarMensagens(banco, 'aviso');
    expect(achadas).toHaveLength(LIMITE_DA_BUSCA);
    expect(achadas[0]).toMatchObject({
      texto: `aviso ${String(LIMITE_DA_BUSCA + 4)}`,
      conversa: ALICE,
      deMim: false,
      status: 'recebida',
    });
    expect(await buscarMensagens(banco, 'aviso', null, 3)).toHaveLength(3);
  });

  it('só nos contatos aceitos e na nota pessoal: pedidos e as apagadas só neste celular ficam de fora', async () => {
    const pedido = cripto.randombytes_buf(BYTES_DO_ID);
    const eu = cripto.randombytes_buf(BYTES_DO_ID);
    const escondida = recebida(ALICE, 'aviso escondido');
    const banco = await bancoCom(
      [ALICE, 'aviso do contato'],
      [pedido, 'aviso do pedido'],
      [eu, 'aviso da nota'],
    );
    await guardarMensagem(banco, escondida);
    await esconderParaApagar(banco, ALICE, [escondida.id], 1);
    await registrarPedido(banco, pedido, 0);

    expect(await textos(banco, 'aviso')).toEqual(['aviso do contato']);
    const comANota = await buscarMensagens(banco, 'aviso', eu);
    expect(comANota.map((m) => m.texto)).toEqual(['aviso da nota', 'aviso do contato']);
  });

  it('as mensagens de antes da busca existir entram no índice na migração', async () => {
    const aberto = abrirBancoDeTeste();
    abertos.push(aberto);
    const { banco } = aberto;
    // Um banco no esquema 2, sem o índice, já com mensagens.
    await migrar(banco, 2);
    await banco.executar(
      `INSERT INTO mensagens (id, conversa, de_mim, texto, enviada_em, recebida_em, ttl, status)
       VALUES (?, ?, 0, 'mensagem antiga', 1, 2, 0, 'recebida')`,
      [cripto.randombytes_buf(16), ALICE],
    );

    await prepararBanco(banco);
    expect(await textos(banco, 'antiga')).toEqual(['mensagem antiga']);
  });
});
