export { BYTES_DO_ID, formatarId, idDaChave, lerId } from './id.ts';
export {
  ANEXOS_SUBINDO,
  BITS_DO_ID,
  CARACTERES_DO_ID,
  CONEXOES_SIMULTANEAS,
  ESPACO_DOS_ANEXOS_EM_MB,
  INTERVALO_DO_PING_EM_SEGUNDOS,
  JANELA_DE_ENTREGA,
  LIMITE_DO_TEXTO,
  MAXIMO_DE_PREKEYS,
  MAXIMO_DE_RELAYS,
  OCIOSIDADE_EM_SEGUNDOS,
  PACOTES_POR_CAIXA,
  PARADA_DO_ANEXO_EM_SEGUNDOS,
  PINGS_SEM_RESPOSTA,
  RETENCAO_DA_CAIXA_EM_DIAS,
  RETENCAO_DO_ANEXO_EM_DIAS,
  RETENCAO_DO_CARTAO_EM_DIAS,
  RETENCAO_DO_PACOTE_EM_DIAS,
  SAIDA_POR_CONEXAO,
  TAMANHO_DO_PACOTE,
  TAXAS,
  TIMER_MAXIMO_EM_SEGUNDOS,
  TIMER_MINIMO_EM_SEGUNDOS,
  TOLERANCIA_DO_RELOGIO_EM_HORAS,
  TRANSFERENCIAS_DE_ANEXOS,
  VERSAO_DO_CARTAO,
  VERSAO_DO_PROTOCOLO,
  type Taxa,
} from './limites.ts';
export type { Assinar, Hash, Verificador } from './verificador.ts';
export { ErroDeFormato, Escritor, iguais, juntar, Leitor } from './bytes.ts';
export { CONTEXTOS, CONTEXTOS_DE_DERIVACAO } from './contextos.ts';
export { enderecoDeRelayValido, LIMITE_DO_ENDERECO } from './endereco.ts';
export { deUtf8, utf8 } from './utf8.ts';

// Cartão de identidade e publicação no relay (RF-04, RF-06).
export {
  BYTES_DA_ASSINATURA,
  BYTES_DA_CHAVE,
  cartaoAutentico,
  criarCartao,
  criarPublicacao,
  idDoCartao,
  lerCartao,
  lerPublicacao,
  mensagemDaPrekeyAssinada,
  publicacaoAutentica,
  TAMANHO_MAXIMO_DA_PUBLICACAO,
  TAMANHO_MAXIMO_DO_CARTAO,
  type Cartao,
  type DadosDoCartao,
  type ModoDaPublicacao,
  type Prekey,
  type PrekeyAssinada,
  type Publicacao,
} from './cartao.ts';

// Mensagens entre app e relay (RNF-04, RNF-13).
export {
  aberturaAutentica,
  apagarTudoAutentico,
  BYTES_DA_MARCA,
  BYTES_DO_DESAFIO,
  BYTES_DO_ID_DO_PACOTE,
  CODIGOS,
  codificarMensagemDoRelay,
  codificarPedido,
  FECHAMENTOS,
  idDoPacote,
  lerMensagemDoRelay,
  lerPedido,
  mensagemDaAbertura,
  mensagemDoApagarTudo,
  TAMANHO_MAXIMO_DA_MENSAGEM_DO_RELAY,
  TAMANHO_MAXIMO_DO_PEDIDO,
  type CodigoDeResposta,
  type LeituraDoPedido,
  type MensagemDoRelay,
  type PedidoAoRelay,
} from './relay.ts';

// Mensagens entre apps, dentro do pacote selado (RF-13, RNF-04), com os controles de apagar pra
// todos e do timer da conversa (RF-25, RF-30).
export {
  BYTES_DA_ETIQUETA,
  BYTES_DO_CABECALHO_DA_CATRACA,
  BYTES_DO_INTERIOR,
  BYTES_DO_SELO,
  capacidadeDoConteudo,
  codificarCabecalho,
  codificarInterior,
  lerInterior,
  VERSAO_DO_ENVELOPE,
  type AberturaDaSessao,
  type CabecalhoDaCatraca,
  type Interior,
  type TipoDeEnvelope,
} from './envelope.ts';
export {
  anexoValido,
  BYTES_DO_ID_DA_MENSAGEM,
  CABECALHO_DO_CONTEUDO,
  codificarConteudo,
  formatoValido,
  lerConteudo,
  LIMITE_DA_CAPA,
  LIMITE_DA_LEGENDA,
  LIMITE_DA_MINIATURA,
  LIMITE_DO_FORMATO,
  MAXIMO_DE_APAGADAS,
  MAXIMO_DE_LIDAS,
  timerValido,
  type Conteudo,
  type DadosDoAnexo,
  type TipoDeArquivo,
} from './conteudo.ts';

// Anexos: o blob no relay, as faixas de tamanho e o endereço HTTP (RF-32 a RF-35).
export {
  BYTES_A_MAIS_POR_PEDACO,
  BYTES_DA_CHAVE_DO_ANEXO,
  BYTES_DO_CABECALHO_DO_FLUXO,
  BYTES_DO_HASH_DO_ANEXO,
  BYTES_DO_PEDACO,
  BYTES_DO_TOKEN,
  caminhoDoAnexo,
  enderecoDoAnexo,
  lerCaminhoDoAnexo,
  padme,
  pedacosDoClaro,
  TAMANHO_MAXIMO_DO_ANEXO,
  TAMANHO_MAXIMO_DO_CLARO,
  TAMANHO_MINIMO_DO_ANEXO,
  tamanhoCifrado,
  tamanhoDeAnexoValido,
  tamanhoDoAnexo,
} from './anexo.ts';
