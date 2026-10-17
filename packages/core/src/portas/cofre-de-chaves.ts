// Porta dos segredos embrulhados pelo aparelho: Keystore no Android, Keychain no iOS e chave não
// extraível na web. Ler pode pedir biometria ou senha: é o desbloqueio do app que libera a
// chave mestra do banco (RNF-07).

/**
 * `chave-mestra`: 256 bits aleatórios que cifram o banco principal. O segredo do cofre das
 * conversas ocultas sai dela, no desbloqueio: não é um item à parte.
 * `chave-da-caixa`: abre a caixa principal no relay. O serviço de notificação precisa dela com o
 * app bloqueado, então ela fica fora do banco.
 * `preferencias`: o que vale com o app bloqueado, quando o banco está fechado (tema, idioma e
 * notificações). Não é segredo, mas assim nada disso fica num arquivo sem cifra.
 */
export type NomeDoSegredo = 'chave-mestra' | 'chave-da-caixa' | 'preferencias';

/**
 * `desbloqueio`: só sai depois da biometria ou da senha do aparelho (RF-40).
 * `aparelho`: sai sem pedir nada, mesmo com o app bloqueado. Continua presa ao Keystore/Keychain
 * deste aparelho, mas qualquer código rodando no app consegue ler.
 */
export type Protecao = 'desbloqueio' | 'aparelho';

/**
 * Por que a leitura de um segredo falhou.
 * - `cancelado`: a pessoa cancelou o pedido de biometria ou senha. Tentar de novo pode dar certo.
 * - `perdido`: o segredo continua guardado, mas o aparelho apagou ou invalidou a chave que o
 *   protegia (no Android, quando o bloqueio de tela é removido). Ele nunca mais abre.
 */
export type FalhaDoCofre = 'cancelado' | 'perdido';

export class ErroDoCofre extends Error {
  readonly falha: FalhaDoCofre;

  constructor(falha: FalhaDoCofre, opcoes?: ErrorOptions) {
    super(falha, opcoes);
    this.falha = falha;
  }
}

export interface CofreDeChaves {
  guardar(nome: NomeDoSegredo, segredo: Uint8Array, protecao: Protecao): Promise<void>;
  /**
   * Devolve `null` quando o segredo não existe. Com proteção `desbloqueio`, pede a biometria ou a
   * senha do aparelho. Rejeita com `ErroDoCofre` quando a pessoa cancela (`cancelado`) ou quando o
   * segredo não abre mais (`perdido`), sem pedir nada antes. Qualquer outro erro pode ser
   * passageiro.
   */
  ler(nome: NomeDoSegredo): Promise<Uint8Array | null>;
  destruir(nome: NomeDoSegredo): Promise<void>;
  /** Pânico: destrói todos os segredos (RF-48). */
  destruirTudo(): Promise<void>;
}
