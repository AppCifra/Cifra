// Anexos no relay (SPEC, "Especificação do relay"): PUT, GET e DELETE em /anexos/<token>, no mesmo
// servidor HTTP do WebSocket. O relay não sabe de quem é nem para quem vai: só guarda um blob
// cifrado, de um tamanho de faixa, até alguém que conhece o token baixar e apagar, ou até vencer
// (RF-35, RNF-14). Nada aqui lê o endereço de quem conecta nem escreve log (RNF-05).
//
// - PUT: o corpo precisa de Content-Length com um tamanho de faixa válido. O blob sobe em pedaços
//   de 64 KiB, gravados à medida que chegam; até o último byte, o anexo fica incompleto e ninguém
//   baixa. Corpo cortado não fica. Token que já existe responde 409, depois de ler o corpo: é o
//   reenvio de quem não viu a resposta do primeiro.
// - GET: devolve o blob, um pedaço de cada vez, sem ler o anexo inteiro para a memória.
// - DELETE: apaga. Quem recebe apaga depois de baixar e conferir o hash.
//
// Limites (RNF-13): transferências e envios ao mesmo tempo, espaço total e transferência parada.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BYTES_DO_PEDACO, lerCaminhoDoAnexo, tamanhoDeAnexoValido } from '@cifra/protocol';
import type { Banco } from './banco.ts';
import type { SodiumDoRelay } from './sodium.ts';

export interface LimitesDosAnexos {
  /** Envios (PUT) ao mesmo tempo. */
  readonly subindo: number;
  /** Pedidos de anexo ao mesmo tempo, de qualquer tipo. */
  readonly transferencias: number;
  /** Bytes que todos os anexos guardados podem somar. */
  readonly espaco: number;
  /** Milissegundos sem receber nem mandar nada até a transferência cair. */
  readonly parada: number;
}

export interface OpcoesDosAnexos {
  readonly banco: Banco;
  readonly sodium: SodiumDoRelay;
  readonly limites: LimitesDosAnexos;
  /** Quando vence um anexo que começa a subir agora, na hora cheia. */
  readonly prazo: () => number;
}

export type AtendenteDeAnexos = (pedido: IncomingMessage, resposta: ServerResponse) => void;

/** Pedaços gravados numa transação: até 1 MiB de cada envio fica na memória. */
const PEDACOS_POR_GRAVACAO = 16;

function responder(resposta: ServerResponse, status: number, fechar = false): void {
  if (resposta.headersSent) {
    resposta.destroy();
    return;
  }
  resposta.writeHead(status, { 'Content-Length': 0, ...(fechar ? { Connection: 'close' } : {}) });
  resposta.end();
}

export function criarAnexos(o: OpcoesDosAnexos): AtendenteDeAnexos {
  let transferencias = 0;
  let subindo = 0;
  /** O ID guardado é o BLAKE2b do token: o banco do relay não tem o que baixaria o anexo. */
  const idDe = (token: Uint8Array) => o.sodium.crypto_generichash(32, token, null);

  function subir(id: Uint8Array, pedido: IncomingMessage, resposta: ServerResponse): void {
    const cabecalho = pedido.headers['content-length'];
    const tamanho = Number(cabecalho);
    if (pedido.headers['transfer-encoding'] !== undefined || cabecalho === undefined) {
      responder(resposta, 411, true);
      return;
    }
    if (!tamanhoDeAnexoValido(tamanho)) {
      responder(resposta, 413, true);
      return;
    }
    const inicio = o.banco.comecarAnexo(id, tamanho, o.prazo(), o.limites.espaco);
    if (inicio === 'sem-espaco') {
      responder(resposta, 507, true);
      return;
    }
    if (inicio === 'existe') {
      pedido.resume();
      pedido.on('end', () => {
        responder(resposta, 409);
      });
      return;
    }

    let recebidos = 0;
    let indice = 0;
    let atual = new Uint8Array(BYTES_DO_PEDACO);
    let usados = 0;
    let prontos: Uint8Array[] = [];
    let encerrado = false;
    const desistir = () => {
      if (encerrado) return;
      encerrado = true;
      o.banco.apagarAnexo(id);
      pedido.destroy();
    };
    const gravar = () => {
      o.banco.guardarPedacos(id, indice, prontos);
      indice += prontos.length;
      prontos = [];
    };

    pedido.on('data', (dados: Uint8Array) => {
      if (encerrado) return;
      recebidos += dados.length;
      if (recebidos > tamanho) {
        desistir();
        return;
      }
      for (let posicao = 0; posicao < dados.length;) {
        const parte = Math.min(BYTES_DO_PEDACO - usados, dados.length - posicao);
        atual.set(dados.subarray(posicao, posicao + parte), usados);
        usados += parte;
        posicao += parte;
        if (usados === BYTES_DO_PEDACO) {
          prontos.push(atual);
          atual = new Uint8Array(BYTES_DO_PEDACO);
          usados = 0;
        }
      }
      try {
        if (prontos.length >= PEDACOS_POR_GRAVACAO) gravar();
      } catch {
        // O anexo foi apagado no meio do envio, ou o banco falhou.
        desistir();
      }
    });
    pedido.on('end', () => {
      if (encerrado) return;
      if (recebidos !== tamanho) {
        desistir();
        return;
      }
      try {
        if (usados > 0) prontos.push(atual.slice(0, usados));
        if (prontos.length > 0) gravar();
        o.banco.concluirAnexo(id);
      } catch {
        desistir();
        return;
      }
      encerrado = true;
      responder(resposta, 201);
    });
    // Conexão que cai no meio: o que subiu até ali não fica.
    pedido.on('close', desistir);
  }

  function baixar(id: Uint8Array, resposta: ServerResponse): void {
    const anexo = o.banco.anexo(id);
    if (!anexo) {
      responder(resposta, 404);
      return;
    }
    resposta.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': anexo.tamanho,
    });
    let indice = 0;
    const escrever = () => {
      while (indice < anexo.pedacos) {
        const dados = o.banco.pedaco(id, indice++);
        // Apagado no meio do download: a resposta cai sem completar.
        if (!dados) {
          resposta.destroy();
          return;
        }
        if (!resposta.write(dados)) {
          resposta.once('drain', escrever);
          return;
        }
      }
      resposta.end();
    };
    escrever();
  }

  return (pedido, resposta) => {
    resposta.sendDate = false;
    const token = lerCaminhoDoAnexo(pedido.url ?? '');
    const metodo = pedido.method;
    const fora = !token
      ? 404
      : metodo !== 'GET' && metodo !== 'PUT' && metodo !== 'DELETE'
        ? 405
        : transferencias >= o.limites.transferencias ||
            (metodo === 'PUT' && subindo >= o.limites.subindo)
          ? 503
          : null;
    if (fora !== null || !token) {
      responder(resposta, fora ?? 404, true);
      return;
    }
    transferencias++;
    if (metodo === 'PUT') subindo++;
    let terminou = false;
    resposta.on('close', () => {
      if (terminou) return;
      terminou = true;
      transferencias--;
      if (metodo === 'PUT') subindo--;
    });
    // Sem receber nem mandar nada por este tempo, a transferência cai.
    pedido.setTimeout(o.limites.parada, () => {
      pedido.destroy();
    });
    const id = idDe(token);
    if (metodo === 'PUT') {
      subir(id, pedido, resposta);
    } else if (metodo === 'GET') {
      pedido.resume();
      baixar(id, resposta);
    } else {
      pedido.resume();
      responder(resposta, o.banco.apagarAnexo(id) ? 204 : 404);
    }
  };
}
