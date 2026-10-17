import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  carregarIdentidade,
  celulasDoIdenticon,
  gerarIdentidade,
  guardarIdentidade,
  identidadeDaEntropia,
  migrar,
  palavrasDaEntropia,
  VERSAO_DO_ESQUEMA,
} from '../src/index.ts';
import { cripto } from './adaptadores/sodium-node.ts';
import {
  abrirBancoDeTeste,
  abrirBancoNoArquivo,
  pastaTemporaria,
  type BancoDeTeste,
} from './adaptadores/sqlite-node.ts';

const pastas: string[] = [];
let aberto: BancoDeTeste | undefined;

afterEach(() => {
  aberto?.fechar();
  aberto = undefined;
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true });
});

/** Um arquivo de banco numa pasta temporária, apagada no fim do teste. */
function arquivoNovo(): string {
  const pasta = pastaTemporaria();
  pastas.push(pasta);
  return join(pasta, 'cifra.sqlite');
}

describe('identidade guardada (RF-01)', () => {
  it('o ID, o identicon e as chaves não mudam entre aberturas', async () => {
    const arquivo = arquivoNovo();
    const { identidade } = gerarIdentidade(cripto, 'portugues');

    const primeira = abrirBancoNoArquivo(arquivo);
    await migrar(primeira.banco);
    await guardarIdentidade(primeira.banco, identidade);
    primeira.fechar();

    for (let abertura = 0; abertura < 3; abertura++) {
      const banco = abrirBancoNoArquivo(arquivo);
      await migrar(banco.banco);
      const carregada = await carregarIdentidade(banco.banco, cripto);
      banco.fechar();

      expect(carregada?.id).toBe(identidade.id);
      expect(carregada?.assinatura).toEqual(identidade.assinatura);
      expect(carregada?.acordo).toEqual(identidade.acordo);
      for (const grade of [5, 6] as const) {
        expect(celulasDoIdenticon(carregada?.id ?? '', grade)).toEqual(
          celulasDoIdenticon(identidade.id, grade),
        );
      }
    }
  });

  it('o banco guarda só a semente: nem as palavras nem o ID', async () => {
    const arquivo = arquivoNovo();
    // Entropia fixa: com palavras sorteadas, uma palavra curta como "dad" poderia aparecer por
    // acaso dentro do texto do esquema ("identidade").
    const entropia = Uint8Array.from(Buffer.from('9e885d952ad362caeb4efe34a8e91bd2', 'hex'));
    const identidade = identidadeDaEntropia(cripto, entropia);
    const palavras = [
      ...palavrasDaEntropia(cripto, entropia, 'ingles'),
      ...palavrasDaEntropia(cripto, entropia, 'portugues'),
    ];
    const banco = abrirBancoNoArquivo(arquivo);
    await migrar(banco.banco);
    await guardarIdentidade(banco.banco, identidade);

    const colunas = await banco.banco.consultar(
      "SELECT name FROM pragma_table_info('identidade') ORDER BY cid",
    );
    expect(colunas.map((coluna) => coluna['name'])).toEqual(['unica', 'semente']);
    banco.fechar();

    // Neste teste o banco não é cifrado, então dá para procurar nos bytes do arquivo.
    const conteudo = readFileSync(arquivo).toString('latin1');
    expect(conteudo).not.toContain(identidade.id);
    expect(conteudo).not.toContain(identidade.id.replace(/-/g, ''));
    expect(palavras.filter((palavra) => conteudo.includes(palavra))).toEqual([]);
  });

  it('banco sem identidade devolve null', async () => {
    aberto = abrirBancoDeTeste();
    await migrar(aberto.banco);
    expect(await carregarIdentidade(aberto.banco, cripto)).toBeNull();
  });

  it('só existe uma identidade: guardar outra por cima falha e a primeira fica', async () => {
    aberto = abrirBancoDeTeste();
    await migrar(aberto.banco);
    const primeira = gerarIdentidade(cripto, 'portugues').identidade;
    await guardarIdentidade(aberto.banco, primeira);
    await expect(
      guardarIdentidade(aberto.banco, gerarIdentidade(cripto, 'portugues').identidade),
    ).rejects.toThrow();
    expect((await carregarIdentidade(aberto.banco, cripto))?.id).toBe(primeira.id);
  });

  it('o banco recusa semente que não tem 32 bytes', async () => {
    aberto = abrirBancoDeTeste();
    await migrar(aberto.banco);
    await expect(
      aberto.banco.executar('INSERT INTO identidade (unica, semente) VALUES (1, ?)', [
        new Uint8Array(31),
      ]),
    ).rejects.toThrow();
  });
});

describe('migrações do banco principal', () => {
  it('levam o banco até a versão atual e podem rodar de novo sem mudar nada', async () => {
    aberto = abrirBancoDeTeste();
    await migrar(aberto.banco);
    await migrar(aberto.banco);
    const [linha] = await aberto.banco.consultar('PRAGMA user_version');
    expect(linha?.['user_version']).toBe(VERSAO_DO_ESQUEMA);
    expect(VERSAO_DO_ESQUEMA).toBeGreaterThanOrEqual(1);
  });

  it('recusam banco de uma versão mais nova do app', async () => {
    aberto = abrirBancoDeTeste();
    await aberto.banco.executar(`PRAGMA user_version = ${VERSAO_DO_ESQUEMA + 1}`);
    await expect(migrar(aberto.banco)).rejects.toThrow();
  });

  it('quem já conversava antes dos contatos entra como contato aceito', async () => {
    aberto = abrirBancoDeTeste();
    const { banco } = aberto;
    await migrar(banco, 3);
    const [comMensagem, soComSessao] = [cripto.randombytes_buf(10), cripto.randombytes_buf(10)];
    await banco.executar(
      `INSERT INTO mensagens (id, conversa, de_mim, texto, enviada_em, ttl, status)
       VALUES (?, ?, 1, 'oi', 1, 0, 'enviada')`,
      [cripto.randombytes_buf(16), comMensagem],
    );
    for (const posicao of [0, 1]) {
      await banco.executar('INSERT INTO sessoes (contato, posicao, sessao) VALUES (?, ?, ?)', [
        soComSessao,
        posicao,
        new Uint8Array([1]),
      ]);
    }
    await migrar(banco);
    const contatos = await banco.consultar(
      'SELECT contato, aceito, bloqueado, verificado, apelido FROM contatos ORDER BY contato',
    );
    expect(contatos).toEqual(
      [comMensagem, soComSessao]
        .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
        .map((contato) => ({ contato, aceito: 1, bloqueado: 0, verificado: 0, apelido: null })),
    );
  });

  it('o que existia antes das temporárias fica sem timer, e os ajustes começam desligados', async () => {
    aberto = abrirBancoDeTeste();
    const { banco } = aberto;
    await migrar(banco, 4);
    const contato = cripto.randombytes_buf(10);
    await banco.executar('INSERT INTO contatos (contato, aceito, criado_em) VALUES (?, 1, 0)', [
      contato,
    ]);
    await banco.executar(
      `INSERT INTO mensagens (id, conversa, de_mim, texto, enviada_em, ttl, status)
       VALUES (?, ?, 1, 'oi', 1, 0, 'enviada')`,
      [cripto.randombytes_buf(16), contato],
    );
    await migrar(banco);
    expect(
      await banco.consultar('SELECT timer, timer_desde, timer_por_avisar FROM contatos'),
    ).toEqual([{ timer: 0, timer_desde: 0, timer_por_avisar: 0 }]);
    expect(await banco.consultar('SELECT expira_em, desfazer_ate FROM mensagens')).toEqual([
      { expira_em: null, desfazer_ate: null },
    ]);
    expect(await banco.consultar('SELECT timer_padrao, timer_da_nota FROM ajustes')).toEqual([
      { timer_padrao: 0, timer_da_nota: 0 },
    ]);
    // O banco recusa timer fora de 10 s a 7 dias.
    await expect(banco.executar('UPDATE contatos SET timer = 5')).rejects.toThrow();
    await expect(banco.executar('UPDATE ajustes SET timer_padrao = 604801')).rejects.toThrow();
  });
});
