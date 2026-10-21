import {
  cartaoAutentico,
  idDaChave,
  idDoCartao,
  JANELA_DE_ENTREGA,
  lerMensagemDoRelay,
  lerPedido,
  TAMANHO_DO_PACOTE,
  utf8,
} from '@cifra/protocol';
import { describe, expect, it } from 'vitest';
import { apagarDeVerdade, CIRCUITO_DA_CAIXA, ErroDoCorreio } from '../src/index.ts';
import { ConexaoComORelay } from '../src/relay/conexao.ts';
import { cripto } from './adaptadores/sodium-node.ts';
import {
  ate,
  avancarAte,
  conversa,
  DIA,
  HORA,
  online,
  pedidos,
  pessoa,
  relay,
  RELAY,
  relogio,
  status,
  subir,
  textos,
  transporte,
} from './correio-de-teste.ts';
import { LIVRE, TAXAS_LIVRES } from './relay.ts';

// O correio contra o relay de verdade (apps/relay), no mesmo processo: RF-04, RF-13 a RF-16 e
// RNF-03, RNF-04 e RNF-12. O cenário (pessoas, relay e relógio do teste) está em
// correio-de-teste.ts.

describe('cartão no relay (RF-04)', () => {
  it('publica o cartão: quem busca confere assinaturas e ID e recebe uma one-time prekey', async () => {
    const alice = await pessoa();
    await online(alice);
    expect(alice.eventos).toContainEqual({ tipo: 'cartao', prekeysNoRelay: 100 });

    const busca = await ConexaoComORelay.abrir(transporte(), relay.endereco, 'teste', relogio);
    const id = idDaChave(cripto, alice.identidade.assinatura.publicKey);
    const resposta = await busca.pedir({ tipo: 'buscar-cartao', id });
    await busca.fechar();
    if (resposta.tipo !== 'cartao-encontrado') throw new Error('sem cartão');
    expect(cartaoAutentico(cripto, resposta.cartao)).toBe(true);
    expect(idDoCartao(cripto, resposta.cartao)).toEqual(id);
    expect(resposta.cartao.caixaPrincipal).toEqual(alice.caixa);
    expect(resposta.cartao.relays).toEqual([RELAY]);
    expect(resposta.prekey).not.toBeNull();
    expect(relay.consultar('SELECT count(*) AS n FROM prekeys')).toEqual([{ n: 99 }]);
  });

  it('repõe as one-time prekeys quando acabam, e a reposta abre sessão', async () => {
    const [alice, bob] = [await pessoa(), await pessoa()];
    await online(alice, bob);
    const busca = await ConexaoComORelay.abrir(transporte(), relay.endereco, 'teste', relogio);
    const id = idDaChave(cripto, alice.identidade.assinatura.publicKey);
    for (let i = 0; i < 100; i++) await busca.pedir({ tipo: 'buscar-cartao', id });
    const vazia = await busca.pedir({ tipo: 'buscar-cartao', id });
    await busca.fechar();
    expect(vazia.tipo === 'cartao-encontrado' && vazia.prekey).toBe(null);

    // Com a caixa aberta, o correio confere o cartão a cada hora e renova depois de 24 h.
    await avancarAte(
      () => alice.eventos.filter((e) => e.tipo === 'cartao').length >= 2,
      'renovação',
      HORA,
    );
    const daAlice = () =>
      relay.consultar('SELECT count(*) AS n FROM prekeys WHERE cartao = ?', id)[0]?.['n'];
    await ate(() => daAlice() === 100, 'reposição');
    expect(alice.eventos.filter((e) => e.tipo === 'cartao')).toEqual([
      { tipo: 'cartao', prekeysNoRelay: 100 },
      { tipo: 'cartao', prekeysNoRelay: 0 },
      { tipo: 'cartao', prekeysNoRelay: 100 },
    ]);

    await bob.correio.iniciarConversa(alice.id);
    await bob.correio.enviarTexto(alice.id, 'com prekey nova');
    await ate(async () => (await textos(alice, bob)).includes('com prekey nova'), 'alice recebe');
  }, 60_000);

  it('a prekey assinada muda em 7 dias; a substituída abre sessão por mais 30', async () => {
    const [alice, bob] = [await pessoa(), await pessoa()];
    await online(alice, bob);
    // O Bob busca o cartão agora e só escreve depois da troca.
    await bob.correio.iniciarConversa(alice.id);
    await alice.correio.parar();
    relogio.avancar(7 * DIA);
    await online(alice);
    const assinadas = () =>
      alice.banco.banco.consultar(
        'SELECT numero, substituida_em FROM prekeys_assinadas ORDER BY numero',
      );
    await ate(async () => (await assinadas()).length === 2, 'prekey assinada nova');
    const [antiga] = await assinadas();
    expect(antiga?.['substituida_em']).toBe(relogio.agora());

    await bob.correio.enviarTexto(alice.id, 'com o cartão de antes');
    await ate(async () => (await textos(alice, bob)).length === 1, 'alice recebe com a antiga');

    await alice.correio.parar();
    relogio.avancar(31 * DIA);
    await online(alice);
    await ate(
      async () => !(await assinadas()).some((linha) => linha['numero'] === antiga?.['numero']),
      'a antiga sai depois de 30 dias',
    );
    expect(await alice.banco.banco.consultar('SELECT count(*) AS n FROM bases_vistas')).toEqual([
      { n: 0 },
    ]);
  }, 60_000);
});

describe('mensagens de ponta a ponta (RF-13, RNF-03, RNF-04)', () => {
  it('Alice e Bob conversam pelo relay; quem não conhecia recebe e responde', async () => {
    const [alice, bob] = await conversa();
    await alice.correio.enviarTexto(bob.id, 'encontro na praça às nove');
    await ate(async () => (await textos(bob, alice)).length === 3, 'bob recebe');
    expect(await textos(bob, alice)).toEqual(['oi', 'oi, alice', 'encontro na praça às nove']);
    expect(bob.eventos).toContainEqual(
      expect.objectContaining({ tipo: 'mensagem', conversa: alice.id }),
    );
  });

  it('o relay só recebe pacotes de 4096 bytes; a caixa e cada contato têm o próprio circuito', async () => {
    const [alice, bob] = await conversa();
    const carol = await pessoa();
    await online(carol);
    await alice.correio.iniciarConversa(carol.id);
    await alice.correio.enviarTexto(carol.id, 'oi, carol');
    await ate(async () => (await textos(carol, alice)).length === 1, 'carol recebe');

    for (const p of [alice, bob]) {
      const lista = pedidos(p);
      const depositos = lista.filter(({ pedido }) => pedido.tipo === 'depositar');
      expect(depositos.length).toBeGreaterThan(0);
      for (const { pedido } of depositos) {
        if (pedido.tipo === 'depositar') expect(pedido.pacote).toHaveLength(TAMANHO_DO_PACOTE);
      }
      // Na conexão da caixa só a caixa e o próprio cartão (publicado e, antes da primeira
      // publicação, buscado); depósito e busca do cartão de outro vão por outro circuito.
      const meuId = idDaChave(cripto, p.identidade.assinatura.publicKey);
      for (const { circuito, pedido } of lista) {
        const daCaixa =
          ['criar-caixa', 'publicar-cartao', 'abrir-caixa', 'confirmar'].includes(pedido.tipo) ||
          (pedido.tipo === 'buscar-cartao' && pedido.id.every((byte, i) => byte === meuId[i]));
        expect(circuito === CIRCUITO_DA_CAIXA).toBe(daCaixa);
      }
    }
    const circuitosDaAlice = new Set(
      pedidos(alice)
        .filter(({ pedido }) => pedido.tipo === 'depositar')
        .map(({ circuito }) => circuito),
    );
    expect(circuitosDaAlice.size).toBe(2);
  });

  it('no banco do relay: só pacotes de 4096 bytes, sem texto, sem remetente', async () => {
    const [alice, bob] = await conversa();
    await bob.correio.parar();
    const segredo = 'apague depois de ler · ação';
    const id = await alice.correio.enviarTexto(bob.id, segredo);
    await ate(async () => (await status(alice, bob, id)) === 'enviada', 'relay aceita');

    // Nenhum texto em claro no arquivo, nem o que já foi entregue e apagado.
    const dump = relay.bytesDoBanco();
    for (const texto of [segredo, 'oi, alice']) {
      expect(dump.includes(Buffer.from(utf8(texto)))).toBe(false);
    }
    expect(dump.toString('latin1')).not.toContain(alice.id);
    // O relay conhece a Alice pelo cartão que ela publicou, mas nada dela vai na linha do pacote.
    const remetente = alice.identidade.assinatura.publicKey;
    const linhas = relay.consultar('SELECT * FROM pacotes');
    expect(linhas).toHaveLength(1);
    for (const linha of linhas) {
      const pacote = linha['pacote'] as Uint8Array;
      expect(pacote).toHaveLength(TAMANHO_DO_PACOTE);
      const tudo = Buffer.concat(
        Object.values(linha).map((valor) =>
          valor instanceof Uint8Array ? Buffer.from(valor) : Buffer.from(String(valor)),
        ),
      );
      expect(tudo.includes(Buffer.from(idDaChave(cripto, remetente)))).toBe(false);
      expect(tudo.includes(Buffer.from(remetente))).toBe(false);
    }

    await online(bob);
    await ate(async () => (await textos(bob, alice)).includes(segredo), 'bob recebe');
    await ate(
      () => relay.consultar('SELECT count(*) AS n FROM pacotes')[0]?.['n'] === 0,
      'relay apaga',
    );
  });

  it('pedidos que o correio recusa: ID inválido, o próprio, sem cartão, sem sessão, texto fora', async () => {
    const [alice, bob] = [await pessoa(), await pessoa()];
    await online(alice);
    const codigo = (promessa: Promise<unknown>) =>
      promessa.then(
        () => 'aceito',
        (erro: unknown) => (erro instanceof ErroDoCorreio ? erro.codigo : 'outro'),
      );
    expect(await codigo(alice.correio.iniciarConversa('nao-e-id'))).toBe('id-invalido');
    expect(await codigo(alice.correio.iniciarConversa(alice.id))).toBe('proprio-id');
    expect(await codigo(alice.correio.iniciarConversa(bob.id))).toBe('cartao-inexistente');
    expect(await codigo(alice.correio.enviarTexto(bob.id, 'oi'))).toBe('sem-sessao');
    await online(bob);
    await alice.correio.iniciarConversa(bob.id);
    expect(await codigo(alice.correio.enviarTexto(bob.id, ''))).toBe('texto-invalido');
    expect(await codigo(alice.correio.enviarTexto(bob.id, 'x'.repeat(3501)))).toBe(
      'texto-invalido',
    );
    expect(await codigo(alice.correio.enviarTexto(bob.id, 'a\ud800'))).toBe('texto-invalido');
    expect(await codigo(alice.correio.enviarTexto(bob.id, 'é'.repeat(1750)))).toBe('aceito');
  });
});

describe('status e fila de saída (RF-14, RF-15, RNF-12)', () => {
  it('pendente até o relay aceitar, enviada depois, lida quando o contato confirma', async () => {
    const [alice, bob] = await conversa();
    await relay.derrubar();
    await ate(() => alice.eventos.some((e) => e.tipo === 'caixa' && !e.aberta), 'alice cai');
    const id = await alice.correio.enviarTexto(bob.id, 'vai esperar');
    expect(await status(alice, bob, id)).toBe('pendente');

    await relay.voltar();
    await avancarAte(async () => (await status(alice, bob, id)) === 'enviada', 'enviada');
    await avancarAte(async () => (await textos(bob, alice)).includes('vai esperar'), 'bob recebe');

    await bob.correio.marcarLidas(alice.id, true);
    await ate(async () => (await status(alice, bob, id)) === 'lida', 'lida');
    expect(alice.eventos).toContainEqual(
      expect.objectContaining({ tipo: 'status', conversa: bob.id, status: 'lida' }),
    );
    expect(
      (await bob.correio.mensagens(alice.id)).every((m) => m.deMim || m.status === 'lida'),
    ).toBe(true);
  });

  it('sem avisar, a leitura fica só neste aparelho', async () => {
    const [alice, bob] = await conversa();
    await bob.correio.marcarLidas(alice.id, false);
    const [primeira] = await alice.correio.mensagens(bob.id);
    expect(primeira?.status).toBe('enviada');
    expect((await bob.correio.mensagens(alice.id))[0]?.status).toBe('lida');
  });

  it('sem conseguir depositar, as tentativas se espaçam e a mensagem sai sozinha quando der', async () => {
    const [alice, bob] = await conversa();
    // A caixa da Alice continua em dia (com o relay fora do ar, a fila nem tenta: espera a caixa
    // voltar e ficar em dia). Cada depósito é que se perde no caminho.
    let perder = true;
    alice.transporte.perderAoEnviar = (dados) => {
      const leitura = lerPedido(dados);
      return perder && leitura.ok && leitura.pedido.tipo === 'depositar';
    };
    await alice.correio.enviarTexto(bob.id, 'quando voltar');
    const fila = async () => {
      const [linha] = await alice.banco.banco.consultar(
        'SELECT tentativas, proxima_tentativa FROM fila',
      );
      return {
        tentativas: Number(linha?.['tentativas']),
        proxima: Number(linha?.['proxima_tentativa']),
      };
    };
    const intervalos: number[] = [];
    for (let tentativa = 1; tentativa <= 8; tentativa++) {
      await ate(async () => (await fila()).tentativas === tentativa, `tentativa ${tentativa}`);
      const { proxima } = await fila();
      intervalos.push(proxima - relogio.agora());
      relogio.avancar(proxima - relogio.agora());
    }
    expect(intervalos).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]);

    perder = false;
    await avancarAte(async () => (await textos(bob, alice)).includes('quando voltar'), 'chega');
    expect(await textos(bob, alice)).toEqual(['oi', 'oi, alice', 'quando voltar']);
  });

  it('taxa excedida: o que passou da taxa fica pendente e sai depois, na ordem', async () => {
    await relay.fechar();
    await subir({
      taxas: {
        depositar: { rajada: 2, porMinuto: 1 },
        buscarCartao: LIVRE,
        publicarCartao: LIVRE,
        criarCaixa: LIVRE,
        apagarTudo: LIVRE,
        mensagens: LIVRE,
      },
    });
    const [alice, bob] = await conversa();
    const enviadas = ['um', 'dois', 'três', 'quatro'];
    for (const texto of enviadas) await alice.correio.enviarTexto(bob.id, texto);
    await avancarAte(async () => (await textos(bob, alice)).length === 6, 'todas chegam', 10_000);
    expect(await textos(bob, alice)).toEqual(['oi', 'oi, alice', ...enviadas]);
  });

  it('caixa cheia: o depósito espera o contato esvaziar a caixa', async () => {
    await relay.fechar();
    await subir({ ...TAXAS_LIVRES, pacotesPorCaixa: 2 });
    const [alice, bob] = await conversa();
    await bob.correio.parar();
    const ids: Uint8Array[] = [];
    for (const texto of ['a', 'b', 'c']) ids.push(await alice.correio.enviarTexto(bob.id, texto));
    await ate(
      async () => (await status(alice, bob, ids[1] ?? new Uint8Array())) === 'enviada',
      'duas',
    );
    expect(await status(alice, bob, ids[2] ?? new Uint8Array())).toBe('pendente');
    await online(bob);
    await avancarAte(async () => (await textos(bob, alice)).length === 5, 'as três chegam');
    expect(await textos(bob, alice)).toEqual(['oi', 'oi, alice', 'a', 'b', 'c']);
  });
});

describe('exclusão real e a fila de saída (RNF-08)', () => {
  it('mensagem apagada antes de sair não sai, e a seguinte chega', async () => {
    const [alice, bob] = await conversa();
    await relay.derrubar();
    await ate(() => alice.eventos.some((e) => e.tipo === 'caixa' && !e.aberta), 'alice cai');
    const id = await alice.correio.enviarTexto(bob.id, 'apagada antes de sair');
    expect(await status(alice, bob, id)).toBe('pendente');

    await alice.correio.parar();
    const { banco } = alice.banco;
    expect(await banco.transacao((t) => apagarDeVerdade(t, { mensagens: [id] }))).toBe(1);
    expect(await banco.consultar('SELECT count(*) AS n FROM fila')).toEqual([{ n: 0 }]);
    const depositos = () =>
      pedidos(alice).filter(({ pedido }) => pedido.tipo === 'depositar').length;
    const antes = depositos();

    await relay.voltar();
    await online(alice);
    await alice.correio.enviarTexto(bob.id, 'esta chega');
    await avancarAte(async () => (await textos(bob, alice)).includes('esta chega'), 'chega');
    expect(await textos(bob, alice)).toEqual(['oi', 'oi, alice', 'esta chega']);
    expect(depositos()).toBe(antes + 1);
  });
});

describe('mensagem repetida (RF-16)', () => {
  it('resposta do relay perdida: o reenvio leva os mesmos bytes e o relay não duplica', async () => {
    const [alice, bob] = await conversa();
    await bob.correio.parar();
    let armado = true;
    alice.transporte.perderAoReceber = (dados) => {
      const mensagem = lerMensagemDoRelay(dados);
      if (!armado || mensagem?.tipo !== 'resposta') return false;
      armado = false;
      return true;
    };
    const id = await alice.correio.enviarTexto(bob.id, 'uma vez');
    await avancarAte(async () => (await status(alice, bob, id)) === 'enviada', 'enviada');
    expect(armado).toBe(false);
    const depositados = pedidos(alice)
      .map(({ pedido }) => pedido)
      .filter((pedido) => pedido.tipo === 'depositar')
      .slice(-2);
    expect(depositados).toHaveLength(2);
    const [primeiro, segundo] = depositados;
    if (primeiro?.tipo !== 'depositar' || segundo?.tipo !== 'depositar')
      throw new Error('depósitos');
    expect(segundo.pacote).toEqual(primeiro.pacote);
    expect(relay.consultar('SELECT count(*) AS n FROM pacotes')).toEqual([{ n: 1 }]);

    await online(bob);
    await ate(async () => (await textos(bob, alice)).includes('uma vez'), 'bob recebe');
    await ate(() => relay.consultar('SELECT count(*) AS n FROM pacotes')[0]?.['n'] === 0, 'apaga');
    expect((await textos(bob, alice)).filter((t) => t === 'uma vez')).toHaveLength(1);
  });

  it('confirmação perdida: o relay entrega de novo e a mensagem aparece uma vez', async () => {
    const [alice, bob] = await conversa();
    let armado = true;
    bob.transporte.perderAoEnviar = (dados) => {
      const leitura = lerPedido(dados);
      if (!armado || !leitura.ok || leitura.pedido.tipo !== 'confirmar') return false;
      armado = false;
      return true;
    };
    await alice.correio.enviarTexto(bob.id, 'chega duas vezes');
    await ate(() => !armado, 'confirmação perdida');
    // O Bob reconecta; o relay entrega o mesmo pacote, que a catraca recusa, e o Bob confirma.
    await avancarAte(
      () => relay.consultar('SELECT count(*) AS n FROM pacotes')[0]?.['n'] === 0,
      'relay apaga',
    );
    expect((await textos(bob, alice)).filter((t) => t === 'chega duas vezes')).toHaveLength(1);
  });
});

describe('iniciar conversa com o circuito do contato falhando', () => {
  const codigo = (promessa: Promise<unknown>) =>
    promessa.then(
      () => 'aceito',
      (erro: unknown) => (erro instanceof ErroDoCorreio ? erro.codigo : 'outro'),
    );

  it('a primeira conexão com o contato falha, e o correio tenta de novo sozinho', async () => {
    const [alice, bob] = [await pessoa(), await pessoa()];
    await online(alice, bob);
    let tentativas = 0;
    alice.transporte.falharAoConectar = (circuito) => {
      if (circuito === CIRCUITO_DA_CAIXA) return false;
      tentativas++;
      return tentativas === 1;
    };
    const iniciando = alice.correio.iniciarConversa(bob.id);
    await avancarAte(
      async () => (await alice.agenda.conversa(bob.id))?.tipo === 'contato',
      'contato aceito',
    );
    await iniciando;
    expect(tentativas).toBe(2);
  });

  it('depois de três tentativas, avisa que não alcançou o relay', async () => {
    const [alice, bob] = [await pessoa(), await pessoa()];
    await online(alice, bob);
    let tentativas = 0;
    alice.transporte.falharAoConectar = (circuito) => {
      if (circuito === CIRCUITO_DA_CAIXA) return false;
      tentativas++;
      return true;
    };
    const resultado: string[] = [];
    void codigo(alice.correio.iniciarConversa(bob.id)).then((fim) => resultado.push(fim));
    await avancarAte(() => resultado.length > 0, 'desiste');
    expect(resultado).toEqual(['relay-inacessivel']);
    expect(tentativas).toBe(3);
    expect(await alice.agenda.conversa(bob.id)).toBeNull();
  });
});

describe('pacote que falha ao entrar no banco', () => {
  /** As próximas `vezes` mensagens que chegam falham ao entrar no banco, como com o disco cheio. */
  function falharAoGuardar(p: Awaited<ReturnType<typeof conversa>>[number], vezes: number) {
    const banco = p.banco.banco;
    const original = banco.executar.bind(banco);
    let faltam = vezes;
    banco.executar = (sql, parametros) => {
      if (faltam > 0 && sql.trimStart().startsWith('INSERT OR IGNORE INTO mensagens')) {
        faltam--;
        return Promise.reject(new Error('database or disk is full'));
      }
      return original(sql, parametros);
    };
    return { faltam: () => faltam };
  }

  const pacotesDe = (caixa: Uint8Array) =>
    relay.consultar('SELECT count(*) AS n FROM pacotes WHERE caixa = ?', caixa)[0]?.['n'];

  it('o relay entrega de novo, e a mensagem entra quando o banco volta', async () => {
    const [alice, bob] = await conversa();
    const falha = falharAoGuardar(bob, 1);
    await alice.correio.enviarTexto(bob.id, 'depois da falha');
    await ate(() => falha.faltam() === 0, 'a falha');
    await avancarAte(async () => (await textos(bob, alice)).includes('depois da falha'), 'entra');
    await avancarAte(() => pacotesDe(bob.caixa) === 0, 'confirmada');
  });

  it('na terceira falha do mesmo pacote, ele é descartado, e a caixa segue', async () => {
    const [alice, bob] = await conversa();
    const falha = falharAoGuardar(bob, 3);
    await alice.correio.enviarTexto(bob.id, 'nunca entra');
    await avancarAte(() => falha.faltam() === 0 && pacotesDe(bob.caixa) === 0, 'descartado');
    expect(await textos(bob, alice)).not.toContain('nunca entra');
    await alice.correio.enviarTexto(bob.id, 'a seguinte');
    await ate(async () => (await textos(bob, alice)).includes('a seguinte'), 'a seguinte entra');
  });
});

describe('confirmação do que chegou', () => {
  const pacotesDe = (caixa: Uint8Array) =>
    relay.consultar('SELECT count(*) AS n FROM pacotes WHERE caixa = ?', caixa)[0]?.['n'];

  /** A Alice e o Bob conversando, e `quantos` textos da Alice esperando na caixa do Bob. */
  async function caixaCheia(quantos: number) {
    const [alice, bob] = await conversa();
    await bob.correio.parar();
    for (let i = 0; i < quantos; i++) {
      await alice.correio.enviarTexto(bob.id, `à espera ${String(i)}`);
    }
    await ate(() => pacotesDe(bob.caixa) === quantos, 'os textos esperam na caixa do Bob');
    return [alice, bob] as const;
  }

  it('o que chega entra sem esperar a resposta da confirmação do anterior', async () => {
    const [alice, bob] = await caixaCheia(150);
    // As respostas às confirmações do Bob somem: a primeira fica a caminho até o prazo.
    const confirmacoes = new Set<number>();
    bob.transporte.perderAoEnviar = (dados) => {
      const leitura = lerPedido(dados);
      if (leitura.ok && leitura.pedido.tipo === 'confirmar') {
        confirmacoes.add(leitura.pedido.numero);
      }
      return false;
    };
    bob.transporte.sumirAoReceber = (dados) => {
      const mensagem = lerMensagemDoRelay(dados);
      return mensagem !== null && 'numero' in mensagem && confirmacoes.has(mensagem.numero);
    };
    bob.correio.iniciar();
    await ate(
      async () => (await textos(bob, alice)).length >= 2 + JANELA_DE_ENTREGA,
      'a janela inteira entra',
    );
  });

  it('confirma em lote: a caixa esvazia com poucas confirmações', async () => {
    const [alice, bob] = await caixaCheia(150);
    bob.correio.iniciar();
    await ate(() => pacotesDe(bob.caixa) === 0, 'a caixa esvazia');
    expect(await textos(bob, alice)).toHaveLength(152);
    const confirmacoes = pedidos(bob).filter(({ pedido }) => pedido.tipo === 'confirmar');
    expect(confirmacoes.length).toBeLessThanOrEqual(10);
  });
});
