// O vigia do app bloqueado (RF-42): com a identidade fechada, ele abre a caixa principal só com a
// chave da caixa, que o aparelho entrega sem biometria, e avisa quando chega uma mensagem. Não abre
// pacote nenhum, então nunca sabe quem escreveu nem o que veio: o aviso é cego. A marca de aviso
// (relay/marca.ts) diz, sem abrir o pacote, se é mensagem; confirmação de leitura, "digitando" e
// controles não avisam.
//
// O vigia nunca confirma: ele vigia a caixa, e o relay manda só a marca de cada pacote, sem o
// pacote e sem a janela de entrega; tudo fica guardado até o app desbloquear, e aí o correio recebe,
// decifra e confirma. Cada pacote avisa uma vez, mesmo que o relay mande a marca de novo depois de
// uma reconexão. Quem abre a caixa por último fica com ela (o relay fecha a conexão anterior): o app
// para o vigia antes de o correio abrir a caixa, e o vigia parado não reabre sozinho.
import { mensagemDaAbertura, paraHex } from '@cifra/protocol';
import { intervaloDeReenvio } from './mensagens/fila.ts';
import type { Cripto } from './portas/cripto.ts';
import type { Relogio } from './portas/relogio.ts';
import type { Transporte } from './portas/transporte.ts';
import { ConexaoComORelay, type Aviso, type Resposta } from './relay/conexao.ts';
import { marcaAvisa } from './relay/marca.ts';

/** O circuito do vigia: o mesmo nome do da caixa no correio, que nunca roda junto com ele. */
const CIRCUITO_DO_VIGIA = 'caixa';

export interface OpcoesDoVigia {
  readonly cripto: Cripto;
  readonly transporte: Transporte;
  readonly relogio: Relogio;
  /** O endereço do relay da caixa. */
  readonly relay: string;
  /**
   * A semente (32 bytes) do par Ed25519 da caixa principal. Continua de quem chama, que a zera
   * depois de parar o vigia.
   */
  readonly sementeDaCaixa: Uint8Array;
}

function codigoDe(resposta: Resposta): string {
  return resposta.tipo === 'resposta' ? resposta.codigo : resposta.tipo;
}

export class Vigia {
  readonly #o: OpcoesDoVigia;
  readonly #caixa: Uint8Array;
  #parado = true;
  /** A caixa sumiu ou foi trocada (outro aparelho): o vigia não tenta mais. */
  #semCaixa = false;
  #conexao: ConexaoComORelay | null = null;
  #abrindo: Promise<void> | null = null;
  #tentativas = 0;
  #cancelarReconexao: (() => void) | null = null;
  /** Os pacotes que já avisaram (ID do relay em hex). */
  readonly #vistos = new Set<string>();
  readonly #ouvintes = new Set<() => void>();

  constructor(opcoes: OpcoesDoVigia) {
    this.#o = opcoes;
    const par = opcoes.cripto.crypto_sign_seed_keypair(opcoes.sementeDaCaixa);
    opcoes.cripto.memzero(par.privateKey);
    this.#caixa = par.publicKey;
  }

  /** A caixa está aberta numa conexão deste vigia agora. */
  get aberta(): boolean {
    return this.#conexao !== null;
  }

  /** Avisa a cada mensagem nova que chega à caixa. Devolve a função que cancela. */
  aoChegar(ouvinte: () => void): () => void {
    this.#ouvintes.add(ouvinte);
    return () => this.#ouvintes.delete(ouvinte);
  }

  /** Abre a caixa e fica ouvindo. Reconecta sozinho quando a conexão cai. */
  iniciar(): void {
    if (!this.#parado || this.#semCaixa) return;
    this.#parado = false;
    this.#conectar();
  }

  /** Fecha a conexão e espera o que estava abrindo terminar: depois disso, a caixa está livre. */
  async parar(): Promise<void> {
    this.#parado = true;
    this.#cancelarReconexao?.();
    this.#cancelarReconexao = null;
    await this.#abrindo;
    const conexao = this.#conexao;
    this.#conexao = null;
    await conexao?.fechar();
  }

  // Lidos por método: entre um await e outro eles mudam, e o TypeScript não sabe disso.
  #estaParado(): boolean {
    return this.#parado;
  }

  #conectar(): void {
    if (this.#parado || this.#semCaixa || this.#conexao || this.#abrindo) return;
    this.#abrindo = this.#abrir().finally(() => {
      this.#abrindo = null;
    });
  }

  async #abrir(): Promise<void> {
    const { transporte, relay, relogio, cripto, sementeDaCaixa } = this.#o;
    let conexao: ConexaoComORelay | null = null;
    try {
      conexao = await ConexaoComORelay.abrir(transporte, relay, CIRCUITO_DO_VIGIA, relogio);
      const aberta = conexao;
      aberta.aoAvisar((aviso) => {
        this.#aoAvisar(aviso);
      });
      aberta.aoFechar(() => {
        this.#aoCair(aberta);
      });
      if (this.#estaParado()) throw new Error('parado');
      const par = cripto.crypto_sign_seed_keypair(sementeDaCaixa);
      let assinatura: Uint8Array;
      try {
        assinatura = cripto.crypto_sign_detached(
          mensagemDaAbertura(aberta.desafio, this.#caixa),
          par.privateKey,
        );
      } finally {
        cripto.memzero(par.privateKey);
      }
      const resposta = await aberta.pedir({ tipo: 'vigiar-caixa', caixa: this.#caixa, assinatura });
      if (codigoDe(resposta) === 'caixa-inexistente') {
        // A caixa sumiu: outro aparelho restaurou a identidade (RF-05). O correio descobre no
        // desbloqueio; o vigia não cria caixa nem tenta de novo.
        this.#semCaixa = true;
        throw new Error('sem caixa');
      }
      if (codigoDe(resposta) !== 'ok') throw new Error('abrir caixa');
      if (this.#estaParado() || !aberta.aberta) throw new Error('parado');
      this.#conexao = aberta;
      this.#tentativas = 0;
    } catch {
      await conexao?.fechar();
      this.#agendarReconexao();
    }
  }

  #aoAvisar(aviso: Aviso): void {
    if (aviso.tipo === 'caixa-substituida') {
      this.#semCaixa = true;
      return;
    }
    if (aviso.tipo !== 'marca') return;
    const chave = paraHex(aviso.id);
    if (this.#vistos.has(chave)) return;
    this.#vistos.add(chave);
    if (!marcaAvisa(this.#o.cripto, aviso.marca, this.#o.sementeDaCaixa)) return;
    for (const ouvinte of [...this.#ouvintes]) {
      try {
        ouvinte();
      } catch {
        // Quem ouve não derruba o vigia.
      }
    }
  }

  #aoCair(conexao: ConexaoComORelay): void {
    if (this.#conexao !== conexao) return;
    this.#conexao = null;
    this.#agendarReconexao();
  }

  #agendarReconexao(): void {
    if (this.#parado || this.#semCaixa || this.#cancelarReconexao) return;
    this.#tentativas++;
    this.#cancelarReconexao = this.#o.relogio.agendar(intervaloDeReenvio(this.#tentativas), () => {
      this.#cancelarReconexao = null;
      this.#conectar();
    });
  }
}
