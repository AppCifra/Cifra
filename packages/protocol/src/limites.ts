// Valores iniciais do SPEC (seções "Envelope, padding e remetente oculto" e "Limites e retenção").
// Ainda são decisão pendente: mudar um valor aqui exige atualizar docs/SPEC.md no mesmo commit.

/** Todo pacote de mensagem tem exatamente este tamanho, em bytes (RNF-04). */
export const TAMANHO_DO_PACOTE = 4096;

/** Limite do texto de uma mensagem, em bytes UTF-8. */
export const LIMITE_DO_TEXTO = 3500;

/**
 * O menor timer das mensagens temporárias: o da conversa, o padrão das conversas novas e o de cada
 * mensagem. Zero é sem timer.
 */
export const TIMER_MINIMO_EM_SEGUNDOS = 10;

/** O maior timer das mensagens temporárias: 7 dias. */
export const TIMER_MAXIMO_EM_SEGUNDOS = 604_800;

/** Pacote não entregue é apagado do relay depois deste prazo (RNF-14). */
export const RETENCAO_DO_PACOTE_EM_DIAS = 14;

/** Anexo não baixado é apagado do relay depois deste prazo. */
export const RETENCAO_DO_ANEXO_EM_DIAS = 14;

/** Anexos subindo ao mesmo tempo no relay. Acima disso, o relay recusa e o app tenta depois. */
export const ANEXOS_SUBINDO = 16;

/** Transferências de anexo (subindo, descendo ou apagando) ao mesmo tempo no relay. */
export const TRANSFERENCIAS_DE_ANEXOS = 64;

/** Espaço dos anexos no relay, em MB (padrão; quem opera o relay ajusta). Cheio, recusa os novos. */
export const ESPACO_DOS_ANEXOS_EM_MB = 4096;

/** Transferência de anexo que fica este tempo sem receber nada cai. */
export const PARADA_DO_ANEXO_EM_SEGUNDOS = 60;

/** Cartão sem renovação é apagado do relay depois deste prazo. */
export const RETENCAO_DO_CARTAO_EM_DIAS = 90;

/** Caixa que ninguém abre neste prazo é apagada do relay, com o que houver nela. */
export const RETENCAO_DA_CAIXA_EM_DIAS = 90;

/** O ID são os primeiros 80 bits do BLAKE2b da chave pública. */
export const BITS_DO_ID = 80;

/** Em base32 Crockford (5 bits por caractere), o ID tem 16 caracteres: XXXX-XXXX-XXXX-XXXX. */
export const CARACTERES_DO_ID = 16;

/** Versão do protocolo entre app e relay, que o relay anuncia ao conectar. */
export const VERSAO_DO_PROTOCOLO = 1;

/** Versão do formato do cartão de identidade. */
export const VERSAO_DO_CARTAO = 1;

/** One-time prekeys guardadas por ID no relay. Também é o máximo de uma publicação. */
export const MAXIMO_DE_PREKEYS = 100;

/** Relays num cartão. O MVP usa um; a fase 2, de dois a três. */
export const MAXIMO_DE_RELAYS = 3;

/** A data do cartão pode estar até este tanto à frente do relógio do relay. */
export const TOLERANCIA_DO_RELOGIO_EM_HORAS = 24;

/** Pacotes à espera numa caixa. Acima disso o relay recusa o depósito, e o remetente tenta depois. */
export const PACOTES_POR_CAIXA = 1000;

/**
 * Pacotes entregues e ainda sem confirmação, por conexão. Também é o máximo de IDs numa mensagem
 * `confirmar`: uma janela inteira se confirma de uma vez.
 */
export const JANELA_DE_ENTREGA = 100;

/** Conexões abertas ao mesmo tempo no relay. */
export const CONEXOES_SIMULTANEAS = 1000;

/**
 * Bytes que o relay deixa esperando para sair numa conexão. Acima disso, quem não lê o que o relay
 * manda perde a conexão: a saída dela não fica na memória do relay.
 */
export const SAIDA_POR_CONEXAO = 1024 * 1024;

/** Conexão sem caixa aberta e sem mensagem neste prazo é fechada. */
export const OCIOSIDADE_EM_SEGUNDOS = 300;

/** Intervalo do ping do relay. */
export const INTERVALO_DO_PING_EM_SEGUNDOS = 30;

/**
 * Conexão que deixa este tanto de pings seguidos sem resposta, nem mensagem nenhuma, é derrubada.
 * Pelo Tor, uma ida e volta passa de 30 s nos piores momentos.
 */
export const PINGS_SEM_RESPOSTA = 2;

/** Taxa de um tipo de pedido, por conexão: `rajada` de uma vez, depois `porMinuto`. */
export interface Taxa {
  readonly rajada: number;
  readonly porMinuto: number;
}

/**
 * Pedidos por conexão. Pedido acima da taxa recebe `taxa-excedida` e não é atendido. Acima da taxa
 * de `mensagens`, que conta qualquer mensagem, a conexão é fechada.
 */
export const TAXAS = {
  depositar: { rajada: 20, porMinuto: 60 },
  buscarCartao: { rajada: 10, porMinuto: 10 },
  publicarCartao: { rajada: 3, porMinuto: 1 },
  criarCaixa: { rajada: 3, porMinuto: 1 },
  /** O pânico: cada pedido confere uma assinatura. */
  apagarTudo: { rajada: 3, porMinuto: 1 },
  mensagens: { rajada: 100, porMinuto: 1200 },
} as const satisfies Readonly<Record<string, Taxa>>;
