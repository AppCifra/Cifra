import type { ArquivoParaEnviar } from '@cifra/core';
import { describe, expect, it } from 'vitest';
import { cripto } from '../../../packages/core/test/adaptadores/sodium-node.ts';
import {
  ate,
  conversa,
  online,
  pessoa,
  redeParada,
  textos,
  type Pessoa,
} from '../../../packages/core/test/correio-de-teste.ts';
import { deBase64 } from '../src/adaptadores/formato.ts';
import {
  ConversasDoApp,
  ErroDaMidia,
  ITENS_POR_ENVIO,
  type ArquivoAberto,
  type Escolhido,
  type MidiaDoApp,
} from '../src/conversas.ts';

// Anexos e ações nas mensagens pela tela (RF-32 a RF-36, RF-51 a RF-57), sobre o núcleo de verdade
// e o relay no mesmo processo. A plataforma (seletor, limpeza, galeria e área de transferência) é
// de mentira: anota o que o app pediu.

interface MidiaDeTeste extends MidiaDoApp {
  readonly salvos: ArquivoAberto[];
  readonly copiados: string[];
  escolhidos: Escolhido[];
  esquecidas: number;
}

function midiaDeTeste(): MidiaDeTeste {
  const midia: MidiaDeTeste = {
    salvos: [],
    copiados: [],
    escolhidos: [],
    esquecidas: 0,
    escolherMidia: (limite) => Promise.resolve(midia.escolhidos.slice(0, limite + 5)),
    escolherArquivos: (limite) => Promise.resolve(midia.escolhidos.slice(0, limite + 5)),
    preparar(escolhido) {
      if (escolhido.endereco === 'grande') return Promise.reject(new ErroDaMidia('grande'));
      if (escolhido.endereco === 'estranho') return Promise.reject(new Error('qualquer'));
      return Promise.resolve(foto());
    },
    salvar(arquivo) {
      midia.salvos.push(arquivo);
      return Promise.resolve();
    },
    copiar(texto) {
      midia.copiados.push(texto);
      return Promise.resolve();
    },
    salvarArquivo: () => Promise.resolve(false),
    esquecerImagens() {
      midia.esquecidas++;
    },
  };
  return midia;
}

function foto(tamanho = 20_000): ArquivoParaEnviar {
  return {
    arquivo: 'imagem',
    formato: 'image/jpeg',
    bytes: cripto.randombytes_buf(tamanho),
    miniatura: cripto.randombytes_buf(300),
    largura: 800,
    altura: 600,
  };
}

function conversasDe(p: Pessoa, midia: MidiaDoApp = midiaDeTeste()) {
  const seletores = { abertos: 0 };
  const app = new ConversasDoApp({
    agenda: p.agenda,
    correio: p.correio,
    temporarias: p.temporarias,
    identidade: p.identidade,
    aoSubstituir: () => undefined,
    midia,
    semBloquear: async (acao) => {
      seletores.abertos++;
      return acao();
    },
  });
  return Object.assign(app, { seletores });
}

const estadoDo = async (p: Pessoa, de: Pessoa, id: Uint8Array) => {
  const item = (await p.agenda.itens(de.id)).find(
    (i) => i.tipo === 'mensagem' && i.mensagem.id.every((b, n) => b === id[n]),
  );
  return item?.tipo === 'mensagem' ? item.anexo?.estado : undefined;
};

const baixou = (p: Pessoa, de: Pessoa, id: Uint8Array) =>
  ate(async () => (await estadoDo(p, de, id)) === 'baixado', 'anexo baixado');

describe('escolher e preparar', () => {
  it('o seletor abre sem bloquear o app, e só os 10 primeiros entram', async () => {
    const alice = await pessoa();
    const midia = midiaDeTeste();
    midia.escolhidos = Array.from({ length: 12 }, (_, i) => ({
      endereco: `content://${String(i)}`,
      formato: 'image/jpeg',
    }));
    const app = conversasDe(alice, midia);
    expect(await app.escolher('midia')).toHaveLength(ITENS_POR_ENVIO);
    expect(await app.escolher('arquivo')).toHaveLength(ITENS_POR_ENVIO);
    expect(app.seletores.abertos).toBe(2);
  });

  it('o que passa de 25 MB, ou não abre, volta como erro para a tela', async () => {
    const app = conversasDe(await pessoa());
    expect(await app.preparar({ endereco: 'grande', formato: 'video/mp4' })).toBe('grande');
    expect(await app.preparar({ endereco: 'estranho', formato: 'image/heic' })).toBe('nao-abre');
    expect(await app.preparar({ endereco: 'ok', formato: 'image/jpeg' })).toMatchObject({
      arquivo: 'imagem',
    });
  });
});

describe('enviar e abrir', () => {
  it('na nota fica aqui; para o contato, sobe e chega; legenda longa e timer maior não saem', async () => {
    const [alice, bob] = await conversa();
    const app = conversasDe(alice);
    expect(await app.enviarAnexo(alice.id, foto(), { legenda: 'só minha' })).toBe('ok');
    const arquivo = foto();
    expect(await app.enviarAnexo(bob.id, arquivo, { legenda: 'a praça', ttl: 600 })).toBe('ok');
    expect(await app.enviarAnexo(bob.id, foto(), { legenda: 'x'.repeat(2001) })).toBe('longa');
    await app.mudarTimer(bob.id, 3600, false);
    expect(await app.enviarAnexo(bob.id, foto(), { ttl: 7200 })).toBe('timer');
    const [nota] = await alice.agenda.mensagens(alice.id);
    expect(nota).toMatchObject({ tipo: 'imagem', texto: 'só minha' });
    await ate(async () => (await textos(bob, alice)).includes('a praça'), 'bob recebe');
    const recebida = (await bob.agenda.mensagens(alice.id)).find((m) => m.texto === 'a praça');
    if (!recebida) throw new Error('sem a mensagem');
    expect(recebida.ttl).toBe(600);
    await baixou(bob, alice, recebida.id);
  }, 30_000);

  it('a foto abre na memória como data:, guardada para a tela até o app parar', async () => {
    const [alice, bob] = await conversa();
    const midia = midiaDeTeste();
    const app = conversasDe(bob, midia);
    const arquivo = foto();
    await conversasDe(alice).enviarAnexo(bob.id, arquivo);
    await ate(async () => (await bob.agenda.mensagens(alice.id)).length === 3, 'bob recebe');
    const recebida = (await bob.agenda.mensagens(alice.id)).at(-1);
    if (!recebida) throw new Error('sem a mensagem');
    await baixou(bob, alice, recebida.id);

    const endereco = await app.imagem(alice.id, recebida.id);
    expect(endereco?.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(deBase64(endereco?.split(',')[1] ?? '')).toEqual(arquivo.bytes);
    expect(await app.imagem(alice.id, recebida.id)).toBe(endereco);
    expect(await app.capa(alice.id, recebida.id)).toBeNull();
    expect(await app.video(alice.id, recebida.id)).toBeNull();
    await app.parar();
    expect(midia.esquecidas).toBe(1);
  }, 30_000);

  it('o progresso avisa a tela sem ler a conversa de novo; o fim da transferência, sim', async () => {
    const [alice, bob] = await conversa();
    const app = conversasDe(bob);
    let avisos = 0;
    app.aoMudarProgresso(() => {
      avisos++;
    });
    const versoes: number[] = [];
    app.aoMudar(() => versoes.push(app.versao));
    const id = await alice.correio.enviarAnexo(bob.id, foto());
    await baixou(bob, alice, id);
    await ate(() => avisos > 0, 'progresso');
    expect(app.progresso(id)).toBeNull();
    expect(versoes.length).toBeGreaterThan(0);
  }, 30_000);
});

describe('baixar, parar e cancelar', () => {
  it('baixar sozinho desligado (RF-57): o anexo espera; tocar baixa', async () => {
    const [alice, bob] = await conversa();
    const app = conversasDe(bob);
    await app.mudar((agenda) => agenda.mudarBaixarSozinho(false));
    const id = await alice.correio.enviarAnexo(bob.id, foto());
    await ate(async () => (await estadoDo(bob, alice, id)) === 'manual', 'chega parado');
    await app.baixar(alice.id, id);
    await baixou(bob, alice, id);
  }, 30_000);

  it('cancelar o download para e deixa para tocar; cancelar o envio apaga a mensagem', async () => {
    const [alice, bob] = await conversa();
    const deBob = conversasDe(bob);
    let soltar: () => void = () => undefined;
    const solto = new Promise<void>((pronto) => {
      soltar = pronto;
    });
    bob.transporte.segurarHttp = (pedido) => (pedido.metodo === 'GET' ? solto : null);
    const id = await alice.correio.enviarAnexo(bob.id, foto());
    await ate(() => bob.transporte.http.length === 1, 'começa a baixar');
    await deBob.pararDownload(alice.id, id);
    bob.transporte.segurarHttp = null;
    soltar();
    await redeParada();
    expect(await estadoDo(bob, alice, id)).toBe('manual');

    const daAlice = conversasDe(alice);
    let soltarEnvio: () => void = () => undefined;
    const envioSolto = new Promise<void>((pronto) => {
      soltarEnvio = pronto;
    });
    alice.transporte.segurarHttp = (pedido) => (pedido.metodo === 'PUT' ? envioSolto : null);
    const parado = await alice.correio.enviarAnexo(bob.id, foto());
    await ate(() => alice.transporte.http.filter((h) => h.metodo === 'PUT').length === 2, 'sobe');
    await daAlice.cancelarEnvio(bob.id, parado);
    alice.transporte.segurarHttp = null;
    soltarEnvio();
    await redeParada();
    expect(
      (await alice.agenda.mensagens(bob.id)).some((m) => m.id.every((b, n) => b === parado[n])),
    ).toBe(false);
  }, 30_000);

  it('aceitar um pedido baixa os anexos que esperavam (RF-07)', async () => {
    const [alice, bob] = [await pessoa(), await pessoa()];
    await online(alice, bob);
    await alice.correio.iniciarConversa(bob.id);
    const id = await alice.correio.enviarAnexo(bob.id, foto());
    await ate(async () => (await estadoDo(bob, alice, id)) === 'baixar', 'chega como pedido');
    await redeParada();
    expect(bob.transporte.http).toEqual([]);
    await conversasDe(bob).adicionar(alice.id);
    await baixou(bob, alice, id);
  }, 30_000);
});

describe('ações nas mensagens (RF-52 a RF-55)', () => {
  it('salvar só por pedido, só o que já está aqui (RF-53)', async () => {
    const [alice, bob] = await conversa();
    const midia = midiaDeTeste();
    const app = conversasDe(bob, midia);
    const arquivo = foto();
    const id = await alice.correio.enviarAnexo(bob.id, arquivo);
    await baixou(bob, alice, id);
    expect(midia.salvos).toEqual([]);
    await bob.agenda.mudarBaixarSozinho(false);
    const parado = await alice.correio.enviarAnexo(bob.id, foto());
    await ate(async () => (await estadoDo(bob, alice, parado)) === 'manual', 'chega parado');
    const [primeira] = await bob.agenda.mensagens(alice.id);
    if (!primeira) throw new Error('sem mensagens');
    expect(await app.salvar(alice.id, [id, parado, primeira.id])).toBe(1);
    expect(midia.salvos).toEqual([
      { arquivo: 'imagem', formato: 'image/jpeg', bytes: arquivo.bytes, capa: null },
    ]);
  }, 30_000);

  it('copiar: textos e legendas, um por linha, na ordem da conversa, sem nome nem hora (RF-52)', async () => {
    const [alice, bob] = await conversa();
    const midia = midiaDeTeste();
    const app = conversasDe(alice, midia);
    const semLegenda = await alice.correio.enviarAnexo(bob.id, foto());
    const comLegenda = await alice.correio.enviarAnexo(bob.id, foto(), { legenda: 'o portão' });
    const [oi, resposta] = await alice.agenda.mensagens(bob.id);
    if (!oi || !resposta) throw new Error('sem mensagens');
    expect(await app.copiar(bob.id, [comLegenda, resposta.id, semLegenda, oi.id])).toBe(true);
    expect(midia.copiados).toEqual(['oi\noi, alice\no portão']);
    expect(await app.copiar(bob.id, [semLegenda])).toBe(false);
  }, 30_000);

  it('encaminhar: até 5 conversas, como mensagem nova, com o timer do destino (RF-54)', async () => {
    const [alice, bob] = await conversa();
    const carol = await pessoa();
    await online(carol);
    const app = conversasDe(bob);
    await bob.correio.iniciarConversa(carol.id);
    await app.mudarTimer(carol.id, 3600, false);
    await ate(async () => (await carol.agenda.pedidos()).length === 1, 'carol recebe o timer');
    await carol.agenda.aceitar(bob.id);
    const arquivo = foto();
    const original = await alice.correio.enviarAnexo(bob.id, arquivo, { legenda: 'veja' });
    await baixou(bob, alice, original);
    const [oi] = await bob.agenda.mensagens(alice.id);
    if (!oi) throw new Error('sem mensagens');

    const destinos = [carol.id, bob.id];
    expect(await app.encaminhar(alice.id, [original, oi.id], destinos)).toEqual({
      enviadas: 4,
      falhas: 0,
    });
    await ate(async () => (await textos(carol, bob)).includes('veja'), 'carol recebe');
    const deCarol = await carol.agenda.mensagens(bob.id);
    expect(deCarol.map((m) => [m.texto, m.ttl])).toEqual([
      ['oi', 3600],
      ['veja', 3600],
    ]);
    const copia = deCarol[1];
    if (!copia) throw new Error('sem a cópia');
    await baixou(carol, bob, copia.id);
    expect((await carol.agenda.abrirAnexo(bob.id, copia.id))?.bytes).toEqual(arquivo.bytes);
    // Na nota pessoal, ficou só no aparelho do Bob.
    expect((await bob.agenda.mensagens(bob.id)).map((m) => m.texto)).toEqual(['oi', 'veja']);
    expect(await app.encaminhar(alice.id, [oi.id], ['A', 'B', 'C', 'D', 'E', 'F'])).toEqual({
      enviadas: 0,
      falhas: 1,
    });
  }, 30_000);

  it('responder leva o ID da original; a citação sai da cópia de cada lado (RF-55)', async () => {
    const [alice, bob] = await conversa();
    const app = conversasDe(bob);
    const [oi] = await bob.agenda.mensagens(alice.id);
    if (!oi) throw new Error('sem mensagens');
    expect(await app.enviar(alice.id, 'respondendo', undefined, oi.id)).toBe('ok');
    expect(await app.enviar(bob.id, 'na nota', undefined, oi.id)).toBe('ok');
    await ate(async () => (await textos(alice, bob)).includes('respondendo'), 'alice recebe');
    const itens = await alice.agenda.itens(bob.id);
    const resposta = itens.find((i) => i.tipo === 'mensagem' && i.mensagem.texto === 'respondendo');
    expect(resposta?.tipo === 'mensagem' && resposta.citada?.mensagem?.texto).toBe('oi');
  }, 30_000);
});
