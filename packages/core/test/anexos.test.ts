import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import {
  BYTES_DO_CABECALHO_DO_FLUXO,
  BYTES_DO_ID,
  BYTES_DO_PEDACO,
  caminhoDoAnexo,
  iguais,
  TAMANHO_MAXIMO_DO_CLARO,
  TAMANHO_MINIMO_DO_ANEXO,
  tamanhoDeAnexoValido,
  tamanhoDoAnexo,
} from '@cifra/protocol';
import { describe, expect, it } from 'vitest';
import {
  anexoConfere,
  CIRCUITO_DOS_ANEXOS,
  cifrarAnexo,
  decifrarAnexo,
  ErroDaAgenda,
  ErroDoCorreio,
  guardarMensagem,
  prepararAnexo,
  prepararBanco,
  type ArquivoParaEnviar,
  type EstadoDoAnexo,
} from '../src/index.ts';
import { guardarAnexo } from '../src/anexos/repositorio.ts';
import { itensDa } from '../src/mensagens/notas.ts';
import { cripto } from './adaptadores/sodium-node.ts';
import { abrirBancoDeTeste, contandoAsIdas } from './adaptadores/sqlite-node.ts';
import {
  andarAte,
  ate,
  avancarAte,
  conversa,
  online,
  pedidos,
  pessoa,
  redeParada,
  relay,
  relogio,
  textos,
  type Pessoa,
} from './correio-de-teste.ts';

// Anexos (RF-32 a RF-36, RF-54, RF-55, RF-57): a cifra do arquivo e o caminho dele pelo relay de
// verdade. A limpeza de metadados (RF-32 a RF-34) é da plataforma: aqui os arquivos são bytes
// aleatórios, fáceis de procurar nos bytes de um banco.

const aleatorios = (tamanho: number) => cripto.randombytes_buf(tamanho);

function imagem(tamanho = 50_000): ArquivoParaEnviar {
  return {
    arquivo: 'imagem',
    formato: 'image/jpeg',
    bytes: aleatorios(tamanho),
    miniatura: aleatorios(600),
    largura: 1600,
    altura: 1200,
  };
}

function video(tamanho = 200_000): ArquivoParaEnviar {
  return {
    arquivo: 'video',
    formato: 'video/mp4',
    bytes: aleatorios(tamanho),
    capa: aleatorios(20_000),
    miniatura: aleatorios(800),
    largura: 1280,
    altura: 720,
    duracao: 42_000,
  };
}

function documento(tamanho = 3_000): ArquivoParaEnviar {
  return { arquivo: 'documento', formato: 'application/pdf', bytes: aleatorios(tamanho) };
}

/** O texto claro de um arquivo: a capa (no vídeo) seguida dos bytes. */
function claroDe(arquivo: ArquivoParaEnviar): Uint8Array {
  const capa = arquivo.capa ?? new Uint8Array(0);
  const claro = new Uint8Array(capa.length + arquivo.bytes.length);
  claro.set(capa, 0);
  claro.set(arquivo.bytes, capa.length);
  return claro;
}

/** Algum trecho de `bytes` aparece em `dump`? Confere o começo, o meio e o fim, 64 bytes cada. */
function contem(dump: Buffer, bytes: Uint8Array): boolean {
  return [0, Math.floor(bytes.length / 2), bytes.length - 64].some((inicio) =>
    dump.includes(Buffer.from(bytes.subarray(inicio, inicio + 64))),
  );
}

const arquivoDoBanco = (p: Pessoa) => readFileSync(p.banco.caminho);

/** Uma cópia com um bit trocado na posição. */
function virado(bytes: Uint8Array, posicao: number): Uint8Array {
  const copia = bytes.slice();
  copia[posicao] = (copia[posicao] ?? 0) ^ 1;
  return copia;
}

const codigo = (promessa: Promise<unknown>) =>
  promessa.then(
    () => 'aceito',
    (erro: unknown) =>
      erro instanceof ErroDoCorreio || erro instanceof ErroDaAgenda ? erro.codigo : 'outro',
  );

/** O item da mensagem na conversa, como a tela recebe. */
async function itemDa(p: Pessoa, de: Pessoa, id: Uint8Array) {
  const item = (await p.agenda.itens(de.id)).find(
    (i) => i.tipo === 'mensagem' && iguais(i.mensagem.id, id),
  );
  return item?.tipo === 'mensagem' ? item : undefined;
}

const estadoDo = async (p: Pessoa, de: Pessoa, id: Uint8Array) =>
  (await itemDa(p, de, id))?.anexo?.estado;

const ficaEm = (p: Pessoa, de: Pessoa, id: Uint8Array, estado: EstadoDoAnexo) =>
  ate(async () => (await estadoDo(p, de, id)) === estado, `anexo ${estado}`);

const statusDa = async (p: Pessoa, de: Pessoa, id: Uint8Array) =>
  (await itemDa(p, de, id))?.mensagem.status;

const recebeu = (p: Pessoa, de: Pessoa, id: Uint8Array) =>
  ate(async () => (await itemDa(p, de, id)) !== undefined, 'mensagem chega');

const anexosNoRelay = () => relay.consultar('SELECT count(*) AS n FROM anexos')[0]?.['n'];

/** O blob como o relay guarda: os pedaços, em ordem. */
const blobNoRelay = () =>
  Buffer.concat(
    relay
      .consultar('SELECT dados FROM pedacos ORDER BY indice')
      .map((linha) => Buffer.from(linha['dados'] as Uint8Array)),
  );

async function blobNoBanco(p: Pessoa, id: Uint8Array): Promise<Uint8Array | null> {
  const [linha] = await p.banco.banco.consultar('SELECT blob FROM anexos WHERE mensagem = ?', [id]);
  const blob = linha?.['blob'];
  return blob instanceof Uint8Array ? blob : null;
}

const httpDe = (p: Pessoa, metodo: string) => p.transporte.http.filter((h) => h.metodo === metodo);

/** Um envio direto ao relay que parou no meio: ele tem o anexo pela metade até `cortar`. */
function subirParado(token: Uint8Array, blob: Uint8Array): { cortar: () => void } {
  const pedido = request(relay.endereco.replace('ws://', 'http://') + caminhoDoAnexo(token), {
    method: 'PUT',
    headers: { 'Content-Length': blob.length },
  });
  pedido.on('error', () => undefined);
  pedido.write(blob.subarray(0, Math.floor(blob.length / 2)));
  return {
    cortar: () => {
      pedido.destroy();
    },
  };
}

/** Segura os pedidos HTTP do método até `soltar`: uma transferência lenta pelo Tor. */
function segurar(p: Pessoa, metodo: string): { soltar: () => void } {
  let soltar: () => void = () => undefined;
  const solto = new Promise<void>((pronto) => {
    soltar = pronto;
  });
  p.transporte.segurarHttp = (pedido) => (pedido.metodo === metodo ? solto : null);
  return {
    soltar: () => {
      p.transporte.segurarHttp = null;
      soltar();
    },
  };
}

describe('cifra do anexo (RF-35)', () => {
  it('ida e volta: o blob tem o tamanho da faixa, confere pelo hash e abre com a chave', () => {
    const arquivo = video(3 * BYTES_DO_PEDACO + 123);
    const claro = claroDe(arquivo);
    const preparado = prepararAnexo(cripto, arquivo);
    if (!preparado) throw new Error('não preparou');
    const { anexo, blob, sha256 } = preparado;
    expect(blob).toHaveLength(tamanhoDoAnexo(claro.length));
    expect(tamanhoDeAnexoValido(blob.length)).toBe(true);
    expect(anexoConfere(cripto, blob, anexo.hash, claro.length)).toBe(true);
    expect(decifrarAnexo(cripto, blob, anexo.chave, claro.length)).toEqual(claro);
    // O SHA-256 que as duas pessoas comparam é o do arquivo, sem a capa.
    expect(sha256).toEqual(cripto.crypto_hash_sha256(arquivo.bytes));
    expect(anexo).toMatchObject({ capa: 20_000, tamanho: arquivo.bytes.length, duracao: 42_000 });
    // Token e chave novos a cada vez.
    const outro = prepararAnexo(cripto, arquivo);
    expect(outro?.anexo.token).not.toEqual(anexo.token);
    expect(outro?.anexo.chave).not.toEqual(anexo.chave);
  });

  it('blob adulterado, hash de outro ou chave errada: não abre', () => {
    const claro = aleatorios(100_000);
    const { blob, chave, hash } = cifrarAnexo(cripto, claro);
    const adulterado = virado(blob, BYTES_DO_CABECALHO_DO_FLUXO + 70_000);
    expect(anexoConfere(cripto, adulterado, hash, claro.length)).toBe(false);
    expect(decifrarAnexo(cripto, adulterado, chave, claro.length)).toBeNull();
    expect(anexoConfere(cripto, blob, aleatorios(32), claro.length)).toBe(false);
    expect(decifrarAnexo(cripto, blob, aleatorios(32), claro.length)).toBeNull();
    // Tamanho que não é o da faixa do texto claro dito na mensagem.
    expect(anexoConfere(cripto, blob, hash, claro.length + BYTES_DO_PEDACO * 4)).toBe(false);
    expect(decifrarAnexo(cripto, blob.subarray(1), chave, claro.length)).toBeNull();
  });

  it('fluxo cortado ou emendado: não abre, mesmo no tamanho certo', () => {
    const claro = aleatorios(2 * BYTES_DO_PEDACO);
    /** Cifra os pedaços com as etiquetas pedidas e completa até a faixa, como um app modificado. */
    const fluxo = (etiquetas: number[]) => {
      const chave = aleatorios(32);
      const blob = aleatorios(tamanhoDoAnexo(claro.length));
      const { state, header } = cripto.crypto_secretstream_xchacha20poly1305_init_push(chave);
      blob.set(header, 0);
      let posicao = header.length;
      etiquetas.forEach((etiqueta, i) => {
        const pedaco = claro.subarray(i * BYTES_DO_PEDACO, (i + 1) * BYTES_DO_PEDACO);
        const cifrado = cripto.crypto_secretstream_xchacha20poly1305_push(
          state,
          pedaco,
          null,
          etiqueta,
        );
        blob.set(cifrado, posicao);
        posicao += cifrado.length;
      });
      return decifrarAnexo(cripto, blob, chave, claro.length);
    };
    const { TAG_MESSAGE: meio, TAG_FINAL: fim } = {
      TAG_MESSAGE: cripto.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE,
      TAG_FINAL: cripto.crypto_secretstream_xchacha20poly1305_TAG_FINAL,
    };
    expect(fluxo([meio, fim])).toEqual(claro);
    // Sem a etiqueta final: o fluxo foi cortado.
    expect(fluxo([meio, meio])).toBeNull();
    // A final no meio: outro fluxo emendado depois.
    expect(fluxo([fim, fim])).toBeNull();
  });

  it('a capa sai do primeiro pedaço, sem decifrar o resto', () => {
    const arquivo = video(300_000);
    const preparado = prepararAnexo(cripto, arquivo);
    if (!preparado) throw new Error('não preparou');
    const { anexo, blob } = preparado;
    const claro = anexo.capa + anexo.tamanho;
    // O último pedaço estragado: a capa ainda abre; o vídeo inteiro, não.
    const estragado = virado(blob, BYTES_DO_CABECALHO_DO_FLUXO + 4 * (BYTES_DO_PEDACO + 17) + 10);
    expect(decifrarAnexo(cripto, estragado, anexo.chave, claro, anexo.capa)).toEqual(arquivo.capa);
    expect(decifrarAnexo(cripto, estragado, anexo.chave, claro)).toBeNull();
  });

  it('as faixas: arquivo pequeno vira 4096 bytes, e o preenchimento é aleatório', () => {
    for (const tamanho of [1, 1000, 5000, BYTES_DO_PEDACO, 1_000_000, TAMANHO_MAXIMO_DO_CLARO]) {
      expect(tamanhoDeAnexoValido(tamanhoDoAnexo(tamanho))).toBe(true);
    }
    expect(tamanhoDoAnexo(1)).toBe(TAMANHO_MINIMO_DO_ANEXO);
    expect(tamanhoDoAnexo(1_000_000)).toBe(tamanhoDoAnexo(1_000_001));
    const { blob } = cifrarAnexo(cripto, aleatorios(10));
    // Zeros mostrariam ao relay onde o fluxo acaba.
    expect(blob.subarray(-64).every((byte) => byte === 0)).toBe(false);
  });

  it('o que foge do formato não é preparado', () => {
    const recusado = (troca: Partial<ArquivoParaEnviar>, base = imagem()) =>
      prepararAnexo(cripto, { ...base, ...troca }) === null;
    expect(recusado({ formato: 'image/gif' })).toBe(true);
    expect(recusado({ formato: 'video/mp4' })).toBe(true);
    expect(recusado({ largura: 0 })).toBe(true);
    expect(recusado({ miniatura: aleatorios(1537) })).toBe(true);
    expect(recusado({ capa: aleatorios(100) })).toBe(true);
    expect(recusado({ bytes: new Uint8Array(0) })).toBe(true);
    expect(recusado({ bytes: new Uint8Array(TAMANHO_MAXIMO_DO_CLARO + 1) })).toBe(true);
    expect(recusado({ miniatura: aleatorios(10) }, documento())).toBe(true);
    expect(recusado({ capa: aleatorios(70_000) }, video())).toBe(true);
    expect(recusado({}, documento())).toBe(false);
    expect(recusado({ formato: 'application/x-qualquer' }, documento())).toBe(false);
  });

  it('o tipo vai em minúsculas: o do .xlsm, que tem maiúscula, é aceito', () => {
    const xlsm = prepararAnexo(cripto, {
      ...documento(),
      formato: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    });
    expect(xlsm?.anexo.formato).toBe('application/vnd.ms-excel.sheet.macroenabled.12');
    const foto = prepararAnexo(cripto, { ...imagem(), formato: 'Image/JPEG' });
    expect(foto?.anexo.formato).toBe('image/jpeg');
  });
});

describe('anexo pelo relay (RF-32 a RF-35)', () => {
  it('a imagem sobe antes da mensagem, baixa sozinha, confere e sai do relay', async () => {
    const [alice, bob] = await conversa();
    await bob.correio.parar();
    const arquivo = imagem(150_000);
    const id = await alice.correio.enviarAnexo(bob.id, arquivo, { legenda: 'a praça' });
    await ate(async () => (await statusDa(alice, bob, id)) === 'enviada', 'relay aceita');
    expect(await estadoDo(alice, bob, id)).toBe('enviado');

    // No relay, só o blob cifrado, igual ao que a Alice cifrou: nem o arquivo, nem a legenda.
    expect(anexosNoRelay()).toBe(1);
    const blob = await blobNoBanco(alice, id);
    if (!blob) throw new Error('sem blob');
    expect(blobNoRelay().equals(Buffer.from(blob))).toBe(true);
    const dump = relay.bytesDoBanco();
    expect(contem(dump, arquivo.bytes)).toBe(false);
    expect(contem(dump, arquivo.miniatura ?? new Uint8Array(0))).toBe(false);
    expect(dump.includes(Buffer.from('a praça'))).toBe(false);

    await online(bob);
    await ficaEm(bob, alice, id, 'baixado');
    await ate(() => anexosNoRelay() === 0, 'relay apaga');
    expect(relay.consultar('SELECT count(*) AS n FROM pedacos')[0]?.['n']).toBe(0);

    const recebido = await itemDa(bob, alice, id);
    expect(recebido?.mensagem).toMatchObject({ tipo: 'imagem', texto: 'a praça', deMim: false });
    expect(recebido?.anexo).toMatchObject({
      arquivo: 'imagem',
      formato: 'image/jpeg',
      largura: 1600,
      altura: 1200,
      tamanho: arquivo.bytes.length,
      miniatura: arquivo.miniatura,
    });
    // O resumo que a tela recebe não leva o que abre o arquivo.
    expect(recebido?.anexo).not.toHaveProperty('chave');
    expect(recebido?.anexo).not.toHaveProperty('token');
    const aberto = await bob.agenda.abrirAnexo(alice.id, id);
    expect(aberto?.bytes).toEqual(arquivo.bytes);
    expect(aberto?.capa).toBeNull();
    // O mesmo SHA-256 nos dois lados, para as duas pessoas compararem.
    const sha256 = cripto.crypto_hash_sha256(arquivo.bytes);
    expect((await itemDa(alice, bob, id))?.anexo?.sha256).toEqual(sha256);
    expect(recebido?.anexo?.sha256).toEqual(sha256);
    expect(bob.eventos).toContainEqual(
      expect.objectContaining({ tipo: 'progresso', conversa: alice.id, fracao: 1 }),
    );
  }, 30_000);

  it('circuitos: sobe pelo circuito de depósito do contato; baixa e apaga pelo dos anexos', async () => {
    const [alice, bob] = await conversa();
    const id = await alice.correio.enviarAnexo(bob.id, imagem());
    await ficaEm(bob, alice, id, 'baixado');
    const depositoDaAlice = pedidos(alice).find(({ pedido }) => pedido.tipo === 'depositar');
    expect(httpDe(alice, 'PUT').map((h) => h.circuito)).toEqual([depositoDaAlice?.circuito]);
    expect(httpDe(alice, 'GET')).toEqual([]);
    const daBob = bob.transporte.http;
    expect(daBob.map((h) => h.metodo)).toEqual(['GET', 'DELETE']);
    // Nunca pelo circuito de depósito do Bob para a Alice: ligaria as duas conversas.
    expect(daBob.every((h) => h.circuito === CIRCUITO_DOS_ANEXOS)).toBe(true);
    expect(new Set([...httpDe(alice, 'PUT'), ...daBob].map((h) => h.caminho)).size).toBe(1);
  }, 30_000);

  it('vídeo com capa e documento sem miniatura chegam inteiros', async () => {
    const [alice, bob] = await conversa();
    const filme = video();
    const papel = documento();
    const doVideo = await alice.correio.enviarAnexo(bob.id, filme);
    const doDocumento = await alice.correio.enviarAnexo(bob.id, papel);
    await ficaEm(bob, alice, doVideo, 'baixado');
    await ficaEm(bob, alice, doDocumento, 'baixado');
    expect(await bob.agenda.abrirCapa(alice.id, doVideo)).toEqual(filme.capa);
    const aberto = await bob.agenda.abrirAnexo(alice.id, doVideo);
    expect(aberto?.bytes).toEqual(filme.bytes);
    expect(aberto?.capa).toEqual(filme.capa);
    expect((await itemDa(bob, alice, doVideo))?.anexo).toMatchObject({ duracao: 42_000 });
    expect(await bob.agenda.abrirCapa(alice.id, doDocumento)).toBeNull();
    expect((await bob.agenda.abrirAnexo(alice.id, doDocumento))?.bytes).toEqual(papel.bytes);
    expect((await itemDa(bob, alice, doDocumento))?.anexo).toMatchObject({
      arquivo: 'documento',
      formato: 'application/pdf',
      miniatura: new Uint8Array(0),
    });
  }, 30_000);

  it('relay fora do ar: o anexo fica pendente e sobe quando ele volta (RNF-12)', async () => {
    const [alice, bob] = await conversa();
    await relay.derrubar();
    const arquivo = imagem();
    const id = await alice.correio.enviarAnexo(bob.id, arquivo);
    await redeParada();
    expect(await statusDa(alice, bob, id)).toBe('pendente');
    expect(await estadoDo(alice, bob, id)).toBe('enviar');
    await relay.voltar();
    await avancarAte(async () => (await estadoDo(bob, alice, id)) === 'baixado', 'bob baixa');
    expect((await bob.agenda.abrirAnexo(alice.id, id))?.bytes).toEqual(arquivo.bytes);
    expect(await statusDa(alice, bob, id)).toBe('enviada');
  }, 30_000);

  it('subida que falha espera o intervalo da fila, e a mensagem só sai depois dela', async () => {
    const [alice, bob] = await conversa();
    alice.transporte.falharHttp = (pedido) => pedido.metodo === 'PUT';
    const id = await alice.correio.enviarAnexo(bob.id, imagem());
    await ate(() => httpDe(alice, 'PUT').length >= 1, 'tenta subir');
    await redeParada();
    const [item] = await alice.banco.banco.consultar('SELECT tentativas FROM fila');
    expect(item?.['tentativas']).toBe(1);
    expect(await statusDa(alice, bob, id)).toBe('pendente');
    expect(await itemDa(bob, alice, id)).toBeUndefined();

    alice.transporte.falharHttp = null;
    await avancarAte(async () => (await estadoDo(bob, alice, id)) === 'baixado', 'bob baixa');
    expect(await statusDa(alice, bob, id)).toBe('enviada');
  }, 30_000);

  it('o mesmo anexo ainda subindo no relay, por um envio parado: espera ele cair e sobe de novo', async () => {
    const [alice, bob] = await conversa();
    const lento = segurar(alice, 'PUT');
    const arquivo = imagem();
    const id = await alice.correio.enviarAnexo(bob.id, arquivo);
    await ate(() => httpDe(alice, 'PUT').length === 1, 'tenta subir');
    // Um envio anterior do mesmo blob, por um circuito que parou: o relay o tem pela metade.
    const [linha] = await alice.banco.banco.consultar(
      'SELECT token, blob FROM anexos WHERE mensagem = ?',
      [id],
    );
    const parado = subirParado(linha?.['token'] as Uint8Array, linha?.['blob'] as Uint8Array);
    await ate(() => anexosNoRelay() === 1, 'o envio parado começa');
    lento.soltar();
    await ate(async () => {
      const [item] = await alice.banco.banco.consultar('SELECT tentativas FROM fila');
      return Number(item?.['tentativas'] ?? 0) > 0 || (await estadoDo(alice, bob, id)) !== 'enviar';
    }, 'o relay responde');
    expect(await estadoDo(alice, bob, id)).toBe('enviar');
    await redeParada();
    expect(await itemDa(bob, alice, id)).toBeUndefined();

    parado.cortar();
    await ate(() => anexosNoRelay() === 0, 'o relay descarta o envio parado');
    await avancarAte(async () => (await estadoDo(bob, alice, id)) === 'baixado', 'bob baixa');
    expect((await bob.agenda.abrirAnexo(alice.id, id))?.bytes).toEqual(arquivo.bytes);
  }, 30_000);

  it('um anexo subindo não segura as outras conversas; a mensagem seguinte espera por ele', async () => {
    const [alice, bob] = await conversa();
    const carol = await pessoa();
    await online(carol);
    await alice.correio.iniciarConversa(carol.id);
    const lento = segurar(alice, 'PUT');
    const id = await alice.correio.enviarAnexo(bob.id, imagem());
    await alice.correio.enviarTexto(bob.id, 'depois da foto');
    await ate(() => httpDe(alice, 'PUT').length === 1, 'começa a subir');
    await alice.correio.enviarTexto(carol.id, 'enquanto isso');
    await ate(async () => (await textos(carol, alice)).includes('enquanto isso'), 'carol recebe');
    expect(await textos(bob, alice)).toEqual(['oi', 'oi, alice']);

    lento.soltar();
    await ate(async () => (await textos(bob, alice)).length === 4, 'bob recebe as duas');
    const lista = await bob.agenda.mensagens(alice.id);
    expect(lista.map((m) => m.tipo)).toEqual(['texto', 'texto', 'imagem', 'texto']);
    expect(lista[2]?.id).toEqual(id);
  }, 30_000);

  it('cancelar o envio no meio: a mensagem sai de verdade e nada chega ao contato', async () => {
    const [alice, bob] = await conversa();
    const lento = segurar(alice, 'PUT');
    const id = await alice.correio.enviarAnexo(bob.id, imagem());
    await ate(() => httpDe(alice, 'PUT').length === 1, 'começa a subir');
    expect(await alice.agenda.cancelarEnvio(bob.id, id)).toBe(true);
    alice.correio.cancelarTransferencia(id);
    await alice.correio.enviarTexto(bob.id, 'sem a foto');
    await ate(async () => (await textos(bob, alice)).includes('sem a foto'), 'bob recebe');
    lento.soltar();
    await redeParada();

    expect(await textos(bob, alice)).toEqual(['oi', 'oi, alice', 'sem a foto']);
    expect(anexosNoRelay()).toBe(0);
    expect(await itemDa(alice, bob, id)).toBeUndefined();
    const sobra = await alice.banco.banco.consultar(
      'SELECT (SELECT count(*) FROM anexos) AS anexos, (SELECT count(*) FROM fila) AS fila',
    );
    expect(sobra).toEqual([{ anexos: 0, fila: 0 }]);
    // Depois de subir, cancelar não vale: aí só apagando.
    const subiu = await alice.correio.enviarAnexo(bob.id, imagem());
    await ficaEm(alice, bob, subiu, 'enviado');
    expect(await alice.agenda.cancelarEnvio(bob.id, subiu)).toBe(false);
  }, 30_000);

  it('cancelar o download: o anexo para e só baixa quando a pessoa tocar', async () => {
    const [alice, bob] = await conversa();
    const lento = segurar(bob, 'GET');
    const arquivo = imagem();
    const id = await alice.correio.enviarAnexo(bob.id, arquivo);
    await ate(() => httpDe(bob, 'GET').length === 1, 'começa a baixar');
    expect(await bob.agenda.pararDownload(alice.id, id)).toBe(true);
    bob.correio.cancelarTransferencia(id);
    await ficaEm(bob, alice, id, 'manual');
    lento.soltar();
    await redeParada();
    expect(await estadoDo(bob, alice, id)).toBe('manual');
    expect(httpDe(bob, 'GET')).toHaveLength(1);
    // O blob continua no relay, para quando a pessoa tocar.
    expect(anexosNoRelay()).toBe(1);

    expect(await bob.agenda.baixarAnexo(alice.id, id)).toBe(true);
    bob.correio.conferirAnexos();
    await ficaEm(bob, alice, id, 'baixado');
    expect((await bob.agenda.abrirAnexo(alice.id, id))?.bytes).toEqual(arquivo.bytes);
    await ate(() => anexosNoRelay() === 0, 'relay apaga');
    // Tocar de novo não faz nada.
    expect(await bob.agenda.baixarAnexo(alice.id, id)).toBe(false);
  }, 30_000);

  it('baixar sozinho desligado (RF-57): o anexo espera a pessoa tocar', async () => {
    const [alice, bob] = await conversa();
    expect(await bob.agenda.baixarSozinho()).toBe(true);
    await bob.agenda.mudarBaixarSozinho(false);
    expect(await bob.agenda.baixarSozinho()).toBe(false);
    const id = await alice.correio.enviarAnexo(bob.id, imagem());
    await recebeu(bob, alice, id);
    await redeParada();
    expect(await estadoDo(bob, alice, id)).toBe('manual');
    expect(bob.transporte.http).toEqual([]);
    // A miniatura vem dentro da mensagem: o balão mostra sem baixar.
    expect((await itemDa(bob, alice, id))?.anexo?.miniatura).toHaveLength(600);

    await bob.agenda.baixarAnexo(alice.id, id);
    bob.correio.conferirAnexos();
    await ficaEm(bob, alice, id, 'baixado');
    // Ligado de novo, o que chega baixa sozinho.
    await bob.agenda.mudarBaixarSozinho(true);
    const outro = await alice.correio.enviarAnexo(bob.id, imagem());
    await ficaEm(bob, alice, outro, 'baixado');
  }, 30_000);

  it('pedido de conversa: nada baixa antes de aceitar; aceito, baixa pelo ajuste (RF-07, RF-57)', async () => {
    const [alice, bob, carol] = [await pessoa(), await pessoa(), await pessoa()];
    await online(alice, bob, carol);
    await alice.correio.iniciarConversa(bob.id);
    await carol.correio.iniciarConversa(bob.id);
    const daAlice = await alice.correio.enviarAnexo(bob.id, imagem());
    const daCarol = await carol.correio.enviarAnexo(bob.id, imagem());
    await recebeu(bob, alice, daAlice);
    await recebeu(bob, carol, daCarol);
    await redeParada();
    expect((await bob.agenda.pedidos()).map((p) => p.id).sort()).toEqual(
      [alice.id, carol.id].sort(),
    );
    expect(bob.transporte.http).toEqual([]);

    await bob.agenda.aceitar(alice.id);
    bob.correio.conferirAnexos();
    await ficaEm(bob, alice, daAlice, 'baixado');
    // Com o ajuste desligado na hora de aceitar, o anexo espera a pessoa tocar.
    await bob.agenda.mudarBaixarSozinho(false);
    await bob.correio.iniciarConversa(carol.id);
    await redeParada();
    expect(await estadoDo(bob, carol, daCarol)).toBe('manual');
    expect(httpDe(bob, 'GET')).toHaveLength(1);
  }, 30_000);

  it('de um ID bloqueado, o anexo é descartado sem baixar (RF-08)', async () => {
    const [alice, bob] = await conversa();
    await bob.agenda.bloquear(alice.id);
    const id = await alice.correio.enviarAnexo(bob.id, imagem());
    await ate(async () => (await statusDa(alice, bob, id)) === 'enviada', 'relay aceita');
    await redeParada();
    expect(await itemDa(bob, alice, id)).toBeUndefined();
    expect(await bob.banco.banco.consultar('SELECT count(*) AS n FROM anexos')).toEqual([{ n: 0 }]);
    expect(bob.transporte.http).toEqual([]);
  }, 30_000);

  it('blob adulterado no relay não entra; sem o blob no relay, fica indisponível', async () => {
    const [alice, bob] = await conversa();
    await bob.correio.parar();
    const adulterado = await alice.correio.enviarAnexo(bob.id, imagem());
    await ficaEm(alice, bob, adulterado, 'enviado');
    relay.adulterar('UPDATE pedacos SET dados = randomblob(length(dados)) WHERE indice = 0');
    await online(bob);
    await ficaEm(bob, alice, adulterado, 'invalido');
    expect(await bob.agenda.abrirAnexo(alice.id, adulterado)).toBeNull();

    await bob.correio.parar();
    const sumiu = await alice.correio.enviarAnexo(bob.id, imagem());
    await ficaEm(alice, bob, sumiu, 'enviado');
    relay.adulterar('DELETE FROM anexos');
    await online(bob);
    await ficaEm(bob, alice, sumiu, 'indisponivel');
    expect(bob.eventos).toContainEqual({ tipo: 'anexo', conversa: alice.id, id: sumiu });
  }, 30_000);

  it('nota pessoal: o anexo fica só no aparelho (RF-19)', async () => {
    const alice = await pessoa();
    await online(alice);
    const arquivo = video();
    const id = await alice.agenda.anexarNaNota(arquivo, { legenda: 'só aqui' });
    const [item] = await alice.agenda.itens(alice.id);
    expect(item).toMatchObject({
      tipo: 'mensagem',
      mensagem: { tipo: 'video', texto: 'só aqui', status: 'enviada' },
      anexo: { estado: 'local' },
    });
    expect((await alice.agenda.abrirAnexo(alice.id, id))?.bytes).toEqual(arquivo.bytes);
    expect(await alice.agenda.abrirCapa(alice.id, id)).toEqual(arquivo.capa);
    await redeParada();
    expect(alice.transporte.http).toEqual([]);
    expect(await alice.banco.banco.consultar('SELECT count(*) AS n FROM fila')).toEqual([{ n: 0 }]);
    expect(await codigo(alice.agenda.anexarNaNota(arquivo, { legenda: 'x'.repeat(2001) }))).toBe(
      'texto-invalido',
    );
    expect(await codigo(alice.agenda.anexarNaNota({ ...arquivo, formato: 'video/webm' }))).toBe(
      'anexo-invalido',
    );
  }, 30_000);

  it('contato que trocou de aparelho recebe o anexo que esperava na fila (RF-05)', async () => {
    const [alice, bob] = await conversa();
    await alice.correio.parar();
    await relay.derrubar();
    const arquivo = imagem();
    const id = await bob.correio.enviarAnexo(alice.id, arquivo, { legenda: 'para o novo' });
    // A primeira tentativa falha com o relay fora; a próxima só depois de a Alice restaurar.
    await ate(async () => {
      const [item] = await bob.banco.banco.consultar('SELECT tentativas FROM fila');
      return Number(item?.['tentativas']) >= 1;
    }, 'a primeira tentativa falha');
    await redeParada();

    await relay.voltar();
    const aliceNova = await pessoa(alice.identidade);
    await online(aliceNova);
    // O aparelho novo, sem backup, ainda não tem os contatos: chega como pedido, que só baixa
    // depois de aceito.
    await avancarAte(async () => (await estadoDo(aliceNova, bob, id)) === 'baixar', 'chega');
    await aliceNova.agenda.aceitar(bob.id);
    aliceNova.correio.conferirAnexos();
    await avancarAte(
      async () => (await estadoDo(aliceNova, bob, id)) === 'baixado',
      'o aparelho novo baixa',
    );
    expect((await aliceNova.agenda.abrirAnexo(bob.id, id))?.bytes).toEqual(arquivo.bytes);
    expect((await itemDa(aliceNova, bob, id))?.mensagem.texto).toBe('para o novo');
  }, 30_000);

  it('legenda acima de 2000 bytes ou arquivo fora do formato: recusados', async () => {
    const [alice, bob] = await conversa();
    expect(
      await codigo(alice.correio.enviarAnexo(bob.id, imagem(), { legenda: 'ç'.repeat(1001) })),
    ).toBe('texto-invalido');
    expect(
      await codigo(alice.correio.enviarAnexo(bob.id, { ...imagem(), formato: 'image/heic' })),
    ).toBe('anexo-invalido');
    expect(
      await codigo(
        alice.correio.enviarAnexo(bob.id, {
          ...documento(),
          bytes: new Uint8Array(TAMANHO_MAXIMO_DO_CLARO + 1),
        }),
      ),
    ).toBe('anexo-invalido');
    expect(await codigo(alice.correio.enviarAnexo(bob.id, imagem(), { ttl: 5 }))).toBe(
      'timer-invalido',
    );
    expect(await alice.agenda.mensagens(bob.id)).toHaveLength(2);
  }, 30_000);
});

describe('anexos fora da galeria e exclusão real (RF-36, RNF-08)', () => {
  it('o arquivo do banco não guarda o anexo em claro, nem depois de abrir', async () => {
    const [alice, bob] = await conversa();
    const arquivo = video();
    const id = await alice.correio.enviarAnexo(bob.id, arquivo);
    await ficaEm(bob, alice, id, 'baixado');
    expect((await bob.agenda.abrirAnexo(alice.id, id))?.bytes).toEqual(arquivo.bytes);
    expect(await bob.agenda.abrirCapa(alice.id, id)).toEqual(arquivo.capa);
    for (const p of [alice, bob]) {
      const dump = arquivoDoBanco(p);
      expect(contem(dump, arquivo.bytes)).toBe(false);
      expect(contem(dump, arquivo.capa ?? new Uint8Array(0))).toBe(false);
    }
  }, 30_000);

  it('apagar pra todos tira o blob dos dois arquivos', async () => {
    const [alice, bob] = await conversa();
    const id = await alice.correio.enviarAnexo(bob.id, imagem(200_000));
    await ficaEm(bob, alice, id, 'baixado');
    const blob = await blobNoBanco(bob, id);
    if (!blob) throw new Error('sem blob');
    expect(contem(arquivoDoBanco(alice), blob)).toBe(true);
    expect(contem(arquivoDoBanco(bob), blob)).toBe(true);

    await bob.correio.apagarParaTodos(alice.id, [id]);
    await ate(async () => (await itemDa(alice, bob, id)) === undefined, 'some da alice');
    expect(await itemDa(bob, alice, id)).toBeUndefined();
    expect(contem(arquivoDoBanco(alice), blob)).toBe(false);
    expect(contem(arquivoDoBanco(bob), blob)).toBe(false);
  }, 30_000);

  it('a temporária leva o blob no prazo, e o arquivo do banco encolhe', async () => {
    const [alice, bob] = await conversa({ encolhe: true });
    alice.temporarias.iniciar();
    bob.temporarias.iniciar();
    const enviada = relogio.agora();
    const id = await alice.correio.enviarAnexo(bob.id, imagem(600_000), { ttl: 10 });
    await ficaEm(bob, alice, id, 'baixado');
    const blob = await blobNoBanco(bob, id);
    if (!blob) throw new Error('sem blob');
    const antes = arquivoDoBanco(bob).length;

    await andarAte(enviada + 10_000);
    await ate(async () => (await itemDa(bob, alice, id)) === undefined, 'some do bob');
    await ate(async () => (await itemDa(alice, bob, id)) === undefined, 'some da alice');
    await ate(() => arquivoDoBanco(bob).length < antes - 500_000, 'o arquivo encolhe');
    expect(contem(arquivoDoBanco(bob), blob)).toBe(false);
    expect(contem(arquivoDoBanco(alice), blob)).toBe(false);
  }, 30_000);

  it('apagar a conversa tira o blob do arquivo', async () => {
    const [alice, bob] = await conversa();
    const id = await alice.correio.enviarAnexo(bob.id, documento(100_000));
    await ficaEm(bob, alice, id, 'baixado');
    const blob = await blobNoBanco(bob, id);
    if (!blob) throw new Error('sem blob');
    await bob.agenda.apagarConversa(alice.id);
    expect(await bob.agenda.mensagens(alice.id)).toEqual([]);
    expect(contem(arquivoDoBanco(bob), blob)).toBe(false);
    expect(await bob.banco.banco.consultar('SELECT count(*) AS n FROM anexos')).toEqual([{ n: 0 }]);
  }, 30_000);
});

describe('responder e encaminhar (RF-54, RF-55)', () => {
  it('a resposta leva só o ID: cada lado cita a própria cópia, e a que sumiu vira nula', async () => {
    const [alice, bob] = await conversa();
    const foto = await alice.correio.enviarAnexo(bob.id, imagem(), { legenda: 'olha isto' });
    await ficaEm(bob, alice, foto, 'baixado');
    const resposta = await bob.correio.enviarTexto(alice.id, 'que lugar', undefined, foto);
    const comFoto = await bob.correio.enviarAnexo(alice.id, documento(), { resposta: foto });
    await recebeu(alice, bob, resposta);
    await recebeu(alice, bob, comFoto);
    for (const [p, de] of [
      [alice, bob],
      [bob, alice],
    ] as const) {
      const citada = (await itemDa(p, de, resposta))?.citada;
      expect(citada?.id).toEqual(foto);
      expect(citada?.mensagem).toEqual({
        deMim: p === alice,
        tipo: 'imagem',
        texto: 'olha isto',
      });
      expect((await itemDa(p, de, comFoto))?.citada?.id).toEqual(foto);
    }
    expect((await itemDa(alice, bob, resposta))?.mensagem.resposta).toEqual(foto);

    // Apagada só no Bob: lá a citação some; na Alice, continua.
    await bob.agenda.apagarSoAqui(alice.id, [foto]);
    expect((await itemDa(bob, alice, resposta))?.citada).toEqual({ id: foto, mensagem: null });
    expect((await itemDa(alice, bob, resposta))?.citada?.mensagem).not.toBeNull();
    // Apagada pra todos: some nos dois, e nada dela volta pela resposta.
    await alice.correio.apagarParaTodos(bob.id, [foto]);
    await ate(
      async () => (await itemDa(alice, bob, resposta))?.citada?.mensagem === null,
      'a citação some',
    );
    expect(await textos(alice, bob)).toEqual(['oi', 'oi, alice', 'que lugar', '']);
  }, 30_000);

  it('encaminhar: mensagem nova, cifrada de novo, que sobe de novo e vai com o timer do destino', async () => {
    const [alice, bob] = await conversa();
    const carol = await pessoa();
    await online(carol);
    await bob.correio.iniciarConversa(carol.id);
    await bob.correio.mudarTimer(carol.id, 3600, false);
    await ate(async () => (await carol.agenda.pedidos()).length === 1, 'carol recebe o timer');
    await carol.agenda.aceitar(bob.id);
    const arquivo = video();
    const original = await alice.correio.enviarAnexo(bob.id, arquivo, { legenda: 'veja' });
    const texto = await alice.correio.enviarTexto(bob.id, 'e leia');
    await ficaEm(bob, alice, original, 'baixado');
    await recebeu(bob, alice, texto);

    const anexo = await bob.agenda.paraEncaminhar(alice.id, original);
    const escrito = await bob.agenda.paraEncaminhar(alice.id, texto);
    expect(escrito).toEqual({ tipo: 'texto', texto: 'e leia' });
    if (anexo?.tipo !== 'anexo') throw new Error('sem o anexo');
    expect(anexo.legenda).toBe('veja');
    expect(anexo.arquivo).toMatchObject({
      arquivo: 'video',
      formato: 'video/mp4',
      largura: 1280,
      altura: 720,
      duracao: 42_000,
      capa: arquivo.capa,
      miniatura: arquivo.miniatura,
    });
    const id = await bob.correio.enviarAnexo(carol.id, anexo.arquivo, { legenda: anexo.legenda });
    await ficaEm(carol, bob, id, 'baixado');
    expect(id).not.toEqual(original);
    expect((await carol.agenda.abrirAnexo(bob.id, id))?.bytes).toEqual(arquivo.bytes);
    expect(await carol.agenda.abrirCapa(bob.id, id)).toEqual(arquivo.capa);
    const chegou = await itemDa(carol, bob, id);
    expect(chegou?.mensagem).toMatchObject({ texto: 'veja', ttl: 3600, resposta: null });
    // Token e chave novos: o relay não liga o encaminhado ao original.
    const caminhos = [...httpDe(alice, 'PUT'), ...httpDe(bob, 'PUT')].map((h) => h.caminho);
    expect(new Set(caminhos).size).toBe(2);
    const chaves = await Promise.all(
      [
        [bob, original],
        [carol, id],
      ].map(async ([p, mensagem]) => {
        const [linha] = await (p as Pessoa).banco.banco.consultar(
          'SELECT chave FROM anexos WHERE mensagem = ?',
          [mensagem as Uint8Array],
        );
        return linha?.['chave'];
      }),
    );
    expect(chaves[0]).not.toEqual(chaves[1]);
    // Para a nota pessoal, fica só no aparelho.
    const naNota = await bob.agenda.anexarNaNota(anexo.arquivo, { legenda: anexo.legenda });
    expect((await bob.agenda.abrirAnexo(bob.id, naNota))?.bytes).toEqual(arquivo.bytes);
    // O que ainda não baixou não encaminha.
    await bob.agenda.mudarBaixarSozinho(false);
    const parado = await alice.correio.enviarAnexo(bob.id, imagem());
    await recebeu(bob, alice, parado);
    expect(await bob.agenda.paraEncaminhar(alice.id, parado)).toBeNull();
  }, 30_000);
});

describe('a conversa aberta', () => {
  it('vem com um número fixo de idas ao banco, e não uma por anexo ou por resposta', async () => {
    const aberto = abrirBancoDeTeste();
    try {
      const { banco } = aberto;
      await prepararBanco(banco);
      const contato = cripto.randombytes_buf(BYTES_DO_ID);
      const preparado = prepararAnexo(cripto, imagem());
      if (!preparado) throw new Error('não preparou');
      await banco.transacao(async (t) => {
        for (let i = 0; i < 20; i++) {
          const foto = cripto.randombytes_buf(16);
          await guardarMensagem(t, {
            id: foto,
            conversa: contato,
            deMim: false,
            tipo: 'imagem',
            texto: `foto ${String(i)}`,
            enviadaEm: 2 * i,
            recebidaEm: 2 * i,
            ttl: 0,
            expiraEm: null,
            status: 'recebida',
          });
          await guardarAnexo(t, foto, preparado.anexo, 'baixar');
          await guardarMensagem(t, {
            id: cripto.randombytes_buf(16),
            conversa: contato,
            deMim: true,
            texto: `resposta ${String(i)}`,
            resposta: foto,
            enviadaEm: 2 * i + 1,
            recebidaEm: null,
            ttl: 0,
            expiraEm: null,
            status: 'enviada',
          });
        }
      });

      const contado = contandoAsIdas(banco);
      const itens = await itensDa(contado.banco, contato);
      const mensagens = itens.flatMap((item) => (item.tipo === 'mensagem' ? [item] : []));
      expect(mensagens).toHaveLength(40);
      expect(mensagens.filter((item) => item.anexo?.arquivo === 'imagem')).toHaveLength(20);
      expect(mensagens.filter((item) => item.citada?.mensagem?.tipo === 'imagem')).toHaveLength(20);
      // As mensagens, os anexos, as citações e as notas.
      expect(contado.idas()).toBe(4);
    } finally {
      aberto.fechar();
    }
  });
});
