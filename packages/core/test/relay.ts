// O relay de verdade (apps/relay) no mesmo processo, só nos testes: o núcleo conversa com ele como
// o app conversa com o relay oficial. Cai e volta na mesma porta e com o mesmo banco, e usa o mesmo
// relógio do teste para prazos e taxas.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { abrirBanco, type Banco } from '../../../apps/relay/src/banco.ts';
import { criarRelay, type LimitesDoRelay, type Relay } from '../../../apps/relay/src/relay.ts';
import { libsodium } from '../../../apps/relay/src/sodium.ts';
import type { Relogio } from '../src/index.ts';

/** Uma taxa que nenhum teste alcança. */
export const LIVRE = { rajada: 10_000, porMinuto: 10_000 };

/** Para os testes que não são de taxa: nenhum pedido esbarra no limite. */
export const TAXAS_LIVRES: Partial<LimitesDoRelay> = {
  taxas: {
    depositar: LIVRE,
    buscarCartao: LIVRE,
    publicarCartao: LIVRE,
    criarCaixa: LIVRE,
    apagarTudo: LIVRE,
    mensagens: LIVRE,
  },
};

export class RelayDeTeste {
  readonly #pasta: string;
  readonly #caminho: string;
  readonly #relogio: Relogio;
  readonly #limites: Partial<LimitesDoRelay>;
  #porta = 0;
  #banco: Banco | null = null;
  #relay: Relay | null = null;

  private constructor(relogio: Relogio, limites: Partial<LimitesDoRelay>) {
    this.#pasta = mkdtempSync(join(tmpdir(), 'cifra-relay-'));
    this.#caminho = join(this.#pasta, 'relay.sqlite');
    this.#relogio = relogio;
    this.#limites = limites;
  }

  static async subir(
    relogio: Relogio,
    limites: Partial<LimitesDoRelay> = TAXAS_LIVRES,
  ): Promise<RelayDeTeste> {
    const relay = new RelayDeTeste(relogio, limites);
    await relay.voltar();
    return relay;
  }

  get endereco(): string {
    return `ws://127.0.0.1:${String(this.#porta)}`;
  }

  /** Sobe o relay na mesma porta, com o mesmo banco. */
  async voltar(): Promise<void> {
    if (this.#relay) return;
    const banco = abrirBanco(this.#caminho);
    const relay = criarRelay({
      banco,
      sodium: libsodium,
      agora: () => this.#relogio.agora(),
      limites: this.#limites,
    });
    await new Promise<void>((pronto) => relay.servidor.listen(this.#porta, '127.0.0.1', pronto));
    this.#porta = (relay.servidor.address() as AddressInfo).port;
    this.#banco = banco;
    this.#relay = relay;
  }

  /** Derruba o relay: todas as conexões caem e ninguém conecta até ele voltar. */
  async derrubar(): Promise<void> {
    await this.#relay?.fechar();
    this.#banco?.fechar();
    this.#relay = null;
    this.#banco = null;
  }

  /** Consulta o banco do relay por fora, numa conexão só de leitura. */
  consultar(sql: string, ...parametros: (number | Uint8Array)[]): Record<string, unknown>[] {
    const leitura = new DatabaseSync(this.#caminho, { readOnly: true });
    try {
      return leitura.prepare(sql).all(...parametros);
    } finally {
      leitura.close();
    }
  }

  /** Muda o banco por fora, como um operador que adultera o relay. */
  adulterar(sql: string, ...parametros: (number | Uint8Array)[]): void {
    const escrita = new DatabaseSync(this.#caminho);
    try {
      escrita.prepare(sql).run(...parametros);
    } finally {
      escrita.close();
    }
  }

  /** Os bytes do arquivo do banco, como a perícia veria. */
  bytesDoBanco(): Buffer {
    return readFileSync(this.#caminho);
  }

  async fechar(): Promise<void> {
    await this.derrubar();
    rmSync(this.#pasta, { recursive: true, force: true });
  }
}
