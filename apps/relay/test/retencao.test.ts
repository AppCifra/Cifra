import {
  RETENCAO_DA_CAIXA_EM_DIAS,
  RETENCAO_DO_CARTAO_EM_DIAS,
  RETENCAO_DO_PACOTE_EM_DIAS,
} from '@cifra/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClienteDoRelay } from '../scripts/cliente.ts';
import { horaCheia } from '../src/relay.ts';
import {
  abrir,
  codigo,
  contem,
  DIA,
  HORA,
  INICIO,
  novaIdentidade,
  novoPar,
  pacoteAleatorio,
  publicacaoDe,
  subirRelay,
  TAXAS_LIVRES,
  type ParDeTeste,
  type RelayDeTeste,
  marcaDeTeste,
} from './ajuda.ts';

// RNF-14: o relay apaga depois da confirmação, e pacote não entregue some em 14 dias. Verificação do
// SPEC: inspeção do banco do relay, aqui pela tabela e pelos bytes do arquivo.

let relay: RelayDeTeste;
let cliente: ClienteDoRelay;

beforeEach(async () => {
  relay = await subirRelay(TAXAS_LIVRES);
  cliente = await relay.conectar();
});

afterEach(async () => {
  await relay.fechar();
});

async function caixaComPacote(): Promise<{ caixa: ParDeTeste; pacote: Uint8Array }> {
  const caixa = novoPar();
  const pacote = pacoteAleatorio();
  await cliente.pedir({ tipo: 'criar-caixa', caixa: caixa.publicKey });
  await cliente.pedir({ tipo: 'depositar', caixa: caixa.publicKey, pacote, marca: marcaDeTeste() });
  return { caixa, pacote };
}

function contar(tabela: string): number {
  return Number(relay.consultar(`SELECT count(*) AS n FROM ${tabela}`)[0]?.['n']);
}

/**
 * Quantos dos 128 pedaços de 32 bytes do pacote aparecem no arquivo do banco. O pacote não cabe
 * numa página do SQLite e fica partido entre páginas: procurar o pacote inteiro não acharia nada.
 */
function pedacosNoArquivo(pacote: Uint8Array): number {
  const arquivo = relay.bytesDoBanco();
  let achados = 0;
  for (let inicio = 0; inicio < pacote.length; inicio += 32) {
    if (contem(arquivo, pacote.subarray(inicio, inicio + 32))) achados++;
  }
  return achados;
}

describe('apagar depois da confirmação (RNF-14)', () => {
  it('o pacote confirmado some da tabela e dos bytes do arquivo', async () => {
    const { caixa, pacote } = await caixaComPacote();
    // Controle: antes da confirmação, o pacote está no arquivo (só um pedaço pode cair no corte
    // entre duas páginas).
    expect(pedacosNoArquivo(pacote)).toBeGreaterThanOrEqual(127);

    const dono = await relay.conectar();
    await abrir(dono, caixa);
    const entregue = await dono.proximoAviso();
    if (entregue.tipo !== 'pacote') throw new Error('esperava o pacote');
    expect(codigo(await dono.pedir({ tipo: 'confirmar', ids: [entregue.id] }))).toBe('ok');

    expect(contar('pacotes')).toBe(0);
    // Nem um pedaço: o secure_delete zera as páginas, não só as marca como livres.
    expect(pedacosNoArquivo(pacote)).toBe(0);
  });
});

describe(`pacote não entregue some em ${RETENCAO_DO_PACOTE_EM_DIAS} dias (RNF-14)`, () => {
  it('fica até o prazo e some depois, da tabela e do arquivo', async () => {
    const { pacote } = await caixaComPacote();
    const prazo = RETENCAO_DO_PACOTE_EM_DIAS * DIA;

    relay.relogio.agora = INICIO + prazo - 1;
    relay.relay.limpar();
    expect(contar('pacotes')).toBe(1);
    expect(pedacosNoArquivo(pacote)).toBeGreaterThanOrEqual(127);

    // O banco arredonda o prazo para a hora cheia de cima: no máximo uma hora a mais.
    relay.relogio.agora = INICIO + prazo + HORA;
    relay.relay.limpar();
    expect(contar('pacotes')).toBe(0);
    expect(pedacosNoArquivo(pacote)).toBe(0);
  });

  it('o banco guarda só a hora cheia, sem minuto nem segundo', async () => {
    await caixaComPacote();
    const [linha] = relay.consultar('SELECT expira_em FROM pacotes');
    const prazo = Number(linha?.['expira_em']);
    expect(prazo % HORA).toBe(0);
    expect(prazo).toBe(horaCheia(INICIO + RETENCAO_DO_PACOTE_EM_DIAS * DIA));
    for (const tabela of ['caixas', 'pacotes']) {
      for (const { expira_em } of relay.consultar(`SELECT expira_em FROM ${tabela}`)) {
        expect(Number(expira_em) % HORA).toBe(0);
      }
    }
  });
});

describe(`cartão sem renovação some em ${RETENCAO_DO_CARTAO_EM_DIAS} dias`, () => {
  it('some com as prekeys, e a mesma publicação não volta depois', async () => {
    const bob = novaIdentidade();
    const publicacao = publicacaoDe(bob, { prekeys: [1, 2] });
    await cliente.pedir({ tipo: 'publicar-cartao', publicacao });
    const prazo = RETENCAO_DO_CARTAO_EM_DIAS * DIA;

    relay.relogio.agora = INICIO + prazo - 1;
    relay.relay.limpar();
    expect(contar('cartoes')).toBe(1);

    relay.relogio.agora = INICIO + prazo + HORA;
    relay.relay.limpar();
    expect([contar('cartoes'), contar('prekeys')]).toEqual([0, 0]);
    expect(codigo(await cliente.pedir({ tipo: 'buscar-cartao', id: bob.id }))).toBe(
      'cartao-inexistente',
    );
    // Quem guardou a publicação não consegue ressuscitar o cartão nem as prekeys.
    expect(codigo(await cliente.pedir({ tipo: 'publicar-cartao', publicacao }))).toBe(
      'cartao-fora-do-prazo',
    );
  });

  it('renovar adia o prazo', async () => {
    const bob = novaIdentidade();
    await cliente.pedir({ tipo: 'publicar-cartao', publicacao: publicacaoDe(bob) });
    relay.relogio.agora = INICIO + 60 * DIA;
    const renovado = publicacaoDe(bob, { data: relay.relogio.agora });
    expect(codigo(await cliente.pedir({ tipo: 'publicar-cartao', publicacao: renovado }))).toBe(
      'cartao-publicado',
    );
    relay.relogio.agora = INICIO + 100 * DIA;
    relay.relay.limpar();
    expect(contar('cartoes')).toBe(1);
  });
});

describe(`caixa sem abertura some em ${RETENCAO_DA_CAIXA_EM_DIAS} dias`, () => {
  const prazo = RETENCAO_DA_CAIXA_EM_DIAS * DIA;

  it('some com o que houver nela; depositar depois dá caixa-inexistente', async () => {
    const { caixa } = await caixaComPacote();
    relay.relogio.agora = INICIO + prazo + HORA;
    relay.relay.limpar();
    expect([contar('caixas'), contar('pacotes')]).toEqual([0, 0]);
    const deposito = await cliente.pedir({
      tipo: 'depositar',
      caixa: caixa.publicKey,
      pacote: pacoteAleatorio(),
      marca: marcaDeTeste(),
    });
    expect(codigo(deposito)).toBe('caixa-inexistente');
  });

  it('abrir a caixa adia o prazo', async () => {
    const caixa = novoPar();
    await cliente.pedir({ tipo: 'criar-caixa', caixa: caixa.publicKey });
    relay.relogio.agora = INICIO + 80 * DIA;
    const dono = await relay.conectar();
    await abrir(dono, caixa);
    await dono.fechar();
    relay.relogio.agora = INICIO + 100 * DIA;
    relay.relay.limpar();
    expect(contar('caixas')).toBe(1);
  });

  it('a caixa que segue aberta numa conexão não vence', async () => {
    const caixa = novoPar();
    await cliente.pedir({ tipo: 'criar-caixa', caixa: caixa.publicKey });
    const dono = await relay.conectar();
    await abrir(dono, caixa);
    for (let dia = 30; dia <= 120; dia += 30) {
      relay.relogio.agora = INICIO + dia * DIA;
      relay.relay.limpar();
    }
    expect(contar('caixas')).toBe(1);
  });
});
