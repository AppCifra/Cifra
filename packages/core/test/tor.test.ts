import { describe, expect, it } from 'vitest';
import { ate, avancarAte, pessoa } from './correio-de-teste.ts';

// RF-44: o app só conecta pelo Tor (Orbot). Com o Orbot fora, nada conecta, e o correio diz por
// quê, para a tela mostrar "tor · indisponível" em vez de "conectando" para sempre.

describe('Tor obrigatório (RF-44)', () => {
  it('sem Tor, a caixa não abre e o correio avisa; com o Tor de volta, conecta sozinho', async () => {
    const alice = await pessoa();
    alice.transporte.semTor = true;
    alice.correio.iniciar();
    await ate(
      () => alice.eventos.some((e) => e.tipo === 'caixa' && !e.aberta && e.semTor === true),
      'o aviso de Tor indisponível',
    );
    expect(alice.transporte.conexoes).toEqual([]);
    alice.transporte.semTor = false;
    await avancarAte(
      () => alice.eventos.some((e) => e.tipo === 'caixa' && e.aberta),
      'a caixa abre com o Tor de volta',
    );
  });
});
