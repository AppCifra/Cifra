// As preferências que valem com o app bloqueado, quando o banco está fechado: o tema (RF-39), o
// idioma (RF-49) e as notificações (RF-42). A tela de bloqueio já aparece no tema e no idioma
// escolhidos, e o aviso de mensagem nova funciona antes do desbloqueio. Ficam num item do Keystore
// com proteção `aparelho`: cifradas, lidas sem biometria, e nada disso num arquivo comum. O resto
// dos ajustes fica no banco cifrado. O Tor não é preferência: o app só conecta por ele (RF-44).
// Sem React Native: os testes rodam no Node.
import type { CofreDeChaves } from '@cifra/core';
import { IDIOMAS, type Idioma } from '@cifra/i18n';
import { deUtf8, utf8 } from '@cifra/protocol';

export type Tema = 'escuro' | 'claro';

export interface Preferencias {
  /** Escuro por padrão (RF-39). */
  readonly tema: Tema;
  /** `null`: o idioma do sistema, como na primeira abertura (RF-49). */
  readonly idioma: Idioma | null;
  /** Avisar de mensagem nova, sem remetente (RF-42). Ligadas por padrão. */
  readonly notificacoes: boolean;
  /** O pedido de permissão de notificações (Android 13+) já apareceu uma vez. */
  readonly avisosPedidos: boolean;
}

export const PREFERENCIAS_PADRAO: Preferencias = {
  tema: 'escuro',
  idioma: null,
  notificacoes: true,
  avisosPedidos: false,
};

const NOME = 'preferencias';

/** Lê o que está guardado. Campo que falta ou que não segue o formato fica no padrão. */
export function lerPreferencias(bytes: Uint8Array | null): Preferencias {
  const texto = bytes ? deUtf8(bytes) : null;
  let lido: unknown;
  try {
    lido = texto === null ? null : JSON.parse(texto);
  } catch {
    lido = null;
  }
  const campos = typeof lido === 'object' && lido !== null ? (lido as Record<string, unknown>) : {};
  const { tema, idioma, notificacoes, avisosPedidos } = campos;
  return {
    tema: tema === 'claro' || tema === 'escuro' ? tema : PREFERENCIAS_PADRAO.tema,
    idioma: (IDIOMAS as readonly unknown[]).includes(idioma) ? (idioma as Idioma) : null,
    notificacoes:
      typeof notificacoes === 'boolean' ? notificacoes : PREFERENCIAS_PADRAO.notificacoes,
    avisosPedidos: avisosPedidos === true,
  };
}

export function bytesDasPreferencias(preferencias: Preferencias): Uint8Array {
  const { tema, idioma, notificacoes, avisosPedidos } = preferencias;
  return utf8(JSON.stringify({ tema, idioma, notificacoes, avisosPedidos }));
}

export class PreferenciasDoApp {
  readonly #cofre: CofreDeChaves;
  #atual: Preferencias = PREFERENCIAS_PADRAO;
  readonly #ouvintes = new Set<() => void>();
  /** As gravações saem uma de cada vez, na ordem das mudanças. */
  #gravando: Promise<unknown> = Promise.resolve();

  constructor(cofre: CofreDeChaves) {
    this.#cofre = cofre;
  }

  get atual(): Preferencias {
    return this.#atual;
  }

  aoMudar = (ouvinte: () => void): (() => void) => {
    this.#ouvintes.add(ouvinte);
    return () => this.#ouvintes.delete(ouvinte);
  };

  /** Lê o que está guardado. Sem nada guardado, ou se o Keystore falhar, fica o padrão. */
  async carregar(): Promise<Preferencias> {
    let bytes: Uint8Array | null = null;
    try {
      bytes = await this.#cofre.ler(NOME);
    } catch {
      // Ilegível: segue o padrão. A próxima mudança grava por cima.
    }
    this.#trocar(lerPreferencias(bytes));
    return this.#atual;
  }

  /**
   * A tela muda na hora; a gravação vem depois. Rejeita se não conseguir gravar: a mudança vale
   * até o app fechar.
   */
  mudar(mudanca: Partial<Preferencias>): Promise<void> {
    this.#trocar({ ...this.#atual, ...mudanca });
    const bytes = bytesDasPreferencias(this.#atual);
    const gravacao = this.#gravando.then(() => this.#cofre.guardar(NOME, bytes, 'aparelho'));
    this.#gravando = gravacao.catch(() => undefined);
    return gravacao;
  }

  /**
   * Pânico (RF-48): volta aos padrões na hora, sem gravar nada. O item do Keystore já foi destruído:
   * o app abre como numa instalação nova.
   */
  esquecer(): void {
    this.#trocar(PREFERENCIAS_PADRAO);
  }

  #trocar(novas: Preferencias): void {
    const antes = this.#atual;
    this.#atual = novas;
    if (JSON.stringify(antes) === JSON.stringify(novas)) return;
    for (const ouvinte of [...this.#ouvintes]) ouvinte();
  }
}
