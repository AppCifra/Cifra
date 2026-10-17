import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { celulasDoIdenticon, gerarIdentidade } from '@cifra/core';
import { afterEach, describe, expect, it } from 'vitest';
import { cripto } from '../../../packages/core/test/adaptadores/sodium-node.ts';
import {
  abrirSessao,
  criarSessao,
  encerrarSessao,
  ErroNaAbertura,
  type FalhaNaAbertura,
  type Plataforma,
  type Sessao,
} from '../src/sessao.ts';
import { plataformaDeTeste as criarPlataforma, type PlataformaDeTeste } from './plataforma.ts';

const testes: PlataformaDeTeste[] = [];
const sessoes: Sessao[] = [];

afterEach(() => {
  for (const sessao of sessoes.splice(0)) sessao.banco.fechar();
  for (const teste of testes.splice(0)) {
    for (const banco of teste.bancos) banco.fechar();
    teste.limpar();
  }
});

function plataformaDeTeste(): PlataformaDeTeste {
  const teste = criarPlataforma();
  testes.push(teste);
  return teste;
}

/** Abre e registra para fechar no fim do teste. */
async function abrir(plataforma: Plataforma) {
  const sessao = await abrirSessao(plataforma);
  if (sessao) sessoes.push(sessao);
  return sessao;
}

/** A falha com que a abertura rejeita. */
async function falhaAoAbrir(plataforma: Plataforma): Promise<FalhaNaAbertura | 'abriu'> {
  try {
    await abrir(plataforma);
    return 'abriu';
  } catch (erro) {
    if (erro instanceof ErroNaAbertura) return erro.falha;
    throw erro;
  }
}

describe('primeira abertura', () => {
  it('sem identidade: nenhum pedido de biometria e nenhum arquivo criado', async () => {
    const { plataforma, cofre, arquivo } = plataformaDeTeste();
    expect(await abrir(plataforma)).toBeNull();
    expect(cofre.pedidos).toBe(0);
    expect(existsSync(arquivo)).toBe(false);
  });
});

describe('identidade guardada (RF-01)', () => {
  it('o ID e o identicon não mudam entre aberturas', async () => {
    const { plataforma } = plataformaDeTeste();
    const { identidade } = gerarIdentidade(cripto, 'portugues');
    (await criarSessao(plataforma, identidade)).banco.fechar();

    for (let abertura = 0; abertura < 3; abertura++) {
      const sessao = await abrirSessao(plataforma);
      sessao?.banco.fechar();
      expect(sessao?.identidade.id).toBe(identidade.id);
      expect(sessao?.identidade.assinatura).toEqual(identidade.assinatura);
      expect(celulasDoIdenticon(sessao?.identidade.id ?? '', 6)).toEqual(
        celulasDoIdenticon(identidade.id, 6),
      );
    }
  });
});

describe('chave mestra só no desbloqueio (RNF-07)', () => {
  it('é sorteada, tem 256 bits e fica no Keystore só com desbloqueio', async () => {
    const { plataforma, cofre, copias } = plataformaDeTeste();
    sessoes.push(await criarSessao(plataforma, gerarIdentidade(cripto, 'ingles').identidade));

    const guardada = cofre.guardados.get('chave-mestra');
    expect(guardada?.protecao).toBe('desbloqueio');
    expect(guardada?.segredo).toHaveLength(32);
    expect(guardada?.segredo.some((byte) => byte !== 0)).toBe(true);
    expect(copias).toEqual([guardada?.segredo]);
    expect(cofre.pedidos).toBe(1);
  });

  it('abrir pede biometria ou senha uma vez e usa a chave guardada', async () => {
    const { plataforma, cofre, copias } = plataformaDeTeste();
    (await criarSessao(plataforma, gerarIdentidade(cripto, 'ingles').identidade)).banco.fechar();
    cofre.pedidos = 0;

    await abrir(plataforma);
    expect(cofre.pedidos).toBe(1);
    expect(copias[1]).toEqual(cofre.guardados.get('chave-mestra')?.segredo);
  });

  it('zera a cópia da chave mestra depois de abrir o banco', async () => {
    const { plataforma, chavesRecebidas } = plataformaDeTeste();
    (await criarSessao(plataforma, gerarIdentidade(cripto, 'portugues').identidade)).banco.fechar();
    await abrir(plataforma);
    expect(chavesRecebidas).toHaveLength(2);
    for (const chave of chavesRecebidas) expect(chave.every((byte) => byte === 0)).toBe(true);
  });

  it('encerrar fecha o banco e zera a semente, as chaves privadas e a semente da caixa', async () => {
    const { plataforma } = plataformaDeTeste();
    const { identidade } = gerarIdentidade(cripto, 'portugues');
    (await criarSessao(plataforma, identidade)).banco.fechar();
    const sessao = await abrirSessao(plataforma);
    if (!sessao) throw new Error('sem sessão');

    encerrarSessao(cripto, sessao);

    await expect(sessao.banco.banco.consultar('SELECT 1')).rejects.toThrow();
    const zerado = (bytes: Uint8Array) => bytes.length > 0 && bytes.every((byte) => byte === 0);
    expect(zerado(sessao.identidade.semente)).toBe(true);
    expect(zerado(sessao.identidade.assinatura.privateKey)).toBe(true);
    expect(zerado(sessao.identidade.acordo.privateKey)).toBe(true);
    expect(zerado(sessao.sementeDaCaixa)).toBe(true);
    // O que é público continua: a tela ainda pode mostrar o ID até sair.
    expect(sessao.identidade.id).toBe(identidade.id);
  });
});

describe('quando não dá para guardar ou abrir', () => {
  it('sem bloqueio de tela ou com o pedido cancelado, nada fica guardado', async () => {
    const { plataforma, cofre, arquivo } = plataformaDeTeste();
    cofre.falharAoGuardar = true;
    await expect(
      criarSessao(plataforma, gerarIdentidade(cripto, 'portugues').identidade),
    ).rejects.toThrow();
    expect(existsSync(arquivo)).toBe(false);
    expect(cofre.guardados.size).toBe(0);
    expect(await abrir(plataforma)).toBeNull();
  });

  it('cancelar o pedido ao abrir não apaga nada: a identidade abre na tentativa seguinte', async () => {
    const { plataforma, cofre, arquivo } = plataformaDeTeste();
    const { identidade } = gerarIdentidade(cripto, 'ingles');
    (await criarSessao(plataforma, identidade)).banco.fechar();

    cofre.cancelarAoLer = true;
    expect(await falhaAoAbrir(plataforma)).toBe('cancelado');
    expect(existsSync(arquivo)).toBe(true);

    cofre.cancelarAoLer = false;
    expect((await abrir(plataforma))?.identidade.id).toBe(identidade.id);
  });

  it('chave apagada pelo aparelho: nenhum pedido aparece e o banco continua lá', async () => {
    const { plataforma, cofre, arquivo } = plataformaDeTeste();
    (await criarSessao(plataforma, gerarIdentidade(cripto, 'ingles').identidade)).banco.fechar();
    cofre.pedidos = 0;
    cofre.chavesPerdidas = true;

    expect(await falhaAoAbrir(plataforma)).toBe('chave-perdida');
    expect(cofre.pedidos).toBe(0);
    expect(existsSync(arquivo)).toBe(true);
  });

  it('depois da chave perdida, a identidade restaurada apaga o banco antigo e abre', async () => {
    const { plataforma, cofre } = plataformaDeTeste();
    const { identidade } = gerarIdentidade(cripto, 'portugues');
    const antiga = await criarSessao(plataforma, identidade);
    // Uma marca no banco antigo, para ver que ele não continua.
    await antiga.banco.banco.executar('CREATE TABLE do_banco_antigo (x INTEGER)');
    antiga.banco.fechar();
    cofre.chavesPerdidas = true;
    expect(await falhaAoAbrir(plataforma)).toBe('chave-perdida');

    // O celular ganhou um bloqueio de tela de novo, e a pessoa restaura com as palavras.
    cofre.chavesPerdidas = false;
    const nova = await criarSessao(plataforma, identidade);
    sessoes.push(nova);
    expect(
      await nova.banco.banco.consultar(
        "SELECT name FROM sqlite_schema WHERE name = 'do_banco_antigo'",
      ),
    ).toEqual([]);
    expect(nova.identidade.id).toBe(identidade.id);
  });

  it('banco que não abre com a chave: falha à parte, sem apagar nada', async () => {
    const teste = plataformaDeTeste();
    (
      await criarSessao(teste.plataforma, gerarIdentidade(cripto, 'ingles').identidade)
    ).banco.fechar();
    teste.ilegivel = true;
    expect(await falhaAoAbrir(teste.plataforma)).toBe('banco-ilegivel');
    expect(existsSync(teste.arquivo)).toBe(true);
    // A chave mestra lida também é zerada quando o banco não abre.
    expect(teste.chavesRecebidas.at(-1)?.every((byte) => byte === 0)).toBe(true);
  });

  it('outro erro, talvez passageiro, é só uma falha: a próxima tentativa abre', async () => {
    const { plataforma, cofre } = plataformaDeTeste();
    const { identidade } = gerarIdentidade(cripto, 'portugues');
    (await criarSessao(plataforma, identidade)).banco.fechar();
    cofre.falharAoLer = true;
    expect(await falhaAoAbrir(plataforma)).toBe('falhou');
    cofre.falharAoLer = false;
    expect((await abrir(plataforma))?.identidade.id).toBe(identidade.id);
  });

  it('chave sem identidade (onboarding interrompido) volta ao onboarding, que refaz tudo', async () => {
    const { plataforma, cofre } = plataformaDeTeste();
    const antiga = cripto.randombytes_buf(32);
    await cofre.guardar('chave-mestra', antiga, 'desbloqueio');

    expect(await abrir(plataforma)).toBeNull();

    const { identidade } = gerarIdentidade(cripto, 'portugues');
    sessoes.push(await criarSessao(plataforma, identidade));
    expect(cofre.guardados.get('chave-mestra')?.segredo).not.toEqual(antiga);
  });
});

describe('chave da caixa principal no relay', () => {
  it('nasce com a identidade, sorteada, no Keystore sem pedido de desbloqueio', async () => {
    const { plataforma, cofre } = plataformaDeTeste();
    const sessao = await criarSessao(plataforma, gerarIdentidade(cripto, 'portugues').identidade);
    sessoes.push(sessao);
    const guardada = cofre.guardados.get('chave-da-caixa');
    expect(guardada?.protecao).toBe('aparelho');
    expect(guardada?.segredo).toEqual(sessao.sementeDaCaixa);
    expect(sessao.sementeDaCaixa).toHaveLength(32);
    expect(cofre.pedidos).toBe(1);
  });

  it('abrir devolve a mesma caixa, sem pedido a mais', async () => {
    const { plataforma, cofre } = plataformaDeTeste();
    const criada = await criarSessao(plataforma, gerarIdentidade(cripto, 'ingles').identidade);
    criada.banco.fechar();
    cofre.pedidos = 0;
    const aberta = await abrir(plataforma);
    expect(aberta?.sementeDaCaixa).toEqual(criada.sementeDaCaixa);
    expect(cofre.pedidos).toBe(1);
  });

  it('identidade sem caixa: abrir sorteia e guarda uma', async () => {
    const { plataforma, cofre } = plataformaDeTeste();
    (await criarSessao(plataforma, gerarIdentidade(cripto, 'ingles').identidade)).banco.fechar();
    await cofre.destruir('chave-da-caixa');
    const aberta = await abrir(plataforma);
    expect(aberta?.sementeDaCaixa).toHaveLength(32);
    expect(cofre.guardados.get('chave-da-caixa')?.segredo).toEqual(aberta?.sementeDaCaixa);
  });

  it('identidade nova troca a caixa', async () => {
    const { plataforma, cofre } = plataformaDeTeste();
    const primeira = await criarSessao(plataforma, gerarIdentidade(cripto, 'ingles').identidade);
    primeira.banco.fechar();
    const segunda = await criarSessao(plataforma, gerarIdentidade(cripto, 'ingles').identidade);
    sessoes.push(segunda);
    expect(segunda.sementeDaCaixa).not.toEqual(primeira.sementeDaCaixa);
    expect(cofre.guardados.get('chave-da-caixa')?.segredo).toEqual(segunda.sementeDaCaixa);
  });
});

describe('o cofre das conversas ocultas desde a instalação (RNF-11)', () => {
  /** O bloco do cofre na plataforma de teste. */
  const BLOCO = 1024 * 1024;

  it('a identidade nova ganha um cofre vazio de um bloco; abrir de novo não mexe nele', async () => {
    const teste = plataformaDeTeste();
    const { plataforma } = teste;
    const criada = await criarSessao(plataforma, gerarIdentidade(cripto, 'portugues').identidade);
    criada.banco.fechar();
    expect(teste.contagem.truncar).toBe(1);
    expect(statSync(teste.arquivoDoCofre).size).toBe(BLOCO);
    const bytes = readFileSync(teste.arquivoDoCofre);

    const sessao = await abrir(plataforma);
    expect(sessao).not.toBeNull();
    // Abriu com uma chave sorteada, que não abre o cofre que já existe: nada mudou nele.
    expect(readFileSync(teste.arquivoDoCofre).equals(bytes)).toBe(true);
    expect(teste.contagem.tocar).toBeGreaterThanOrEqual(2);
    // O segredo do cofre sai da chave mestra: o mesmo a cada abertura, e nada novo no Keystore.
    expect(sessao?.segredoDoCofre).toEqual(criada.segredoDoCofre);
    expect([...teste.cofre.guardados.keys()].sort()).toEqual(['chave-da-caixa', 'chave-mestra']);
  });

  it('a instalação sem cofre ganha um na próxima abertura', async () => {
    const teste = plataformaDeTeste();
    const { plataforma } = teste;
    (await criarSessao(plataforma, gerarIdentidade(cripto, 'portugues').identidade)).banco.fechar();
    rmSync(teste.arquivoDoCofre);
    const sessao = await abrir(plataforma);
    expect(sessao).not.toBeNull();
    expect(statSync(teste.arquivoDoCofre).size).toBe(BLOCO);
  });

  it('o segredo do cofre é zerado ao fechar a sessão', async () => {
    const { plataforma } = plataformaDeTeste();
    const sessao = await criarSessao(plataforma, gerarIdentidade(cripto, 'portugues').identidade);
    expect(sessao.segredoDoCofre.some((byte) => byte !== 0)).toBe(true);
    encerrarSessao(cripto, sessao);
    expect(sessao.segredoDoCofre.every((byte) => byte === 0)).toBe(true);
  });
});
