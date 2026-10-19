// Backup de contatos e ajustes (RF-46, RF-47). Um arquivo que a pessoa guarda onde quiser e que só
// abre com as 12 palavras: a chave sai da semente da identidade, que sai das palavras. Ele leva os
// contatos aceitos (apelido, verificação, bloqueio, timer e prints da conversa, com o cartão
// conferido de cada um), os IDs bloqueados que vieram de pedidos, os ajustes e o tema e o idioma.
// Nunca leva mensagem, nota, anexo, pedido, sessão ou chave de conversa, nem nada das conversas
// ocultas: ele sai só do banco principal, e o cofre fica de fora (RF-46).
//
// Arquivo: o nonce (24 bytes) e o texto claro cifrado com XChaCha20-Poly1305, sem nenhum cabeçalho
// em claro: para quem não tem as palavras, ele é ruído. O texto claro é completado com zeros até a
// faixa do Padmé, com no mínimo 4096 bytes: o tamanho não diz quantos contatos há.
//
// Texto claro (inteiros em big-endian):
//   versão              1 byte
//   criado em           8 bytes, milissegundos desde 1970
//   ajustes             timer padrão (4), timer da nota (4), baixar sozinho (1), confirmações de
//                       leitura (1), indicador de digitação (1), bloquear sozinho (4), bloquear
//                       capturas (1)
//   preferências        tema (1: 0 escuro, 1 claro), idioma (1: 0 o do sistema, 1 pt-BR, 2 en)
//   contatos            quantidade (4), e cada um:
//     ID                10 bytes
//     bandeiras         1 byte: aceito (1), bloqueado (2), verificado (4), timer por avisar (8),
//                       prints bloqueados (16)
//     apelido           tamanho (1) + UTF-8; 0 é sem apelido
//     criado em         8 bytes
//     timer             4 bytes, em segundos; 0 é sem timer
//     timer desde       8 bytes
//     prints desde      8 bytes
//     recebidas até     8 bytes
//     cartão            tamanho (2) + o cartão conferido, como o relay entregou; 0 é sem cartão
//   zeros até a faixa
//
// Na restauração (RF-47), os contatos entram aceitos, como estavam, e o cartão de cada um entra
// marcado como desatualizado: o número de segurança aparece logo, e o primeiro envio busca o cartão
// de novo. As sessões não voltam; o primeiro envio abre uma nova.
import {
  BYTES_DO_ID,
  cartaoAutentico,
  deUtf8,
  ErroDeFormato,
  Escritor,
  idDaChave,
  idDoCartao,
  iguais,
  Leitor,
  lerCartao,
  padme,
  TAMANHO_MAXIMO_DO_CARTAO,
  timerValido,
  utf8,
} from '@cifra/protocol';
import {
  gravarLinhaDosAjustes,
  linhaDosAjustes,
  prazoDoBloqueioValido,
  type LinhaDosAjustes,
} from '../ajustes/repositorio.ts';
import { bytesDe, numeroDe } from '../banco/linhas.ts';
import { LIMITE_DO_APELIDO } from '../contatos/repositorio.ts';
import type { Identidade } from '../identidade/identidade.ts';
import type { Armazenamento } from '../portas/armazenamento.ts';
import type { Cripto } from '../portas/cripto.ts';

/** A versão do texto claro. Muda junto com o contexto, quando o formato mudar. */
const VERSAO = 1;

/** O contexto da chave e os dados adicionais da cifra: só vale para o backup desta versão. */
const CONTEXTO = utf8('cifra/backup/1');

/** O menor texto claro: um backup com poucos contatos não diz quantos são. */
const MINIMO_DO_CLARO = 4096;

/** O maior arquivo que o app lê: um backup de verdade fica muito abaixo disso. */
export const TAMANHO_MAXIMO_DO_BACKUP = 16 * 1024 * 1024;

const BYTES_DO_NONCE = 24;
const BYTES_DA_ETIQUETA = 16;
const BYTES_DA_CHAVE = 32;

const ACEITO = 1;
const BLOQUEADO = 2;
const VERIFICADO = 4;
const TIMER_POR_AVISAR = 8;
const PRINTS_BLOQUEADOS = 16;
const BANDEIRAS = ACEITO | BLOQUEADO | VERIFICADO | TIMER_POR_AVISAR | PRINTS_BLOQUEADOS;

export type TemaDoBackup = 'escuro' | 'claro';
export type IdiomaDoBackup = 'pt-BR' | 'en' | null;

/** O que vale com o app bloqueado e fica fora do banco: o tema e o idioma (`null`: o do sistema). */
export interface PreferenciasDoBackup {
  readonly tema: TemaDoBackup;
  readonly idioma: IdiomaDoBackup;
}

const TEMAS: readonly TemaDoBackup[] = ['escuro', 'claro'];
const IDIOMAS: readonly IdiomaDoBackup[] = [null, 'pt-BR', 'en'];

export interface ContatoDoBackup {
  /** O ID em bytes. */
  readonly contato: Uint8Array;
  /** `false`: um ID bloqueado que veio de um pedido. */
  readonly aceito: boolean;
  readonly bloqueado: boolean;
  readonly verificado: boolean;
  readonly apelido: string | null;
  readonly criadoEm: number;
  readonly timer: number;
  readonly timerDesde: number;
  readonly timerPorAvisar: boolean;
  readonly printsBloqueados: boolean;
  readonly printsDesde: number;
  readonly recebidasAte: number;
  /** O cartão conferido do contato, como o relay entregou; `null` se não havia. */
  readonly cartao: Uint8Array | null;
}

export interface ConteudoDoBackup {
  readonly criadoEm: number;
  readonly ajustes: LinhaDosAjustes;
  readonly preferencias: PreferenciasDoBackup;
  readonly contatos: readonly ContatoDoBackup[];
}

/** A chave do backup, que sai da semente da identidade: só as mesmas palavras abrem. */
function chaveDoBackup(cripto: Cripto, identidade: Identidade): Uint8Array {
  return cripto.crypto_generichash(BYTES_DA_CHAVE, CONTEXTO, identidade.semente);
}

/** O apelido como a agenda guarda: sem espaço nas pontas, de 1 a 40 caracteres, sem controle. */
function apelidoValido(apelido: string): boolean {
  const tamanho = Array.from(apelido).length;
  return (
    apelido.trim() === apelido &&
    tamanho >= 1 &&
    tamanho <= LIMITE_DO_APELIDO &&
    !/\p{Cc}/u.test(apelido)
  );
}

/**
 * O que vai no backup, lido do banco principal: os contatos aceitos e os IDs bloqueados, com o cartão
 * conferido de cada um, e os ajustes. Pedidos de conversa ficam de fora, e o próprio ID também (um
 * banco que passou pela atualização dos contatos com notas pessoais o tem entre os contatos).
 */
export async function conteudoDoBackup(
  banco: Armazenamento,
  meuId: Uint8Array,
  preferencias: PreferenciasDoBackup,
  agora: number,
): Promise<ConteudoDoBackup> {
  const ajustes = await linhaDosAjustes(banco);
  const linhas = await banco.consultar(
    `SELECT c.contato, c.aceito, c.bloqueado, c.verificado, c.apelido, c.criado_em, c.timer,
            c.timer_desde, c.timer_por_avisar, c.prints_bloqueados, c.prints_desde,
            c.recebidas_ate, d.cartao
       FROM contatos c LEFT JOIN destinos d ON d.contato = c.contato
      WHERE (c.aceito = 1 OR c.bloqueado = 1) AND c.contato <> ?
      ORDER BY c.criado_em, c.contato`,
    [meuId],
  );
  const contatos = linhas.map((linha): ContatoDoBackup => {
    const apelido = linha['apelido'];
    const cartao = linha['cartao'];
    return {
      contato: bytesDe(linha, 'contato'),
      aceito: numeroDe(linha, 'aceito') === 1,
      bloqueado: numeroDe(linha, 'bloqueado') === 1,
      verificado: numeroDe(linha, 'verificado') === 1,
      apelido: typeof apelido === 'string' ? apelido : null,
      criadoEm: numeroDe(linha, 'criado_em'),
      timer: numeroDe(linha, 'timer'),
      timerDesde: numeroDe(linha, 'timer_desde'),
      timerPorAvisar: numeroDe(linha, 'timer_por_avisar') === 1,
      printsBloqueados: numeroDe(linha, 'prints_bloqueados') === 1,
      printsDesde: numeroDe(linha, 'prints_desde'),
      recebidasAte: numeroDe(linha, 'recebidas_ate'),
      cartao: cartao instanceof Uint8Array ? cartao : null,
    };
  });
  return { criadoEm: agora, ajustes, preferencias, contatos };
}

/** O texto claro, sem os zeros do fim. Valor fora do formato é erro de quem chama e lança. */
function codificar(conteudo: ConteudoDoBackup): Uint8Array {
  const { ajustes, preferencias } = conteudo;
  const escritor = new Escritor()
    .uint8(VERSAO)
    .uint64(conteudo.criadoEm)
    .uint32(ajustes.timer_padrao)
    .uint32(ajustes.timer_da_nota)
    .uint8(ajustes.baixar_sozinho)
    .uint8(ajustes.confirmacoes_de_leitura)
    .uint8(ajustes.indicador_de_digitacao)
    .uint32(ajustes.bloquear_sozinho)
    .uint8(ajustes.bloquear_capturas)
    .uint8(TEMAS.indexOf(preferencias.tema))
    .uint8(IDIOMAS.indexOf(preferencias.idioma))
    .uint32(conteudo.contatos.length);
  for (const contato of conteudo.contatos) {
    if (contato.contato.length !== BYTES_DO_ID) throw new RangeError('ID fora do formato');
    const apelido = contato.apelido === null ? new Uint8Array(0) : utf8(contato.apelido);
    const cartao = contato.cartao ?? new Uint8Array(0);
    escritor
      .bytes(contato.contato)
      .uint8(
        (contato.aceito ? ACEITO : 0) |
          (contato.bloqueado ? BLOQUEADO : 0) |
          (contato.verificado ? VERIFICADO : 0) |
          (contato.timerPorAvisar ? TIMER_POR_AVISAR : 0) |
          (contato.printsBloqueados ? PRINTS_BLOQUEADOS : 0),
      )
      .uint8(apelido.length)
      .bytes(apelido)
      .uint64(contato.criadoEm)
      .uint32(contato.timer)
      .uint64(contato.timerDesde)
      .uint64(contato.printsDesde)
      .uint64(contato.recebidasAte)
      .uint16(cartao.length)
      .bytes(cartao);
  }
  return escritor.resultado();
}

function lerBooleano(leitor: Leitor): number {
  const valor = leitor.uint8();
  if (valor > 1) throw new ErroDeFormato('ajuste');
  return valor;
}

function lerTimer(leitor: Leitor): number {
  const segundos = leitor.uint32();
  if (!timerValido(segundos)) throw new ErroDeFormato('timer');
  return segundos;
}

function lerAjustes(leitor: Leitor): LinhaDosAjustes {
  const ajustes: LinhaDosAjustes = {
    timer_padrao: lerTimer(leitor),
    timer_da_nota: lerTimer(leitor),
    baixar_sozinho: lerBooleano(leitor),
    confirmacoes_de_leitura: lerBooleano(leitor),
    indicador_de_digitacao: lerBooleano(leitor),
    bloquear_sozinho: leitor.uint32(),
    bloquear_capturas: lerBooleano(leitor),
  };
  if (!prazoDoBloqueioValido(ajustes.bloquear_sozinho)) throw new ErroDeFormato('prazo');
  return ajustes;
}

function lerContato(leitor: Leitor): ContatoDoBackup {
  const contato = leitor.bytes(BYTES_DO_ID);
  const bandeiras = leitor.uint8();
  if ((bandeiras & ~BANDEIRAS) !== 0) throw new ErroDeFormato('bandeiras');
  // Só vão contatos aceitos e IDs bloqueados: um pedido não entra no backup.
  if ((bandeiras & (ACEITO | BLOQUEADO)) === 0) throw new ErroDeFormato('pedido');
  const tamanhoDoApelido = leitor.uint8();
  let apelido: string | null = null;
  if (tamanhoDoApelido > 0) {
    apelido = deUtf8(leitor.bytes(tamanhoDoApelido));
    if (apelido === null || !apelidoValido(apelido)) throw new ErroDeFormato('apelido');
  }
  const criadoEm = leitor.uint64();
  const timer = lerTimer(leitor);
  const timerDesde = leitor.uint64();
  const printsDesde = leitor.uint64();
  const recebidasAte = leitor.uint64();
  const tamanhoDoCartao = leitor.uint16();
  if (tamanhoDoCartao > TAMANHO_MAXIMO_DO_CARTAO) throw new ErroDeFormato('cartão');
  return {
    contato,
    aceito: (bandeiras & ACEITO) !== 0,
    bloqueado: (bandeiras & BLOQUEADO) !== 0,
    verificado: (bandeiras & VERIFICADO) !== 0,
    apelido,
    criadoEm,
    timer,
    timerDesde,
    timerPorAvisar: (bandeiras & TIMER_POR_AVISAR) !== 0,
    printsBloqueados: (bandeiras & PRINTS_BLOQUEADOS) !== 0,
    printsDesde,
    recebidasAte,
    cartao: tamanhoDoCartao > 0 ? leitor.bytes(tamanhoDoCartao) : null,
  };
}

/**
 * Lê o texto claro sem confiar em nada: formato, faixas, nenhum ID repetido. O próprio ID, que o
 * backup de um banco com ele entre os contatos levava, fica de fora, e o resto vale.
 */
function ler(claro: Uint8Array, meuId: Uint8Array): ConteudoDoBackup {
  const leitor = new Leitor(claro);
  if (leitor.uint8() !== VERSAO) throw new ErroDeFormato('versão');
  const criadoEm = leitor.uint64();
  const ajustes = lerAjustes(leitor);
  const tema = TEMAS[leitor.uint8()];
  const idioma = IDIOMAS[leitor.uint8()];
  if (tema === undefined || idioma === undefined) throw new ErroDeFormato('preferências');
  const quantidade = leitor.uint32();
  const contatos: ContatoDoBackup[] = [];
  const vistos = new Set<string>();
  for (let i = 0; i < quantidade; i++) {
    const contato = lerContato(leitor);
    if (iguais(contato.contato, meuId)) continue;
    const chave = Array.from(contato.contato).join(',');
    if (vistos.has(chave)) throw new ErroDeFormato('ID');
    vistos.add(chave);
    contatos.push(contato);
  }
  // O resto é o preenchimento: só zeros.
  if (leitor.bytes(claro.length - leitor.posicao).some((byte) => byte !== 0)) {
    throw new ErroDeFormato('preenchimento');
  }
  return { criadoEm, ajustes, preferencias: { tema, idioma }, contatos };
}

/** O backup cifrado com a chave que sai das palavras da identidade. */
export function cifrarBackup(
  cripto: Cripto,
  identidade: Identidade,
  conteudo: ConteudoDoBackup,
): Uint8Array {
  const sem = codificar(conteudo);
  const claro = new Uint8Array(padme(Math.max(sem.length, MINIMO_DO_CLARO)));
  claro.set(sem);
  const chave = chaveDoBackup(cripto, identidade);
  const nonce = cripto.randombytes_buf(BYTES_DO_NONCE);
  try {
    const cifrado = cripto.crypto_aead_xchacha20poly1305_ietf_encrypt(
      claro,
      CONTEXTO,
      null,
      nonce,
      chave,
    );
    const arquivo = new Uint8Array(BYTES_DO_NONCE + cifrado.length);
    arquivo.set(nonce);
    arquivo.set(cifrado, BYTES_DO_NONCE);
    return arquivo;
  } finally {
    cripto.memzero(chave);
    cripto.memzero(claro);
    cripto.memzero(sem);
  }
}

/** Monta o backup do banco principal, já cifrado (RF-46). */
export async function exportarBackup(
  cripto: Cripto,
  banco: Armazenamento,
  identidade: Identidade,
  preferencias: PreferenciasDoBackup,
  agora: number,
): Promise<Uint8Array> {
  const meuId = idDaChave(cripto, identidade.assinatura.publicKey);
  return cifrarBackup(
    cripto,
    identidade,
    await conteudoDoBackup(banco, meuId, preferencias, agora),
  );
}

/**
 * Abre o arquivo com a identidade restaurada (RF-47). Devolve `null` quando ele não é um backup desta
 * identidade (outras palavras, outro arquivo) ou foi mexido: nada dele é usado. O cartão de um
 * contato que não confere (assinatura ou ID) fica de fora, sem derrubar o resto.
 */
export function abrirBackup(
  cripto: Cripto,
  identidade: Identidade,
  arquivo: Uint8Array,
): ConteudoDoBackup | null {
  if (
    arquivo.length < BYTES_DO_NONCE + BYTES_DA_ETIQUETA + MINIMO_DO_CLARO ||
    arquivo.length > TAMANHO_MAXIMO_DO_BACKUP
  ) {
    return null;
  }
  const chave = chaveDoBackup(cripto, identidade);
  let claro: Uint8Array;
  try {
    claro = cripto.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      arquivo.subarray(BYTES_DO_NONCE),
      CONTEXTO,
      arquivo.subarray(0, BYTES_DO_NONCE),
      chave,
    );
  } catch {
    return null;
  } finally {
    cripto.memzero(chave);
  }
  const meuId = idDaChave(cripto, identidade.assinatura.publicKey);
  let conteudo: ConteudoDoBackup;
  try {
    conteudo = ler(claro, meuId);
  } catch (erro) {
    if (erro instanceof ErroDeFormato) return null;
    throw erro;
  } finally {
    cripto.memzero(claro);
  }
  return {
    ...conteudo,
    contatos: conteudo.contatos.map((contato) => {
      if (!contato.cartao) return contato;
      const cartao = lerCartao(contato.cartao);
      const confere =
        cartao !== null &&
        cartaoAutentico(cripto, cartao) &&
        iguais(idDoCartao(cripto, cartao), contato.contato);
      return confere ? contato : { ...contato, cartao: null };
    }),
  };
}

/**
 * Grava o backup no banco novo da identidade restaurada (RF-47): os ajustes, os contatos e o cartão
 * de cada um, marcado como desatualizado. Um contato que já existe no banco fica como está.
 */
export async function importarBackup(
  banco: Armazenamento,
  conteudo: ConteudoDoBackup,
): Promise<void> {
  await banco.transacao(async (t) => {
    await gravarLinhaDosAjustes(t, conteudo.ajustes);
    for (const contato of conteudo.contatos) {
      const { linhasAlteradas } = await t.executar(
        `INSERT INTO contatos (contato, aceito, bloqueado, verificado, apelido, criado_em, timer,
           timer_desde, timer_por_avisar, prints_bloqueados, prints_desde, recebidas_ate)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (contato) DO NOTHING`,
        [
          contato.contato,
          contato.aceito ? 1 : 0,
          contato.bloqueado ? 1 : 0,
          contato.verificado ? 1 : 0,
          contato.apelido,
          contato.criadoEm,
          contato.timer,
          contato.timerDesde,
          contato.timerPorAvisar ? 1 : 0,
          contato.printsBloqueados ? 1 : 0,
          contato.printsDesde,
          contato.recebidasAte,
        ],
      );
      if (linhasAlteradas === 0 || !contato.cartao) continue;
      await t.executar(
        `INSERT INTO destinos (contato, cartao, desatualizado) VALUES (?, ?, 1)
         ON CONFLICT (contato) DO NOTHING`,
        [contato.contato, contato.cartao],
      );
    }
  });
}
