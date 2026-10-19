// O correio contra o relay de verdade (apps/relay), no mesmo processo: o cenário dos testes do
// correio e dos contatos. O cartão leva um endereço .onion, e o transporte do teste leva toda
// conexão ao relay local, como o Tor levaria ao onion service. Quem importa ganha um relay novo e
// um relógio novo a cada teste.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { formatarId, idDaChave, lerPedido, type PedidoAoRelay } from '@cifra/protocol';
import { afterEach, beforeEach, vi } from 'vitest';
import type { LimitesDoRelay } from '../../../apps/relay/src/relay.ts';
import {
  Agenda,
  Cofre,
  Correio,
  criarExclusivo,
  gerarIdentidade,
  migrar,
  prepararBanco,
  prepararCofre,
  Temporarias,
  type Armazenamento,
  type EventoDoCorreio,
  type Exclusivo,
  type Identidade,
} from '../src/index.ts';
import { RelogioDeTeste } from './adaptadores/relogio.ts';
import { cripto } from './adaptadores/sodium-node.ts';
import {
  abrirBancoDeTeste,
  abrirBancoNoArquivo,
  pastaTemporaria,
  type BancoDeTeste,
  type BancoNoArquivo,
} from './adaptadores/sqlite-node.ts';
import { transporteNode, type TransporteDeTeste } from './adaptadores/transporte-node.ts';
import { RelayDeTeste, TAXAS_LIVRES } from './relay.ts';

// Com todos os arquivos de teste rodando juntos, uma conversa com o relay de verdade pode passar dos
// 5 s do padrão sem nada errado: as esperas daqui (`ate`) já vão até 10 s.
vi.setConfig({ testTimeout: 30_000 });

export const RELAY = 'ws://' + 'r'.repeat(56) + '.onion';
export const HORA = 3_600_000;
export const DIA = 24 * HORA;

/**
 * Uma pessoa com um aparelho: banco, correio, agenda e a limpeza das temporárias, que dividem o
 * acesso ao banco. A limpeza só roda depois de `temporarias.iniciar()`, como o app faz ao abrir.
 */
export interface Pessoa {
  readonly identidade: Identidade;
  readonly id: string;
  readonly banco: BancoDeTeste;
  readonly transporte: TransporteDeTeste;
  readonly correio: Correio;
  readonly agenda: Agenda;
  readonly temporarias: Temporarias;
  readonly eventos: EventoDoCorreio[];
  readonly caixa: Uint8Array;
  /** A semente da caixa principal, que o vigia do app bloqueado usa (RF-42). */
  readonly sementeDaCaixa: Uint8Array;
  /** O acesso ao banco principal, dividido entre correio, agenda e limpeza. */
  readonly exclusivo: Exclusivo;
}

// Trocados a cada teste; quem importa vê sempre os atuais.
export let relogio: RelogioDeTeste;
export let relay: RelayDeTeste;
const pessoas: Pessoa[] = [];
/** Todos os transportes do teste: o relógio só anda com todos parados. */
const transportes: TransporteDeTeste[] = [];

export function transporte(): TransporteDeTeste {
  const novo = transporteNode(() => relay.endereco);
  transportes.push(novo);
  return novo;
}

export async function subir(limites: Partial<LimitesDoRelay> = TAXAS_LIVRES): Promise<void> {
  relogio = new RelogioDeTeste();
  relay = await RelayDeTeste.subir(relogio, limites);
}

beforeEach(async () => {
  await subir();
});

afterEach(async () => {
  for (const { ocultas, pasta } of todasAsOcultas.splice(0)) {
    await ocultas.fechar();
    rmSync(pasta, { recursive: true, force: true });
  }
  for (const pessoa of pessoas.splice(0)) {
    await pessoa.temporarias.parar();
    await pessoa.correio.parar();
    pessoa.banco.fechar();
  }
  transportes.length = 0;
  await relay.fechar();
});

export interface OpcoesDaPessoa {
  /**
   * O banco como o app prepara, com o `auto_vacuum` incremental: o arquivo encolhe quando os
   * anexos saem. Custa um VACUUM a mais; só os testes que medem o arquivo pedem.
   */
  readonly encolhe?: boolean;
}

/** Uma pessoa nova; com `identidade`, a mesma identidade restaurada noutro aparelho. */
export async function pessoa(
  identidade: Identidade = gerarIdentidade(cripto, 'portugues').identidade,
  opcoes: OpcoesDaPessoa = {},
): Promise<Pessoa> {
  const banco = abrirBancoDeTeste();
  await (opcoes.encolhe ? prepararBanco(banco.banco) : migrar(banco.banco));
  const seu = transporte();
  const semente = cripto.randombytes_buf(32);
  const exclusivo = criarExclusivo();
  const correio = new Correio({
    cripto,
    banco: banco.banco,
    transporte: seu,
    relogio,
    identidade,
    sementeDaCaixa: semente,
    relay: RELAY,
    exclusivo,
  });
  const agenda = new Agenda({ cripto, banco: banco.banco, relogio, identidade, exclusivo });
  const temporarias = new Temporarias({ banco: banco.banco, relogio, exclusivo });
  const eventos: EventoDoCorreio[] = [];
  correio.aoMudar((evento) => eventos.push(evento));
  const nova = {
    identidade,
    id: formatarId(idDaChave(cripto, identidade.assinatura.publicKey)),
    banco,
    transporte: seu,
    correio,
    agenda,
    temporarias,
    eventos,
    caixa: cripto.crypto_sign_seed_keypair(semente).publicKey,
    sementeDaCaixa: semente,
    exclusivo,
  };
  pessoas.push(nova);
  return nova;
}

/** O bloco do cofre nos testes: pequeno, para o arquivo crescer rápido. */
export const BLOCO_DE_TESTE = 64 * 1024;

/**
 * O cofre das conversas ocultas de uma pessoa, num arquivo sem cifra: abre e fecha como o app, com
 * o correio do cofre no mesmo transporte da pessoa (os circuitos têm prefixo próprio).
 */
export interface OcultasDeTeste {
  readonly caminho: string;
  /** O cofre aberto agora, ou `null`. */
  readonly aberto: Cofre | null;
  /** O que o correio do cofre avisou, desde a abertura. */
  readonly eventos: EventoDoCorreio[];
  /** Abre o cofre (prepara, resolve a mudança que ficou no meio e liga o correio). */
  abrir(): Promise<Cofre>;
  /** Fecha o cofre: o correio para, e as mensagens das ocultas esperam no relay. */
  fechar(): Promise<void>;
}

const todasAsOcultas: { readonly ocultas: OcultasDeTeste; readonly pasta: string }[] = [];

/**
 * O banco sem espaço para crescer enquanto `cheio` valer: completar o bloco do cofre falha, como
 * com o disco cheio.
 */
export function semEspacoParaOBloco(
  banco: Armazenamento,
  cheio: () => boolean = () => true,
): Armazenamento {
  return {
    executar(sql, parametros) {
      if (cheio() && sql.startsWith('INSERT INTO reserva')) {
        return Promise.reject(new Error('database or disk is full'));
      }
      return banco.executar(sql, parametros);
    },
    consultar: (sql, parametros) => banco.consultar(sql, parametros),
    transacao: (operacao) => banco.transacao((t) => operacao(semEspacoParaOBloco(t, cheio))),
  };
}

/** `embrulhar` passa o banco do cofre por outro, como `semEspacoParaOBloco`. */
export function ocultasDe(
  p: Pessoa,
  bloco = BLOCO_DE_TESTE,
  embrulhar: (banco: Armazenamento) => Armazenamento = (banco) => banco,
): OcultasDeTeste {
  const pasta = pastaTemporaria();
  const caminho = join(pasta, 'cofre.sqlite');
  let arquivo: BancoNoArquivo | null = null;
  let aberto: Cofre | null = null;
  const eventos: EventoDoCorreio[] = [];
  const ocultas: OcultasDeTeste = {
    caminho,
    get aberto() {
      return aberto;
    },
    eventos,
    async abrir() {
      if (aberto) return aberto;
      arquivo = abrirBancoNoArquivo(caminho, 'TRUNCATE');
      await prepararCofre(arquivo.banco);
      const cofre = new Cofre({
        cripto,
        relogio,
        identidade: p.identidade,
        banco: embrulhar(arquivo.banco),
        bloco,
        transporte: p.transporte,
        relay: RELAY,
        principal: { banco: p.banco.banco, exclusivo: p.exclusivo, correio: p.correio },
      });
      eventos.length = 0;
      cofre.correio?.aoMudar((evento) => eventos.push(evento));
      await cofre.iniciar();
      aberto = cofre;
      return cofre;
    },
    async fechar() {
      await aberto?.fechar();
      aberto = null;
      arquivo?.fechar();
      arquivo = null;
    },
  };
  todasAsOcultas.push({ ocultas, pasta });
  return ocultas;
}

/** Espera, em tempo de verdade, até a condição valer. O relógio do teste não anda sozinho. */
export async function ate(condicao: () => boolean | Promise<boolean>, oQue: string): Promise<void> {
  const limite = Date.now() + 10_000;
  while (!(await condicao())) {
    if (Date.now() > limite) throw new Error(`não aconteceu: ${oQue}`);
    await new Promise((pronto) => setTimeout(pronto, 5));
  }
}

export const caixaAberta = (p: Pessoa) => p.eventos.some((e) => e.tipo === 'caixa' && e.aberta);

export async function online(...lista: Pessoa[]): Promise<void> {
  for (const p of lista) {
    p.eventos.length = 0;
    p.correio.iniciar();
  }
  for (const p of lista) await ate(() => caixaAberta(p), `caixa de ${p.id} aberta`);
}

export const textos = async (p: Pessoa, de: Pessoa) =>
  (await p.agenda.mensagens(de.id)).map((m) => m.texto);

export async function status(p: Pessoa, de: Pessoa, id: Uint8Array) {
  const mensagem = (await p.agenda.mensagens(de.id)).find((m) => m.id.every((b, i) => b === id[i]));
  return mensagem?.status;
}

/** Espera a rede parar: nenhuma conexão abrindo, nenhum pedido a caminho. */
export async function redeParada(): Promise<void> {
  await ate(() => transportes.every((t) => t.ociosa()), 'rede parada');
  await new Promise((pronto) => setTimeout(pronto, 5));
}

/**
 * Anda o relógio de `passo` em `passo` até a condição valer: reconexão e reenvio têm prazo. Só
 * anda com a rede parada, senão o prazo de um pedido a caminho venceria antes da resposta.
 */
export async function avancarAte(
  condicao: () => boolean | Promise<boolean>,
  oQue: string,
  passo = 1000,
): Promise<void> {
  for (let i = 0; i < 300; i++) {
    await redeParada();
    if (await condicao()) return;
    relogio.avancar(passo);
  }
  throw new Error(`não aconteceu: ${oQue}`);
}

/**
 * Anda o relógio até `instante`, de no máximo 1 s por vez, deixando a rede e o banco trabalharem
 * entre um passo e outro: o que tem prazo roda na hora certa.
 */
export async function andarAte(instante: number): Promise<void> {
  while (relogio.agora() < instante) {
    await redeParada();
    relogio.avancar(Math.min(1000, instante - relogio.agora()));
  }
  await redeParada();
}

/** Cada pedido que a pessoa mandou ao relay, com o circuito por onde saiu. */
export function pedidos(p: Pessoa): { circuito: string; pedido: PedidoAoRelay }[] {
  return p.transporte.conexoes.flatMap(({ circuito, enviadas }) =>
    enviadas.map((bytes) => {
      const leitura = lerPedido(bytes);
      if (!leitura.ok) throw new Error('pedido fora do formato');
      return { circuito, pedido: leitura.pedido };
    }),
  );
}

/** Uma conversa já aberta: a Alice escreveu, o Bob recebeu o pedido, aceitou e respondeu. */
export async function conversa(opcoes: OpcoesDaPessoa = {}): Promise<[Pessoa, Pessoa]> {
  const [alice, bob] = [await pessoa(undefined, opcoes), await pessoa(undefined, opcoes)];
  await online(alice, bob);
  await alice.correio.iniciarConversa(bob.id);
  await alice.correio.enviarTexto(bob.id, 'oi');
  await ate(async () => (await textos(bob, alice)).length === 1, 'bob recebe');
  await bob.correio.iniciarConversa(alice.id);
  await bob.correio.enviarTexto(alice.id, 'oi, alice');
  await ate(async () => (await textos(alice, bob)).length === 2, 'alice recebe');
  return [alice, bob];
}
