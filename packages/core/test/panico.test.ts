import { lerId, lerPedido } from '@cifra/protocol';
import { describe, expect, it } from 'vitest';
import {
  apagarTudoNoRelay,
  CIRCUITO_DA_CAIXA,
  ErroDoCorreio,
  TENTATIVAS_DO_APAGAR,
} from '../src/index.ts';
import { cripto } from './adaptadores/sodium-node.ts';
import {
  ate,
  avancarAte,
  conversa,
  online,
  pessoa,
  relay,
  RELAY,
  relogio,
  status,
  transporte,
  type Pessoa,
} from './correio-de-teste.ts';

// O pânico no relay (RF-48): depois de apagar o que está no aparelho, o app pede ao relay para
// apagar o cartão, as prekeys, a caixa principal e o que esperava nela. Contra o relay de verdade.

const idDe = (p: Pessoa) => {
  const id = lerId(p.id);
  if (!id) throw new Error('ID');
  return id;
};

const contar = (sql: string, ...parametros: Uint8Array[]) =>
  relay.consultar(sql, ...parametros)[0]?.['n'];

const codigo = (promessa: Promise<unknown>) =>
  promessa.then(
    () => 'aceito',
    (erro: unknown) => (erro instanceof ErroDoCorreio ? erro.codigo : 'outro'),
  );

describe('apagar tudo no relay (pânico, RF-48)', () => {
  it('o cartão, as prekeys, a caixa principal e o que esperava nela somem do relay', async () => {
    const [alice, bob] = await conversa();
    await alice.correio.parar();
    const id = await bob.correio.enviarTexto(alice.id, 'esperando a alice');
    await ate(async () => (await status(bob, alice, id)) === 'enviada', 'no relay');
    expect(contar('SELECT count(*) AS n FROM pacotes WHERE caixa = ?', alice.caixa)).toBe(1);

    const seu = transporte();
    const apagou = await apagarTudoNoRelay({
      cripto,
      transporte: seu,
      relogio,
      relay: RELAY,
      assinatura: alice.identidade.assinatura,
    });
    expect(apagou).toBe(true);

    expect(contar('SELECT count(*) AS n FROM cartoes WHERE id = ?', idDe(alice))).toBe(0);
    expect(contar('SELECT count(*) AS n FROM prekeys WHERE cartao = ?', idDe(alice))).toBe(0);
    expect(contar('SELECT count(*) AS n FROM caixas WHERE chave = ?', alice.caixa)).toBe(0);
    expect(contar('SELECT count(*) AS n FROM pacotes WHERE caixa = ?', alice.caixa)).toBe(0);
    // O Bob continua no relay.
    expect(contar('SELECT count(*) AS n FROM cartoes WHERE id = ?', idDe(bob))).toBe(1);
    // O pedido saiu uma vez só, pelo circuito da caixa, que já publicava o cartão.
    const enviados = seu.conexoes.flatMap(({ circuito, enviadas }) =>
      enviadas.map((bytes) => ({ circuito, pedido: lerPedido(bytes) })),
    );
    expect(enviados).toHaveLength(1);
    expect(enviados[0]?.circuito).toBe(CIRCUITO_DA_CAIXA);
    expect(enviados[0]?.pedido).toMatchObject({ ok: true, pedido: { tipo: 'apagar-tudo' } });

    // Quem procura a Alice não acha mais ninguém.
    const carol = await pessoa();
    await online(carol);
    expect(await codigo(carol.correio.iniciarConversa(alice.id))).toBe('cartao-inexistente');
    // Pedir de novo também dá certo: não há o que apagar.
    expect(
      await apagarTudoNoRelay({
        cripto,
        transporte: transporte(),
        relogio,
        relay: RELAY,
        assinatura: alice.identidade.assinatura,
      }),
    ).toBe(true);
  });

  it('sem conexão, desiste depois das tentativas, e nada muda no relay', async () => {
    const alice = await pessoa();
    await online(alice);
    await alice.correio.parar();
    await relay.derrubar();

    const inicio = relogio.agora();
    let resultado: boolean | null = null;
    void apagarTudoNoRelay({
      cripto,
      transporte: transporte(),
      relogio,
      relay: RELAY,
      assinatura: alice.identidade.assinatura,
    }).then((apagou) => {
      resultado = apagou;
    });
    await avancarAte(() => resultado !== null, 'desiste');
    expect(resultado).toBe(false);
    // Tentou de novo, com o intervalo da fila entre as tentativas: 1 s, depois 2 s.
    expect(TENTATIVAS_DO_APAGAR).toBe(3);
    expect(relogio.agora() - inicio).toBeGreaterThanOrEqual(3000);

    await relay.voltar();
    expect(contar('SELECT count(*) AS n FROM cartoes WHERE id = ?', idDe(alice))).toBe(1);
  });
});
