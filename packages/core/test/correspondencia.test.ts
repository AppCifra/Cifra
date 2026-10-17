import { idDaChave, formatarId, type Cartao, type Conteudo, type Prekey } from '@cifra/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import {
  confirmarPublicacao,
  estadoDoCartao,
  planejarPublicacao,
  prepararPublicacao,
} from '../src/cartao/publicacao.ts';
import {
  aceitarContato,
  bloquearContato,
  contatoDe,
  desbloquearContato,
} from '../src/contatos/repositorio.ts';
import { gerarIdentidade, migrar, type Identidade } from '../src/index.ts';
import {
  Bloqueado,
  enfileirarConteudo,
  NaoAceito,
  receberPacote,
  recomecarComAparelhoNovo,
  SemSessao,
  type Contexto,
} from '../src/mensagens/correspondencia.ts';
import { itensDaFila, tirarDaFila } from '../src/mensagens/fila.ts';
import { mensagensDa } from '../src/mensagens/repositorio.ts';
import { guardarDestino, guardarSessoes, sessoesDe } from '../src/sessao/repositorio.ts';
import { sessaoDeQuemAbre } from '../src/sessao/sessao.ts';
import { cripto } from './adaptadores/sodium-node.ts';
import { abrirBancoDeTeste, type BancoDeTeste } from './adaptadores/sqlite-node.ts';

// Envio e recebimento no banco, sem rede (RF-13, RF-16, RNF-02): o que o correio faz entre a fila e
// o relay. O relay de verdade entra nos testes do correio.

const RELAY = 'ws://' + 'r'.repeat(56) + '.onion';
const AGORA = Date.UTC(2026, 9, 1, 12);
const bancos: BancoDeTeste[] = [];

afterEach(() => {
  for (const banco of bancos.splice(0)) banco.fechar();
});

interface Pessoa {
  readonly identidade: Identidade;
  readonly contato: Uint8Array;
  readonly banco: BancoDeTeste;
  readonly contexto: Contexto;
  readonly cartao: Cartao;
  /** As one-time prekeys publicadas, na ordem em que o relay entregaria. */
  readonly avulsas: Prekey[];
}

/** Uma pessoa com o próprio aparelho. Com `identidade`, é ela restaurada noutro aparelho. */
async function pessoa(
  identidade: Identidade = gerarIdentidade(cripto, 'portugues').identidade,
): Promise<Pessoa> {
  const banco = abrirBancoDeTeste();
  bancos.push(banco);
  await migrar(banco.banco);
  const gerarPar = () => cripto.crypto_box_keypair();
  const estado = await estadoDoCartao(banco.banco, RELAY);
  const plano = planejarPublicacao(estado, AGORA);
  if (!plano) throw new Error('esperava a primeira publicação');
  const caixa = cripto.crypto_sign_seed_keypair(cripto.randombytes_buf(32)).publicKey;
  // Como no correio, cada passo numa transação: no Windows, cada escrita solta custa um fsync.
  const preparada = await banco.banco.transacao(async (t) => {
    const pronta = await prepararPublicacao(
      cripto,
      t,
      identidade,
      caixa,
      estado,
      plano,
      AGORA,
      gerarPar,
    );
    await confirmarPublicacao(t, estado, pronta, 100, AGORA);
    return pronta;
  });
  return {
    identidade,
    contato: idDaChave(cripto, identidade.assinatura.publicKey),
    banco,
    contexto: { cripto, identidade, gerarPar },
    cartao: preparada.publicacao.cartao,
    avulsas: [...preparada.publicacao.prekeys],
  };
}

/** `de` adiciona `para`: busca o cartão e abre a sessão, como o correio faz. */
async function conhecer(de: Pessoa, para: Pessoa, comAvulsa = true): Promise<void> {
  const avulsa = comAvulsa ? (para.avulsas.shift() ?? null) : null;
  const sessao = sessaoDeQuemAbre(cripto, de.identidade, para.cartao, avulsa, de.contexto.gerarPar);
  await de.banco.banco.transacao(async (t) => {
    await guardarSessoes(t, para.contato, [sessao]);
    await guardarDestino(t, para.contato, para.cartao);
    await aceitarContato(t, para.contato, AGORA);
  });
}

let numero = 0;
function texto(mensagem: string): Conteudo {
  numero++;
  return {
    tipo: 'texto',
    id: cripto.randombytes_buf(16),
    enviadaEm: AGORA + numero,
    ttl: 0,
    texto: mensagem,
  };
}

/**
 * Cifra e tira da fila o pacote, como se o relay tivesse aceitado. Quem envia já aceitou o outro:
 * um pedido de conversa só recebe resposta depois de aceito (RF-07).
 */
async function pacote(de: Pessoa, para: Pessoa, conteudo: Conteudo): Promise<Uint8Array> {
  await de.banco.banco.transacao(async (t) => {
    await aceitarContato(t, para.contato, AGORA);
    await enfileirarConteudo(de.contexto, t, para.contato, conteudo, AGORA);
  });
  const itens = await itensDaFila(de.banco.banco);
  const ultimo = itens.at(-1);
  if (!ultimo) throw new Error('fila vazia');
  await tirarDaFila(de.banco.banco, ultimo);
  return ultimo.pacote;
}

const receber = (para: Pessoa, bytes: Uint8Array) =>
  para.banco.banco.transacao((t) => receberPacote(para.contexto, t, bytes, AGORA));

const textos = async (de: Pessoa, conversa: Pessoa) =>
  (await mensagensDa(de.banco.banco, conversa.contato)).map((m) => m.texto);

describe('envio e recebimento no banco', () => {
  it('texto vai e volta; quem recebeu responde pela sessão que a mensagem inicial abriu', async () => {
    const [alice, bob] = [await pessoa(), await pessoa()];
    await conhecer(alice, bob);
    expect(await receber(bob, await pacote(alice, bob, texto('oi')))).toMatchObject({
      tipo: 'mensagem',
    });
    await receber(alice, await pacote(bob, alice, texto('oi, alice')));
    await receber(bob, await pacote(alice, bob, texto('tudo bem')));
    expect(await textos(bob, alice)).toEqual(['oi', 'oi, alice', 'tudo bem']);
    expect(await textos(alice, bob)).toEqual(['oi', 'oi, alice', 'tudo bem']);
    const deBob = await mensagensDa(bob.banco.banco, alice.contato);
    expect(deBob.map((m) => [m.deMim, m.status])).toEqual([
      [false, 'recebida'],
      [true, 'pendente'],
      [false, 'recebida'],
    ]);
  });

  it('sem sessão com o contato, não cifra nada', async () => {
    const [alice, bob] = [await pessoa(), await pessoa()];
    await expect(
      enfileirarConteudo(alice.contexto, alice.banco.banco, bob.contato, texto('x'), AGORA),
    ).rejects.toBeInstanceOf(SemSessao);
    expect(await itensDaFila(alice.banco.banco)).toEqual([]);
  });

  it('o mesmo ID em outro pacote: a segunda vez é ignorada (RF-16)', async () => {
    const [alice, bob] = [await pessoa(), await pessoa()];
    await conhecer(alice, bob);
    const conteudo = texto('uma vez só');
    const primeiro = await pacote(alice, bob, conteudo);
    const segundo = await pacote(alice, bob, conteudo);
    expect(primeiro).not.toEqual(segundo);
    expect((await receber(bob, primeiro)).tipo).toBe('mensagem');
    expect((await receber(bob, segundo)).tipo).toBe('ignorado');
    expect(await textos(bob, alice)).toEqual(['uma vez só']);
  });

  it('o mesmo pacote de novo é descartado sem mudar nada', async () => {
    const [alice, bob] = [await pessoa(), await pessoa()];
    await conhecer(alice, bob);
    const bytes = await pacote(alice, bob, texto('oi'));
    await receber(bob, bytes);
    const antes = await sessoesDe(bob.banco.banco, alice.contato);
    expect(await receber(bob, bytes)).toEqual({ tipo: 'descartado' });
    expect(await sessoesDe(bob.banco.banco, alice.contato)).toEqual(antes);
  });

  it('a one-time prekey usada sai; a mensagem inicial guardada não reabre a sessão', async () => {
    const [alice, bob] = [await pessoa(), await pessoa()];
    const [avulsa] = bob.avulsas;
    await conhecer(alice, bob);
    const contar = async () =>
      (
        await bob.banco.banco.consultar(
          'SELECT count(*) AS n FROM prekeys_avulsas WHERE numero = ?',
          [avulsa?.numero ?? 0],
        )
      )[0]?.['n'];
    expect(await contar()).toBe(1);
    const inicial = await pacote(alice, bob, texto('primeira'));
    await receber(bob, inicial);
    expect(await contar()).toBe(0);

    // O relay guardou a mensagem inicial e entrega de novo depois que a sessão saiu da lista.
    await guardarSessoes(bob.banco.banco, alice.contato, []);
    expect(await receber(bob, inicial)).toEqual({ tipo: 'descartado' });
    expect(await sessoesDe(bob.banco.banco, alice.contato)).toEqual([]);
  });

  it('sem one-time prekey no relay, o X3DH abre a sessão só com a assinada', async () => {
    const [alice, bob] = [await pessoa(), await pessoa()];
    await conhecer(alice, bob, false);
    expect((await receber(bob, await pacote(alice, bob, texto('sem avulsa')))).tipo).toBe(
      'mensagem',
    );
  });

  it('abertura simultânea: os dois abrem sessão, tudo decifra e a conversa converge', async () => {
    const [alice, bob] = [await pessoa(), await pessoa()];
    await conhecer(alice, bob);
    await conhecer(bob, alice);
    const deAlice = await pacote(alice, bob, texto('a1'));
    const doBob = await pacote(bob, alice, texto('b1'));
    expect((await receber(bob, deAlice)).tipo).toBe('mensagem');
    expect((await receber(alice, doBob)).tipo).toBe('mensagem');
    for (let i = 2; i < 6; i++) {
      expect((await receber(bob, await pacote(alice, bob, texto(`a${i}`)))).tipo).toBe('mensagem');
      expect((await receber(alice, await pacote(bob, alice, texto(`b${i}`)))).tipo).toBe(
        'mensagem',
      );
    }
    const [atualDaAlice] = await sessoesDe(alice.banco.banco, bob.contato);
    const [atualDoBob] = await sessoesDe(bob.banco.banco, alice.contato);
    expect(atualDaAlice?.base).toEqual(atualDoBob?.base);
    expect(await textos(bob, alice)).toHaveLength(10);
  });

  it('não é deste aparelho, de sessão desconhecida ou de mim mesmo: descartado', async () => {
    const [alice, bob, carol] = [await pessoa(), await pessoa(), await pessoa()];
    await conhecer(alice, bob);
    await receber(bob, await pacote(alice, bob, texto('abre')));
    await receber(alice, await pacote(bob, alice, texto('responde')));
    // Para o Bob, mas entregue à Carol.
    expect(await receber(carol, await pacote(alice, bob, texto('para o bob')))).toEqual({
      tipo: 'descartado',
    });
    // Envelope de sessão de alguém sem sessão com o Bob.
    await conhecer(carol, alice);
    await receber(alice, await pacote(carol, alice, texto('oi alice')));
    await receber(carol, await pacote(alice, carol, texto('oi carol')));
    expect(await receber(bob, await pacote(carol, alice, texto('sessão da alice')))).toEqual({
      tipo: 'descartado',
    });
    expect(formatarId(bob.contato)).not.toBe(formatarId(alice.contato));
  });

  it('confirmação de leitura: só a da própria conversa vale, e a mensagem sai da fila', async () => {
    const [alice, bob, carol] = [await pessoa(), await pessoa(), await pessoa()];
    await conhecer(alice, bob);
    const mensagem = texto('leia');
    await enfileirarConteudo(alice.contexto, alice.banco.banco, bob.contato, mensagem, AGORA);
    const [naFila] = await itensDaFila(alice.banco.banco);
    if (!naFila) throw new Error('fila vazia');
    await receber(bob, naFila.pacote);

    // A Carol diz que leu a mensagem que a Alice mandou ao Bob: não muda nada.
    await conhecer(carol, alice);
    const daCarol: Conteudo = {
      tipo: 'leitura',
      id: cripto.randombytes_buf(16),
      enviadaEm: AGORA,
      ttl: 0,
      lidas: [mensagem.id],
    };
    expect(await receber(alice, await pacote(carol, alice, daCarol))).toMatchObject({
      tipo: 'leitura',
      lidas: [],
    });
    expect((await mensagensDa(alice.banco.banco, bob.contato))[0]?.status).toBe('pendente');

    const doBob: Conteudo = {
      tipo: 'leitura',
      id: cripto.randombytes_buf(16),
      enviadaEm: AGORA,
      ttl: 0,
      lidas: [mensagem.id],
    };
    expect(await receber(alice, await pacote(bob, alice, doBob))).toMatchObject({
      tipo: 'leitura',
      lidas: [mensagem.id],
    });
    expect((await mensagensDa(alice.banco.banco, bob.contato))[0]?.status).toBe('lida');
    expect(await itensDaFila(alice.banco.banco)).toEqual([]);
  });
});

describe('data do cartão (RNF-03)', () => {
  it('fica na hora cheia, e a seguinte na mesma hora só anda 1 ms', async () => {
    const banco = abrirBancoDeTeste();
    bancos.push(banco);
    await migrar(banco.banco);
    const { identidade } = gerarIdentidade(cripto, 'portugues');
    const caixa = cripto.crypto_sign_seed_keypair(cripto.randombytes_buf(32)).publicKey;
    const gerarPar = () => cripto.crypto_box_keypair();
    const publicar = async (agora: number) => {
      const estado = await estadoDoCartao(banco.banco, RELAY);
      const plano = estado.data === null ? planejarPublicacao(estado, agora) : null;
      return banco.banco.transacao(async (t) => {
        const pronta = await prepararPublicacao(
          cripto,
          t,
          identidade,
          caixa,
          estado,
          plano ?? { modo: 'acrescentar', novaAssinada: false, avulsas: 0 },
          agora,
          gerarPar,
        );
        await confirmarPublicacao(t, estado, pronta, 100, agora);
        return pronta.publicacao.cartao.data;
      });
    };
    const minutos = 60_000;
    expect(await publicar(AGORA + 25 * minutos + 37_123)).toBe(AGORA);
    expect(await publicar(AGORA + 40 * minutos)).toBe(AGORA + 1);
    expect(await publicar(AGORA + 61 * minutos)).toBe(AGORA + 60 * minutos);
  });
});

describe('contatos no envio e no recebimento', () => {
  it('quem não é contato vira pedido; só sai resposta depois de aceitar (RF-07)', async () => {
    const [alice, bob] = [await pessoa(), await pessoa()];
    await conhecer(alice, bob);
    expect(await receber(bob, await pacote(alice, bob, texto('oi')))).toMatchObject({
      tipo: 'mensagem',
      pedido: true,
    });
    expect(await contatoDe(bob.banco.banco, alice.contato)).toMatchObject({
      aceito: false,
      bloqueado: false,
    });
    await expect(
      enfileirarConteudo(bob.contexto, bob.banco.banco, alice.contato, texto('x'), AGORA),
    ).rejects.toBeInstanceOf(NaoAceito);
    expect(await itensDaFila(bob.banco.banco)).toEqual([]);
    expect(await receber(bob, await pacote(alice, bob, texto('oi de novo')))).toMatchObject({
      pedido: true,
    });

    await aceitarContato(bob.banco.banco, alice.contato, AGORA);
    expect(await receber(bob, await pacote(alice, bob, texto('aceito')))).toMatchObject({
      pedido: false,
    });
    expect(await textos(bob, alice)).toEqual(['oi', 'oi de novo', 'aceito']);
  });

  it('ID bloqueado: o que ele manda some sem rastro, e a sessão continua em dia (RF-08)', async () => {
    const [alice, bob] = [await pessoa(), await pessoa()];
    await conhecer(alice, bob);
    await receber(bob, await pacote(alice, bob, texto('oi')));
    await receber(alice, await pacote(bob, alice, texto('oi, alice')));

    await bloquearContato(bob.banco.banco, alice.contato, AGORA);
    for (const mensagem of ['bloqueada 1', 'bloqueada 2']) {
      expect(await receber(bob, await pacote(alice, bob, texto(mensagem)))).toEqual({
        tipo: 'ignorado',
        contato: alice.contato,
      });
    }
    expect(await textos(bob, alice)).toEqual(['oi', 'oi, alice']);
    await expect(
      enfileirarConteudo(bob.contexto, bob.banco.banco, alice.contato, texto('x'), AGORA),
    ).rejects.toBeInstanceOf(Bloqueado);

    // Desbloqueado, a conversa segue de onde estava: a catraca andou com as descartadas.
    await desbloquearContato(bob.banco.banco, alice.contato);
    expect((await receber(bob, await pacote(alice, bob, texto('de volta')))).tipo).toBe('mensagem');
    expect(await textos(bob, alice)).toEqual(['oi', 'oi, alice', 'de volta']);
  });

  it('contato que trocou de aparelho: sessão nova com o cartão novo e a fila cifrada de novo (RF-05)', async () => {
    const [alice, bob] = [await pessoa(), await pessoa()];
    await conhecer(alice, bob);
    await receber(bob, await pacote(alice, bob, texto('antes')));
    const enfileirar = (conteudo: Conteudo) =>
      alice.banco.banco.transacao((t) =>
        enfileirarConteudo(alice.contexto, t, bob.contato, conteudo, AGORA),
      );
    await enfileirar(texto('pendente 1'));
    await enfileirar({
      tipo: 'leitura',
      id: cripto.randombytes_buf(16),
      enviadaEm: AGORA,
      ttl: 0,
      lidas: [cripto.randombytes_buf(16)],
    });
    await enfileirar(texto('pendente 2'));

    // O Bob restaura a identidade noutro aparelho: prekeys, caixa e cartão novos.
    const bobNovo = await pessoa(bob.identidade);
    await alice.banco.banco.transacao((t) =>
      recomecarComAparelhoNovo(
        alice.contexto,
        t,
        bob.contato,
        bobNovo.cartao,
        bobNovo.avulsas.shift() ?? null,
        AGORA,
      ),
    );
    const fila = await itensDaFila(alice.banco.banco);
    // A confirmação de leitura saiu: o aparelho novo não tem as mensagens lidas.
    expect(fila.map((item) => item.mensagem === null)).toEqual([false, false]);
    const [primeiro] = fila;
    if (!primeiro) throw new Error('fila vazia');
    expect(await receber(bob, primeiro.pacote)).toEqual({ tipo: 'descartado' });
    for (const item of fila) {
      expect(await receber(bobNovo, item.pacote)).toMatchObject({ tipo: 'mensagem' });
    }
    expect(await textos(bobNovo, alice)).toEqual(['pendente 1', 'pendente 2']);

    // A resposta do aparelho novo chega à Alice pela sessão nova.
    expect(
      await receber(alice, await pacote(bobNovo, alice, texto('do aparelho novo'))),
    ).toMatchObject({ tipo: 'mensagem' });
  });
});
