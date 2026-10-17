import { formatarId, TAMANHO_DO_PACOTE } from '@cifra/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { conferirDump } from '../scripts/dump.ts';
import {
  HORA,
  INICIO,
  marcaDeTeste,
  novaIdentidade,
  pacoteAleatorio,
  publicacaoDe,
  subirRelay,
  TAXAS_LIVRES,
  type IdentidadeDeTeste,
  type RelayDeTeste,
} from './ajuda.ts';

// O script do dump do relay real (docs/VERIFICACAO.md): o que ele acusa num banco que vazasse, e
// que ele não acusa nada num banco como o relay guarda.

let relay: RelayDeTeste;

beforeEach(async () => {
  relay = await subirRelay(TAXAS_LIVRES);
});

afterEach(async () => {
  await relay.fechar();
});

async function publicar(identidade: IdentidadeDeTeste, data: number): Promise<void> {
  const conexao = await relay.conectar();
  await conexao.pedir({ tipo: 'criar-caixa', caixa: identidade.caixa.publicKey });
  await conexao.pedir({ tipo: 'publicar-cartao', publicacao: publicacaoDe(identidade, { data }) });
}

async function depositar(para: IdentidadeDeTeste, pacote: Uint8Array): Promise<void> {
  const conexao = await relay.conectar();
  await conexao.pedir({
    tipo: 'depositar',
    caixa: para.caixa.publicKey,
    pacote,
    marca: marcaDeTeste(),
  });
}

describe('dump do relay real (RNF-03, RNF-05, RNF-14)', () => {
  it('num banco como o relay guarda, nada a acusar', async () => {
    const [alice, bob] = [novaIdentidade(), novaIdentidade()];
    const hora = INICIO - (INICIO % HORA);
    await publicar(alice, hora);
    await publicar(bob, hora + 1);
    await depositar(bob, pacoteAleatorio());
    const ids = [alice, bob].map((pessoa) => formatarId(pessoa.id));
    expect(conferirDump(relay.caminho, ['xqzmensagem7k2'], ids)).toEqual([]);
  });

  it('acusa texto, ID fora do cartão, IP e data com minuto', async () => {
    const [alice, bob] = [novaIdentidade(), novaIdentidade()];
    await publicar(alice, INICIO);
    await publicar(bob, INICIO - (INICIO % HORA));
    const vazado = new Uint8Array(TAMANHO_DO_PACOTE);
    vazado.set(Buffer.from('de 10.1.2.3: xqzmensagem7k2'));
    vazado.set(alice.id, 100);
    await depositar(bob, vazado);
    const escrito = formatarId(alice.id);
    expect(conferirDump(relay.caminho, ['xqzmensagem7k2'], [escrito])).toEqual([
      'marcador "xqzmensagem7k2" (utf8)',
      'IP 10.1.2.3',
      `cartão de ${escrito} com data fora da hora cheia`,
      `ID ${escrito} fora do cartão`,
      '1 cartão(ões) com data fora da hora cheia (2026-10-01)',
    ]);
  });
});
