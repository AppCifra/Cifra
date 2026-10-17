import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BYTES_DA_MARCA, codificarMensagemDoRelay, codificarPedido } from '@cifra/protocol';
import { afterAll, describe, expect, it } from 'vitest';
import { alvosDaTela, pequenos } from '../spike/verificacao/alvos.ts';
import {
  conexoesTcp,
  lerPcap,
  perguntasDeDns,
  quadrosWebSocket,
} from '../spike/verificacao/pcap.ts';
import { resumirRede } from '../spike/verificacao/rede.ts';
import { conferirCaptura } from '../spike/verificacao/tamanhos.ts';
import { formasDe, lerMarcadores, varrer } from '../spike/verificacao/varredura.ts';

// As ferramentas da verificação final (docs/VERIFICACAO.md): a varredura de marcadores na extração
// do aparelho, o leitor de capturas e a conferência dos tamanhos, e as áreas de toque.

const pasta = mkdtempSync(join(tmpdir(), 'cifra-verificacao-'));
afterAll(() => {
  rmSync(pasta, { recursive: true, force: true });
});

function arquivo(nome: string, conteudo: Buffer): string {
  const caminho = join(pasta, nome);
  writeFileSync(caminho, conteudo);
  return caminho;
}

/** Um .tar ustar com os arquivos dados; nomes longos vão num cabeçalho GNU `L`. */
function tar(arquivos: Record<string, Buffer>): Buffer {
  const blocos: Buffer[] = [];
  const cabecalho = (nome: string, tamanho: number, tipo: string) => {
    const bloco = Buffer.alloc(512);
    bloco.write(nome.slice(0, 100), 0, 'utf8');
    bloco.write(tamanho.toString(8).padStart(11, '0'), 124, 'latin1');
    bloco.write(tipo, 156, 'latin1');
    bloco.write('ustar\0', 257, 'latin1');
    return bloco;
  };
  const dados = (conteudo: Buffer) =>
    Buffer.concat([conteudo, Buffer.alloc((512 - (conteudo.length % 512)) % 512)]);
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    if (nome.length > 100) {
      const longo = Buffer.from(`${nome}\0`);
      blocos.push(cabecalho('././@LongLink', longo.length, 'L'), dados(longo));
    }
    blocos.push(cabecalho(nome, conteudo.length, '0'), dados(conteudo));
  }
  return Buffer.concat([...blocos, Buffer.alloc(1024)]);
}

describe('varredura de marcadores na extração', () => {
  const marcador = 'xqzmensagem7k2';

  it('acha o marcador em UTF-8, UTF-16 e base64, com o arquivo do .tar em que está', () => {
    const longo = `data/data/org.cifra.app/${'p'.repeat(120)}/prefs.json`;
    const caminho = arquivo(
      'extracao.tar',
      tar({
        'data/system/limpo.bin': Buffer.alloc(3000, 7),
        'data/misc/log.txt': Buffer.from(`linha ${marcador} fim`),
        'data/data/teclado/dicionario': Buffer.from(`..${marcador}..`, 'utf16le'),
        [longo]: Buffer.from(`{"v":"${Buffer.from(`!${marcador}?`).toString('base64')}"}`),
      }),
    );
    const achados = varrer(caminho, [marcador]);
    expect(achados.map((achado) => [achado.arquivo, achado.forma])).toEqual([
      ['data/misc/log.txt', 'utf8'],
      ['data/data/teclado/dicionario', 'utf16'],
      [longo, 'base64'],
    ]);
    expect(achados[0]?.deslocamento).toBe(6);
  });

  it('numa imagem crua, varre byte a byte; sem o marcador, nada', () => {
    const imagem = Buffer.alloc(100_000, 0);
    Buffer.from(marcador, 'utf16le').swap16().copy(imagem, 77_777);
    expect(varrer(arquivo('imagem.img', imagem), [marcador])).toEqual([
      { marcador, forma: 'utf16', arquivo: '', deslocamento: 77_778 },
    ]);
    expect(varrer(arquivo('limpa.img', Buffer.alloc(50_000, 1)), [marcador])).toEqual([]);
  });

  it('as formas em base64 aparecem em qualquer alinhamento', () => {
    const formas = formasDe(marcador).filter((forma) => forma.forma === 'base64');
    expect(formas).toHaveLength(3);
    for (const antes of ['', 'a', 'ab', 'abc', 'abcd']) {
      const codificado = Buffer.from(`${antes}${marcador}!`).toString('base64');
      expect(formas.some((forma) => codificado.includes(forma.bytes.toString()))).toBe(true);
    }
  });

  it('com hex:, procura os bytes como estão', () => {
    const trecho = Buffer.from([0xff, 0xd8, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const imagem = Buffer.concat([Buffer.alloc(1000, 3), trecho, Buffer.alloc(10)]);
    expect(varrer(arquivo('anexo.img', imagem), [`hex:${trecho.toString('hex')}`])).toEqual([
      {
        marcador: `hex:${trecho.toString('hex')}`,
        forma: 'bytes',
        arquivo: '',
        deslocamento: 1000,
      },
    ]);
  });

  it('lê o arquivo de marcadores sem linhas vazias e comentários', () => {
    expect(lerMarcadores('# cenário\nxqza1\n\n  xqzb2  \r\n')).toEqual(['xqza1', 'xqzb2']);
  });
});

/** Uma captura pcap em Ethernet com os pacotes IPv4 dados. */
function pcap(pacotes: Buffer[]): Buffer {
  const global = Buffer.alloc(24);
  global.writeUInt32LE(0xa1b2c3d4, 0);
  global.writeUInt16LE(2, 4);
  global.writeUInt16LE(4, 6);
  global.writeUInt32LE(65535, 16);
  global.writeUInt32LE(1, 20);
  const registros = pacotes.map((ip, i) => {
    const quadro = Buffer.concat([Buffer.alloc(12), Buffer.from([0x08, 0x00]), ip]);
    const cabecalho = Buffer.alloc(16);
    cabecalho.writeUInt32LE(1_700_000_000 + i, 0);
    cabecalho.writeUInt32LE(quadro.length, 8);
    cabecalho.writeUInt32LE(quadro.length, 12);
    return Buffer.concat([cabecalho, quadro]);
  });
  return Buffer.concat([global, ...registros]);
}

function ipv4(origem: string, destino: string, protocolo: number, transporte: Buffer): Buffer {
  const ip = Buffer.alloc(20);
  ip[0] = 0x45;
  ip.writeUInt16BE(20 + transporte.length, 2);
  ip[9] = protocolo;
  Buffer.from(origem.split('.').map(Number)).copy(ip, 12);
  Buffer.from(destino.split('.').map(Number)).copy(ip, 16);
  return Buffer.concat([ip, transporte]);
}

function tcp(de: number, para: number, sequencia: number, carga: Buffer, sin = false): Buffer {
  const cabecalho = Buffer.alloc(20);
  cabecalho.writeUInt16BE(de, 0);
  cabecalho.writeUInt16BE(para, 2);
  cabecalho.writeUInt32BE(sequencia, 4);
  cabecalho[12] = 5 << 4;
  cabecalho[13] = sin ? 0x02 : 0x18;
  return Buffer.concat([cabecalho, carga]);
}

function udp(de: number, para: number, carga: Buffer): Buffer {
  const cabecalho = Buffer.alloc(8);
  cabecalho.writeUInt16BE(de, 0);
  cabecalho.writeUInt16BE(para, 2);
  cabecalho.writeUInt16BE(8 + carga.length, 4);
  return Buffer.concat([cabecalho, carga]);
}

/** Um quadro binário de WebSocket, com máscara quando sai do cliente. */
function quadro(carga: Uint8Array, mascarado: boolean): Buffer {
  const tamanho =
    carga.length < 126
      ? Buffer.from([carga.length])
      : Buffer.from([126, carga.length >> 8, carga.length & 0xff]);
  if (mascarado) tamanho[0] = (tamanho[0] ?? 0) | 0x80;
  const mascara = Buffer.from([1, 2, 3, 4]);
  const corpo = Buffer.from(carga);
  if (mascarado)
    for (let i = 0; i < corpo.length; i++) corpo[i] = (corpo[i] ?? 0) ^ (mascara[i % 4] ?? 0);
  return Buffer.concat([
    Buffer.from([0x82]),
    tamanho,
    mascarado ? mascara : Buffer.alloc(0),
    corpo,
  ]);
}

const ABERTURA = Buffer.from(
  'GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n',
);
const RESPOSTA = Buffer.from('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\n');

function deposito(pacote: number): Uint8Array {
  const pedido = codificarPedido({
    tipo: 'depositar',
    numero: 1,
    caixa: new Uint8Array(32),
    pacote: new Uint8Array(4096),
    marca: new Uint8Array(BYTES_DA_MARCA),
  });
  if (pacote === 4096) return pedido;
  // Um cliente modificado: o mesmo pedido com o pacote de outro tamanho.
  return Buffer.concat([pedido.subarray(0, 37), Buffer.alloc(pacote), pedido.subarray(37 + 4096)]);
}

/** Uma conexão do Tor com o relay: os bytes de ida em dois segmentos fora de ordem e repetidos. */
function capturaDoRelay(ida: Buffer): Buffer {
  const volta = Buffer.concat([
    RESPOSTA,
    quadro(
      codificarMensagemDoRelay({
        tipo: 'pacote',
        id: new Uint8Array(16),
        pacote: new Uint8Array(4096),
        marca: new Uint8Array(BYTES_DA_MARCA),
      }),
      false,
    ),
  ]);
  const meio = 1000;
  const c = '127.0.0.1';
  return pcap([
    ipv4(c, c, 6, tcp(50000, 8080, 99, Buffer.alloc(0), true)),
    ipv4(c, c, 6, tcp(50000, 8080, 100 + meio, ida.subarray(meio))),
    ipv4(c, c, 6, tcp(50000, 8080, 100, ida.subarray(0, meio))),
    ipv4(c, c, 6, tcp(50000, 8080, 100, ida.subarray(0, meio))),
    ipv4(c, c, 6, tcp(8080, 50000, 7, Buffer.alloc(0), true)),
    ipv4(c, c, 6, tcp(8080, 50000, 8, volta)),
  ]);
}

describe('leitor de capturas e tamanhos dos pacotes (RNF-04)', () => {
  it('remonta a conexão fora de ordem e com retransmissão, e lê os quadros', () => {
    const ida = Buffer.concat([ABERTURA, quadro(deposito(4096), true)]);
    const [conexao] = conexoesTcp(lerPcap(capturaDoRelay(ida)), 8080);
    expect(conexao?.enviado).toEqual(ida);
    const [primeiro] = quadrosWebSocket(conexao?.enviado ?? Buffer.alloc(0));
    expect(primeiro?.carga).toEqual(Buffer.from(deposito(4096)));
  });

  it('depósito e entrega de 4096 bytes passam', () => {
    const ida = Buffer.concat([ABERTURA, quadro(deposito(4096), true)]);
    expect(conferirCaptura(capturaDoRelay(ida))).toEqual({
      contagem: { 'pedido depositar': 1, 'relay pacote': 1 },
      problemas: [],
    });
  });

  it('um pacote de outro tamanho é acusado', () => {
    const ida = Buffer.concat([ABERTURA, quadro(deposito(4000), true)]);
    expect(conferirCaptura(capturaDoRelay(ida)).problemas).toEqual([
      'pedido ilegível de 4086 bytes',
    ]);
  });

  it('anexo que sobe fora da faixa é acusado', () => {
    const c = '127.0.0.1';
    const put = (tamanho: number, porta: number) =>
      ipv4(
        c,
        c,
        6,
        tcp(
          porta,
          8080,
          1,
          Buffer.from(`PUT /anexos/abc HTTP/1.1\r\nContent-Length: ${tamanho}\r\n\r\n`),
        ),
      );
    expect(conferirCaptura(pcap([put(4096, 50001), put(5000, 50002)]))).toEqual({
      contagem: { 'anexo PUT': 2 },
      problemas: ['anexo com 5000 bytes'],
    });
  });
});

describe('captura do aparelho (RNF-06)', () => {
  function pergunta(nome: string): Buffer {
    const rotulos = nome
      .split('.')
      .map((rotulo) => Buffer.concat([Buffer.from([rotulo.length]), Buffer.from(rotulo)]));
    const cabecalho = Buffer.alloc(12);
    cabecalho.writeUInt16BE(1, 4);
    return Buffer.concat([cabecalho, ...rotulos, Buffer.from([0, 0, 1, 0, 1])]);
  }

  it('acusa nome .onion no DNS e conexão com destino proibido', () => {
    const captura = pcap([
      ipv4('10.0.2.15', '10.0.2.3', 17, udp(40000, 53, pergunta('exemplo.org'))),
      ipv4('10.0.2.15', '10.0.2.3', 17, udp(40001, 53, pergunta(`${'a'.repeat(56)}.onion`))),
      ipv4('10.0.2.15', '198.51.100.7', 6, tcp(40002, 9001, 1, Buffer.from('tor'))),
      ipv4('10.0.2.15', '10.0.2.2', 6, tcp(40003, 8080, 1, Buffer.from('GET'))),
    ]);
    expect(perguntasDeDns(lerPcap(captura))).toEqual(['exemplo.org', `${'a'.repeat(56)}.onion`]);
    expect(resumirRede(captura, ['10.0.2.2:8080']).problemas).toEqual([
      `DNS de ${'a'.repeat(56)}.onion`,
      'tcp 10.0.2.15:40003 > 10.0.2.2:8080',
    ]);
    expect(resumirRede(captura, []).fluxos).toHaveLength(4);
  });
});

describe('áreas de toque (RNF-18)', () => {
  it('lista o que é clicável no app e menor que 44 dp', () => {
    const xml = `<hierarchy>
      <node text="Entrar" package="org.cifra.app" clickable="true" long-clickable="false" bounds="[0,0][1080,147]" />
      <node text="" content-desc="timer" package="org.cifra.app" clickable="true" long-clickable="false" bounds="[10,10][94,94]" />
      <node text="balão" package="org.cifra.app" clickable="false" long-clickable="true" bounds="[0,200][1080,400]" />
      <node text="Wi-Fi" package="com.android.systemui" clickable="true" long-clickable="false" bounds="[0,0][10,10]" />
      <node text="título" package="org.cifra.app" clickable="false" long-clickable="false" bounds="[0,0][10,10]" />
    </hierarchy>`;
    const alvos = alvosDaTela(xml, 420);
    expect(alvos.map((alvo) => alvo.texto)).toEqual(['Entrar', 'timer', 'balão']);
    expect(pequenos(alvos)).toEqual([{ texto: 'timer', largura: 32, altura: 32 }]);
  });
});
