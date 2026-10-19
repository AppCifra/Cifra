import { formatarId, TAMANHO_DO_PACOTE } from '@cifra/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClienteDoRelay } from '../scripts/cliente.ts';
import {
  abrir,
  contem,
  novaIdentidade,
  novoPar,
  publicacaoDe,
  sodium,
  subirRelay,
  TAXAS_LIVRES,
  type IdentidadeDeTeste,
  type RelayDeTeste,
  marcaDeTeste,
} from './ajuda.ts';

// RNF-03: o relay nunca recebe conteúdo em claro nem quem enviou. Verificação do SPEC: dump do
// banco do relay. Aqui o pacote tem a forma do envelope do app: o texto e o ID de quem envia dentro
// de um crypto_box_seal para a chave do destinatário, com padding até 4096 bytes.

let relay: RelayDeTeste;

beforeEach(async () => {
  relay = await subirRelay(TAXAS_LIVRES);
});

afterEach(async () => {
  await relay.fechar();
});

const texto = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

/** Envelope selado com remetente e texto dentro, do tamanho exato do pacote. */
function envelope(remetente: IdentidadeDeTeste, para: IdentidadeDeTeste, mensagem: string) {
  const conteudo = new Uint8Array(TAMANHO_DO_PACOTE - sodium.crypto_box_SEALBYTES);
  conteudo.set(Buffer.from(`${formatarId(remetente.id)}\n${mensagem}`, 'utf8'));
  const destino = sodium.crypto_sign_ed25519_pk_to_curve25519(para.publicKey);
  return sodium.crypto_box_seal(conteudo, destino);
}

async function cenario() {
  const alice = novaIdentidade();
  const bob = novaIdentidade();
  const caixaDaAlice = novoPar();
  const caixaDoBob = novoPar();

  // Cada um publica o cartão e abre a própria caixa numa conexão.
  const conexaoDaAlice = await relay.conectar();
  const conexaoDoBob = await relay.conectar();
  for (const [conexao, identidade, caixa] of [
    [conexaoDaAlice, alice, caixaDaAlice],
    [conexaoDoBob, bob, caixaDoBob],
  ] as const) {
    await conexao.pedir({ tipo: 'criar-caixa', caixa: caixa.publicKey });
    await conexao.pedir({
      tipo: 'publicar-cartao',
      publicacao: publicacaoDe(identidade, { caixa: caixa.publicKey, prekeys: [1, 2] }),
    });
    await abrir(conexao, caixa);
  }

  // A Alice busca o cartão do Bob e deposita por outra conexão, sem caixa aberta.
  const envio: ClienteDoRelay = await relay.conectar();
  const encontrado = await envio.pedir({ tipo: 'buscar-cartao', id: bob.id });
  if (encontrado.tipo !== 'cartao-encontrado') throw new Error('cartão do Bob');
  const mensagens = ['encontro na praça às nove', 'leve o documento', 'apague depois de ler'];
  const pacotes = mensagens.map((mensagem) => envelope(alice, bob, mensagem));
  const marcas = pacotes.map(() => marcaDeTeste());
  for (const [i, pacote] of pacotes.entries()) {
    await envio.pedir({
      tipo: 'depositar',
      caixa: encontrado.cartao.caixaPrincipal,
      pacote,
      marca: marcas[i] ?? marcaDeTeste(),
    });
  }
  return { alice, bob, caixaDoBob, conexaoDoBob, mensagens, pacotes, marcas };
}

describe('dump do banco do relay (RNF-03)', () => {
  it('nenhum texto em claro e nenhum ID de quem enviou, em lugar nenhum do arquivo', async () => {
    const { alice, mensagens } = await cenario();
    const dump = relay.bytesDoBanco();
    for (const mensagem of mensagens) {
      expect(contem(dump, Buffer.from(mensagem, 'utf8'))).toBe(false);
    }
    expect(texto(dump)).not.toContain(formatarId(alice.id));
    expect(texto(dump)).not.toContain(formatarId(alice.id).replace(/-/g, ''));
  });

  it('o pacote guardado é o blob de 4096 bytes que chegou, com a marca de aviso fechada e só a caixa de destino', async () => {
    const { alice, caixaDoBob, pacotes, marcas } = await cenario();
    const linhas = relay.consultar('SELECT * FROM pacotes ORDER BY ordem');
    expect(linhas.map((linha) => Object.keys(linha).sort())).toEqual(
      pacotes.map(() => ['caixa', 'expira_em', 'id', 'marca', 'ordem', 'pacote']),
    );
    for (const [i, linha] of linhas.entries()) {
      const pacote = linha['pacote'] as Uint8Array;
      expect(pacote).toHaveLength(TAMANHO_DO_PACOTE);
      expect(new Uint8Array(pacote)).toEqual(pacotes[i]);
      // A marca fica como chegou: o relay não tem a chave da caixa para abrir.
      expect(new Uint8Array(linha['marca'] as Uint8Array)).toEqual(marcas[i]);
      expect(new Uint8Array(linha['caixa'] as Uint8Array)).toEqual(caixaDoBob.publicKey);
      // Nada da Alice na linha: nem o ID, nem a chave de identidade.
      const tudo = Buffer.concat(
        Object.values(linha).map((valor) =>
          valor instanceof Uint8Array ? Buffer.from(valor) : Buffer.from(String(valor)),
        ),
      );
      expect(contem(tudo, alice.id)).toBe(false);
      expect(contem(tudo, alice.publicKey)).toBe(false);
    }
  });

  it('quem enviou só aparece dentro do envelope, que só o destinatário abre', async () => {
    const { alice, bob, conexaoDoBob, mensagens } = await cenario();
    const publica = sodium.crypto_sign_ed25519_pk_to_curve25519(bob.publicKey);
    const privada = sodium.crypto_sign_ed25519_sk_to_curve25519(bob.privateKey);
    const outra = sodium.crypto_box_keypair();
    const abertos: string[] = [];
    while (abertos.length < mensagens.length) {
      const aviso = await conexaoDoBob.proximoAviso();
      if (aviso.tipo !== 'pacote') continue;
      expect(aviso.pacote).toHaveLength(TAMANHO_DO_PACOTE);
      expect(() =>
        sodium.crypto_box_seal_open(aviso.pacote, outra.publicKey, outra.privateKey),
      ).toThrow();
      const conteudo = sodium.crypto_box_seal_open(aviso.pacote, publica, privada);
      abertos.push(Buffer.from(conteudo).toString('utf8').replace(/\0+$/, ''));
    }
    expect(abertos).toEqual(mensagens.map((mensagem) => `${formatarId(alice.id)}\n${mensagem}`));
  });

  it('o esquema não tem coluna de remetente, IP ou conexão, e nenhuma tabela a mais', () => {
    const tabelas = relay.consultar(
      "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
    );
    expect(tabelas.map((linha) => linha['name'])).toEqual([
      'anexos',
      'caixas',
      'cartoes',
      'contagens',
      'pacotes',
      'pedacos',
      'prekeys',
    ]);
    const colunas = Object.fromEntries(
      ['anexos', 'caixas', 'cartoes', 'contagens', 'pacotes', 'pedacos', 'prekeys'].map(
        (tabela) => [
          tabela,
          relay
            .consultar(`SELECT name FROM pragma_table_info('${tabela}') ORDER BY cid`)
            .map((linha) => linha['name']),
        ],
      ),
    );
    expect(colunas).toEqual({
      anexos: ['id', 'tamanho', 'completo', 'expira_em'],
      caixas: ['chave', 'expira_em'],
      cartoes: ['id', 'cartao', 'data', 'expira_em'],
      contagens: ['tabela', 'n'],
      pacotes: ['ordem', 'caixa', 'id', 'pacote', 'expira_em', 'marca'],
      pedacos: ['anexo', 'indice', 'dados'],
      prekeys: ['cartao', 'numero', 'chave'],
    });
  });

  it('nenhum IP no arquivo', async () => {
    await cenario();
    const dump = texto(relay.bytesDoBanco());
    for (const ip of ['127.0.0.1', '::1', '::ffff:', 'localhost']) {
      expect(dump).not.toContain(ip);
    }
  });
});
