// O cartão deste aparelho no relay (RF-04). As chaves privadas das prekeys ficam só no banco
// cifrado; o relay recebe o cartão e as one-time prekeys numa publicação assinada.
//
// - A primeira publicação num relay é `substituir`, com 100 one-time prekeys: o que o relay tinha
//   desta identidade (de outro aparelho, numa restauração) não serve mais.
// - Ao conectar, se a última publicação tem mais de 24 h, publica de novo: o relay só guarda cartão
//   renovado nos últimos 90 dias. O relay só conta as prekeys na resposta a uma publicação; se
//   guardar menos de 50, uma segunda publicação completa até 100.
// - A prekey assinada muda a cada 7 dias. A substituída fica 30 dias, para a mensagem inicial
//   atrasada; depois sai, com as chaves efêmeras que a usaram.
// - Chave nova que o relay recusou sai na hora. Se a resposta não chegou, ela fica: o relay pode
//   ter aceitado.
import {
  criarCartao,
  criarPublicacao,
  MAXIMO_DE_PREKEYS,
  type ModoDaPublicacao,
  type Prekey,
  type Publicacao,
} from '@cifra/protocol';
import { bytesDe, numeroDe, numeroOuNulo, textoDe } from '../banco/linhas.ts';
import type { Identidade } from '../identidade/identidade.ts';
import type { Armazenamento } from '../portas/armazenamento.ts';
import type { Cripto, ParDeChaves } from '../portas/cripto.ts';

const HORA = 3_600_000;
const DIA = 24 * HORA;

/** Publica de novo depois deste prazo, para o relay não apagar o cartão. */
export const RENOVACAO_DO_CARTAO = DIA;

/** A prekey assinada muda depois deste prazo, na publicação seguinte. */
export const VIDA_DA_PREKEY_ASSINADA = 7 * DIA;

/** A prekey assinada substituída continua por este prazo, para a mensagem inicial atrasada. */
export const GUARDA_DA_PREKEY_SUBSTITUIDA = 30 * DIA;

/** Com menos one-time prekeys que isto no relay, o app completa até o máximo. */
export const MINIMO_DE_PREKEYS = MAXIMO_DE_PREKEYS / 2;

export interface EstadoDoCartao {
  readonly relay: string;
  readonly caixaCriada: boolean;
  /** A prekey assinada do último cartão aceito, e quando ela foi criada. */
  readonly prekeyAssinada: { readonly numero: number; readonly criadaEm: number } | null;
  /** A data do último cartão aceito. */
  readonly data: number | null;
  /** Quando o relay aceitou a última publicação, no relógio do app. */
  readonly publicadoEm: number | null;
  readonly prekeysNoRelay: number | null;
  readonly proximaPrekey: number;
}

/** O que publicar agora. */
export interface PlanoDePublicacao {
  readonly modo: ModoDaPublicacao;
  /** Gera uma prekey assinada nova para este cartão. */
  readonly novaAssinada: boolean;
  /** Quantas one-time prekeys novas vão junto. */
  readonly avulsas: number;
}

/**
 * O estado do cartão neste relay. Sem linha, ou com outro relay (o endereço mudou), começa do
 * zero: caixa a criar e primeira publicação.
 */
export async function estadoDoCartao(banco: Armazenamento, relay: string): Promise<EstadoDoCartao> {
  const [linha] = await banco.consultar(
    `SELECT c.relay, c.caixa_criada, c.prekey_assinada, p.criada_em, c.data, c.publicado_em,
            c.prekeys_no_relay, c.proxima_prekey
       FROM cartao c LEFT JOIN prekeys_assinadas p ON p.numero = c.prekey_assinada
      WHERE c.unica = 1`,
  );
  if (!linha || textoDe(linha, 'relay') !== relay) {
    const proxima = linha ? numeroDe(linha, 'proxima_prekey') : 1;
    await banco.executar(
      `INSERT INTO cartao (unica, relay, caixa_criada, proxima_prekey) VALUES (1, ?, 0, ?)
       ON CONFLICT (unica) DO UPDATE SET relay = excluded.relay, caixa_criada = 0,
         prekey_assinada = NULL, data = NULL, publicado_em = NULL, prekeys_no_relay = NULL`,
      [relay, proxima],
    );
    return {
      relay,
      caixaCriada: false,
      prekeyAssinada: null,
      data: null,
      publicadoEm: null,
      prekeysNoRelay: null,
      proximaPrekey: proxima,
    };
  }
  const numero = numeroOuNulo(linha, 'prekey_assinada');
  const criadaEm = numeroOuNulo(linha, 'criada_em');
  return {
    relay,
    caixaCriada: numeroDe(linha, 'caixa_criada') === 1,
    prekeyAssinada: numero !== null && criadaEm !== null ? { numero, criadaEm } : null,
    data: numeroOuNulo(linha, 'data'),
    publicadoEm: numeroOuNulo(linha, 'publicado_em'),
    prekeysNoRelay: numeroOuNulo(linha, 'prekeys_no_relay'),
    proximaPrekey: numeroDe(linha, 'proxima_prekey'),
  };
}

export async function marcarCaixaCriada(banco: Armazenamento): Promise<void> {
  await banco.executar('UPDATE cartao SET caixa_criada = 1 WHERE unica = 1');
}

/** A identidade foi restaurada em outro aparelho, e este não conecta mais (RF-05). */
export async function estaSubstituido(banco: Armazenamento): Promise<boolean> {
  const [linha] = await banco.consultar('SELECT substituido FROM cartao WHERE unica = 1');
  return linha?.['substituido'] === 1;
}

export async function marcarSubstituido(banco: Armazenamento): Promise<void> {
  await banco.executar('UPDATE cartao SET substituido = 1 WHERE unica = 1');
}

/** A publicação de agora, ou `null` se o cartão no relay está em dia. */
export function planejarPublicacao(
  estado: EstadoDoCartao,
  agora: number,
): PlanoDePublicacao | null {
  if (estado.data === null || estado.prekeyAssinada === null) {
    return { modo: 'substituir', novaAssinada: true, avulsas: MAXIMO_DE_PREKEYS };
  }
  const desde = estado.publicadoEm ?? 0;
  // Relógio que voltou também renova: não dá para saber quanto tempo passou.
  if (agora - desde < RENOVACAO_DO_CARTAO && agora >= desde) return null;
  const criadaEm = estado.prekeyAssinada.criadaEm;
  return {
    modo: 'acrescentar',
    novaAssinada: agora - criadaEm >= VIDA_DA_PREKEY_ASSINADA || agora < criadaEm,
    avulsas: 0,
  };
}

/** Depois de uma publicação aceita: completa as one-time prekeys se o relay guarda poucas. */
export function planejarReposicao(prekeysNoRelay: number): PlanoDePublicacao | null {
  if (prekeysNoRelay >= MINIMO_DE_PREKEYS) return null;
  return { modo: 'acrescentar', novaAssinada: false, avulsas: MAXIMO_DE_PREKEYS - prekeysNoRelay };
}

export interface PublicacaoPreparada {
  readonly publicacao: Publicacao;
  readonly modo: ModoDaPublicacao;
  readonly prekeyAssinada: number;
  readonly novaAssinada: boolean;
  /** Os números das one-time prekeys desta publicação, em ordem. */
  readonly avulsas: readonly number[];
}

/**
 * Gera as chaves do plano, guarda as privadas e monta a publicação assinada. A data do cartão é a
 * maior entre a hora cheia de agora e a última aceita mais 1 ms: o relay só aceita cartão mais
 * novo e guarda a data, que assim não diz o minuto da publicação. Na
 * restauração, `dataMinima` é a do cartão que outro aparelho deixou no relay mais 1 ms: o relógio
 * deste pode estar atrás do daquele.
 */
export async function prepararPublicacao(
  cripto: Cripto,
  banco: Armazenamento,
  identidade: Identidade,
  caixa: Uint8Array,
  estado: EstadoDoCartao,
  plano: PlanoDePublicacao,
  agora: number,
  gerarPar: () => ParDeChaves,
  dataMinima = 0,
): Promise<PublicacaoPreparada> {
  let numero = estado.proximaPrekey;
  let assinada: Prekey | null = null;
  if (!plano.novaAssinada && estado.prekeyAssinada) {
    const [linha] = await banco.consultar(
      'SELECT publica FROM prekeys_assinadas WHERE numero = ?',
      [estado.prekeyAssinada.numero],
    );
    if (linha)
      assinada = { numero: estado.prekeyAssinada.numero, chave: bytesDe(linha, 'publica') };
  }
  const novaAssinada = assinada === null;
  if (!assinada) {
    const par = gerarPar();
    assinada = { numero: numero++, chave: par.publicKey };
    await banco.executar(
      'INSERT INTO prekeys_assinadas (numero, privada, publica, criada_em) VALUES (?, ?, ?, ?)',
      [assinada.numero, par.privateKey, par.publicKey, agora],
    );
  }
  const avulsas: Prekey[] = [];
  for (let i = 0; i < plano.avulsas; i++) {
    const par = gerarPar();
    const avulsa = { numero: numero++, chave: par.publicKey };
    await banco.executar('INSERT INTO prekeys_avulsas (numero, privada) VALUES (?, ?)', [
      avulsa.numero,
      par.privateKey,
    ]);
    avulsas.push(avulsa);
  }
  await banco.executar('UPDATE cartao SET proxima_prekey = ? WHERE unica = 1', [numero]);

  const assinar = (mensagem: Uint8Array) =>
    cripto.crypto_sign_detached(mensagem, identidade.assinatura.privateKey);
  const cartao = criarCartao(
    {
      chaveDeIdentidade: identidade.assinatura.publicKey,
      prekeyAssinada: assinada,
      caixaPrincipal: caixa,
      data: Math.max(agora - (agora % HORA), (estado.data ?? 0) + 1, dataMinima),
      relays: [estado.relay],
    },
    assinar,
  );
  return {
    publicacao: criarPublicacao(plano.modo, cartao, avulsas, assinar),
    modo: plano.modo,
    prekeyAssinada: assinada.numero,
    novaAssinada,
    avulsas: avulsas.map(({ numero: n }) => n),
  };
}

/** O relay aceitou: o cartão e a prekey assinada dele passam a ser os atuais. */
export async function confirmarPublicacao(
  banco: Armazenamento,
  estado: EstadoDoCartao,
  preparada: PublicacaoPreparada,
  prekeysNoRelay: number,
  agora: number,
): Promise<void> {
  const anterior = estado.prekeyAssinada?.numero;
  if (anterior !== undefined && anterior !== preparada.prekeyAssinada) {
    await banco.executar('UPDATE prekeys_assinadas SET substituida_em = ? WHERE numero = ?', [
      agora,
      anterior,
    ]);
  }
  if (preparada.modo === 'substituir') {
    // O relay trocou todas as one-time prekeys desta identidade pelas desta publicação.
    const [primeira] = preparada.avulsas;
    await banco.executar('DELETE FROM prekeys_avulsas WHERE numero < ?', [
      primeira ?? Number.MAX_SAFE_INTEGER,
    ]);
  }
  await banco.executar(
    `UPDATE cartao SET prekey_assinada = ?, data = ?, publicado_em = ?, prekeys_no_relay = ?
      WHERE unica = 1`,
    [preparada.prekeyAssinada, preparada.publicacao.cartao.data, agora, prekeysNoRelay],
  );
}

/** O relay recusou: as chaves geradas para esta publicação nunca foram publicadas e saem. */
export async function descartarPublicacao(
  banco: Armazenamento,
  preparada: PublicacaoPreparada,
): Promise<void> {
  if (preparada.novaAssinada) {
    await banco.executar('DELETE FROM prekeys_assinadas WHERE numero = ?', [
      preparada.prekeyAssinada,
    ]);
  }
  for (const numero of preparada.avulsas) {
    await banco.executar('DELETE FROM prekeys_avulsas WHERE numero = ?', [numero]);
  }
}

/**
 * Apaga a prekey assinada substituída há mais de 30 dias, e a que nunca chegou a ser aceita (a
 * resposta do relay se perdeu) depois do mesmo prazo, com as chaves efêmeras que as usaram.
 */
export async function apagarPrekeysVencidas(banco: Armazenamento, agora: number): Promise<void> {
  const limite = agora - GUARDA_DA_PREKEY_SUBSTITUIDA;
  const vencidas = `SELECT numero FROM prekeys_assinadas
     WHERE (substituida_em IS NOT NULL AND substituida_em <= ?1)
        OR (substituida_em IS NULL AND criada_em <= ?1
            AND numero IS NOT (SELECT prekey_assinada FROM cartao WHERE unica = 1))`;
  await banco.executar(`DELETE FROM bases_vistas WHERE prekey_assinada IN (${vencidas})`, [limite]);
  await banco.executar(`DELETE FROM prekeys_assinadas WHERE numero IN (${vencidas})`, [limite]);
}

/** O par da prekey assinada pelo número, se ainda existir. */
export async function parDaPrekeyAssinada(
  banco: Armazenamento,
  numero: number,
): Promise<ParDeChaves | null> {
  const [linha] = await banco.consultar(
    'SELECT privada, publica FROM prekeys_assinadas WHERE numero = ?',
    [numero],
  );
  return linha
    ? { privateKey: bytesDe(linha, 'privada'), publicKey: bytesDe(linha, 'publica') }
    : null;
}

/** A chave privada da one-time prekey pelo número, se ainda não foi usada. */
export async function privadaDaPrekeyAvulsa(
  banco: Armazenamento,
  numero: number,
): Promise<Uint8Array | null> {
  const [linha] = await banco.consultar('SELECT privada FROM prekeys_avulsas WHERE numero = ?', [
    numero,
  ]);
  return linha ? bytesDe(linha, 'privada') : null;
}

/** Usada uma vez, a one-time prekey sai (sigilo para trás da primeira mensagem). */
export async function apagarPrekeyAvulsa(banco: Armazenamento, numero: number): Promise<void> {
  await banco.executar('DELETE FROM prekeys_avulsas WHERE numero = ?', [numero]);
}
