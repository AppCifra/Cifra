// Notificações cegas (RF-42), sem React: quando ligar o serviço que mantém o app vivo fora da
// frente, quando avisar "nova mensagem" e quando tirar o aviso. O aviso não diz quem escreveu nem o
// quê. Com o app aberto fora da frente, ele sai do correio, que já decifrou e sabe que é mensagem;
// com o app bloqueado, sai do vigia, pela marca de aviso. Os testes rodam no Node.
import type { Traduzir } from './i18n.ts';

export interface TextosDosAvisos {
  readonly canalDeMensagens: string;
  readonly canalDoServico: string;
  readonly servico: string;
  readonly novaMensagem: string;
}

/** O que a plataforma faz (no Android, o módulo nativo e o pedido de permissão do sistema). */
export interface PlataformaDosAvisos {
  /** Liga o serviço em primeiro plano. Só funciona com o app na frente. */
  ligar(textos: TextosDosAvisos): Promise<void>;
  desligar(): Promise<void>;
  avisar(textos: TextosDosAvisos): Promise<void>;
  limpar(): Promise<void>;
  /** Pede a permissão de notificações (Android 13+); devolve se ficou permitida. */
  pedirPermissao(): Promise<boolean>;
}

export function textosDosAvisos(t: Traduzir): TextosDosAvisos {
  return {
    canalDeMensagens: t('avisos.canalDeMensagens'),
    canalDoServico: t('avisos.canalDoServico'),
    servico: t('avisos.servico'),
    novaMensagem: t('avisos.novaMensagem'),
  };
}

export interface SituacaoDosAvisos {
  /** O app está na frente. */
  readonly naFrente: boolean;
  /** Há identidade neste aparelho (aberta ou bloqueada). */
  readonly temIdentidade: boolean;
  /** O ajuste das notificações. */
  readonly ligadas: boolean;
}

export class AvisosDoApp {
  readonly #plataforma: PlataformaDosAvisos;
  readonly #t: Traduzir;
  #ligado = false;

  constructor(plataforma: PlataformaDosAvisos, t: Traduzir) {
    this.#plataforma = plataforma;
    this.#t = t;
  }

  /**
   * Liga o serviço quando dá (app na frente, identidade e o ajuste ligado) e desliga quando não deve
   * mais rodar. Fora da frente, o que já estava ligado continua.
   */
  async sincronizar({ naFrente, temIdentidade, ligadas }: SituacaoDosAvisos): Promise<void> {
    if (!temIdentidade || !ligadas) {
      if (!this.#ligado) return;
      this.#ligado = false;
      await this.#plataforma.desligar().catch(() => undefined);
      return;
    }
    if (!naFrente) return;
    // Ligar de novo só troca o texto (o idioma pode ter mudado). Um pedido que falha pode ter
    // ligado o serviço mesmo assim: o desligar continua valendo.
    this.#ligado = true;
    await this.#plataforma.ligar(textosDosAvisos(this.#t)).catch(() => undefined);
  }

  /** "Nova mensagem", sem remetente nem conteúdo. */
  async novaMensagem(): Promise<void> {
    await this.#plataforma.avisar(textosDosAvisos(this.#t)).catch(() => undefined);
  }

  /** A pessoa abriu o app: o aviso de mensagem nova sai. */
  async limpar(): Promise<void> {
    await this.#plataforma.limpar().catch(() => undefined);
  }

  /** Pede a permissão ao ligar o ajuste; devolve se ficou permitida. */
  pedirPermissao(): Promise<boolean> {
    return this.#plataforma.pedirPermissao().catch(() => false);
  }
}
