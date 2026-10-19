// O relay: guarda cartões, caixas e pacotes cifrados, entrega e esquece (SPEC, "Especificação do
// relay"). O HTTP só existe para o WebSocket, e o WebSocket só aceita as mensagens binárias do
// protocolo, validadas na entrada (RNF-13). Cada conexão recebe um desafio no `ola`, pode abrir uma
// caixa e depositar em qualquer uma. O dono de um ID também apaga o cartão e a caixa principal
// (pânico), assinando o desafio da conexão com a chave de identidade. O relay não sabe quem é quem:
// não lê IP, não guarda nada da conexão no banco e não escreve log (RNF-03, RNF-05).
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  aberturaAutentica,
  ANEXOS_SUBINDO,
  apagarTudoAutentico,
  codificarMensagemDoRelay,
  CONEXOES_SIMULTANEAS,
  ESPACO_DOS_ANEXOS_EM_MB,
  FECHAMENTOS,
  idDaChave,
  idDoCartao,
  idDoPacote,
  JANELA_DE_ENTREGA,
  lerCartao,
  lerPedido,
  MAXIMO_DE_PREKEYS,
  OCIOSIDADE_EM_SEGUNDOS,
  PACOTES_POR_CAIXA,
  PARADA_DO_ANEXO_EM_SEGUNDOS,
  PINGS_SEM_RESPOSTA,
  publicacaoAutentica,
  RETENCAO_DA_CAIXA_EM_DIAS,
  RETENCAO_DO_ANEXO_EM_DIAS,
  RETENCAO_DO_CARTAO_EM_DIAS,
  RETENCAO_DO_PACOTE_EM_DIAS,
  TAMANHO_MAXIMO_DO_PEDIDO,
  TAXAS,
  TOLERANCIA_DO_RELOGIO_EM_HORAS,
  TRANSFERENCIAS_DE_ANEXOS,
  VERSAO_DO_PROTOCOLO,
  type CodigoDeResposta,
  type MensagemDoRelay,
  type PedidoAoRelay,
  type Taxa,
} from '@cifra/protocol';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { criarAnexos, type LimitesDosAnexos } from './anexos.ts';
import type { Banco } from './banco.ts';
import type { SodiumDoRelay } from './sodium.ts';
import { criarBalde, type Balde } from './taxa.ts';

const HORA = 3_600_000;
const DIA = 24 * HORA;

/** Fechamento padrão do WebSocket para mensagem de texto: o protocolo só tem binárias. */
const SO_BINARIO = 1003;

/** O banco guarda as datas na hora cheia, arredondadas para cima: o prazo nunca encurta. */
export function horaCheia(instante: number): number {
  return Math.ceil(instante / HORA) * HORA;
}

export interface LimitesDoRelay {
  readonly pacotesPorCaixa: number;
  readonly janelaDeEntrega: number;
  readonly conexoes: number;
  readonly ociosidade: number;
  readonly taxas: Readonly<Record<keyof typeof TAXAS, Taxa>>;
  readonly anexos: LimitesDosAnexos;
}

const LIMITES: LimitesDoRelay = {
  pacotesPorCaixa: PACOTES_POR_CAIXA,
  janelaDeEntrega: JANELA_DE_ENTREGA,
  conexoes: CONEXOES_SIMULTANEAS,
  ociosidade: OCIOSIDADE_EM_SEGUNDOS * 1000,
  taxas: TAXAS,
  anexos: {
    subindo: ANEXOS_SUBINDO,
    transferencias: TRANSFERENCIAS_DE_ANEXOS,
    espaco: ESPACO_DOS_ANEXOS_EM_MB * 1024 * 1024,
    parada: PARADA_DO_ANEXO_EM_SEGUNDOS * 1000,
  },
};

/** Um anexo de 25 MiB pelo Tor pode levar minutos; quem fica parado cai pelo prazo de parada. */
const PRAZO_DO_PEDIDO_HTTP = 30 * 60_000;

export interface OpcoesDoRelay {
  readonly banco: Banco;
  readonly sodium: SodiumDoRelay;
  /** Milissegundos desde 1970. Injetado para testar prazos e taxas sem esperar. */
  readonly agora: () => number;
  /** Só nos testes: limites menores, para não precisar de mil pacotes ou de mil conexões. */
  readonly limites?: Partial<LimitesDoRelay>;
}

export interface Relay {
  readonly servidor: Server;
  /** Apaga pacotes, cartões e caixas vencidos (RNF-14). Rode ao subir e a cada hora. */
  limpar(): void;
  /** Manda ping, derruba quem deixou os últimos sem resposta e fecha as conexões ociosas. */
  vigiar(): void;
  /** Derruba todas as conexões e fecha o servidor. */
  fechar(): Promise<void>;
}

interface Conexao {
  readonly ws: WebSocket;
  /** O desafio do `ola`: só vale para abrir uma caixa nesta conexão. */
  readonly desafio: Uint8Array;
  readonly baldes: Readonly<Record<keyof typeof TAXAS, Balde>>;
  caixa: { readonly chave: Uint8Array; readonly hex: string } | null;
  /** IDs (em hex) dos pacotes entregues e ainda sem confirmação. */
  readonly enviados: Set<string>;
  emDia: boolean;
  /** Pings seguidos sem pong nem mensagem. */
  pingsSemResposta: number;
  ultimaMensagem: number;
  fechada: boolean;
}

const hex = (bytes: Uint8Array) =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('hex');

function comoBytes(dados: RawData): Uint8Array {
  if (Array.isArray(dados)) return Buffer.concat(dados);
  return dados instanceof ArrayBuffer ? new Uint8Array(dados) : dados;
}

export function criarRelay({ banco, sodium, agora, limites: ajustes = {} }: OpcoesDoRelay): Relay {
  const limites: LimitesDoRelay = { ...LIMITES, ...ajustes };
  const conexoes = new Set<Conexao>();
  /** Caixa aberta (em hex) para a conexão que a abriu. Vale a abertura mais nova. */
  const caixasAbertas = new Map<string, Conexao>();

  // O que sobrou de um envio interrompido quando o relay caiu não volta.
  banco.apagarIncompletos();
  const anexos = criarAnexos({
    banco,
    sodium,
    limites: limites.anexos,
    prazo: () => horaCheia(agora() + RETENCAO_DO_ANEXO_EM_DIAS * DIA),
  });
  // Fora do WebSocket, só os anexos.
  const servidor = createServer(anexos);
  servidor.requestTimeout = PRAZO_DO_PEDIDO_HTTP;

  const wss = new WebSocketServer({
    noServer: true,
    // Mensagem maior que o maior pedido possível é recusada antes de ser lida inteira (1009).
    maxPayload: TAMANHO_MAXIMO_DO_PEDIDO,
    // Sem compressão: os pacotes já são aleatórios, e comprimir revelaria tamanho.
    perMessageDeflate: false,
    clientTracking: false,
  });

  function recusar(socket: Duplex, status: string): void {
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }

  servidor.on('upgrade', (pedido: IncomingMessage, socket: Duplex, cabeca: Buffer) => {
    socket.on('error', () => socket.destroy());
    if (pedido.url !== '/') {
      recusar(socket, '404 Not Found');
      return;
    }
    if (conexoes.size >= limites.conexoes) {
      recusar(socket, '503 Service Unavailable');
      return;
    }
    wss.handleUpgrade(pedido, socket, cabeca, aoConectar);
  });

  function enviar(conexao: Conexao, mensagem: MensagemDoRelay): void {
    if (!conexao.fechada) conexao.ws.send(codificarMensagemDoRelay(mensagem));
  }

  function responder(conexao: Conexao, numero: number, codigo: CodigoDeResposta): void {
    enviar(conexao, { tipo: 'resposta', numero, codigo });
  }

  function esquecer(conexao: Conexao): void {
    conexao.fechada = true;
    conexoes.delete(conexao);
    if (conexao.caixa && caixasAbertas.get(conexao.caixa.hex) === conexao) {
      caixasAbertas.delete(conexao.caixa.hex);
    }
  }

  function fecharConexao(conexao: Conexao, codigo: number): void {
    if (conexao.fechada) return;
    esquecer(conexao);
    conexao.ws.close(codigo);
  }

  /**
   * Entrega os pacotes da caixa aberta, na ordem de chegada, até encher a janela. Os entregues e
   * ainda sem confirmação são sempre os mais antigos da caixa: os próximos vêm logo depois deles.
   */
  function preencher(conexao: Conexao): void {
    const { caixa } = conexao;
    if (!caixa || conexao.fechada) return;
    const pendentes = banco.pendentes(caixa.chave, limites.janelaDeEntrega);
    // Entregue que sumiu do banco (venceu antes da confirmação) libera a vaga na janela.
    const existentes = new Set(pendentes.map(({ id }) => hex(id)));
    for (const id of conexao.enviados) if (!existentes.has(id)) conexao.enviados.delete(id);

    for (const { id, pacote, marca } of pendentes) {
      if (conexao.enviados.size >= limites.janelaDeEntrega) break;
      const chave = hex(id);
      if (conexao.enviados.has(chave)) continue;
      conexao.enviados.add(chave);
      enviar(conexao, { tipo: 'pacote', id, pacote, marca });
    }
    if (!conexao.emDia && banco.contarPacotes(caixa.chave) <= conexao.enviados.size) {
      conexao.emDia = true;
      enviar(conexao, { tipo: 'em-dia' });
    }
  }

  function publicarCartao(
    conexao: Conexao,
    { numero, publicacao }: Extract<PedidoAoRelay, { tipo: 'publicar-cartao' }>,
  ): void {
    if (!conexao.baldes.publicarCartao()) {
      responder(conexao, numero, 'taxa-excedida');
      return;
    }
    const { cartao } = publicacao;
    if (!publicacaoAutentica(sodium, publicacao)) {
      responder(conexao, numero, 'assinatura-invalida');
      return;
    }
    const instante = agora();
    const retencao = RETENCAO_DO_CARTAO_EM_DIAS * DIA;
    if (
      cartao.data > instante + TOLERANCIA_DO_RELOGIO_EM_HORAS * HORA ||
      cartao.data <= instante - retencao
    ) {
      responder(conexao, numero, 'cartao-fora-do-prazo');
      return;
    }
    const resultado = banco.publicarCartao({
      id: idDoCartao(sodium, cartao),
      cartao: cartao.bytes,
      caixa: cartao.caixaPrincipal,
      data: cartao.data,
      // Conta da data mais tarde entre a do cartão e a do relay: depois de apagado por prazo, o
      // mesmo cartão já está velho demais para ser aceito de novo.
      expiraEm: horaCheia(Math.max(instante, cartao.data) + retencao),
      modo: publicacao.modo,
      prekeys: publicacao.prekeys,
      maximoDePrekeys: MAXIMO_DE_PREKEYS,
    });
    if (typeof resultado === 'string') {
      responder(conexao, numero, resultado);
      return;
    }
    enviar(conexao, { tipo: 'cartao-publicado', numero, prekeys: resultado.prekeysGuardadas });
    // Um aparelho por ID (RF-05): o aparelho anterior, se estiver com a caixa aberta, fica sabendo
    // agora e perde a conexão. A caixa dele já saiu do banco.
    const { caixaSubstituida } = resultado;
    const anterior = caixaSubstituida && caixasAbertas.get(hex(caixaSubstituida));
    if (anterior) {
      enviar(anterior, { tipo: 'caixa-substituida' });
      fecharConexao(anterior, FECHAMENTOS.caixaSubstituida);
    }
  }

  /**
   * Pânico: o dono apaga o cartão, as prekeys, a caixa principal e o que esperava nela. A
   * assinatura cobre o desafio desta conexão. Quem estiver com a caixa aberta perde a conexão; quem
   * depositar nela depois recebe `caixa-inexistente`, e quem buscar o cartão, `cartao-inexistente`.
   */
  function apagarTudo(
    conexao: Conexao,
    { numero, chave, assinatura }: Extract<PedidoAoRelay, { tipo: 'apagar-tudo' }>,
  ): void {
    if (!conexao.baldes.apagarTudo()) {
      responder(conexao, numero, 'taxa-excedida');
      return;
    }
    if (!apagarTudoAutentico(sodium, conexao.desafio, chave, assinatura)) {
      responder(conexao, numero, 'assinatura-invalida');
      fecharConexao(conexao, FECHAMENTOS.assinaturaInvalida);
      return;
    }
    const caixa = banco.apagarTudo(idDaChave(sodium, chave));
    if (!caixa) {
      responder(conexao, numero, 'cartao-inexistente');
      return;
    }
    responder(conexao, numero, 'ok');
    const aberta = caixasAbertas.get(hex(caixa));
    if (aberta) fecharConexao(aberta, FECHAMENTOS.caixaApagada);
  }

  function atender(conexao: Conexao, pedido: PedidoAoRelay): void {
    const { numero } = pedido;
    switch (pedido.tipo) {
      case 'publicar-cartao':
        publicarCartao(conexao, pedido);
        return;

      case 'buscar-cartao': {
        if (!conexao.baldes.buscarCartao()) {
          responder(conexao, numero, 'taxa-excedida');
          return;
        }
        const guardado = banco.buscarCartao(pedido.id);
        const cartao = guardado && lerCartao(guardado.cartao);
        if (!guardado || !cartao) {
          responder(conexao, numero, 'cartao-inexistente');
          return;
        }
        enviar(conexao, { tipo: 'cartao-encontrado', numero, cartao, prekey: guardado.prekey });
        return;
      }

      case 'criar-caixa':
        if (!conexao.baldes.criarCaixa()) {
          responder(conexao, numero, 'taxa-excedida');
          return;
        }
        banco.criarCaixa(pedido.caixa, horaCheia(agora() + RETENCAO_DA_CAIXA_EM_DIAS * DIA));
        responder(conexao, numero, 'ok');
        return;

      case 'depositar': {
        if (!conexao.baldes.depositar()) {
          responder(conexao, numero, 'taxa-excedida');
          return;
        }
        const resultado = banco.depositar({
          caixa: pedido.caixa,
          id: idDoPacote(sodium, pedido.pacote),
          pacote: pedido.pacote,
          marca: pedido.marca,
          expiraEm: horaCheia(agora() + RETENCAO_DO_PACOTE_EM_DIAS * DIA),
          maximoNaCaixa: limites.pacotesPorCaixa,
        });
        if (resultado === 'caixa-inexistente' || resultado === 'caixa-cheia') {
          responder(conexao, numero, resultado);
          return;
        }
        responder(conexao, numero, 'ok');
        const dono = caixasAbertas.get(hex(pedido.caixa));
        if (resultado === 'novo' && dono) preencher(dono);
        return;
      }

      case 'abrir-caixa': {
        if (conexao.caixa) {
          responder(conexao, numero, 'caixa-ja-aberta');
          return;
        }
        if (!aberturaAutentica(sodium, conexao.desafio, pedido.caixa, pedido.assinatura)) {
          responder(conexao, numero, 'assinatura-invalida');
          fecharConexao(conexao, FECHAMENTOS.assinaturaInvalida);
          return;
        }
        const prazo = horaCheia(agora() + RETENCAO_DA_CAIXA_EM_DIAS * DIA);
        if (!banco.renovarCaixa(pedido.caixa, prazo)) {
          responder(conexao, numero, 'caixa-inexistente');
          return;
        }
        const caixa = { chave: pedido.caixa, hex: hex(pedido.caixa) };
        const anterior = caixasAbertas.get(caixa.hex);
        if (anterior) fecharConexao(anterior, FECHAMENTOS.caixaEmOutraConexao);
        conexao.caixa = caixa;
        caixasAbertas.set(caixa.hex, conexao);
        responder(conexao, numero, 'ok');
        preencher(conexao);
        return;
      }

      case 'apagar-tudo':
        apagarTudo(conexao, pedido);
        return;

      case 'confirmar':
        if (!conexao.caixa) {
          responder(conexao, numero, 'caixa-fechada');
          return;
        }
        banco.confirmar(conexao.caixa.chave, pedido.ids);
        for (const id of pedido.ids) conexao.enviados.delete(hex(id));
        responder(conexao, numero, 'ok');
        preencher(conexao);
        return;
    }
  }

  function aoReceber(conexao: Conexao, dados: RawData, binaria: boolean): void {
    if (conexao.fechada) return;
    conexao.ultimaMensagem = agora();
    conexao.pingsSemResposta = 0;
    if (!conexao.baldes.mensagens()) {
      fecharConexao(conexao, FECHAMENTOS.taxaExcedida);
      return;
    }
    if (!binaria) {
      fecharConexao(conexao, SO_BINARIO);
      return;
    }
    const leitura = lerPedido(comoBytes(dados));
    if (!leitura.ok) {
      if (leitura.numero !== null) responder(conexao, leitura.numero, 'formato-invalido');
      fecharConexao(conexao, FECHAMENTOS.formatoInvalido);
      return;
    }
    try {
      atender(conexao, leitura.pedido);
    } catch {
      // Um erro do banco (o disco cheio, por exemplo) fica nesta conexão: o pedido não foi
      // atendido, e quem pediu tenta de novo numa conexão nova. As outras continuam.
      fecharConexao(conexao, FECHAMENTOS.erroInterno);
    }
  }

  function aoConectar(ws: WebSocket): void {
    const instante = agora();
    const balde = (taxa: Taxa) => criarBalde(taxa, agora);
    const conexao: Conexao = {
      ws,
      desafio: sodium.randombytes_buf(32),
      baldes: {
        depositar: balde(limites.taxas.depositar),
        buscarCartao: balde(limites.taxas.buscarCartao),
        publicarCartao: balde(limites.taxas.publicarCartao),
        criarCaixa: balde(limites.taxas.criarCaixa),
        apagarTudo: balde(limites.taxas.apagarTudo),
        mensagens: balde(limites.taxas.mensagens),
      },
      caixa: null,
      enviados: new Set(),
      emDia: false,
      pingsSemResposta: 0,
      ultimaMensagem: instante,
      fechada: false,
    };
    conexoes.add(conexao);
    // Sem ouvinte, um erro do WebSocket (mensagem grande demais, quadro inválido) derrubaria o
    // processo. O próprio ws fecha a conexão com o código certo.
    ws.on('error', () => undefined);
    ws.on('close', () => {
      esquecer(conexao);
    });
    ws.on('pong', () => {
      conexao.pingsSemResposta = 0;
    });
    ws.on('message', (dados, binaria) => {
      aoReceber(conexao, dados, binaria);
    });
    enviar(conexao, { tipo: 'ola', versao: VERSAO_DO_PROTOCOLO, desafio: conexao.desafio });
  }

  return {
    servidor,

    limpar() {
      const instante = agora();
      // Caixa aberta agora não vence: o prazo conta da última abertura.
      const prazo = horaCheia(instante + RETENCAO_DA_CAIXA_EM_DIAS * DIA);
      try {
        for (const conexao of caixasAbertas.values()) {
          if (conexao.caixa) banco.renovarCaixa(conexao.caixa.chave, prazo);
        }
        banco.apagarVencidos(instante);
        for (const conexao of caixasAbertas.values()) preencher(conexao);
      } catch {
        // Um erro do banco não derruba o relay: a próxima limpeza tenta de novo.
      }
    },

    vigiar() {
      const instante = agora();
      for (const conexao of [...conexoes]) {
        if (conexao.pingsSemResposta >= PINGS_SEM_RESPOSTA) {
          esquecer(conexao);
          conexao.ws.terminate();
        } else if (!conexao.caixa && instante - conexao.ultimaMensagem >= limites.ociosidade) {
          fecharConexao(conexao, FECHAMENTOS.ociosa);
        } else {
          conexao.pingsSemResposta++;
          conexao.ws.ping();
        }
      }
    },

    async fechar() {
      for (const conexao of [...conexoes]) {
        esquecer(conexao);
        conexao.ws.terminate();
      }
      wss.close();
      servidor.closeAllConnections();
      await new Promise<void>((pronto) => {
        servidor.close(() => {
          pronto();
        });
      });
    },
  };
}
