// Uma sessão com um contato: o resultado do X3DH e a catraca que vem dele. Quem abre a sessão manda
// os dados do X3DH em toda mensagem até receber a primeira resposta, como no libsignal: se a
// primeira mensagem se perder, qualquer uma das seguintes ainda abre a sessão do outro lado.
import {
  capacidadeDoConteudo,
  codificarConteudo,
  ErroDeFormato,
  Escritor,
  idDaChave,
  Leitor,
  lerConteudo,
  type AberturaDaSessao,
  type Cartao,
  type Conteudo,
  type Interior,
  type Prekey,
} from '@cifra/protocol';
import type { Identidade } from '../identidade/identidade.ts';
import type { Cripto, ParDeChaves } from '../portas/cripto.ts';
import {
  cifrar,
  decifrar,
  escreverCatraca,
  iniciarQuemAbre,
  iniciarQuemResponde,
  lerCatraca,
  type EstadoDaCatraca,
  type GerarPar,
} from './catraca.ts';
import { iniciarX3dh, responderX3dh } from './x3dh.ts';

/** As prekeys que quem abriu usou, repetidas no envelope inicial até a primeira resposta. */
export interface PrekeysUsadas {
  readonly prekeyAssinada: number;
  readonly prekeyAvulsa: number | null;
}

export interface Sessao {
  /** Ed25519 do contato, a do cartão: o ID sai dela, e o selo vai para a X25519 dela. */
  readonly chaveDoContato: Uint8Array;
  /** AD do X3DH: a identidade de quem abriu, seguida da de quem respondeu. */
  readonly dadosAssociados: Uint8Array;
  /** A chave efêmera do X3DH que abriu a sessão: reconhece a mensagem inicial que chega de novo. */
  readonly base: Uint8Array;
  /** Só em quem abriu, até a primeira resposta. */
  readonly abertura: PrekeysUsadas | null;
  readonly catraca: EstadoDaCatraca;
}

/**
 * Abre a sessão com o cartão já conferido (assinaturas e ID) e a one-time prekey que veio com ele.
 * A chave efêmera e a primeira chave da catraca saem de `gerarPar`, nessa ordem.
 */
export function sessaoDeQuemAbre(
  cripto: Cripto,
  identidade: Identidade,
  cartao: Cartao,
  avulsa: Prekey | null,
  gerarPar: GerarPar,
): Sessao {
  const efemera = gerarPar();
  const base = efemera.publicKey;
  const { segredo, dadosAssociados } = iniciarX3dh(cripto, identidade, cartao, avulsa, efemera);
  try {
    return {
      chaveDoContato: cartao.chaveDeIdentidade,
      dadosAssociados,
      base,
      abertura: {
        prekeyAssinada: cartao.prekeyAssinada.numero,
        prekeyAvulsa: avulsa?.numero ?? null,
      },
      catraca: iniciarQuemAbre(cripto, segredo, cartao.prekeyAssinada.chave, gerarPar),
    };
  } finally {
    cripto.memzero(segredo);
  }
}

/**
 * Abre a sessão do lado de quem recebe a mensagem inicial, com o par da prekey assinada e a chave
 * privada da one-time prekey que ela diz ter usado. A sessão só vale se a mensagem decifrar com ela.
 */
export function sessaoDeQuemResponde(
  cripto: Cripto,
  identidade: Identidade,
  abertura: AberturaDaSessao,
  assinada: ParDeChaves,
  avulsa: Uint8Array | null,
): Sessao {
  const { segredo, dadosAssociados } = responderX3dh(
    cripto,
    identidade,
    abertura,
    assinada,
    avulsa,
  );
  return {
    chaveDoContato: abertura.chaveDeIdentidade,
    dadosAssociados,
    base: abertura.chaveEfemera,
    abertura: null,
    catraca: iniciarQuemResponde(segredo, assinada),
  };
}

/** Cifra o conteúdo na sessão e monta o interior do pacote. Devolve a sessão já avançada. */
export function cifrarNaSessao(
  cripto: Cripto,
  identidade: Identidade,
  sessao: Sessao,
  conteudo: Conteudo,
): { readonly sessao: Sessao; readonly interior: Interior } {
  const { abertura } = sessao;
  const tipo = abertura ? 'inicial' : 'sessao';
  const texto = codificarConteudo(conteudo, capacidadeDoConteudo(tipo));
  const cifrada = cifrar(cripto, sessao.catraca, texto, sessao.dadosAssociados);
  const { cabecalho, cifrado } = cifrada;
  const interior: Interior = abertura
    ? {
        tipo: 'inicial',
        abertura: {
          chaveDeIdentidade: identidade.assinatura.publicKey,
          chaveEfemera: sessao.base,
          ...abertura,
        },
        cabecalho,
        cifrado,
      }
    : {
        tipo: 'sessao',
        remetente: idDaChave(cripto, identidade.assinatura.publicKey),
        cabecalho,
        cifrado,
      };
  return { sessao: { ...sessao, catraca: cifrada.estado }, interior };
}

/**
 * Decifra o interior na sessão. Devolve `null` se não decifra; a sessão recebida nunca muda. O
 * conteúdo vem `null` quando decifrou mas o formato não bate: a catraca andou do mesmo jeito.
 */
export function decifrarNaSessao(
  cripto: Cripto,
  sessao: Sessao,
  interior: Interior,
  gerarPar: GerarPar,
): { readonly sessao: Sessao; readonly conteudo: Conteudo | null } | null {
  const decifrada = decifrar(
    cripto,
    sessao.catraca,
    interior.cabecalho,
    interior.cifrado,
    sessao.dadosAssociados,
    gerarPar,
  );
  if (!decifrada) return null;
  return {
    // Chegou mensagem do outro lado: a sessão está aberta dos dois lados, e o envelope inicial
    // não é mais preciso.
    sessao: { ...sessao, catraca: decifrada.estado, abertura: null },
    conteudo: lerConteudo(decifrada.texto),
  };
}

// A sessão no banco: versão (1), chave do contato (32), AD (64), base (32), prekeys usadas
// [tem (1) + assinada (4) + tem avulsa (1) + avulsa (4)] e a catraca (catraca.ts).
const VERSAO_DA_SESSAO = 1;

export function codificarSessao(sessao: Sessao): Uint8Array {
  const escritor = new Escritor()
    .uint8(VERSAO_DA_SESSAO)
    .bytes(sessao.chaveDoContato)
    .bytes(sessao.dadosAssociados)
    .bytes(sessao.base);
  const { abertura } = sessao;
  if (abertura) {
    escritor
      .uint8(1)
      .uint32(abertura.prekeyAssinada)
      .uint8(abertura.prekeyAvulsa === null ? 0 : 1)
      .uint32(abertura.prekeyAvulsa ?? 0);
  } else {
    escritor.uint8(0);
  }
  escreverCatraca(escritor, sessao.catraca);
  return escritor.resultado();
}

/** Lê a sessão guardada. Lança se os bytes não seguem o formato: o banco está corrompido. */
export function lerSessao(bytes: Uint8Array): Sessao {
  const leitor = new Leitor(bytes);
  if (leitor.uint8() !== VERSAO_DA_SESSAO) throw new ErroDeFormato('versão da sessão');
  const chaveDoContato = leitor.bytes(32);
  const dadosAssociados = leitor.bytes(64);
  const base = leitor.bytes(32);
  let abertura: PrekeysUsadas | null = null;
  const temAbertura = leitor.uint8();
  if (temAbertura === 1) {
    const prekeyAssinada = leitor.uint32();
    const temAvulsa = leitor.uint8();
    const avulsa = leitor.uint32();
    abertura = { prekeyAssinada, prekeyAvulsa: temAvulsa === 1 ? avulsa : null };
  } else if (temAbertura !== 0) {
    throw new ErroDeFormato('abertura');
  }
  const catraca = lerCatraca(leitor);
  leitor.fim();
  return { chaveDoContato, dadosAssociados, base, abertura, catraca };
}
