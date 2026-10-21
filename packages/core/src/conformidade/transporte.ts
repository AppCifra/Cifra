// Conformidade da porta Transporte, contra um relay de verdade: o canal leva mensagens binárias
// inteiras nos dois sentidos, duas conexões em circuitos diferentes funcionam ao mesmo tempo, o
// fechamento, pelo relay ou pelo app, é avisado, e nada sai depois de fechado. Usa o protocolo cru,
// sem o cliente do núcleo, para que um erro do cliente não esconda um erro do adaptador.
//
// O HTTP dos anexos: um blob sobe, desce inteiro e é apagado, e a resposta maior que o limite
// pedido é recusada (o app também não confia no relay).
import {
  BYTES_DO_TOKEN,
  codificarPedido,
  enderecoDoAnexo,
  iguais,
  lerMensagemDoRelay,
  mensagemDaAbertura,
  TAMANHO_DO_PACOTE,
  BYTES_DA_MARCA,
  TAMANHO_MINIMO_DO_ANEXO,
  VERSAO_DO_PROTOCOLO,
  type MensagemDoRelay,
  type PedidoAoRelay,
} from '@cifra/protocol';
import type { Cripto } from '../portas/cripto.ts';
import type { Relogio } from '../portas/relogio.ts';
import type { Conexao, Transporte } from '../portas/transporte.ts';
import { rodar, type ResultadoDaVerificacao } from './resultado.ts';

/** Pelo Tor, conectar e cada ida e volta podem levar dezenas de segundos. */
const PRAZO = 60_000;

/** O circuito dos pedidos HTTP da conformidade. */
const CIRCUITO_HTTP = 'conformidade-c';

/** A resposta a um PUT ou DELETE não tem corpo. */
const LIMITE_SEM_CORPO = 1024;

/** Uma conexão crua: guarda o que chega, na ordem, e se o relay fechou. */
class Canal {
  readonly conexao: Conexao;
  readonly #relogio: Relogio;
  readonly #chegadas: (MensagemDoRelay | null)[] = [];
  #avisar: (() => void) | null = null;
  fechou = false;

  constructor(conexao: Conexao, relogio: Relogio) {
    this.conexao = conexao;
    this.#relogio = relogio;
    conexao.aoReceber((dados) => {
      this.#chegadas.push(lerMensagemDoRelay(dados));
      this.#avisar?.();
    });
    conexao.aoFechar(() => {
      this.fechou = true;
      this.#avisar?.();
    });
  }

  /** Espera até `condicao` valer ou o prazo acabar. Diz se valeu. */
  async esperar(condicao: () => boolean): Promise<boolean> {
    let esgotou = false;
    const esgotado = () => esgotou;
    const cancelar = this.#relogio.agendar(PRAZO, () => {
      esgotou = true;
      this.#avisar?.();
    });
    try {
      while (!condicao() && !esgotado()) {
        await new Promise<void>((pronto) => {
          this.#avisar = pronto;
        });
      }
      return condicao();
    } finally {
      this.#avisar = null;
      cancelar();
    }
  }

  /** A próxima mensagem do relay; `null` se ela não seguir o formato. */
  async proxima(): Promise<MensagemDoRelay | null> {
    if (!(await this.esperar(() => this.#chegadas.length > 0))) {
      throw new Error('o relay não respondeu no prazo');
    }
    return this.#chegadas.shift() ?? null;
  }

  async pedir(pedido: PedidoAoRelay): Promise<MensagemDoRelay | null> {
    await this.conexao.enviar(codificarPedido(pedido));
    return this.proxima();
  }
}

function ok(mensagem: MensagemDoRelay | null, numero: number): boolean {
  return mensagem?.tipo === 'resposta' && mensagem.numero === numero && mensagem.codigo === 'ok';
}

/**
 * Roda as verificações contra o relay em `endereco`. Cria uma caixa descartável com uma chave
 * sorteada; ela some do relay pelo prazo, como qualquer caixa sem uso. O anexo de teste, de bytes
 * aleatórios, é apagado no fim.
 */
export async function verificarTransporte(
  transporte: Transporte,
  endereco: string,
  cripto: Cripto,
  relogio: Relogio,
): Promise<ResultadoDaVerificacao[]> {
  let dono: Canal | undefined;
  let remetente: Canal | undefined;
  /** O desafio do `ola` da conexão do dono: só ele abre a caixa nessa conexão. */
  let desafio: Uint8Array | undefined;
  /** O anexo de teste: o blob é aleatório, do menor tamanho que o relay aceita. */
  const anexo = enderecoDoAnexo(endereco, cripto.randombytes_buf(BYTES_DO_TOKEN));
  const blob = cripto.randombytes_buf(TAMANHO_MINIMO_DO_ANEXO);
  const baixar = (limite: number) =>
    transporte.pedirHttp({ metodo: 'GET', endereco: anexo, circuito: CIRCUITO_HTTP, limite });
  const apagar = () =>
    transporte.pedirHttp({
      metodo: 'DELETE',
      endereco: anexo,
      circuito: CIRCUITO_HTTP,
      limite: LIMITE_SEM_CORPO,
    });
  /** Se o anexo de teste subiu e ainda não foi apagado. */
  const teste = { noRelay: false };

  const conectar = async (circuito: string): Promise<Canal> =>
    new Canal(await transporte.conectar(endereco, circuito), relogio);
  const exigir = <T>(valor: T | undefined): T => {
    if (valor === undefined) throw new Error('sem conexão');
    return valor;
  };

  try {
    return await rodar({
      'transporte.conecta-e-recebe-o-ola': async () => {
        dono = await conectar('conformidade-a');
        const ola = await dono.proxima();
        if (ola?.tipo !== 'ola') return false;
        desafio = ola.desafio;
        return ola.versao === VERSAO_DO_PROTOCOLO;
      },

      'transporte.duas-conexoes-em-circuitos-diferentes': async () => {
        remetente = await conectar('conformidade-b');
        const ola = await remetente.proxima();
        return ola?.tipo === 'ola' && !exigir(dono).fechou && !remetente.fechou;
      },

      'transporte.pacote-de-4096-bytes-chega-inteiro': async () => {
        const a = exigir(dono);
        const b = exigir(remetente);
        const caixa = cripto.crypto_sign_seed_keypair(cripto.randombytes_buf(32));
        const pacote = cripto.randombytes_buf(TAMANHO_DO_PACOTE);
        const marca = cripto.randombytes_buf(BYTES_DA_MARCA);
        const assinatura = cripto.crypto_sign_detached(
          mensagemDaAbertura(exigir(desafio), caixa.publicKey),
          caixa.privateKey,
        );
        const criada = await a.pedir({ tipo: 'criar-caixa', numero: 1, caixa: caixa.publicKey });
        const depositado = await b.pedir({
          tipo: 'depositar',
          numero: 1,
          caixa: caixa.publicKey,
          pacote,
          marca,
        });
        const aberta = await a.pedir({
          tipo: 'abrir-caixa',
          numero: 2,
          caixa: caixa.publicKey,
          assinatura,
        });
        // Depois da abertura, o relay entrega o pacote e avisa que a caixa está em dia.
        const entregue = await a.proxima();
        const emDia = await a.proxima();
        if (entregue?.tipo !== 'pacote') return false;
        const confirmado = await a.pedir({ tipo: 'confirmar', numero: 3, ids: [entregue.id] });
        return (
          ok(criada, 1) &&
          ok(depositado, 1) &&
          ok(aberta, 2) &&
          iguais(entregue.pacote, pacote) &&
          iguais(entregue.marca, marca) &&
          emDia?.tipo === 'em-dia' &&
          ok(confirmado, 3)
        );
      },

      'transporte.avisa-quando-o-relay-fecha': async () => {
        const b = exigir(remetente);
        // Tipo de pedido que não existe: o relay responde formato-invalido e fecha a conexão.
        await b.conexao.enviar(new Uint8Array([0x7f, 0, 0, 0, 9]));
        return b.esperar(() => b.fechou);
      },

      'transporte.nao-envia-depois-de-fechar': async () => {
        try {
          await exigir(remetente).conexao.enviar(new Uint8Array([0x02]));
          return false;
        } catch {
          return true;
        }
      },

      'transporte.avisa-quando-o-app-fecha': async () => {
        const a = exigir(dono);
        await a.conexao.fechar();
        return a.esperar(() => a.fechou);
      },

      'transporte.http-sobe-um-anexo': async () => {
        const { status } = await transporte.pedirHttp({
          metodo: 'PUT',
          endereco: anexo,
          circuito: CIRCUITO_HTTP,
          corpo: blob,
          limite: LIMITE_SEM_CORPO,
        });
        teste.noRelay = status === 201;
        return teste.noRelay;
      },

      'transporte.http-baixa-o-anexo-inteiro': async () => {
        const { status, corpo } = await baixar(TAMANHO_MINIMO_DO_ANEXO);
        return status === 200 && iguais(corpo, blob);
      },

      'transporte.http-recusa-resposta-maior-que-o-limite': async () => {
        try {
          await baixar(TAMANHO_MINIMO_DO_ANEXO - 1);
          return false;
        } catch {
          return true;
        }
      },

      'transporte.http-apaga-o-anexo': async () => {
        const apagado = await apagar();
        if (apagado.status === 204) teste.noRelay = false;
        const depois = await baixar(TAMANHO_MINIMO_DO_ANEXO);
        return apagado.status === 204 && depois.status === 404;
      },
    });
  } finally {
    await dono?.conexao.fechar().catch(() => undefined);
    await remetente?.conexao.fechar().catch(() => undefined);
    if (teste.noRelay) await apagar().catch(() => undefined);
  }
}
