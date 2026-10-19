// Mensagens do WebSocket entre o app e o relay (SPEC, "Especificação do relay"). Toda mensagem é
// binária e começa pelo tipo. Os pedidos do app levam um número, que volta na resposta: o app pode
// mandar vários pedidos sem esperar cada resposta. Formato inválido não é tolerado em nenhum lado.
//
// Do app ao relay (depois do tipo, o número do pedido em 4 bytes):
//   0x01 publicar-cartao    publicação (cartao.ts)
//   0x02 buscar-cartao      ID (10)
//   0x03 criar-caixa        caixa (32)
//   0x04 depositar          caixa (32) + pacote (4096) + marca de aviso (49)
//   0x05 abrir-caixa        caixa (32) + assinatura do desafio (64)
//   0x06 confirmar          quantidade (1) + IDs de pacote (16 cada)
//   0x07 apagar-tudo        chave de identidade (32) + assinatura do desafio (64)
//
// Do relay ao app:
//   0x80 ola                versão (1) + desafio (32), logo ao conectar
//   0x81 resposta           número (4) + código (1)
//   0x82 cartao-publicado   número (4) + one-time prekeys guardadas (1)
//   0x83 cartao-encontrado  número (4) + cartão + tem prekey (1) [+ número (4) + chave (32)]
//   0x84 pacote             ID (16) + pacote (4096) + marca de aviso (49)
//   0x85 em-dia             nada: os pacotes que esperavam na caixa já foram todos entregues
//   0x86 caixa-substituida  nada: o cartão do dono passou a apontar outra caixa (outro aparelho
//                           restaurou a identidade); a caixa aberta nesta conexão foi apagada, e
//                           o relay fecha a conexão logo depois
//
// Uma caixa é uma chave pública Ed25519. Para abrir, o dono assina o desafio que o relay mandou no
// `ola` daquela conexão: a assinatura não serve em outra conexão nem em outro relay que use outra
// chave de caixa.
//
// O pânico pede ao relay para apagar o cartão do dono, as one-time prekeys, a caixa principal do
// cartão e o que esperava nela. O dono assina, com a chave de identidade, o desafio daquela
// conexão: a assinatura não serve em outra conexão, e só o dono apaga o cartão.
//
// A marca de aviso vai junto com cada pacote: 1 byte selado (crypto_box_seal) para a chave da
// caixa, que diz se o pacote é uma mensagem ou outra coisa (confirmação de leitura, digitação,
// timer, apagar). O relay guarda e repassa sem conseguir abrir; o aparelho bloqueado, que só tem a
// chave da caixa e não abre o pacote, abre a marca para avisar só de mensagem (RF-42). Todo
// depósito tem o mesmo tamanho: o relay não distingue uma mensagem de um controle.
import { ErroDeFormato, Escritor, iguais, juntar, Leitor } from './bytes.ts';
import {
  BYTES_DA_ASSINATURA,
  BYTES_DA_CHAVE,
  lerCartaoDe,
  lerPublicacaoDe,
  TAMANHO_MAXIMO_DA_PUBLICACAO,
  TAMANHO_MAXIMO_DO_CARTAO,
  type Cartao,
  type Prekey,
  type Publicacao,
} from './cartao.ts';
import { CONTEXTOS } from './contextos.ts';
import { BYTES_DO_ID } from './id.ts';
import { JANELA_DE_ENTREGA, MAXIMO_DE_PREKEYS, TAMANHO_DO_PACOTE } from './limites.ts';
import type { Hash, Verificador } from './verificador.ts';

export const BYTES_DO_DESAFIO = 32;

/** O ID de um pacote no relay é o BLAKE2b de 16 bytes do próprio pacote. */
export const BYTES_DO_ID_DO_PACOTE = 16;

/** A marca de aviso: 1 byte selado com crypto_box_seal, que acrescenta 48. */
export const BYTES_DA_MARCA = 49;

/**
 * Códigos de resposta. O byte do código é a posição nesta lista: código novo entra só no fim.
 * - `formato-invalido`: o relay fecha a conexão logo depois.
 * - `taxa-excedida`: o pedido não foi atendido; tente mais tarde.
 * - `assinatura-invalida`: na abertura de caixa, o relay fecha a conexão logo depois.
 * - `cartao-antigo`: o relay já tem um cartão com data igual ou mais nova.
 * - `cartao-fora-do-prazo`: a data está à frente do relógio do relay além da tolerância, ou tão
 *   velha que o cartão já teria vencido.
 * - `prekeys-recusadas`: passaria do máximo guardado, ou repete o número de uma que o relay tem.
 * - `caixa-cheia`: a caixa chegou ao máximo de pacotes; tente mais tarde.
 * - `caixa-ja-aberta`: esta conexão já abriu uma caixa.
 * - `caixa-fechada`: confirmar sem ter aberto uma caixa nesta conexão.
 * - `caixa-substituida`: a publicação traz outra caixa principal, mas não é `substituir`. Só a
 *   restauração em outro aparelho troca a caixa, e o aparelho que recebe este código foi trocado.
 */
export const CODIGOS = [
  'ok',
  'formato-invalido',
  'taxa-excedida',
  'assinatura-invalida',
  'cartao-antigo',
  'cartao-fora-do-prazo',
  'cartao-inexistente',
  'prekeys-recusadas',
  'caixa-inexistente',
  'caixa-cheia',
  'caixa-ja-aberta',
  'caixa-fechada',
  'caixa-substituida',
] as const;

export type CodigoDeResposta = (typeof CODIGOS)[number];

/** Códigos com que o relay fecha a conexão, além dos do próprio WebSocket (1003, 1009). */
export const FECHAMENTOS = {
  /** A mesma caixa foi aberta em outra conexão: vale a abertura mais nova. */
  caixaEmOutraConexao: 4001,
  formatoInvalido: 4002,
  /** A conexão passou da taxa de mensagens. */
  taxaExcedida: 4003,
  /** Assinatura errada na abertura de caixa. */
  assinaturaInvalida: 4004,
  /** Sem caixa aberta e sem mensagem pelo prazo de ociosidade. */
  ociosa: 4005,
  /** A caixa aberta nesta conexão foi substituída por outra no cartão do dono. */
  caixaSubstituida: 4006,
  /** O dono apagou o cartão e a caixa aberta nesta conexão (pânico). */
  caixaApagada: 4007,
  /** O relay falhou ao atender um pedido desta conexão (o banco, o disco cheio): ele não foi atendido. */
  erroInterno: 4008,
} as const;

export type PedidoAoRelay =
  | { readonly tipo: 'publicar-cartao'; readonly numero: number; readonly publicacao: Publicacao }
  | { readonly tipo: 'buscar-cartao'; readonly numero: number; readonly id: Uint8Array }
  | { readonly tipo: 'criar-caixa'; readonly numero: number; readonly caixa: Uint8Array }
  | {
      readonly tipo: 'depositar';
      readonly numero: number;
      readonly caixa: Uint8Array;
      readonly pacote: Uint8Array;
      readonly marca: Uint8Array;
    }
  | {
      readonly tipo: 'abrir-caixa';
      readonly numero: number;
      readonly caixa: Uint8Array;
      readonly assinatura: Uint8Array;
    }
  | { readonly tipo: 'confirmar'; readonly numero: number; readonly ids: readonly Uint8Array[] }
  | {
      readonly tipo: 'apagar-tudo';
      readonly numero: number;
      /** A chave de identidade Ed25519: o ID sai dela. */
      readonly chave: Uint8Array;
      readonly assinatura: Uint8Array;
    };

export type MensagemDoRelay =
  | { readonly tipo: 'ola'; readonly versao: number; readonly desafio: Uint8Array }
  | { readonly tipo: 'resposta'; readonly numero: number; readonly codigo: CodigoDeResposta }
  | { readonly tipo: 'cartao-publicado'; readonly numero: number; readonly prekeys: number }
  | {
      readonly tipo: 'cartao-encontrado';
      readonly numero: number;
      readonly cartao: Cartao;
      readonly prekey: Prekey | null;
    }
  | {
      readonly tipo: 'pacote';
      readonly id: Uint8Array;
      readonly pacote: Uint8Array;
      readonly marca: Uint8Array;
    }
  | { readonly tipo: 'em-dia' }
  | { readonly tipo: 'caixa-substituida' };

const TIPOS_DE_PEDIDO = {
  'publicar-cartao': 0x01,
  'buscar-cartao': 0x02,
  'criar-caixa': 0x03,
  depositar: 0x04,
  'abrir-caixa': 0x05,
  confirmar: 0x06,
  'apagar-tudo': 0x07,
} as const satisfies Record<PedidoAoRelay['tipo'], number>;

const TIPOS_DE_MENSAGEM = {
  ola: 0x80,
  resposta: 0x81,
  'cartao-publicado': 0x82,
  'cartao-encontrado': 0x83,
  pacote: 0x84,
  'em-dia': 0x85,
  'caixa-substituida': 0x86,
} as const satisfies Record<MensagemDoRelay['tipo'], number>;

/** Maior pedido possível, em bytes: o relay recusa qualquer mensagem maior antes de ler. */
export const TAMANHO_MAXIMO_DO_PEDIDO = Math.max(
  1 + 4 + TAMANHO_MAXIMO_DA_PUBLICACAO,
  1 + 4 + BYTES_DA_CHAVE + TAMANHO_DO_PACOTE + BYTES_DA_MARCA,
  1 + 4 + 1 + JANELA_DE_ENTREGA * BYTES_DO_ID_DO_PACOTE,
);

/** Maior mensagem possível do relay, em bytes. */
export const TAMANHO_MAXIMO_DA_MENSAGEM_DO_RELAY = Math.max(
  1 + 4 + TAMANHO_MAXIMO_DO_CARTAO + 1 + 4 + BYTES_DA_CHAVE,
  1 + BYTES_DO_ID_DO_PACOTE + TAMANHO_DO_PACOTE + BYTES_DA_MARCA,
);

/** O ID de um pacote: pacote igual tem ID igual, e um reenvio idêntico não duplica no relay. */
export function idDoPacote(hash: Hash, pacote: Uint8Array): Uint8Array {
  return hash.crypto_generichash(BYTES_DO_ID_DO_PACOTE, pacote, null);
}

/** Os bytes que o dono assina com a chave da caixa para abri-la. */
export function mensagemDaAbertura(desafio: Uint8Array, caixa: Uint8Array): Uint8Array {
  return juntar(CONTEXTOS.aberturaDeCaixa, desafio, caixa);
}

/** Confere a resposta ao desafio: a assinatura tem de ser da chave da própria caixa. */
export function aberturaAutentica(
  verificador: Verificador,
  desafio: Uint8Array,
  caixa: Uint8Array,
  assinatura: Uint8Array,
): boolean {
  return (
    desafio.length === BYTES_DO_DESAFIO &&
    caixa.length === BYTES_DA_CHAVE &&
    assinatura.length === BYTES_DA_ASSINATURA &&
    verificador.crypto_sign_verify_detached(assinatura, mensagemDaAbertura(desafio, caixa), caixa)
  );
}

/** Os bytes que o dono assina com a chave de identidade para apagar o cartão e a caixa. */
export function mensagemDoApagarTudo(desafio: Uint8Array, chave: Uint8Array): Uint8Array {
  return juntar(CONTEXTOS.apagarTudo, desafio, chave);
}

/** Confere o pedido de apagar tudo: a assinatura tem de ser da própria chave de identidade. */
export function apagarTudoAutentico(
  verificador: Verificador,
  desafio: Uint8Array,
  chave: Uint8Array,
  assinatura: Uint8Array,
): boolean {
  return (
    desafio.length === BYTES_DO_DESAFIO &&
    chave.length === BYTES_DA_CHAVE &&
    assinatura.length === BYTES_DA_ASSINATURA &&
    verificador.crypto_sign_verify_detached(assinatura, mensagemDoApagarTudo(desafio, chave), chave)
  );
}

function exigirTamanho(bytes: Uint8Array, tamanho: number): Uint8Array {
  if (bytes.length !== tamanho) throw new RangeError(`campo de ${tamanho} bytes`);
  return bytes;
}

function exigirIds(ids: readonly Uint8Array[]): readonly Uint8Array[] {
  if (ids.length < 1 || ids.length > JANELA_DE_ENTREGA) throw new RangeError('IDs por mensagem');
  for (const id of ids) exigirTamanho(id, BYTES_DO_ID_DO_PACOTE);
  return ids;
}

/** Monta um pedido do app. Campo fora do tamanho é erro de quem chama e lança. */
export function codificarPedido(pedido: PedidoAoRelay): Uint8Array {
  const escritor = new Escritor().uint8(TIPOS_DE_PEDIDO[pedido.tipo]).uint32(pedido.numero);
  switch (pedido.tipo) {
    case 'publicar-cartao':
      return escritor.bytes(pedido.publicacao.bytes).resultado();
    case 'buscar-cartao':
      return escritor.bytes(exigirTamanho(pedido.id, BYTES_DO_ID)).resultado();
    case 'criar-caixa':
      return escritor.bytes(exigirTamanho(pedido.caixa, BYTES_DA_CHAVE)).resultado();
    case 'depositar':
      return escritor
        .bytes(exigirTamanho(pedido.caixa, BYTES_DA_CHAVE))
        .bytes(exigirTamanho(pedido.pacote, TAMANHO_DO_PACOTE))
        .bytes(exigirTamanho(pedido.marca, BYTES_DA_MARCA))
        .resultado();
    case 'abrir-caixa':
      return escritor
        .bytes(exigirTamanho(pedido.caixa, BYTES_DA_CHAVE))
        .bytes(exigirTamanho(pedido.assinatura, BYTES_DA_ASSINATURA))
        .resultado();
    case 'confirmar': {
      const ids = exigirIds(pedido.ids);
      escritor.uint8(ids.length);
      for (const id of ids) escritor.bytes(id);
      return escritor.resultado();
    }
    case 'apagar-tudo':
      return escritor
        .bytes(exigirTamanho(pedido.chave, BYTES_DA_CHAVE))
        .bytes(exigirTamanho(pedido.assinatura, BYTES_DA_ASSINATURA))
        .resultado();
  }
}

function lerIds(leitor: Leitor): Uint8Array[] {
  const quantidade = leitor.uint8();
  if (quantidade < 1 || quantidade > JANELA_DE_ENTREGA) throw new ErroDeFormato('IDs');
  const ids: Uint8Array[] = [];
  for (let i = 0; i < quantidade; i++) {
    const id = leitor.bytes(BYTES_DO_ID_DO_PACOTE);
    if (ids.some((outro) => iguais(outro, id))) throw new ErroDeFormato('ID repetido');
    ids.push(id);
  }
  return ids;
}

function lerCorpoDoPedido(tipo: number, numero: number, leitor: Leitor): PedidoAoRelay {
  switch (tipo) {
    case TIPOS_DE_PEDIDO['publicar-cartao']:
      return { tipo: 'publicar-cartao', numero, publicacao: lerPublicacaoDe(leitor) };
    case TIPOS_DE_PEDIDO['buscar-cartao']:
      return { tipo: 'buscar-cartao', numero, id: leitor.bytes(BYTES_DO_ID) };
    case TIPOS_DE_PEDIDO['criar-caixa']:
      return { tipo: 'criar-caixa', numero, caixa: leitor.bytes(BYTES_DA_CHAVE) };
    case TIPOS_DE_PEDIDO.depositar:
      return {
        tipo: 'depositar',
        numero,
        caixa: leitor.bytes(BYTES_DA_CHAVE),
        pacote: leitor.bytes(TAMANHO_DO_PACOTE),
        marca: leitor.bytes(BYTES_DA_MARCA),
      };
    case TIPOS_DE_PEDIDO['abrir-caixa']:
      return {
        tipo: 'abrir-caixa',
        numero,
        caixa: leitor.bytes(BYTES_DA_CHAVE),
        assinatura: leitor.bytes(BYTES_DA_ASSINATURA),
      };
    case TIPOS_DE_PEDIDO.confirmar:
      return { tipo: 'confirmar', numero, ids: lerIds(leitor) };
    case TIPOS_DE_PEDIDO['apagar-tudo']:
      return {
        tipo: 'apagar-tudo',
        numero,
        chave: leitor.bytes(BYTES_DA_CHAVE),
        assinatura: leitor.bytes(BYTES_DA_ASSINATURA),
      };
    default:
      throw new ErroDeFormato('tipo de pedido');
  }
}

export type LeituraDoPedido =
  | { readonly ok: true; readonly pedido: PedidoAoRelay }
  | {
      readonly ok: false;
      /** O número do pedido, quando deu para ler: o relay responde `formato-invalido` a ele. */
      readonly numero: number | null;
    };

/** Lê um pedido do app sem confiar em nada: tamanho exato, tipo conhecido, nada sobrando. */
export function lerPedido(bytes: Uint8Array): LeituraDoPedido {
  if (bytes.length > TAMANHO_MAXIMO_DO_PEDIDO) return { ok: false, numero: null };
  const leitor = new Leitor(bytes);
  let numero: number | null = null;
  try {
    const tipo = leitor.uint8();
    numero = leitor.uint32();
    const pedido = lerCorpoDoPedido(tipo, numero, leitor);
    leitor.fim();
    return { ok: true, pedido };
  } catch (erro) {
    if (erro instanceof ErroDeFormato) return { ok: false, numero };
    throw erro;
  }
}

/** Monta uma mensagem do relay. Campo fora do tamanho é erro de quem chama e lança. */
export function codificarMensagemDoRelay(mensagem: MensagemDoRelay): Uint8Array {
  const escritor = new Escritor().uint8(TIPOS_DE_MENSAGEM[mensagem.tipo]);
  switch (mensagem.tipo) {
    case 'ola':
      return escritor
        .uint8(mensagem.versao)
        .bytes(exigirTamanho(mensagem.desafio, BYTES_DO_DESAFIO))
        .resultado();
    case 'resposta':
      return escritor.uint32(mensagem.numero).uint8(CODIGOS.indexOf(mensagem.codigo)).resultado();
    case 'cartao-publicado':
      if (mensagem.prekeys > MAXIMO_DE_PREKEYS) throw new RangeError('prekeys demais');
      return escritor.uint32(mensagem.numero).uint8(mensagem.prekeys).resultado();
    case 'cartao-encontrado': {
      escritor.uint32(mensagem.numero).bytes(mensagem.cartao.bytes);
      const { prekey } = mensagem;
      if (!prekey) return escritor.uint8(0).resultado();
      return escritor
        .uint8(1)
        .uint32(prekey.numero)
        .bytes(exigirTamanho(prekey.chave, BYTES_DA_CHAVE))
        .resultado();
    }
    case 'pacote':
      return escritor
        .bytes(exigirTamanho(mensagem.id, BYTES_DO_ID_DO_PACOTE))
        .bytes(exigirTamanho(mensagem.pacote, TAMANHO_DO_PACOTE))
        .bytes(exigirTamanho(mensagem.marca, BYTES_DA_MARCA))
        .resultado();
    case 'em-dia':
    case 'caixa-substituida':
      return escritor.resultado();
  }
}

function lerCorpoDaMensagem(tipo: number, leitor: Leitor): MensagemDoRelay {
  switch (tipo) {
    case TIPOS_DE_MENSAGEM.ola:
      return { tipo: 'ola', versao: leitor.uint8(), desafio: leitor.bytes(BYTES_DO_DESAFIO) };
    case TIPOS_DE_MENSAGEM.resposta: {
      const numero = leitor.uint32();
      const codigo = CODIGOS[leitor.uint8()];
      if (!codigo) throw new ErroDeFormato('código de resposta');
      return { tipo: 'resposta', numero, codigo };
    }
    case TIPOS_DE_MENSAGEM['cartao-publicado']: {
      const numero = leitor.uint32();
      const prekeys = leitor.uint8();
      if (prekeys > MAXIMO_DE_PREKEYS) throw new ErroDeFormato('prekeys demais');
      return { tipo: 'cartao-publicado', numero, prekeys };
    }
    case TIPOS_DE_MENSAGEM['cartao-encontrado']: {
      const numero = leitor.uint32();
      const cartao = lerCartaoDe(leitor);
      const temPrekey = leitor.uint8();
      if (temPrekey > 1) throw new ErroDeFormato('prekey');
      const prekey =
        temPrekey === 1 ? { numero: leitor.uint32(), chave: leitor.bytes(BYTES_DA_CHAVE) } : null;
      return { tipo: 'cartao-encontrado', numero, cartao, prekey };
    }
    case TIPOS_DE_MENSAGEM.pacote:
      return {
        tipo: 'pacote',
        id: leitor.bytes(BYTES_DO_ID_DO_PACOTE),
        pacote: leitor.bytes(TAMANHO_DO_PACOTE),
        marca: leitor.bytes(BYTES_DA_MARCA),
      };
    case TIPOS_DE_MENSAGEM['em-dia']:
      return { tipo: 'em-dia' };
    case TIPOS_DE_MENSAGEM['caixa-substituida']:
      return { tipo: 'caixa-substituida' };
    default:
      throw new ErroDeFormato('tipo de mensagem');
  }
}

/** Lê uma mensagem do relay. Devolve `null` se o formato não bate: o app não confia no relay. */
export function lerMensagemDoRelay(bytes: Uint8Array): MensagemDoRelay | null {
  if (bytes.length > TAMANHO_MAXIMO_DA_MENSAGEM_DO_RELAY) return null;
  try {
    const leitor = new Leitor(bytes);
    const mensagem = lerCorpoDaMensagem(leitor.uint8(), leitor);
    leitor.fim();
    return mensagem;
  } catch (erro) {
    if (erro instanceof ErroDeFormato) return null;
    throw erro;
  }
}
