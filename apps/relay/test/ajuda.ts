// Relay de teste: servidor numa porta livre, banco num arquivo temporário e relógio que o teste
// controla. Os clientes são os da sonda, que também mandam bytes crus.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  criarCartao,
  criarPublicacao,
  idDaChave,
  mensagemDaAbertura,
  BYTES_DA_MARCA,
  TAMANHO_DO_PACOTE,
  type Assinar,
  type ModoDaPublicacao,
  type Publicacao,
} from '@cifra/protocol';
import { ClienteDoRelay, type OpcoesDoCliente, type Resposta } from '../scripts/cliente.ts';
import { abrirBanco, type Banco } from '../src/banco.ts';
import { criarRelay, type LimitesDoRelay, type Relay } from '../src/relay.ts';
import { libsodium } from '../src/sodium.ts';
import sodium from 'libsodium-wrappers-sumo';

await sodium.ready;

export { sodium };

export const HORA = 3_600_000;
export const DIA = 24 * HORA;

/** 1º de outubro de 2026, 10:17:23.456: fora da hora cheia, de propósito. */
export const INICIO = Date.UTC(2026, 9, 1, 10, 17, 23, 456);

export const ONION = 'ws://' + 'a'.repeat(56) + '.onion';

const LIVRE = { rajada: 10_000, porMinuto: 10_000 };

/** Para os testes que não são de taxa: nenhum pedido esbarra no limite. */
export const TAXAS_LIVRES: Partial<LimitesDoRelay> = {
  taxas: {
    depositar: LIVRE,
    buscarCartao: LIVRE,
    publicarCartao: LIVRE,
    criarCaixa: LIVRE,
    apagarTudo: LIVRE,
    mensagens: LIVRE,
  },
  taxasDoRelay: { prekeysPorId: LIVRE, depositosPorCaixa: LIVRE },
};

export interface Relogio {
  agora: number;
  avancar(ms: number): void;
}

export interface RelayDeTeste {
  readonly endereco: string;
  readonly relay: Relay;
  /** Caminho do arquivo do banco, para ler os bytes como faria a perícia. */
  readonly caminho: string;
  readonly relogio: Relogio;
  conectar(opcoes?: OpcoesDoCliente): Promise<ClienteDoRelay>;
  /** Consulta o banco por fora, numa conexão só de leitura. */
  consultar(sql: string, ...parametros: (number | Uint8Array)[]): Record<string, unknown>[];
  /** Os bytes do arquivo do banco. */
  bytesDoBanco(): Buffer;
  fechar(): Promise<void>;
}

/**
 * O banco que lança, como com o disco cheio, no método que `qual` disser enquanto disser; os outros
 * funcionam.
 */
export function falhando(banco: Banco, qual: () => keyof Banco | null): Banco {
  return new Proxy(banco, {
    get(alvo, nome: keyof Banco, receptor) {
      const valor: unknown = Reflect.get(alvo, nome, receptor);
      if (typeof valor !== 'function') return valor;
      return (...argumentos: unknown[]) => {
        if (qual() === nome) throw new Error('database or disk is full');
        return Reflect.apply(valor, alvo, argumentos) as unknown;
      };
    },
  });
}

/** `embrulhar` passa o banco do relay por outro, como `falhando`. */
export async function subirRelay(
  limites: Partial<LimitesDoRelay> = {},
  embrulhar: (banco: Banco) => Banco = (banco) => banco,
): Promise<RelayDeTeste> {
  const pasta = mkdtempSync(join(tmpdir(), 'cifra-relay-'));
  const caminho = join(pasta, 'relay.sqlite');
  const banco = abrirBanco(caminho);
  const relogio: Relogio = {
    agora: INICIO,
    avancar(ms) {
      relogio.agora += ms;
    },
  };
  const relay = criarRelay({
    banco: embrulhar(banco),
    sodium: libsodium,
    agora: () => relogio.agora,
    limites,
  });
  await new Promise<void>((pronto) => relay.servidor.listen(0, '127.0.0.1', pronto));
  const { port } = relay.servidor.address() as AddressInfo;
  const endereco = `ws://127.0.0.1:${String(port)}`;
  const clientes: ClienteDoRelay[] = [];

  return {
    endereco,
    relay,
    caminho,
    relogio,
    async conectar(opcoes) {
      const cliente = await ClienteDoRelay.conectar(endereco, opcoes);
      clientes.push(cliente);
      return cliente;
    },
    consultar(sql, ...parametros) {
      const leitura = new DatabaseSync(caminho, { readOnly: true });
      try {
        return leitura.prepare(sql).all(...parametros);
      } finally {
        leitura.close();
      }
    },
    bytesDoBanco() {
      return readFileSync(caminho);
    },
    async fechar() {
      await relay.fechar();
      await Promise.all(clientes.map((cliente) => cliente.fechamento));
      banco.fechar();
      rmSync(pasta, { recursive: true, force: true });
    },
  };
}

export interface ParDeTeste {
  readonly publicKey: Uint8Array;
  readonly privateKey: Uint8Array;
  readonly assinar: Assinar;
}

export function novoPar(): ParDeTeste {
  const { publicKey, privateKey } = sodium.crypto_sign_keypair();
  return {
    publicKey,
    privateKey,
    assinar: (mensagem) => sodium.crypto_sign_detached(mensagem, privateKey),
  };
}

export interface IdentidadeDeTeste extends ParDeTeste {
  /** O ID em bytes. */
  readonly id: Uint8Array;
  /** A caixa principal do aparelho: vai em toda publicação, se o teste não disser outra. */
  readonly caixa: ParDeTeste;
}

export function novaIdentidade(): IdentidadeDeTeste {
  const par = novoPar();
  return { ...par, id: idDaChave(sodium, par.publicKey), caixa: novoPar() };
}

export interface OpcoesDaPublicacao {
  readonly caixa?: Uint8Array;
  readonly data?: number;
  readonly prekeys?: readonly number[];
  readonly modo?: ModoDaPublicacao;
  /** Quem assina: por padrão, a própria identidade. */
  readonly assinante?: ParDeTeste;
}

export function publicacaoDe(
  identidade: IdentidadeDeTeste,
  opcoes: OpcoesDaPublicacao = {},
): Publicacao {
  const assinar = (opcoes.assinante ?? identidade).assinar;
  const cartao = criarCartao(
    {
      chaveDeIdentidade: identidade.publicKey,
      prekeyAssinada: { numero: 1, chave: sodium.randombytes_buf(32) },
      caixaPrincipal: opcoes.caixa ?? identidade.caixa.publicKey,
      data: opcoes.data ?? INICIO,
      relays: [ONION],
    },
    assinar,
  );
  const prekeys = (opcoes.prekeys ?? []).map((numero) => ({
    numero,
    chave: sodium.randombytes_buf(32),
  }));
  return criarPublicacao(opcoes.modo ?? 'acrescentar', cartao, prekeys, assinar);
}

/** O que o dono de `caixa` assina para abri-la na conexão de `cliente`. */
export function mensagemDaAberturaDe(cliente: ClienteDoRelay, caixa: ParDeTeste): Uint8Array {
  return mensagemDaAbertura(cliente.desafio, caixa.publicKey);
}

/** Abre `caixa` assinando o desafio desta conexão. */
export function abrir(cliente: ClienteDoRelay, caixa: ParDeTeste): Promise<Resposta> {
  const assinatura = caixa.assinar(mensagemDaAberturaDe(cliente, caixa));
  return cliente.pedir({ tipo: 'abrir-caixa', caixa: caixa.publicKey, assinatura });
}

export function pacoteAleatorio(): Uint8Array {
  return sodium.randombytes_buf(TAMANHO_DO_PACOTE);
}

/** Uma marca de aviso qualquer: o relay guarda e repassa sem abrir. */
export function marcaDeTeste(): Uint8Array {
  return sodium.randombytes_buf(BYTES_DA_MARCA);
}

/** O código de uma resposta simples, ou o tipo da mensagem quando não é uma. */
export function codigo(resposta: Resposta): string {
  return resposta.tipo === 'resposta' ? resposta.codigo : resposta.tipo;
}

/** Diz se `agulha` aparece dentro de `palheiro`. */
export function contem(palheiro: Uint8Array, agulha: Uint8Array): boolean {
  return Buffer.from(palheiro).indexOf(Buffer.from(agulha)) !== -1;
}
