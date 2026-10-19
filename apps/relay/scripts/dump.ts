// Dump do relay (RNF-03, RNF-05, RNF-14), sobre uma cópia do banco de um relay de verdade
// (docs/VERIFICACAO.md). Confere o que a perícia acharia no arquivo:
//
// - nenhum marcador do cenário de teste (textos de mensagem, apelidos, nomes de anexo), em UTF-8 ou
//   UTF-16;
// - nenhum ID escrito (com ou sem hífens) e nenhum ID ou chave de identidade em bytes fora das
//   tabelas do cartão: nem nos pacotes, nem nos anexos;
// - nenhum IP;
// - só as tabelas e colunas conhecidas, sem coluna de remetente, IP ou conexão;
// - datas só na hora cheia (a do cartão anda 1 ms por publicação na mesma hora).
//
//   node apps/relay/scripts/dump.ts <relay.sqlite> [marcadores.txt] [ID]...
//
// Sai com 1 se achou algum problema. Não escreve o conteúdo do banco, só o que achou.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { formatarId, lerCartao, lerId } from '@cifra/protocol';

const HORA = 3_600_000;

/** Folga da data do cartão: cada publicação na mesma hora anda 1 ms (core, publicacao.ts). */
const FOLGA_DO_CARTAO = 60_000;

export const ESQUEMA: Record<string, readonly string[]> = {
  anexos: ['id', 'tamanho', 'completo', 'expira_em'],
  caixas: ['chave', 'expira_em'],
  cartoes: ['id', 'cartao', 'data', 'expira_em'],
  contagens: ['tabela', 'n'],
  pacotes: ['ordem', 'caixa', 'id', 'pacote', 'expira_em', 'marca'],
  pedacos: ['anexo', 'indice', 'dados'],
  prekeys: ['cartao', 'numero', 'chave'],
};

const IP = /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/g;

const contem = (palheiro: Buffer, agulha: Uint8Array) =>
  agulha.length > 0 && palheiro.indexOf(Buffer.from(agulha)) !== -1;

const bytesDaLinha = (linha: Record<string, unknown>) =>
  Buffer.concat(
    Object.values(linha).map((valor) =>
      valor instanceof Uint8Array ? Buffer.from(valor) : Buffer.from(String(valor)),
    ),
  );

export function conferirDump(
  caminho: string,
  marcadores: readonly string[],
  ids: readonly string[],
): string[] {
  const problemas: string[] = [];
  const arquivo = readFileSync(caminho);
  const texto = arquivo.toString('latin1');

  for (const marcador of marcadores) {
    for (const forma of ['utf8', 'utf16le'] as const) {
      if (contem(arquivo, Buffer.from(marcador, forma))) {
        problemas.push(`marcador "${marcador}" (${forma})`);
      }
    }
  }
  for (const ip of new Set(texto.match(IP) ?? [])) problemas.push(`IP ${ip}`);

  const banco = new DatabaseSync(caminho, { readOnly: true });
  try {
    const tabelas = banco
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
      .all()
      .map((linha) => String(linha['name']));
    if (tabelas.join() !== Object.keys(ESQUEMA).sort().join()) {
      problemas.push(`tabelas: ${tabelas.join(', ')}`);
    }
    for (const [tabela, colunas] of Object.entries(ESQUEMA)) {
      const reais = banco
        .prepare(`SELECT name FROM pragma_table_info('${tabela}') ORDER BY cid`)
        .all()
        .map((linha) => String(linha['name']));
      if (reais.join() !== colunas.join())
        problemas.push(`colunas de ${tabela}: ${reais.join(', ')}`);
    }

    // Cada ID: escrito, em lugar nenhum; em bytes, só no cartão do próprio dono.
    const fora = ['pacotes', 'anexos', 'pedacos', 'caixas'].flatMap((tabela) =>
      banco.prepare(`SELECT * FROM ${tabela}`).all().map(bytesDaLinha),
    );
    for (const id of ids) {
      const bytes = lerId(id);
      if (!bytes) {
        problemas.push(`ID inválido no pedido: ${id}`);
        continue;
      }
      const escrito = formatarId(bytes);
      if (texto.includes(escrito) || texto.includes(escrito.replace(/-/g, ''))) {
        problemas.push(`ID ${escrito} escrito no arquivo`);
      }
      const linha = banco.prepare('SELECT cartao, data FROM cartoes WHERE id = ?').get(bytes);
      const guardado = linha?.['cartao'];
      if (linha && Number(linha['data']) % HORA >= FOLGA_DO_CARTAO) {
        problemas.push(`cartão de ${escrito} com data fora da hora cheia`);
      }
      const chaveDeIdentidade =
        guardado instanceof Uint8Array ? (lerCartao(guardado)?.chaveDeIdentidade ?? null) : null;
      if (fora.some((linha) => contem(linha, bytes)))
        problemas.push(`ID ${escrito} fora do cartão`);
      if (chaveDeIdentidade && fora.some((linha) => contem(linha, chaveDeIdentidade))) {
        problemas.push(`chave de ${escrito} fora do cartão`);
      }
    }

    for (const tabela of ['anexos', 'caixas', 'cartoes', 'pacotes']) {
      const fora = banco
        .prepare(`SELECT count(*) AS n FROM ${tabela} WHERE expira_em % ${HORA} <> 0`)
        .get()?.['n'];
      if (fora !== 0) problemas.push(`${String(fora)} data(s) de ${tabela} fora da hora cheia`);
    }
    // Com o dia de cada um: o cartão com a data fora da hora cheia só muda quando o dono publicar
    // de novo.
    const dias = banco
      .prepare(`SELECT data FROM cartoes WHERE data % ${HORA} >= ${FOLGA_DO_CARTAO} ORDER BY data`)
      .all()
      .map((linha) => new Date(Number(linha['data'])).toISOString().slice(0, 10));
    if (dias.length > 0) {
      problemas.push(
        `${String(dias.length)} cartão(ões) com data fora da hora cheia (${[...new Set(dias)].join(', ')})`,
      );
    }
  } finally {
    banco.close();
  }
  return problemas;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [caminho, arquivoDeMarcadores, ...ids] = process.argv.slice(2);
  if (!caminho) {
    process.stderr.write('uso: dump.ts <relay.sqlite> [marcadores.txt] [ID]...\n');
    process.exit(2);
  }
  const marcadores = arquivoDeMarcadores
    ? readFileSync(arquivoDeMarcadores, 'utf8')
        .split(/\r?\n/)
        .map((linha) => linha.trim())
        .filter((linha) => linha !== '' && !linha.startsWith('#'))
    : [];
  const problemas = conferirDump(caminho, marcadores, ids);
  for (const problema of problemas) process.stdout.write(`problema: ${problema}\n`);
  process.stdout.write(problemas.length === 0 ? 'dump ok\n' : `${problemas.length} problema(s)\n`);
  process.exitCode = problemas.length > 0 ? 1 : 0;
}
