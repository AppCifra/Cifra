import { readFileSync, statSync } from 'node:fs';
import { lerId, lerMensagemDoRelay, lerPedido } from '@cifra/protocol';
import { describe, expect, it } from 'vitest';
import { CIRCUITO_DA_CAIXA, ErroDasOcultas } from '../src/index.ts';
import {
  ate,
  avancarAte,
  BLOCO_DE_TESTE,
  conversa,
  ocultasDe,
  online,
  pedidos,
  pessoa,
  redeParada,
  relay,
  relogio,
  semEspacoParaOBloco,
  status,
  textos,
  type OcultasDeTeste,
  type Pessoa,
} from './correio-de-teste.ts';

// Conversas ocultas, de ponta a ponta (RF-20, RF-23, RNF-11): a Alice oculta a conversa com o Bob.
// O Bob passa a escrever para a caixa oculta, que só o cofre da Alice abre; com o cofre fechado, o
// que ele manda espera no relay. Nenhuma mensagem se perde na troca de caixa.

const textosNoCofre = async (ocultas: OcultasDeTeste, bob: Pessoa) =>
  ocultas.aberto ? (await ocultas.aberto.agenda.mensagens(bob.id)).map((m) => m.texto) : [];

const pacotesNaCaixa = (caixa: Uint8Array) =>
  relay.consultar('SELECT count(*) AS n FROM pacotes WHERE caixa = ?', caixa)[0]?.['n'];

const idDe = (p: Pessoa) => {
  const id = lerId(p.id);
  if (!id) throw new Error('ID');
  return id;
};

/** A caixa que `de` pediu para a conversa, como `p` guardou. */
async function caixaPedida(p: Pessoa, de: Pessoa) {
  const [linha] = await p.banco.banco.consultar(
    'SELECT caixa, caixa_desde FROM contatos WHERE contato = ?',
    [idDe(de)],
  );
  return { caixa: linha?.['caixa'] ?? null, desde: Number(linha?.['caixa_desde'] ?? 0) };
}

async function caixaOculta(p: Pessoa, de: Pessoa): Promise<Uint8Array> {
  const { caixa } = await caixaPedida(p, de);
  if (!(caixa instanceof Uint8Array)) throw new Error('sem caixa oculta');
  return caixa;
}

const codigo = (promessa: Promise<unknown>) =>
  promessa.then(
    () => 'aceito',
    (erro: unknown) => (erro instanceof ErroDasOcultas ? erro.codigo : 'outro'),
  );

describe('ocultar e reexibir uma conversa (RF-20)', () => {
  it('o Bob responde para a caixa oculta, e só o cofre da Alice recebe', async () => {
    const [alice, bob] = await conversa();
    const ocultas = ocultasDe(alice);
    const cofre = await ocultas.abrir();
    alice.eventos.length = 0;
    await cofre.ocultar(bob.id);

    expect((await alice.agenda.conversas()).map(({ id }) => id)).toEqual([alice.id]);
    expect(await textosNoCofre(ocultas, bob)).toEqual(['oi', 'oi, alice']);

    await bob.correio.enviarTexto(alice.id, 'para a oculta');
    await ate(async () => (await textosNoCofre(ocultas, bob)).includes('para a oculta'), 'cofre');
    expect(await alice.agenda.conversa(bob.id)).toBeNull();
    // Nada pelo correio principal: nem mensagem, nem aviso de mensagem nova.
    expect(alice.eventos.filter((e) => e.tipo === 'mensagem')).toEqual([]);
    expect(ocultas.eventos).toContainEqual(
      expect.objectContaining({ tipo: 'mensagem', conversa: bob.id }),
    );
    // A caixa oculta foi criada e é aberta em circuitos do cofre, nunca nos do principal.
    const oculta = await caixaOculta(bob, alice);
    const daOculta = pedidos(alice).flatMap(({ circuito, pedido }) =>
      (pedido.tipo === 'abrir-caixa' || pedido.tipo === 'criar-caixa') &&
      Buffer.from(pedido.caixa).equals(Buffer.from(oculta))
        ? [`${pedido.tipo} ${circuito.replace(/\d+$/, 'N')}`]
        : [],
    );
    expect(new Set(daOculta)).toEqual(
      new Set(['criar-caixa oculta-nova-N', 'abrir-caixa oculta-caixa-N']),
    );

    // A Alice responde de dentro do cofre, e o Bob recebe como sempre.
    await cofre.correio?.enviarTexto(bob.id, 'daqui do cofre');
    await ate(async () => (await textos(bob, alice)).includes('daqui do cofre'), 'bob recebe');
    const depositosDoCofre = pedidos(alice).filter(
      ({ circuito, pedido }) => pedido.tipo === 'depositar' && circuito.startsWith('oculta-'),
    );
    expect(depositosDoCofre.length).toBeGreaterThan(0);
    expect(depositosDoCofre.every(({ circuito }) => circuito.startsWith('oculta-deposito-'))).toBe(
      true,
    );
  });

  it('com o cofre fechado, a mensagem espera no relay e chega quando ele abre', async () => {
    const [alice, bob] = await conversa();
    const ocultas = ocultasDe(alice);
    await (await ocultas.abrir()).ocultar(bob.id);
    await ocultas.fechar();
    const caixa = await caixaOculta(bob, alice);

    alice.eventos.length = 0;
    await bob.correio.enviarTexto(alice.id, 'esperando');
    await ate(() => pacotesNaCaixa(caixa) === 1, 'espera no relay');
    await redeParada();
    expect(alice.eventos.filter((e) => e.tipo === 'mensagem')).toEqual([]);
    expect(await alice.agenda.conversa(bob.id)).toBeNull();

    await ocultas.abrir();
    await ate(async () => (await textosNoCofre(ocultas, bob)).includes('esperando'), 'chega');
    await ate(() => pacotesNaCaixa(caixa) === 0, 'o relay apaga');
  });

  it('reexibir traz a conversa de volta, e tudo volta para a caixa principal', async () => {
    const [alice, bob] = await conversa();
    const ocultas = ocultasDe(alice);
    const cofre = await ocultas.abrir();
    await cofre.ocultar(bob.id);
    await bob.correio.enviarTexto(alice.id, 'na oculta');
    await ate(async () => (await textosNoCofre(ocultas, bob)).includes('na oculta'), 'cofre');

    await cofre.reexibir(bob.id);
    expect(await textos(alice, bob)).toEqual(['oi', 'oi, alice', 'na oculta']);
    expect(await cofre.agenda.conversas()).toEqual([]);
    await ocultas.fechar();
    expect(await alice.banco.banco.consultar('SELECT count(*) AS n FROM mudancas')).toEqual([
      { n: 0 },
    ]);

    await bob.correio.enviarTexto(alice.id, 'de volta');
    await ate(async () => (await textos(alice, bob)).includes('de volta'), 'chega ao principal');
    expect((await caixaPedida(bob, alice)).caixa).toBeNull();
    await ate(() => pacotesNaCaixa(alice.caixa) === 0, 'a caixa principal esvazia');
  });

  it('só um contato aceito, não bloqueado e com sessão; nunca a nota pessoal', async () => {
    const [alice, bob] = await conversa();
    const cofre = await ocultasDe(alice).abrir();
    expect(await codigo(cofre.ocultar(alice.id))).toBe('nao-pode');
    expect(await codigo(cofre.ocultar('nao-e-id'))).toBe('nao-pode');
    await alice.agenda.bloquear(bob.id);
    expect(await codigo(cofre.ocultar(bob.id))).toBe('nao-pode');
    await alice.agenda.desbloquear(bob.id);
    expect(await codigo(cofre.reexibir(bob.id))).toBe('desconhecida');

    // Um pedido de conversa também não.
    const carol = await pessoa();
    await online(carol);
    await carol.correio.iniciarConversa(alice.id);
    await carol.correio.enviarTexto(alice.id, 'oi');
    await ate(async () => (await alice.agenda.pedidos()).length === 1, 'o pedido chega');
    expect(await codigo(cofre.ocultar(carol.id))).toBe('nao-pode');
  });
});

describe('nenhuma mensagem se perde na troca de caixa', () => {
  it('o Bob fora do ar quando a Alice oculta: ao voltar, lê o aviso antes de mandar a fila', async () => {
    const [alice, bob] = await conversa();
    const ocultas = ocultasDe(alice);
    const cofre = await ocultas.abrir();
    await bob.correio.parar();
    await cofre.ocultar(bob.id);
    await bob.correio.enviarTexto(alice.id, 'escrita fora do ar');
    const paraAPrincipal = () =>
      pedidos(bob).filter(
        ({ pedido }) =>
          pedido.tipo === 'depositar' && pedido.caixa.every((b, i) => b === alice.caixa[i]),
      ).length;
    const antes = paraAPrincipal();

    await online(bob);
    await ate(
      async () => (await textosNoCofre(ocultas, bob)).includes('escrita fora do ar'),
      'cofre',
    );
    await redeParada();
    expect(paraAPrincipal()).toBe(antes);
    expect(pacotesNaCaixa(alice.caixa)).toBe(0);
  });

  it('cruzamento ao ocultar: o que chegou à caixa antiga e se perdeu vem pelo reenvio, uma vez', async () => {
    const [alice, bob] = await conversa();
    const ocultas = ocultasDe(alice);
    const cofre = await ocultas.abrir();
    // A mensagem do Bob chega à caixa principal da Alice e some no caminho, sem a conexão cair:
    // o relay acha que entregou, e a Alice nunca a lê ali.
    let sumir = true;
    alice.transporte.sumirAoReceber = (dados, circuito) =>
      sumir && circuito === CIRCUITO_DA_CAIXA && lerMensagemDoRelay(dados)?.tipo === 'pacote';
    const id = await bob.correio.enviarTexto(alice.id, 'no instante da troca');
    await ate(async () => (await status(bob, alice, id)) === 'enviada', 'o relay aceita');
    await redeParada();
    sumir = false;

    // O aviso espera o Bob, e o cofre da Alice está fechado quando ele lê.
    await bob.correio.parar();
    await cofre.ocultar(bob.id);
    await ocultas.fechar();
    await online(bob);
    const caixa = await caixaOculta(bob, alice);
    await ate(() => Number(pacotesNaCaixa(caixa) ?? 0) >= 1, 'o bob manda de novo para a oculta');

    await ocultas.abrir();
    await ate(
      async () => (await textosNoCofre(ocultas, bob)).includes('no instante da troca'),
      'chega pelo reenvio',
    );
    await redeParada();
    await ate(() => pacotesNaCaixa(caixa) === 0, 'o relay apaga');
    expect(await textosNoCofre(ocultas, bob)).toEqual(['oi', 'oi, alice', 'no instante da troca']);
    expect(await alice.agenda.conversa(bob.id)).toBeNull();
  });

  it('cruzamento ao reexibir: o mesmo, de volta para a caixa principal', async () => {
    const [alice, bob] = await conversa();
    const ocultas = ocultasDe(alice);
    const cofre = await ocultas.abrir();
    await cofre.ocultar(bob.id);
    let sumir = true;
    alice.transporte.sumirAoReceber = (dados, circuito) =>
      sumir && circuito.startsWith('oculta-caixa-') && lerMensagemDoRelay(dados)?.tipo === 'pacote';
    const id = await bob.correio.enviarTexto(alice.id, 'na hora de voltar');
    await ate(async () => (await status(bob, alice, id)) === 'enviada', 'o relay aceita');
    await redeParada();
    sumir = false;

    await bob.correio.parar();
    await cofre.reexibir(bob.id);
    await online(bob);
    await ate(
      async () => (await textos(alice, bob)).includes('na hora de voltar'),
      'chega pelo reenvio',
    );
    await redeParada();
    expect(await textos(alice, bob)).toEqual(['oi', 'oi, alice', 'na hora de voltar']);
  });

  it('a caixa oculta sumiu do relay: o Bob espera, sem buscar o cartão, e entrega quando o cofre abre', async () => {
    const [alice, bob] = await conversa();
    const ocultas = ocultasDe(alice);
    await (await ocultas.abrir()).ocultar(bob.id);
    await ocultas.fechar();
    const caixa = await caixaOculta(bob, alice);
    relay.adulterar('DELETE FROM caixas WHERE chave = ?', caixa);

    const buscas = () => pedidos(bob).filter(({ pedido }) => pedido.tipo === 'buscar-cartao');
    const antes = buscas().length;
    const id = await bob.correio.enviarTexto(alice.id, 'quando abrir');
    for (let i = 0; i < 6; i++) {
      await redeParada();
      relogio.avancar(60_000);
    }
    await redeParada();
    expect(await status(bob, alice, id)).toBe('pendente');
    expect(buscas()).toHaveLength(antes);

    await ocultas.abrir();
    await avancarAte(
      async () => (await textosNoCofre(ocultas, bob)).includes('quando abrir'),
      'chega quando o cofre recria a caixa',
    );
  });

  it('o Bob troca de aparelho: o cofre da Alice avisa o aparelho novo da caixa oculta', async () => {
    const [alice, bob] = await conversa();
    const ocultas = ocultasDe(alice);
    const cofre = await ocultas.abrir();
    await cofre.ocultar(bob.id);
    await bob.correio.parar();
    const bobNovo = await pessoa(bob.identidade);
    await online(bobNovo);

    await cofre.correio?.enviarTexto(bob.id, 'para o aparelho novo');
    await avancarAte(
      async () => (await textos(bobNovo, alice)).includes('para o aparelho novo'),
      'chega ao aparelho novo',
    );
    await avancarAte(
      async () => (await caixaPedida(bobNovo, alice)).caixa instanceof Uint8Array,
      'o aparelho novo sabe da caixa oculta',
    );
    await bobNovo.correio.iniciarConversa(alice.id);
    await bobNovo.correio.enviarTexto(alice.id, 'recebi aqui');
    await avancarAte(
      async () => (await textosNoCofre(ocultas, bob)).includes('recebi aqui'),
      'a resposta vai para a oculta',
    );
    expect(await alice.agenda.conversa(bob.id)).toBeNull();
  });

  it('o aviso não chega ao relay: nada muda, e o Bob volta para a caixa do cartão pela fila', async () => {
    const [alice, bob] = await conversa();
    const cofre = await ocultasDe(alice).abrir();
    let perder = true;
    alice.transporte.perderAoEnviar = (dados) => {
      const leitura = lerPedido(dados);
      return perder && leitura.ok && leitura.pedido.tipo === 'depositar';
    };
    const resultado: string[] = [];
    void codigo(cofre.ocultar(bob.id)).then((fim) => resultado.push(fim));
    await avancarAte(() => resultado.length > 0, 'desiste');
    expect(resultado).toEqual(['relay-inacessivel']);
    expect(await textos(alice, bob)).toEqual(['oi', 'oi, alice']);
    expect(await cofre.agenda.conversas()).toEqual([]);
    expect(await cofre.correio?.mensagens(bob.id)).toEqual([]);

    perder = false;
    await avancarAte(async () => (await caixaPedida(bob, alice)).desde > 0, 'o aviso de volta');
    expect((await caixaPedida(bob, alice)).caixa).toBeNull();
    await bob.correio.enviarTexto(alice.id, 'tudo como antes');
    await avancarAte(async () => (await textos(alice, bob)).includes('tudo como antes'), 'chega');
  });
});

describe('o aviso de caixa do outro lado', () => {
  it('vale o mais novo; de quem não é contato, nada; de um bloqueado, guarda sem mandar nada', async () => {
    const [alice, bob] = await conversa();
    const [h1, h2] = [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)];
    const agora = relogio.agora();
    await alice.correio.enfileirarAvisoDeCaixa(bob.id, h1, agora + 100);
    await ate(async () => (await caixaPedida(bob, alice)).desde === agora + 100, 'guarda');
    await alice.correio.enfileirarAvisoDeCaixa(bob.id, h2, agora + 50);
    await redeParada();
    expect(await caixaPedida(bob, alice)).toEqual({ caixa: h1, desde: agora + 100 });

    // O que o Bob mandou de novo para a caixa h1, que não existe no relay, espera na fila.
    await bob.agenda.bloquear(alice.id);
    const fila = () => bob.banco.banco.consultar('SELECT count(*) AS n FROM fila');
    const antes = await fila();
    await alice.correio.enfileirarAvisoDeCaixa(bob.id, null, agora + 200);
    await ate(async () => (await caixaPedida(bob, alice)).desde === agora + 200, 'guarda');
    expect((await caixaPedida(bob, alice)).caixa).toBeNull();
    expect(await fila()).toEqual(antes);

    const carol = await pessoa();
    await online(carol);
    await carol.correio.iniciarConversa(bob.id);
    await carol.correio.enfileirarAvisoDeCaixa(bob.id, h2, agora + 300);
    await ate(() => relay.consultar('SELECT count(*) AS n FROM pacotes')[0]?.['n'] === 0, 'lido');
    await redeParada();
    expect(await bob.agenda.pedidos()).toEqual([]);
    expect(await bob.agenda.conversa(carol.id)).toBeNull();
  });
});

describe('nenhum rastro das ocultas no principal (RF-23)', () => {
  it('nenhuma tabela, índice ou byte do arquivo principal tem o ID, o apelido ou o texto', async () => {
    const [alice, bob] = await conversa({ encolhe: true });
    await bob.correio.enviarTexto(alice.id, 'segredo de estado');
    await ate(async () => (await textos(alice, bob)).includes('segredo de estado'), 'chega');
    await alice.agenda.renomear(bob.id, 'Roberto');
    await alice.correio.mudarTimer(bob.id, 3600, false);
    await ocultasDe(alice)
      .abrir()
      .then((cofre) => cofre.ocultar(bob.id));

    const contato = idDe(bob);
    const contem = (valor: unknown) =>
      (valor instanceof Uint8Array && Buffer.from(valor).includes(Buffer.from(contato))) ||
      (typeof valor === 'string' && (valor.includes('segredo') || valor.includes('Roberto')));
    const { banco } = alice.banco;
    const tabelas = await banco.consultar("SELECT name FROM sqlite_schema WHERE type = 'table'");
    for (const { name } of tabelas) {
      for (const linha of await banco.consultar(`SELECT * FROM "${String(name)}"`)) {
        expect(Object.values(linha).some(contem), String(name)).toBe(false);
      }
    }
    expect(
      await banco.consultar("SELECT count(*) AS n FROM busca WHERE busca MATCH 'segredo'"),
    ).toEqual([{ n: 0 }]);
    for (const texto of ['Roberto', bob.id.slice(0, 9), 'segredo', 'estado']) {
      expect(await alice.agenda.buscar(texto)).toEqual({ conversas: [], mensagens: [] });
    }
    const bytes = readFileSync(alice.banco.caminho);
    for (const procurado of [
      Buffer.from(contato),
      Buffer.from('segredo'),
      Buffer.from('Roberto'),
    ]) {
      expect(bytes.includes(procurado)).toBe(false);
    }
  });
});

describe('o cofre em blocos (RNF-11)', () => {
  it('o cofre vazio e o em uso têm o mesmo tamanho, num múltiplo exato do bloco', async () => {
    const bloco = 1024 * 1024;
    const [alice, bob] = await conversa();
    const vazio = ocultasDe(await pessoa(), bloco);
    await vazio.abrir();
    await vazio.fechar();
    const ocultas = ocultasDe(alice, bloco);
    const cofre = await ocultas.abrir();
    await cofre.ocultar(bob.id);
    await bob.correio.enviarTexto(alice.id, 'algo no cofre');
    await ate(async () => (await textosNoCofre(ocultas, bob)).includes('algo no cofre'), 'cofre');
    await ocultas.fechar();

    const [tamanhoVazio, tamanhoEmUso] = [statSync(vazio.caminho), statSync(ocultas.caminho)].map(
      ({ size }) => size,
    );
    expect(tamanhoVazio).toBe(bloco);
    expect(tamanhoEmUso).toBe(tamanhoVazio);
    // O diário fica no lugar, com 0 byte, nos dois.
    for (const { caminho } of [vazio, ocultas]) {
      expect(statSync(`${caminho}-journal`).size).toBe(0);
    }
  });

  it('sem espaço para o cofre crescer, ocultar falha sem mudar nada, e depois funciona', async () => {
    const [alice, bob] = await conversa();
    let cheio = false;
    const ocultas = ocultasDe(alice, BLOCO_DE_TESTE, (banco) =>
      semEspacoParaOBloco(banco, () => cheio),
    );
    const cofre = await ocultas.abrir();
    // Um documento grande: a cópia faz o cofre crescer.
    await alice.correio.enviarAnexo(bob.id, {
      arquivo: 'documento',
      formato: 'application/pdf',
      bytes: new Uint8Array(200_000).fill(7),
    });
    await redeParada();
    const tamanho = statSync(ocultas.caminho).size;

    cheio = true;
    expect(await codigo(cofre.ocultar(bob.id))).toBe('outro');
    cheio = false;
    expect(statSync(ocultas.caminho).size).toBe(tamanho);
    expect(await cofre.agenda.conversas()).toEqual([]);
    // A conversa segue no principal: o Bob volta para a caixa do cartão pela fila.
    await bob.correio.enviarTexto(alice.id, 'depois da falha');
    await avancarAte(
      async () => (await textos(alice, bob)).includes('depois da falha'),
      'chega ao principal',
    );

    await cofre.ocultar(bob.id);
    expect(await alice.agenda.conversa(bob.id)).toBeNull();
    expect(await textosNoCofre(ocultas, bob)).toContain('depois da falha');
  });
});
