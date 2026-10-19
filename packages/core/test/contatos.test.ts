import { readFileSync } from 'node:fs';
import { idDaChave, lerId, lerPedido, utf8 } from '@cifra/protocol';
import { describe, expect, it } from 'vitest';
import {
  ErroDaAgenda,
  ErroDoCorreio,
  LIMITE_DO_APELIDO,
  type ResumoDaConversa,
} from '../src/index.ts';
import { MAIOR_INTERVALO } from '../src/mensagens/fila.ts';
import { cripto } from './adaptadores/sodium-node.ts';
import {
  andarAte,
  ate,
  avancarAte,
  conversa,
  online,
  pedidos,
  pessoa,
  redeParada,
  relay,
  relogio,
  status,
  textos,
  type Pessoa,
} from './correio-de-teste.ts';

// Contatos contra o relay de verdade: adicionar pelo ID (RF-06), pedidos (RF-07), bloqueio
// (RF-08), apelido (RF-09), lista (RF-11), busca (RF-12), nota pessoal (RF-19), número de
// segurança (RF-37) e verificação (RF-38).

const codigo = (promessa: Promise<unknown>) =>
  promessa.then(
    () => 'aceito',
    (erro: unknown) =>
      erro instanceof ErroDoCorreio || erro instanceof ErroDaAgenda ? erro.codigo : 'outro',
  );

const tipos = (p: Pessoa) => pedidos(p).map(({ pedido }) => pedido.tipo);
const pacotesNoRelay = () => relay.consultar('SELECT count(*) AS n FROM pacotes')[0]?.['n'];
const idsDe = (lista: readonly { readonly id: string }[]) => lista.map(({ id }) => id);
const depositos = (p: Pessoa) =>
  pedidos(p).filter(({ pedido }) => pedido.tipo === 'depositar').length;
const contar = async (p: Pessoa, tabela: 'fila' | 'anexos') =>
  Number((await p.banco.banco.consultar(`SELECT count(*) AS n FROM ${tabela}`))[0]?.['n']);

/** A Alice adiciona o Bob e escreve; o Bob recebe um pedido de conversa. */
async function pedidoDaAlice(texto = 'oi, sou a alice'): Promise<[Pessoa, Pessoa]> {
  const [alice, bob] = [await pessoa(), await pessoa()];
  await online(alice, bob);
  await alice.correio.iniciarConversa(bob.id);
  await alice.correio.enviarTexto(bob.id, texto);
  await ate(async () => (await textos(bob, alice)).length === 1, 'bob recebe o pedido');
  return [alice, bob];
}

describe('adicionar contato pelo ID (RF-06)', () => {
  it('o cartão é buscado e conferido antes da primeira mensagem, e o contato entra aceito', async () => {
    const [alice, bob] = [await pessoa(), await pessoa()];
    await online(alice, bob);
    expect(await alice.agenda.conversa(bob.id)).toBeNull();

    // Colado com espaços e minúsculas, como vem de outro app.
    await alice.correio.iniciarConversa(` ${bob.id.toLowerCase()} `);
    expect(tipos(alice)).toContain('buscar-cartao');
    expect(tipos(alice)).not.toContain('depositar');
    expect(await alice.agenda.conversa(bob.id)).toMatchObject({
      tipo: 'contato',
      apelido: null,
      verificado: false,
      bloqueado: false,
      ultima: null,
    });
    expect(idsDe(await alice.agenda.conversas())).toContain(bob.id);
  });

  it('cartão que não confere com o ID, ou adulterado: nenhum contato, nenhuma sessão', async () => {
    const [alice, bob, carol] = [await pessoa(), await pessoa(), await pessoa()];
    await online(alice, bob);
    const doBob = idDaChave(cripto, bob.identidade.assinatura.publicKey);
    const [guardado] = relay.consultar(
      'SELECT cartao, data, expira_em FROM cartoes WHERE id = ?',
      doBob,
    );
    if (!guardado) throw new Error('sem cartão do bob');
    const cartao = guardado['cartao'] as Uint8Array;

    // O relay entrega, para o ID da Carol, o cartão do Bob: assinatura válida, outro ID.
    relay.adulterar(
      'INSERT INTO cartoes (id, cartao, data, expira_em) VALUES (?, ?, ?, ?)',
      idDaChave(cripto, carol.identidade.assinatura.publicKey),
      cartao,
      guardado['data'] as number,
      guardado['expira_em'] as number,
    );
    expect(await codigo(alice.correio.iniciarConversa(carol.id))).toBe('cartao-invalido');

    // E, para o ID do Bob, o cartão dele com um byte trocado: a assinatura não confere.
    const adulterado = Uint8Array.from(cartao);
    adulterado[40] = (adulterado[40] ?? 0) ^ 1;
    relay.adulterar('UPDATE cartoes SET cartao = ? WHERE id = ?', adulterado, doBob);
    expect(await codigo(alice.correio.iniciarConversa(bob.id))).toBe('cartao-invalido');

    for (const id of [carol.id, bob.id]) {
      expect(await alice.agenda.conversa(id)).toBeNull();
      expect(await codigo(alice.correio.enviarTexto(id, 'oi'))).toBe('sem-sessao');
    }
  });
});

describe('pedidos de conversa (RF-07)', () => {
  it('quem não é contato fica numa área à parte: fora da lista e da busca', async () => {
    const [alice, bob] = await pedidoDaAlice();
    expect(bob.eventos).toContainEqual(
      expect.objectContaining({ tipo: 'mensagem', conversa: alice.id, pedido: true }),
    );
    expect(idsDe(await bob.agenda.conversas())).not.toContain(alice.id);
    const [pedido] = await bob.agenda.pedidos();
    expect(pedido).toMatchObject({ id: alice.id, tipo: 'pedido', naoLidas: 1 });
    expect(pedido?.ultima?.texto).toBe('oi, sou a alice');
    expect(await bob.agenda.buscar('alice')).toEqual({ conversas: [], mensagens: [] });
  });

  it('sem confirmação de leitura nem resposta até aceitar; aceito, vira contato', async () => {
    const [alice, bob] = await pedidoDaAlice();
    const [deAlice] = await alice.agenda.mensagens(bob.id);
    if (!deAlice) throw new Error('sem mensagem');
    await ate(async () => (await status(alice, bob, deAlice.id)) === 'enviada', 'relay aceita');

    // Ler o pedido não avisa quem escreveu, mesmo com a confirmação ligada.
    await bob.correio.marcarLidas(alice.id, true);
    await redeParada();
    expect(tipos(bob)).not.toContain('depositar');
    expect((await bob.agenda.pedidos())[0]?.naoLidas).toBe(0);
    expect(await codigo(bob.correio.enviarTexto(alice.id, 'oi'))).toBe('nao-aceito');

    await bob.agenda.aceitar(alice.id);
    expect(await bob.agenda.pedidos()).toEqual([]);
    expect(idsDe(await bob.agenda.conversas())).toContain(alice.id);
    await bob.correio.enviarTexto(alice.id, 'oi, alice');
    await ate(async () => (await textos(alice, bob)).includes('oi, alice'), 'alice recebe');
    // A leitura de antes de aceitar não volta: a mensagem continua só enviada.
    expect(await status(alice, bob, deAlice.id)).toBe('enviada');
  });

  it('recusar apaga as mensagens de verdade; se escrever de novo, é outro pedido', async () => {
    const [alice, bob] = await pedidoDaAlice('segredo do pedido recusado');
    await bob.agenda.recusar(alice.id);
    expect(await bob.agenda.pedidos()).toEqual([]);
    expect(await textos(bob, alice)).toEqual([]);
    const restos = await bob.banco.banco.consultar(
      "SELECT count(*) AS n FROM busca WHERE busca MATCH 'recusado'",
    );
    expect(restos).toEqual([{ n: 0 }]);
    const arquivo = readFileSync(bob.banco.caminho);
    expect(arquivo.includes(Buffer.from(utf8('segredo do pedido recusado')))).toBe(false);

    await alice.correio.enviarTexto(bob.id, 'de novo');
    await ate(async () => (await bob.agenda.pedidos()).length === 1, 'outro pedido');
    expect(await textos(bob, alice)).toEqual(['de novo']);
  });

  it('bloquear um pedido apaga as mensagens; o que vier depois some sem aviso', async () => {
    const [alice, bob] = await pedidoDaAlice();
    await bob.agenda.bloquear(alice.id);
    expect(await bob.agenda.pedidos()).toEqual([]);
    expect(idsDe(await bob.agenda.bloqueados())).toEqual([alice.id]);
    expect(await textos(bob, alice)).toEqual([]);

    const eventos = bob.eventos.length;
    const id = await alice.correio.enviarTexto(bob.id, 'depois do bloqueio');
    await ate(() => pacotesNoRelay() === 0 && bob.eventos.length === eventos, 'relay entrega');
    await ate(async () => (await status(alice, bob, id)) === 'enviada', 'relay aceita');
    await redeParada();
    expect(await textos(bob, alice)).toEqual([]);
    expect(await bob.agenda.pedidos()).toEqual([]);

    // Desbloqueado, o ID volta a ser desconhecido: se escrever, é um pedido novo.
    await bob.agenda.desbloquear(alice.id);
    expect(await bob.agenda.bloqueados()).toEqual([]);
    await alice.correio.enviarTexto(bob.id, 'outra vez');
    await ate(async () => (await bob.agenda.pedidos()).length === 1, 'pedido novo');
    expect(await textos(bob, alice)).toEqual(['outra vez']);
  });
});

describe('bloquear e desbloquear (RF-08)', () => {
  it('as mensagens de um contato bloqueado somem sem aviso a ele; desbloqueado, a conversa segue', async () => {
    const [alice, bob] = await conversa();
    await bob.agenda.bloquear(alice.id);
    // O contato fica na lista, com o histórico.
    expect(await bob.agenda.conversa(alice.id)).toMatchObject({ tipo: 'contato', bloqueado: true });
    expect(await textos(bob, alice)).toEqual(['oi', 'oi, alice']);
    expect(await codigo(bob.correio.enviarTexto(alice.id, 'x'))).toBe('bloqueado');
    expect(await codigo(bob.correio.iniciarConversa(alice.id))).toBe('bloqueado');

    const id = await alice.correio.enviarTexto(bob.id, 'bloqueada');
    await ate(() => pacotesNoRelay() === 0, 'relay entrega e o bob confirma');
    await ate(async () => (await status(alice, bob, id)) === 'enviada', 'relay aceita');
    await redeParada();
    expect(await textos(bob, alice)).toEqual(['oi', 'oi, alice']);
    expect(bob.eventos.filter((e) => e.tipo === 'mensagem')).toHaveLength(1);

    await bob.agenda.desbloquear(alice.id);
    await alice.correio.enviarTexto(bob.id, 'de volta');
    await ate(async () => (await textos(bob, alice)).includes('de volta'), 'bob recebe');
    await bob.correio.enviarTexto(alice.id, 'voltei');
    await avancarAte(async () => (await textos(alice, bob)).includes('voltei'), 'alice recebe');
  });

  it('nada da fila sai depois do bloqueio; as minhas que não saíram somem de verdade', async () => {
    const [alice, bob] = await conversa();
    await alice.correio.enviarTexto(bob.id, 'lida antes do bloqueio');
    await ate(async () => (await textos(bob, alice)).length === 3, 'bob recebe');
    // Os depósitos do Bob se perdem no caminho: tudo espera na fila.
    let perder = true;
    bob.transporte.perderAoEnviar = (dados) => {
      const leitura = lerPedido(dados);
      return perder && leitura.ok && leitura.pedido.tipo === 'depositar';
    };
    await bob.correio.marcarLidas(alice.id, true);
    await bob.correio.enviarTexto(alice.id, 'não sai');
    await bob.correio.enviarAnexo(alice.id, {
      arquivo: 'documento',
      formato: 'application/pdf',
      bytes: cripto.randombytes_buf(3_000),
    });
    expect(await contar(bob, 'fila')).toBe(3);

    await bob.agenda.bloquear(alice.id);
    expect(await contar(bob, 'fila')).toBe(0);
    expect(await contar(bob, 'anexos')).toBe(0);
    expect(await textos(bob, alice)).toEqual(['oi', 'oi, alice', 'lida antes do bloqueio']);

    perder = false;
    const antes = depositos(bob);
    await andarAte(relogio.agora() + MAIOR_INTERVALO + 5_000);
    expect(depositos(bob)).toBe(antes);
    expect(await textos(alice, bob)).toEqual(['oi', 'oi, alice', 'lida antes do bloqueio']);
    expect((await alice.correio.mensagens(bob.id)).at(-1)?.status).toBe('enviada');
  });

  it('bloquear no meio de uma entrega segura os pacotes seguintes', async () => {
    const [alice, bob] = await conversa();
    let perder = true;
    // Atribuído dentro do gancho: sem o `as`, o TypeScript acharia que continua nulo.
    let bloqueio = null as Promise<void> | null;
    bob.transporte.perderAoEnviar = (dados) => {
      const leitura = lerPedido(dados);
      if (!leitura.ok || leitura.pedido.tipo !== 'depositar') return false;
      if (perder) return true;
      // O primeiro pacote vai, e o bloqueio chega enquanto ele está a caminho.
      bloqueio ??= bob.agenda.bloquear(alice.id);
      return false;
    };
    for (const texto of ['primeira', 'segunda', 'terceira']) {
      await bob.correio.enviarTexto(alice.id, texto);
    }
    expect(await contar(bob, 'fila')).toBe(3);

    perder = false;
    const antes = depositos(bob);
    await avancarAte(() => bloqueio !== null, 'a entrega recomeça');
    await bloqueio;
    await andarAte(relogio.agora() + MAIOR_INTERVALO + 5_000);
    expect(depositos(bob) - antes).toBe(1);
    expect(await textos(alice, bob)).toEqual(['oi', 'oi, alice', 'primeira']);
  });

  it('depois que o bloqueio termina, nenhum depósito começa', async () => {
    const [alice, bob] = await conversa();
    let perder = true;
    bob.transporte.perderAoEnviar = (dados) => {
      const leitura = lerPedido(dados);
      return perder && leitura.ok && leitura.pedido.tipo === 'depositar';
    };
    await bob.correio.enviarTexto(alice.id, 'a caminho');
    // O bloqueio é pedido enquanto a entrega confere o item, logo antes de depositar: o depósito
    // sai antes de o bloqueio começar, ou não sai.
    let depositosAoBloquear = null as Promise<number> | null;
    const { banco } = bob.banco;
    const consultar = banco.consultar.bind(banco);
    banco.consultar = (sql, parametros) => {
      if (!perder && !depositosAoBloquear && sql.startsWith('SELECT 1 AS existe FROM fila')) {
        depositosAoBloquear = bob.agenda.bloquear(alice.id).then(() => depositos(bob));
      }
      return consultar(sql, parametros);
    };

    perder = false;
    await avancarAte(() => depositosAoBloquear !== null, 'a entrega recomeça');
    const aoBloquear = await depositosAoBloquear;
    await andarAte(relogio.agora() + MAIOR_INTERVALO + 5_000);
    expect(depositos(bob)).toBe(aoBloquear);
  });
});

describe('apelido (RF-09)', () => {
  it('o apelido nunca sai do aparelho: nenhum pedido ao relay, nada na fila', async () => {
    const [alice, bob] = await conversa();
    await redeParada();
    const antes = pedidos(alice).length;
    await alice.agenda.renomear(bob.id, '  Bob da praça  ');
    await redeParada();
    expect(pedidos(alice)).toHaveLength(antes);
    expect(await alice.banco.banco.consultar('SELECT count(*) AS n FROM fila')).toEqual([{ n: 0 }]);
    expect(await alice.agenda.conversa(bob.id)).toMatchObject({ apelido: 'Bob da praça' });
    // Do outro lado, nada muda.
    expect(await bob.agenda.conversa(alice.id)).toMatchObject({ apelido: null });

    expect(await codigo(alice.agenda.renomear(bob.id, 'x'.repeat(LIMITE_DO_APELIDO + 1)))).toBe(
      'apelido-invalido',
    );
    expect(await codigo(alice.agenda.renomear(bob.id, 'linha\nquebrada'))).toBe('apelido-invalido');
    await alice.agenda.renomear(bob.id, 'é'.repeat(LIMITE_DO_APELIDO));
    await alice.agenda.renomear(bob.id, '   ');
    expect(await alice.agenda.conversa(bob.id)).toMatchObject({ apelido: null });
    expect(await codigo(alice.agenda.renomear(alice.id, 'eu'))).toBe('proprio-id');
  });
});

describe('lista de conversas (RF-11)', () => {
  it('cada conversa traz o que a linha mostra, e a mais recente vem primeiro', async () => {
    const [alice, bob] = await conversa();
    const carol = await pessoa();
    await online(carol);
    await alice.correio.iniciarConversa(carol.id);
    await alice.agenda.verificar(carol.id, true);
    await bob.correio.enviarTexto(alice.id, 'uma');
    await bob.correio.enviarTexto(alice.id, 'duas');
    await avancarAte(async () => (await textos(alice, bob)).length === 4, 'alice recebe');

    const lista = await alice.agenda.conversas();
    expect(idsDe(lista)).toEqual([bob.id, carol.id, alice.id]);
    const [comBob, comCarol, nota] = lista;
    // A resposta da abertura da conversa e as duas novas: nenhuma foi lida.
    expect(comBob).toMatchObject({ tipo: 'contato', verificado: false, naoLidas: 3 });
    expect(comBob?.ultima).toMatchObject({ texto: 'duas', deMim: false });
    expect(comCarol).toMatchObject({ verificado: true, naoLidas: 0, ultima: null });
    expect(nota).toMatchObject({ tipo: 'nota', ultima: null });

    await alice.agenda.marcarLidas(bob.id);
    expect((await alice.agenda.conversa(bob.id))?.naoLidas).toBe(0);
    await redeParada();
    relogio.avancar(1000);
    await alice.correio.enviarTexto(carol.id, 'oi, carol');
    expect(idsDe(await alice.agenda.conversas())[0]).toBe(carol.id);
    expect((await alice.agenda.conversa(carol.id))?.ultima).toMatchObject({
      texto: 'oi, carol',
      deMim: true,
    });
  });
});

describe('busca local (RF-12)', () => {
  it('acha pelo apelido, pelo ID e pelo conteúdo, sem rede', async () => {
    const [alice, bob] = await conversa();
    await alice.agenda.renomear(bob.id, 'Bóris');
    await alice.agenda.escreverNota('reunião na estação');
    await alice.correio.parar();
    await relay.derrubar();

    expect(idsDe((await alice.agenda.buscar('boris')).conversas)).toEqual([bob.id]);
    expect(idsDe((await alice.agenda.buscar(bob.id.slice(0, 4))).conversas)).toEqual([bob.id]);
    const porConteudo = await alice.agenda.buscar('ALICE');
    expect(
      porConteudo.mensagens.map(({ mensagem, conversa: c }) => [mensagem.texto, c.id]),
    ).toEqual([['oi, alice', bob.id]]);
    const naNota = await alice.agenda.buscar('estacao');
    expect(naNota.mensagens.map(({ conversa: c }) => c.tipo)).toEqual(['nota']);
    expect(await alice.agenda.buscar('   ')).toEqual({ conversas: [], mensagens: [] });
    expect(lerId(bob.id)).not.toBeNull();
  });

  it('acha pelo nome que a tela mostra: o de quem não tem apelido e o da nota pessoal', async () => {
    const [alice, bob] = await conversa();
    const nomeDe = (resumo: ResumoDaConversa) =>
      resumo.tipo === 'nota' ? 'nota pessoal' : (resumo.apelido ?? `anon·${resumo.id.slice(0, 4)}`);
    const buscar = async (texto: string) =>
      idsDe((await alice.agenda.buscar(texto, nomeDe)).conversas);

    expect(await buscar(`anon·${bob.id.slice(0, 4)}`)).toEqual([bob.id]);
    expect(await buscar(`ANON ${bob.id.slice(0, 4).toLowerCase()}`)).toEqual([bob.id]);
    expect(await buscar('anon')).toEqual([bob.id]);
    expect(await buscar('nota pes')).toEqual([alice.id]);
    // Sem o nome da tela, como antes: só o apelido e o ID.
    expect(idsDe((await alice.agenda.buscar('anon')).conversas)).toEqual([]);
    // Com apelido, o nome é o apelido.
    await alice.agenda.renomear(bob.id, 'Bóris');
    expect(await buscar('anon')).toEqual([]);
    expect(await buscar('bóris')).toEqual([bob.id]);
    expect(await buscar('·')).toEqual([]);
  });
});

describe('nota pessoal (RF-19)', () => {
  it('nada dela sai do aparelho', async () => {
    const alice = await pessoa();
    await online(alice);
    await redeParada();
    const antes = pedidos(alice).length;
    const texto = 'lembrete: trocar a senha do roteador';
    await alice.agenda.escreverNota(texto);
    await redeParada();

    expect(pedidos(alice)).toHaveLength(antes);
    expect(await alice.banco.banco.consultar('SELECT count(*) AS n FROM fila')).toEqual([{ n: 0 }]);
    expect(relay.bytesDoBanco().includes(Buffer.from(utf8(texto)))).toBe(false);
    expect(await textos(alice, alice)).toEqual([texto]);
    expect((await alice.agenda.conversas())[0]).toMatchObject({ tipo: 'nota', id: alice.id });
    expect(await codigo(alice.correio.enviarTexto(alice.id, 'x'))).toBe('proprio-id');
    expect(await codigo(alice.correio.iniciarConversa(alice.id))).toBe('proprio-id');
    expect(await codigo(alice.agenda.escreverNota(''))).toBe('texto-invalido');
  });
});

describe('número de segurança (RF-37) e verificação (RF-38)', () => {
  it('os dois aparelhos mostram o mesmo número; o selo aparece na lista e na conversa', async () => {
    const [alice, bob] = await conversa();
    const visto = await alice.agenda.numeroDeSeguranca(bob.id);
    expect(visto).toHaveLength(12);
    expect(await bob.agenda.numeroDeSeguranca(alice.id)).toEqual(visto);

    await alice.agenda.verificar(bob.id, true);
    expect((await alice.agenda.conversas()).find(({ id }) => id === bob.id)?.verificado).toBe(true);
    expect((await alice.agenda.conversa(bob.id))?.verificado).toBe(true);
    await alice.agenda.verificar(bob.id, false);
    expect((await alice.agenda.conversa(bob.id))?.verificado).toBe(false);

    const estranho = await pessoa();
    expect(await codigo(alice.agenda.numeroDeSeguranca(estranho.id))).toBe('desconhecido');
    expect(await codigo(alice.agenda.verificar(estranho.id, true))).toBe('desconhecido');
    expect(await codigo(alice.agenda.numeroDeSeguranca(alice.id))).toBe('proprio-id');
  });
});
