// Abertura do app. A chave mestra sai do Keystore, com a biometria ou a senha do aparelho, e abre o
// banco principal, cifrado; de lá sai a identidade (RNF-07). Sem chave mestra, ainda não há
// identidade: nada é gravado antes de o onboarding terminar. No bloqueio, a sessão fecha o banco e
// zera os segredos que estavam na memória. Sem React Native: os testes rodam no Node, com os
// adaptadores de referência.
//
// O cofre das conversas ocultas existe desde a instalação, num bloco, com uma chave sorteada e
// jogada fora: ninguém prova que ele está em uso (RNF-11). O segredo que, com o código secreto,
// abre o cofre sai da chave mestra, na mesma biometria do desbloqueio.
//
// Na restauração (RF-47), o backup escolhido entra no banco novo junto com a identidade: os
// contatos e os ajustes voltam antes de a pessoa entrar.
import {
  carregarIdentidade,
  completarBloco,
  ErroDoCofre,
  guardarIdentidade,
  importarBackup,
  prepararBanco,
  prepararCofre,
  segredoDoCofre,
  type Armazenamento,
  type CofreAberto,
  type CofreDeChaves,
  type ConteudoDoBackup,
  type Cripto,
  type Identidade,
} from '@cifra/core';

/** A chave mestra tem 256 bits. */
const BYTES_DA_CHAVE_MESTRA = 32;

/** A semente do par Ed25519 da caixa principal no relay. */
const BYTES_DA_SEMENTE_DA_CAIXA = 32;

export interface BancoPrincipal {
  readonly banco: Armazenamento;
  fechar(): void;
}

export interface Plataforma {
  readonly cripto: Cripto;
  readonly cofre: CofreDeChaves;
  /**
   * Abre ou cria o banco principal, cifrado com a chave mestra. Rejeita com `banco-ilegivel`
   * quando o arquivo existe e não abre com ela.
   */
  abrirBanco(chave: Uint8Array): Promise<BancoPrincipal>;
  /** Apaga o arquivo do banco principal, se existir. */
  apagarBanco(): Promise<void>;
  /**
   * Abre ou cria o cofre das conversas ocultas, cifrado com a chave. Rejeita com `banco-ilegivel`
   * quando o arquivo existe e não abre com ela, sem escrever nada nele.
   */
  abrirCofre(chave: Uint8Array): Promise<CofreAberto>;
  /** Zera o arquivo do cofre no lugar: o mesmo arquivo, com 0 byte. Nada pode estar aberto nele. */
  truncarCofre(): Promise<void>;
  /** A data de agora nos arquivos do cofre: o cofre em uso e o vazio ficam iguais. */
  tocarCofre(): Promise<void>;
  /**
   * Pânico (RF-48): apaga os arquivos do banco principal e do cofre, com os diários. Nada pode estar
   * aberto neles.
   */
  apagarArquivos(): Promise<void>;
  /** O bloco do cofre; sem ele, o do núcleo (16 MiB). Os testes usam um menor. */
  readonly blocoDoCofre?: number;
}

export interface Sessao {
  readonly identidade: Identidade;
  readonly banco: BancoPrincipal;
  /**
   * Semente do par Ed25519 que abre a caixa principal no relay. Fica no Keystore com proteção
   * `aparelho`: o serviço de notificação precisa dela com o app bloqueado. Sorteada, não sai das
   * palavras: quem tiver as palavras não abre a caixa deste aparelho.
   */
  readonly sementeDaCaixa: Uint8Array;
  /**
   * O segredo que, com o código secreto, abre o cofre das conversas ocultas. Sai da chave mestra,
   * fica só na memória e é zerado no bloqueio.
   */
  readonly segredoDoCofre: Uint8Array;
}

/**
 * O cofre das conversas ocultas existe desde a instalação: a que ainda não tem um ganha o dela
 * agora. Abre com uma chave sorteada e jogada fora; se abriu, o arquivo era novo ou vazio, e ganha
 * o esquema e um bloco. Se não abriu, o cofre já existe e fica como está.
 */
async function garantirCofre(plataforma: Plataforma): Promise<void> {
  const { cripto } = plataforma;
  const chave = cripto.randombytes_buf(32);
  let aberto: CofreAberto;
  try {
    aberto = await plataforma.abrirCofre(chave);
  } catch (erro) {
    if (erro instanceof Error && erro.message === 'banco-ilegivel') return;
    throw erro;
  } finally {
    cripto.memzero(chave);
  }
  try {
    await prepararCofre(aberto.banco);
    await completarBloco(aberto.banco, plataforma.blocoDoCofre);
  } finally {
    await aberto.fechar();
  }
}

/** O cofre de uma identidade nova: o anterior é zerado no lugar, e nasce ali um vazio. */
async function recriarCofreVazio(plataforma: Plataforma): Promise<void> {
  await plataforma.truncarCofre();
  await garantirCofre(plataforma);
  await plataforma.tocarCofre();
}

/**
 * Por que a abertura falhou.
 * - `cancelado`: a pessoa cancelou a biometria ou a senha. Os dados continuam lá.
 * - `chave-perdida`: o aparelho apagou a chave mestra (no Android, quando o bloqueio de tela é
 *   removido). O banco nunca mais abre.
 * - `banco-ilegivel`: a chave saiu do Keystore, mas o banco não abre com ela (arquivo danificado).
 * - `falhou`: outro erro, talvez passageiro.
 */
export type FalhaNaAbertura = 'cancelado' | 'chave-perdida' | 'banco-ilegivel' | 'falhou';

export class ErroNaAbertura extends Error {
  readonly falha: FalhaNaAbertura;

  constructor(falha: FalhaNaAbertura, opcoes?: ErrorOptions) {
    super(falha, opcoes);
    this.falha = falha;
  }
}

/** A semente da caixa guardada, ou uma nova, se a identidade ainda não tem. */
async function sementeDaCaixa(plataforma: Plataforma): Promise<Uint8Array> {
  const guardada = await plataforma.cofre.ler('chave-da-caixa');
  if (guardada) return guardada;
  const nova = plataforma.cripto.randombytes_buf(BYTES_DA_SEMENTE_DA_CAIXA);
  await plataforma.cofre.guardar('chave-da-caixa', nova, 'aparelho');
  return nova;
}

/** A chave mestra guardada. A falha do cofre vira a falha da abertura. */
async function lerChaveMestra(cofre: CofreDeChaves): Promise<Uint8Array | null> {
  try {
    return await cofre.ler('chave-mestra');
  } catch (erro) {
    if (erro instanceof ErroDoCofre) {
      throw new ErroNaAbertura(erro.falha === 'perdido' ? 'chave-perdida' : 'cancelado', {
        cause: erro,
      });
    }
    throw new ErroNaAbertura('falhou', { cause: erro });
  }
}

/**
 * Abre a identidade guardada. Devolve `null` quando ainda não há identidade neste aparelho; aí
 * nenhum pedido de biometria aparece. Rejeita com `ErroNaAbertura` quando não abre. Nunca apaga
 * nada: com a chave perdida, os dados ficam até a identidade nova ser guardada (`criarSessao`).
 */
export async function abrirSessao(plataforma: Plataforma): Promise<Sessao | null> {
  const { cripto } = plataforma;
  const chave = await lerChaveMestra(plataforma.cofre);
  if (!chave) return null;

  // O segredo do cofre sai antes de a chave mestra ser zerada.
  const segredo = segredoDoCofre(cripto, chave);
  let banco: BancoPrincipal;
  try {
    banco = await plataforma.abrirBanco(chave);
  } catch (erro) {
    cripto.memzero(segredo);
    const ilegivel = erro instanceof Error && erro.message === 'banco-ilegivel';
    throw new ErroNaAbertura(ilegivel ? 'banco-ilegivel' : 'falhou', { cause: erro });
  } finally {
    cripto.memzero(chave);
  }

  try {
    await prepararBanco(banco.banco);
    const identidade = await carregarIdentidade(banco.banco, cripto);
    if (identidade) {
      // O cofre não impede a abertura: sem ele, as ocultas só não abrem.
      await garantirCofre(plataforma).catch(() => undefined);
      await plataforma.tocarCofre().catch(() => undefined);
      return {
        identidade,
        banco,
        sementeDaCaixa: await sementeDaCaixa(plataforma),
        segredoDoCofre: segredo,
      };
    }
  } catch (erro) {
    banco.fechar();
    cripto.memzero(segredo);
    throw new ErroNaAbertura('falhou', { cause: erro });
  }
  // Há chave, mas o onboarding não terminou: o próximo `criarSessao` refaz tudo.
  banco.fechar();
  cripto.memzero(segredo);
  return null;
}

/**
 * Guarda a identidade nova ou restaurada, no fim do onboarding. Cria uma chave mestra nova e um
 * banco novo, no lugar do que houver. Com `backup` (a restauração, RF-47), os contatos e os ajustes
 * dele entram no banco novo. A chave vai para o Keystore por último, com proteção `desbloqueio`, e é
 * aí que aparece o pedido de biometria ou senha: se algo falhar antes ou se a pessoa cancelar, o
 * banco criado é apagado e o aparelho continua sem identidade.
 */
export async function criarSessao(
  plataforma: Plataforma,
  identidade: Identidade,
  backup: ConteudoDoBackup | null = null,
): Promise<Sessao> {
  const { cripto, cofre } = plataforma;
  await plataforma.apagarBanco();
  const chave = cripto.randombytes_buf(BYTES_DA_CHAVE_MESTRA);
  const semente = cripto.randombytes_buf(BYTES_DA_SEMENTE_DA_CAIXA);
  let banco: BancoPrincipal | undefined;
  try {
    banco = await plataforma.abrirBanco(chave);
    await prepararBanco(banco.banco);
    await guardarIdentidade(banco.banco, identidade);
    if (backup) await importarBackup(banco.banco, backup);
    // Caixa nova para a identidade nova; a de uma identidade anterior não serve mais.
    await cofre.guardar('chave-da-caixa', semente, 'aparelho');
    await cofre.guardar('chave-mestra', chave, 'desbloqueio');
    // As ocultas de uma identidade anterior não abrem mais com esta: o cofre volta a um bloco vazio.
    await recriarCofreVazio(plataforma).catch(() => undefined);
    return {
      identidade,
      banco,
      sementeDaCaixa: semente,
      segredoDoCofre: segredoDoCofre(cripto, chave),
    };
  } catch (erro) {
    banco?.fechar();
    await plataforma.apagarBanco().catch(() => undefined);
    await cofre.destruir('chave-da-caixa').catch(() => undefined);
    throw erro;
  } finally {
    cripto.memzero(chave);
  }
}

/**
 * Fecha a sessão no bloqueio. Quem chama já parou o que usava a sessão (o correio). O banco fecha,
 * e o SQLCipher apaga a cópia da chave que guardou na memória nativa; a semente e as chaves
 * privadas da identidade e a semente da caixa são zeradas. Limite: as cópias em texto que passaram
 * pelo JS (a chave em base64 e em hexadecimal) não dá para zerar; somem quando o coletor de lixo
 * passar.
 */
export function encerrarSessao(cripto: Cripto, sessao: Sessao): void {
  const { identidade } = sessao;
  try {
    sessao.banco.fechar();
  } finally {
    for (const segredo of [
      identidade.semente,
      identidade.assinatura.privateKey,
      identidade.acordo.privateKey,
      sessao.sementeDaCaixa,
      sessao.segredoDoCofre,
    ]) {
      cripto.memzero(segredo);
    }
  }
}
