// O núcleo só conversa com a plataforma por estas portas. Cada plataforma entrega os adaptadores.
export type {
  Armazenamento,
  LinhaSql,
  ResultadoDaExecucao,
  ValorSql,
} from './portas/armazenamento.ts';
export {
  ErroDoCofre,
  type CofreDeChaves,
  type FalhaDoCofre,
  type NomeDoSegredo,
  type Protecao,
} from './portas/cofre-de-chaves.ts';
export type { Cripto, EstadoDoFluxo, ParDeChaves, PedacoDoFluxo } from './portas/cripto.ts';
export type { Relogio } from './portas/relogio.ts';
export type {
  Conexao,
  MetodoHttp,
  PedidoHttp,
  RespostaHttp,
  Transporte,
} from './portas/transporte.ts';

// Verificações que todo adaptador de plataforma precisa passar antes de entrar (RNF-15).
export { verificarArmazenamento } from './conformidade/armazenamento.ts';
export { verificarCripto } from './conformidade/cripto.ts';
export { verificarRelogio } from './conformidade/relogio.ts';
export { verificarTransporte } from './conformidade/transporte.ts';
export { verificarCofre, type ArquivoDoCofre, type CofreAberto } from './conformidade/cofre.ts';
export type { ResultadoDaVerificacao } from './conformidade/resultado.ts';

// Vetores do X3DH, do Double Ratchet e do número de segurança, os mesmos no Node e no aparelho
// (RNF-02, RF-37).
export { verificarProtocolo } from './conformidade/protocolo.ts';

// Sessão e mensagens: cartão no relay, X3DH, Double Ratchet, envelope selado e fila de saída
// (RF-04, RF-13 a RF-16); um aparelho por ID (RF-05).
export {
  CIRCUITO_DA_CAIXA,
  CIRCUITO_DOS_ANEXOS,
  Correio,
  PREFIXO_DO_COFRE,
  ErroDoCorreio,
  type OpcoesDoEnvio,
  type CodigoDoCorreio,
  type EventoDoCorreio,
  type OpcoesDoCorreio,
} from './correio.ts';
export type { Mensagem, StatusDaMensagem, TipoDaMensagem } from './mensagens/repositorio.ts';

// O vigia do app bloqueado: só com a chave da caixa, avisa de mensagem nova sem abrir nada
// (RF-42). A marca de aviso diz, sem abrir o pacote, se ele é mensagem.
export { Vigia, type OpcoesDoVigia } from './vigia.ts';
export { marcaAvisa, selarMarca } from './relay/marca.ts';

// Anexos: cifra do arquivo, o que o balão mostra e o que abre na memória (RF-32 a RF-36).
export {
  anexoConfere,
  cifrarAnexo,
  decifrarAnexo,
  prepararAnexo,
  type AnexoCifrado,
  type AnexoPreparado,
  type ArquivoParaEnviar,
} from './anexos/cifra.ts';
export type { EstadoDoAnexo } from './anexos/repositorio.ts';
export { legendaAceita, textoAceito } from './mensagens/repositorio.ts';

// Temporárias e apagar pra todos: o prazo de cada mensagem, a limpeza do que vence, as notas de
// sistema da conversa e o desfazer do "apagar só neste celular" (RF-25 a RF-31, RF-50).
export {
  PRAZO_DO_DESFAZER,
  Temporarias,
  ttlAceito,
  type OpcoesDasTemporarias,
} from './mensagens/temporarias.ts';
export type { Citacao, ItemDaConversa, NotaDeSistema, ResumoDoAnexo } from './mensagens/notas.ts';
export {
  PRAZOS_DO_BLOQUEIO,
  type AjustesDePrivacidade,
  type AjustesDoTimer,
  type LinhaDosAjustes,
} from './ajustes/repositorio.ts';

// Contatos: lista de conversas, pedidos, bloqueio, apelido, nota pessoal, busca e número de
// segurança (RF-06 a RF-12, RF-19, RF-37, RF-38). A agenda divide com o correio o acesso ao banco.
export { criarExclusivo, type Exclusivo } from './banco/exclusivo.ts';
export {
  Agenda,
  ErroDaAgenda,
  LIMITE_DO_ENCAMINHAR,
  type AnexoAberto,
  lerApelido,
  type ParaEncaminhar,
  type CodigoDaAgenda,
  type OpcoesDaAgenda,
  type ResultadoDaBusca,
  type ResumoDaConversa,
  type TipoDaConversa,
} from './contatos/agenda.ts';
export {
  compararNumero,
  GRUPOS_DO_NUMERO,
  ITERACOES_DO_NUMERO,
  numeroDeSeguranca,
  type ComparacaoDoNumero,
} from './contatos/numero-de-seguranca.ts';
export { LIMITE_DO_APELIDO } from './contatos/repositorio.ts';

// Identidade: palavras, chaves, ID e identicon (RF-01 a RF-03).
export {
  BYTES_DA_SEMENTE,
  gerarIdentidade,
  idDaChavePublica,
  identidadeDaEntropia,
  identidadeDaSemente,
  restaurarIdentidade,
  type Identidade,
  type IdentidadeNova,
  type Restauracao,
} from './identidade/identidade.ts';
export {
  BYTES_DA_ENTROPIA,
  LISTAS,
  QUANTIDADE_DE_PALAVRAS,
  lerPalavras,
  palavrasDaEntropia,
  separarPalavras,
  type IdiomaDasPalavras,
  type LeituraDasPalavras,
  type ProblemaNasPalavras,
} from './identidade/palavras.ts';
export { celulasDoIdenticon, type Celula, type Grade } from './identidade/identicon.ts';
export { carregarIdentidade, guardarIdentidade } from './identidade/repositorio.ts';

// Banco principal: esquema versionado, conferência do que a exclusão real exige, busca local e
// exclusão real (RNF-08, RF-12).
export { migrar, VERSAO_DO_ESQUEMA } from './banco/migracoes.ts';
export { encolherBanco, prepararBanco, prepararCofre } from './banco/preparo.ts';
export { buscarMensagens, LIMITE_DA_BUSCA } from './mensagens/busca.ts';
export { apagarDeVerdade, type AlvoDaExclusao } from './mensagens/exclusao.ts';
// A verificação técnica grava mensagens direto no banco para conferir a exclusão no aparelho.
export { guardarMensagem } from './mensagens/repositorio.ts';

// Conversas ocultas: o cofre, aberto pelo código secreto digitado na busca, com as conversas que
// somem do principal, e o arquivo dele, que cresce em blocos (RF-20 a RF-24, RNF-11).
export {
  Cofre,
  ErroDasOcultas,
  type CodigoDasOcultas,
  type OpcoesDoCofre,
  type Principal,
} from './ocultas/cofre.ts';
export {
  BYTES_DA_CHAVE_DO_COFRE,
  chaveDoCofre,
  codigoAceito,
  MAXIMO_DO_CODIGO,
  MINIMO_DO_CODIGO,
  normalizarCodigo,
  segredoDoCofre,
} from './ocultas/codigo.ts';
export { BLOCO_DO_COFRE, cofreEmBlocos, completarBloco, tamanhoDoBanco } from './ocultas/blocos.ts';

// Backup e pânico: o arquivo com os contatos e os ajustes, que só abre com as 12 palavras (RF-46,
// RF-47), e o pedido ao relay para apagar o cartão e a caixa principal (RF-48).
export {
  abrirBackup,
  cifrarBackup,
  conteudoDoBackup,
  exportarBackup,
  importarBackup,
  TAMANHO_MAXIMO_DO_BACKUP,
  type ConteudoDoBackup,
  type ContatoDoBackup,
  type IdiomaDoBackup,
  type PreferenciasDoBackup,
  type TemaDoBackup,
} from './backup/backup.ts';
export { apagarTudoNoRelay, TENTATIVAS_DO_APAGAR, type OpcoesDoApagar } from './relay/apagar.ts';
