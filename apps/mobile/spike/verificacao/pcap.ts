// Leitor mínimo de capturas (.pcap) para os testes de rede (docs/VERIFICACAO.md): IPv4 e IPv6, TCP
// e UDP, sobre Ethernet, IP cru ou o "any" do Linux (SLL e SLL2). Remonta cada sentido de uma
// conexão TCP e lê os quadros de WebSocket. Sem dependência: só o formato publicado do libpcap.

export interface Pacote {
  readonly tempo: number;
  readonly protocolo: 'tcp' | 'udp';
  readonly origem: string;
  readonly destino: string;
  readonly portaDeOrigem: number;
  readonly portaDeDestino: number;
  /** Só no TCP. */
  readonly sequencia: number;
  readonly sin: boolean;
  readonly carga: Buffer;
}

const ETHERNET = 1;
const IP_CRU = 101;
const LINUX_SLL = 113;
const LINUX_SLL2 = 276;

function ipv6(bytes: Buffer): string {
  const partes: string[] = [];
  for (let i = 0; i < 16; i += 2) partes.push(bytes.readUInt16BE(i).toString(16));
  return partes.join(':').replace(/(^|:)0(:0)+(:|$)/, '::');
}

/** O pacote IP que começa em `ip`, ou null se não for TCP nem UDP. */
function lerIp(dados: Buffer, ip: number, tempo: number): Pacote | null {
  const versao = (dados[ip] ?? 0) >> 4;
  let origem: string;
  let destino: string;
  let protocolo: number;
  let transporte: number;
  let fim: number;
  if (versao === 4) {
    const cabecalho = ((dados[ip] ?? 0) & 0x0f) * 4;
    protocolo = dados[ip + 9] ?? 0;
    origem = [...dados.subarray(ip + 12, ip + 16)].join('.');
    destino = [...dados.subarray(ip + 16, ip + 20)].join('.');
    transporte = ip + cabecalho;
    fim = Math.min(dados.length, ip + dados.readUInt16BE(ip + 2));
  } else if (versao === 6) {
    protocolo = dados[ip + 6] ?? 0;
    origem = ipv6(dados.subarray(ip + 8, ip + 24));
    destino = ipv6(dados.subarray(ip + 24, ip + 40));
    transporte = ip + 40;
    fim = Math.min(dados.length, transporte + dados.readUInt16BE(ip + 4));
  } else {
    return null;
  }
  if (protocolo === 6) {
    const deslocamento = ((dados[transporte + 12] ?? 0) >> 4) * 4;
    return {
      tempo,
      protocolo: 'tcp',
      origem,
      destino,
      portaDeOrigem: dados.readUInt16BE(transporte),
      portaDeDestino: dados.readUInt16BE(transporte + 2),
      sequencia: dados.readUInt32BE(transporte + 4),
      sin: ((dados[transporte + 13] ?? 0) & 0x02) !== 0,
      carga: dados.subarray(transporte + deslocamento, fim),
    };
  }
  if (protocolo === 17) {
    return {
      tempo,
      protocolo: 'udp',
      origem,
      destino,
      portaDeOrigem: dados.readUInt16BE(transporte),
      portaDeDestino: dados.readUInt16BE(transporte + 2),
      sequencia: 0,
      sin: false,
      carga: dados.subarray(transporte + 8, fim),
    };
  }
  return null;
}

/** Onde começa o IP dentro do quadro, ou null se não for IP. */
function inicioDoIp(quadro: Buffer, enlace: number): number | null {
  if (enlace === IP_CRU) return 0;
  let tipo: number;
  let ip: number;
  if (enlace === ETHERNET) {
    tipo = quadro.readUInt16BE(12);
    ip = 14;
    while (tipo === 0x8100) {
      tipo = quadro.readUInt16BE(ip + 2);
      ip += 4;
    }
  } else if (enlace === LINUX_SLL) {
    tipo = quadro.readUInt16BE(14);
    ip = 16;
  } else if (enlace === LINUX_SLL2) {
    tipo = quadro.readUInt16BE(0);
    ip = 20;
  } else {
    throw new Error(`enlace ${enlace} não suportado`);
  }
  return tipo === 0x0800 || tipo === 0x86dd ? ip : null;
}

/** Os pacotes TCP e UDP de uma captura no formato clássico do libpcap. */
export function lerPcap(arquivo: Buffer): Pacote[] {
  const magia = arquivo.readUInt32LE(0);
  const pequeno = magia === 0xa1b2c3d4 || magia === 0xa1b23c4d;
  if (!pequeno && magia !== 0xd4c3b2a1 && magia !== 0x4d3cb2a1) {
    throw new Error('não é um .pcap (pcapng não é suportado)');
  }
  const nano = magia === 0xa1b23c4d || magia === 0x4d3cb2a1;
  const u32 = (i: number) => (pequeno ? arquivo.readUInt32LE(i) : arquivo.readUInt32BE(i));
  const enlace = u32(20) & 0x0fffffff;
  const pacotes: Pacote[] = [];
  let i = 24;
  while (i + 16 <= arquivo.length) {
    const tempo = u32(i) + u32(i + 4) / (nano ? 1e9 : 1e6);
    const capturado = u32(i + 8);
    const quadro = arquivo.subarray(i + 16, i + 16 + capturado);
    i += 16 + capturado;
    const ip = inicioDoIp(quadro, enlace);
    if (ip === null) continue;
    const pacote = lerIp(quadro, ip, tempo);
    if (pacote) pacotes.push(pacote);
  }
  return pacotes;
}

export interface Conexao {
  readonly cliente: string;
  readonly servidor: string;
  /** O que o cliente mandou e o que recebeu, remontados na ordem. */
  readonly enviado: Buffer;
  readonly recebido: Buffer;
}

const ponta = (ip: string, porta: number) => `${ip.includes(':') ? `[${ip}]` : ip}:${porta}`;

function remontar(segmentos: Pacote[]): Buffer {
  const comCarga = segmentos.filter((s) => s.carga.length > 0);
  const sin = segmentos.find((s) => s.sin);
  const base = sin ? sin.sequencia + 1 : Math.min(...comCarga.map((s) => s.sequencia));
  const relativo = (s: Pacote) => (s.sequencia - base + 2 ** 32) % 2 ** 32;
  const ordenados = comCarga.sort((a, b) => relativo(a) - relativo(b));
  const partes: Buffer[] = [];
  let proximo = 0;
  for (const segmento of ordenados) {
    const inicio = relativo(segmento);
    const fim = inicio + segmento.carga.length;
    if (fim <= proximo) continue; // retransmissão
    partes.push(segmento.carga.subarray(Math.max(0, proximo - inicio)));
    proximo = fim;
  }
  return Buffer.concat(partes);
}

/** As conexões TCP com `porta` do lado do servidor, cada sentido remontado. */
export function conexoesTcp(pacotes: readonly Pacote[], porta: number): Conexao[] {
  const porConexao = new Map<string, { ida: Pacote[]; volta: Pacote[] }>();
  for (const pacote of pacotes) {
    if (pacote.protocolo !== 'tcp') continue;
    const ida = pacote.portaDeDestino === porta;
    if (!ida && pacote.portaDeOrigem !== porta) continue;
    const cliente = ida
      ? ponta(pacote.origem, pacote.portaDeOrigem)
      : ponta(pacote.destino, pacote.portaDeDestino);
    const servidor = ida
      ? ponta(pacote.destino, pacote.portaDeDestino)
      : ponta(pacote.origem, pacote.portaDeOrigem);
    const chave = `${cliente}>${servidor}`;
    const conexao = porConexao.get(chave) ?? { ida: [], volta: [] };
    (ida ? conexao.ida : conexao.volta).push(pacote);
    porConexao.set(chave, conexao);
  }
  return [...porConexao.entries()].map(([chave, { ida, volta }]) => {
    const [cliente = '', servidor = ''] = chave.split('>');
    return { cliente, servidor, enviado: remontar(ida), recebido: remontar(volta) };
  });
}

export interface QuadroWebSocket {
  readonly opcode: number;
  readonly carga: Buffer;
}

/**
 * Os quadros de WebSocket de um sentido da conexão, depois do cabeçalho HTTP da abertura. Quem é
 * cliente manda com máscara; o servidor, sem. O último quadro, se cortado, fica de fora.
 */
export function quadrosWebSocket(sentido: Buffer): QuadroWebSocket[] {
  const fimDoHttp = sentido.indexOf('\r\n\r\n');
  if (fimDoHttp === -1) return [];
  const quadros: QuadroWebSocket[] = [];
  let i = fimDoHttp + 4;
  while (i + 2 <= sentido.length) {
    const primeiro = sentido[i] ?? 0;
    const segundo = sentido[i + 1] ?? 0;
    let tamanho = segundo & 0x7f;
    let j = i + 2;
    if (tamanho === 126) {
      tamanho = sentido.readUInt16BE(j);
      j += 2;
    } else if (tamanho === 127) {
      tamanho = Number(sentido.readBigUInt64BE(j));
      j += 8;
    }
    const mascara = (segundo & 0x80) !== 0 ? sentido.subarray(j, j + 4) : null;
    if (mascara) j += 4;
    if (j + tamanho > sentido.length) break;
    const carga = Buffer.from(sentido.subarray(j, j + tamanho));
    if (mascara)
      for (let k = 0; k < carga.length; k++) carga[k] = (carga[k] ?? 0) ^ (mascara[k % 4] ?? 0);
    quadros.push({ opcode: primeiro & 0x0f, carga });
    i = j + tamanho;
  }
  return quadros;
}

/** Os nomes perguntados ao DNS (UDP 53), na ordem. */
export function perguntasDeDns(pacotes: readonly Pacote[]): string[] {
  const nomes: string[] = [];
  for (const pacote of pacotes) {
    if (pacote.protocolo !== 'udp' || pacote.portaDeDestino !== 53) continue;
    const carga = pacote.carga;
    if (carga.length < 12 || carga.readUInt16BE(4) === 0) continue;
    const rotulos: string[] = [];
    let i = 12;
    while (i < carga.length && carga[i] !== 0) {
      const tamanho = carga[i] ?? 0;
      rotulos.push(carga.subarray(i + 1, i + 1 + tamanho).toString('latin1'));
      i += 1 + tamanho;
    }
    nomes.push(rotulos.join('.'));
  }
  return nomes;
}

export interface Fluxo {
  readonly protocolo: 'tcp' | 'udp';
  readonly origem: string;
  readonly destino: string;
  readonly pacotes: number;
  readonly bytes: number;
}

/** Os fluxos da captura, de quem para quem, com os pacotes e os bytes de carga. */
export function fluxos(pacotes: readonly Pacote[]): Fluxo[] {
  const mapa = new Map<string, Fluxo>();
  for (const pacote of pacotes) {
    const origem = ponta(pacote.origem, pacote.portaDeOrigem);
    const destino = ponta(pacote.destino, pacote.portaDeDestino);
    const chave = `${pacote.protocolo} ${origem} ${destino}`;
    const atual = mapa.get(chave);
    mapa.set(chave, {
      protocolo: pacote.protocolo,
      origem,
      destino,
      pacotes: (atual?.pacotes ?? 0) + 1,
      bytes: (atual?.bytes ?? 0) + pacote.carga.length,
    });
  }
  return [...mapa.values()].sort((a, b) => b.bytes - a.bytes);
}
