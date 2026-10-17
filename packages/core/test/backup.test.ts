import { formatarId, idDaChave, lerId, padme, utf8 } from '@cifra/protocol';
import { describe, expect, it } from 'vitest';
import {
  abrirBackup,
  cifrarBackup,
  ErroDoCorreio,
  exportarBackup,
  identidadeDaSemente,
  importarBackup,
  numeroDeSeguranca,
  type ConteudoDoBackup,
  type PreferenciasDoBackup,
} from '../src/index.ts';
import { cripto } from './adaptadores/sodium-node.ts';
import {
  ate,
  avancarAte,
  conversa,
  ocultasDe,
  online,
  pessoa,
  redeParada,
  relay,
  relogio,
  status,
  textos,
  type Pessoa,
} from './correio-de-teste.ts';

// O backup de contatos e ajustes (RF-46, RF-47), contra o relay de verdade: a Alice exporta,
// restaura a identidade em outro aparelho com as mesmas palavras e importa. Os contatos e as
// verificações voltam; mensagens, notas, pedidos e conversas ocultas nunca vão.

const PREFERENCIAS: PreferenciasDoBackup = { tema: 'claro', idioma: 'en' };

const idDe = (p: Pessoa) => {
  const id = lerId(p.id);
  if (!id) throw new Error('ID');
  return id;
};

const contem = (palheiro: Uint8Array, agulha: Uint8Array) =>
  Buffer.from(palheiro).indexOf(Buffer.from(agulha)) !== -1;

const codigo = (promessa: Promise<unknown>) =>
  promessa.then(
    () => 'aceito',
    (erro: unknown) => (erro instanceof ErroDoCorreio ? erro.codigo : 'outro'),
  );

/** Quem escreve para a Alice sem ser contato: vira um pedido de conversa. */
async function pedidoPara(alice: Pessoa, texto: string): Promise<Pessoa> {
  const outra = await pessoa();
  await online(outra);
  await outra.correio.iniciarConversa(alice.id);
  await outra.correio.enviarTexto(alice.id, texto);
  await ate(
    async () => (await alice.agenda.pedidos()).some(({ id }) => id === outra.id),
    'pedido chega',
  );
  return outra;
}

/**
 * A Alice com o Bob (apelido, verificado, timer de 1 hora e prints bloqueados), um pedido que ela
 * bloqueou (Carol), um pedido esperando (Dave), mensagens, uma nota pessoal e os ajustes mudados.
 */
async function aliceComTudo() {
  const [alice, bob] = await conversa();
  await alice.agenda.renomear(bob.id, 'Bob da padaria');
  await alice.agenda.verificar(bob.id, true);
  await alice.correio.mudarTimer(bob.id, 3600, false);
  await alice.correio.mudarPrints(bob.id, true);
  await ate(async () => (await bob.agenda.conversa(alice.id))?.printsBloqueados === true, 'bob');
  const carol = await pedidoPara(alice, 'oi, sou a carol');
  await alice.agenda.bloquear(carol.id);
  const dave = await pedidoPara(alice, 'oi, sou o dave');
  await alice.agenda.escreverNota('senha do cofre: 1234');
  await alice.agenda.mudarTimerPadrao(300);
  await alice.agenda.mudarTimerDaNota(86_400, false);
  await alice.agenda.mudarBaixarSozinho(false);
  await alice.agenda.mudarAjustesDePrivacidade({
    confirmacoesDeLeitura: true,
    indicadorDeDigitacao: true,
    bloquearSozinho: 60,
    bloquearCapturas: false,
  });
  return { alice, bob, carol, dave };
}

const exportar = (p: Pessoa) =>
  exportarBackup(cripto, p.banco.banco, p.identidade, PREFERENCIAS, relogio.agora());

describe('exportar o backup (RF-46)', () => {
  it('leva contatos, bloqueados, timers e ajustes; nunca mensagens, notas nem pedidos', async () => {
    const { alice, bob, carol, dave } = await aliceComTudo();
    const arquivo = await exportar(alice);
    const conteudo = abrirBackup(cripto, alice.identidade, arquivo);
    if (!conteudo) throw new Error('não abriu');

    expect(conteudo.criadoEm).toBe(relogio.agora());
    expect(conteudo.preferencias).toEqual(PREFERENCIAS);
    expect(conteudo.ajustes).toEqual({
      timer_padrao: 300,
      timer_da_nota: 86_400,
      baixar_sozinho: 0,
      confirmacoes_de_leitura: 1,
      indicador_de_digitacao: 1,
      bloquear_sozinho: 60,
      bloquear_capturas: 0,
    });
    const porId = new Map(conteudo.contatos.map((c) => [formatarId(c.contato), c]));
    expect([...porId.keys()].sort()).toEqual([bob.id, carol.id].sort());
    expect(porId.get(bob.id)).toMatchObject({
      aceito: true,
      bloqueado: false,
      verificado: true,
      apelido: 'Bob da padaria',
      timer: 3600,
      timerPorAvisar: false,
      printsBloqueados: true,
    });
    expect(porId.get(bob.id)?.timerDesde).toBeGreaterThan(0);
    expect(porId.get(bob.id)?.printsDesde).toBeGreaterThan(0);
    expect(porId.get(bob.id)?.recebidasAte).toBeGreaterThan(0);
    // O cartão conferido do Bob vai junto: o número de segurança aparece logo na restauração.
    expect(porId.get(bob.id)?.cartao).not.toBeNull();
    expect(porId.get(carol.id)).toMatchObject({ aceito: false, bloqueado: true, apelido: null });
    expect(porId.has(dave.id)).toBe(false);

    // Nada do que está no arquivo aparece em claro: nem o apelido, nem os IDs, nem as mensagens.
    for (const segredo of [
      utf8('Bob da padaria'),
      utf8('oi, alice'),
      utf8('senha do cofre'),
      utf8('sou a carol'),
      idDe(bob),
      idDe(carol),
      idDe(alice),
    ]) {
      expect(contem(arquivo, segredo)).toBe(false);
    }
  });

  it('o tamanho é uma faixa do Padmé: não diz quantos contatos há', async () => {
    const [alice] = await conversa();
    const arquivo = await exportar(alice);
    // Nonce (24) + texto claro completado + etiqueta (16).
    const claro = arquivo.length - 24 - 16;
    expect(claro).toBeGreaterThanOrEqual(4096);
    expect(padme(claro)).toBe(claro);
    // Com um contato ou com nenhum, o arquivo tem o mesmo tamanho.
    const sozinha = await pessoa();
    expect((await exportar(sozinha)).length).toBe(arquivo.length);
    // Dois backups iguais não têm os mesmos bytes: o nonce é sorteado.
    expect(await exportar(alice)).not.toEqual(arquivo);
  });

  it('só abre com as palavras da mesma identidade, e nada mexido abre', async () => {
    const [alice, bob] = await conversa();
    const arquivo = await exportar(alice);
    // As mesmas palavras, em outro aparelho, dão a mesma semente e abrem.
    const restaurada = identidadeDaSemente(cripto, alice.identidade.semente.slice());
    expect(abrirBackup(cripto, restaurada, arquivo)?.contatos).toHaveLength(1);
    expect(abrirBackup(cripto, bob.identidade, arquivo)).toBeNull();
    for (const posicao of [0, 23, 24, arquivo.length - 1]) {
      const mexido = arquivo.slice();
      mexido[posicao] = (mexido[posicao] ?? 0) ^ 1;
      expect(abrirBackup(cripto, alice.identidade, mexido), `byte ${posicao}`).toBeNull();
    }
    expect(abrirBackup(cripto, alice.identidade, arquivo.subarray(0, 100))).toBeNull();
    expect(abrirBackup(cripto, alice.identidade, new Uint8Array(arquivo.length))).toBeNull();
  });

  it('nunca leva as conversas ocultas, nem com o cofre aberto (RF-46)', async () => {
    const [alice, bob] = await conversa();
    const carol = await pessoa();
    await online(carol);
    await alice.correio.iniciarConversa(carol.id);
    const cofre = await ocultasDe(alice).abrir();
    await cofre.ocultar(bob.id);

    const conteudo = abrirBackup(cripto, alice.identidade, await exportar(alice));
    expect(conteudo?.contatos.map((c) => formatarId(c.contato))).toEqual([carol.id]);
  });

  it('um cartão que não confere fica de fora, sem derrubar o resto', async () => {
    const [alice, bob] = await conversa();
    const conteudo = abrirBackup(cripto, alice.identidade, await exportar(alice));
    if (!conteudo) throw new Error('não abriu');
    const [doBob] = conteudo.contatos;
    if (!doBob?.cartao) throw new Error('sem cartão');
    const adulterado = doBob.cartao.slice();
    adulterado[40] = (adulterado[40] ?? 0) ^ 1;
    const mexido: ConteudoDoBackup = {
      ...conteudo,
      contatos: [{ ...doBob, cartao: adulterado }],
    };
    const aberto = abrirBackup(
      cripto,
      alice.identidade,
      cifrarBackup(cripto, alice.identidade, mexido),
    );
    expect(aberto?.contatos).toEqual([{ ...doBob, cartao: null }]);
    expect(formatarId(aberto?.contatos[0]?.contato ?? new Uint8Array(10))).toBe(bob.id);
  });
});

describe('importar o backup na restauração (RF-47)', () => {
  /** A Alice restaura a identidade em outro aparelho e importa o backup antes de conectar. */
  async function restaurar(alice: Pessoa) {
    const arquivo = await exportar(alice);
    await alice.correio.parar();
    const nova = await pessoa(identidadeDaSemente(cripto, alice.identidade.semente.slice()));
    const conteudo = abrirBackup(cripto, nova.identidade, arquivo);
    if (!conteudo) throw new Error('não abriu');
    await importarBackup(nova.banco.banco, conteudo);
    return { nova, conteudo };
  }

  it('os contatos e as verificações voltam, com o apelido, o timer, os prints e os ajustes', async () => {
    const { alice, bob, carol } = await aliceComTudo();
    const { nova } = await restaurar(alice);

    const conversas = await nova.agenda.conversas();
    expect(conversas.map(({ id }) => id).sort()).toEqual([alice.id, bob.id].sort());
    expect(await nova.agenda.conversa(bob.id)).toMatchObject({
      tipo: 'contato',
      apelido: 'Bob da padaria',
      verificado: true,
      bloqueado: false,
      timer: 3600,
      printsBloqueados: true,
      naoLidas: 0,
      ultima: null,
    });
    expect((await nova.agenda.bloqueados()).map(({ id }) => id)).toEqual([carol.id]);
    expect(await nova.agenda.pedidos()).toEqual([]);
    // Nenhuma mensagem, nenhuma nota.
    expect(await nova.agenda.mensagens(bob.id)).toEqual([]);
    expect(await nova.agenda.mensagens(alice.id)).toEqual([]);
    expect(await nova.agenda.ajustesDoTimer()).toEqual({ timerPadrao: 300, timerDaNota: 86_400 });
    expect(await nova.agenda.baixarSozinho()).toBe(false);
    expect(await nova.agenda.ajustesDePrivacidade()).toEqual({
      confirmacoesDeLeitura: true,
      indicadorDeDigitacao: true,
      bloquearSozinho: 60,
      bloquearCapturas: false,
    });
    // O número de segurança aparece antes de qualquer conversa: o cartão do Bob voltou.
    expect(await nova.agenda.numeroDeSeguranca(bob.id)).toEqual(
      numeroDeSeguranca(
        cripto,
        alice.identidade.assinatura.publicKey,
        bob.identidade.assinatura.publicKey,
      ),
    );
    // Nenhuma sessão volta: a primeira mensagem abre uma nova.
    expect(await nova.banco.banco.consultar('SELECT count(*) AS n FROM sessoes')).toEqual([
      { n: 0 },
    ]);
  });

  it('a primeira mensagem para um contato restaurado abre a sessão e chega', async () => {
    const [alice, bob] = await conversa();
    await alice.agenda.renomear(bob.id, 'Bob');
    const { nova } = await restaurar(alice);
    await online(nova);

    const id = await nova.correio.enviarTexto(bob.id, 'voltei, aparelho novo');
    await avancarAte(
      async () => (await textos(bob, alice)).includes('voltei, aparelho novo'),
      'bob recebe',
    );
    // Para o Bob, é a mesma conversa: nada de pedido novo.
    expect((await bob.agenda.conversa(alice.id))?.tipo).toBe('contato');
    expect(await status(nova, bob, id)).toBe('enviada');

    await bob.correio.enviarTexto(alice.id, 'que bom');
    await avancarAte(async () => (await textos(nova, bob)).includes('que bom'), 'chega à alice');
    expect((await nova.agenda.conversa(bob.id))?.tipo).toBe('contato');
    expect(await nova.agenda.pedidos()).toEqual([]);
  });

  it('o contato que escreve primeiro chega como conversa, não como pedido', async () => {
    const [alice, bob] = await conversa();
    const { nova } = await restaurar(alice);
    await online(nova);

    await bob.correio.enviarTexto(alice.id, 'você sumiu?');
    await avancarAte(async () => (await textos(nova, bob)).includes('você sumiu?'), 'chega');
    expect(nova.eventos).toContainEqual(
      expect.objectContaining({ tipo: 'mensagem', conversa: bob.id, pedido: false }),
    );
    expect(await nova.agenda.pedidos()).toEqual([]);
    // A resposta já sai na sessão que o Bob abriu.
    await nova.correio.enviarTexto(bob.id, 'voltei');
    await avancarAte(async () => (await textos(bob, alice)).includes('voltei'), 'bob recebe');
  });

  it('sem conexão, a primeira mensagem para o contato restaurado não sai nem fica pendente', async () => {
    const [alice, bob] = await conversa();
    const { nova } = await restaurar(alice);
    await relay.derrubar();
    nova.correio.iniciar();
    await redeParada();

    const envio = codigo(nova.correio.enviarTexto(bob.id, 'sem rede'));
    await avancarAte(async () => {
      const resultado = await Promise.race([envio, Promise.resolve('esperando')]);
      return resultado !== 'esperando';
    }, 'o envio desiste');
    expect(await envio).toBe('relay-inacessivel');
    expect(await nova.agenda.mensagens(bob.id)).toEqual([]);
    expect(await nova.banco.banco.consultar('SELECT count(*) AS n FROM fila')).toEqual([{ n: 0 }]);
    await relay.voltar();
  });

  it('quem não é contato continua sem sessão: nada é buscado', async () => {
    const [alice] = await conversa();
    const { nova } = await restaurar(alice);
    await online(nova);
    const estranho = await pessoa();
    await online(estranho);
    expect(await codigo(nova.correio.enviarTexto(estranho.id, 'oi'))).toBe('sem-sessao');
    const id = formatarId(idDaChave(cripto, estranho.identidade.assinatura.publicKey));
    expect(await nova.agenda.conversa(id)).toBeNull();
  });
});
