// A plataforma de mentira dos testes da sessão e do controle: o Keystore conta os pedidos de
// biometria ou senha (guardar ou ler um segredo com proteção `desbloqueio`) e o banco é o SQLite do
// Node, sem cifra, num arquivo de verdade. O cofre das conversas ocultas também: não é cifrado, mas
// só abre com a chave que o criou (ou a da última troca), e outra chave dá `banco-ilegivel`.
import { existsSync, rmSync, statSync, truncateSync } from 'node:fs';
import { join } from 'node:path';
import {
  ErroDoCofre,
  type CofreAberto,
  type CofreDeChaves,
  type NomeDoSegredo,
  type Protecao,
} from '@cifra/core';
import { iguais } from '@cifra/protocol';
import { cripto } from '../../../packages/core/test/adaptadores/sodium-node.ts';
import {
  abrirBancoNoArquivo,
  pastaTemporaria,
} from '../../../packages/core/test/adaptadores/sqlite-node.ts';
import type { BancoPrincipal, Plataforma } from '../src/sessao.ts';

export interface CofreDeTeste extends CofreDeChaves {
  readonly guardados: Map<NomeDoSegredo, { segredo: Uint8Array; protecao: Protecao }>;
  pedidos: number;
  falharAoGuardar: boolean;
  cancelarAoLer: boolean;
  /** Como o Android quando o bloqueio de tela sai: os segredos com `desbloqueio` não abrem mais. */
  chavesPerdidas: boolean;
  /** Erro qualquer na leitura, que não é cancelamento nem chave perdida. */
  falharAoLer: boolean;
}

export function cofreDeTeste(): CofreDeTeste {
  const cofre: CofreDeTeste = {
    guardados: new Map(),
    pedidos: 0,
    falharAoGuardar: false,
    cancelarAoLer: false,
    chavesPerdidas: false,
    falharAoLer: false,
    guardar(nome, segredo, protecao) {
      if (protecao === 'desbloqueio') cofre.pedidos++;
      if (cofre.falharAoGuardar) return Promise.reject(new Error('sem bloqueio de tela'));
      // Como o Keystore, guarda uma cópia.
      cofre.guardados.set(nome, { segredo: segredo.slice(), protecao });
      return Promise.resolve();
    },
    ler(nome) {
      const guardado = cofre.guardados.get(nome);
      if (!guardado) return Promise.resolve(null);
      const comDesbloqueio = guardado.protecao === 'desbloqueio';
      // A chave perdida é descoberta antes do pedido: nada aparece para a pessoa.
      if (comDesbloqueio && cofre.chavesPerdidas) return Promise.reject(new ErroDoCofre('perdido'));
      if (comDesbloqueio) cofre.pedidos++;
      if (cofre.cancelarAoLer) return Promise.reject(new ErroDoCofre('cancelado'));
      if (cofre.falharAoLer) return Promise.reject(new Error('keystore indisponível'));
      return Promise.resolve(guardado.segredo.slice());
    },
    destruir(nome) {
      cofre.guardados.delete(nome);
      return Promise.resolve();
    },
    destruirTudo() {
      cofre.guardados.clear();
      return Promise.resolve();
    },
  };
  return cofre;
}

export interface PlataformaDeTeste {
  readonly plataforma: Plataforma;
  readonly cofre: CofreDeTeste;
  readonly arquivo: string;
  /** Cada chave que chegou ao banco, como referência: depois de abrir, ela tem de estar zerada. */
  readonly chavesRecebidas: Uint8Array[];
  /** Cópia de cada chave que chegou ao banco. */
  readonly copias: Uint8Array[];
  /** Os bancos abertos, na ordem. */
  readonly bancos: BancoPrincipal[];
  /** Como o SQLCipher com um arquivo danificado: a abertura rejeita com `banco-ilegivel`. */
  ilegivel: boolean;
  /** O arquivo do cofre das conversas ocultas. */
  readonly arquivoDoCofre: string;
  /** Cada chave com que alguém tentou abrir o cofre, em cópia. */
  readonly chavesDoCofre: Uint8Array[];
  /** Quantas vezes o cofre foi zerado no lugar e teve a data tocada, e quantas o pânico apagou tudo. */
  readonly contagem: { truncar: number; tocar: number; apagar: number };
  /** Os cofres abertos agora. */
  readonly cofresAbertos: Set<CofreAberto>;
  /** Apaga a pasta do teste. */
  limpar(): void;
}

export function plataformaDeTeste(): PlataformaDeTeste {
  const pasta = pastaTemporaria();
  const arquivo = join(pasta, 'cifra.sqlite');
  const arquivoDoCofre = join(pasta, 'cofre.sqlite');
  const cofre = cofreDeTeste();
  /** A chave do arquivo do cofre, como o SQLCipher a teria: só ela abre. */
  let chaveDoArquivo: Uint8Array | null = null;
  const vazio = () => !existsSync(arquivoDoCofre) || statSync(arquivoDoCofre).size === 0;
  const teste: PlataformaDeTeste = {
    cofre,
    arquivo,
    chavesRecebidas: [],
    copias: [],
    bancos: [],
    ilegivel: false,
    arquivoDoCofre,
    chavesDoCofre: [],
    contagem: { truncar: 0, tocar: 0, apagar: 0 },
    cofresAbertos: new Set(),
    limpar() {
      rmSync(pasta, { recursive: true, force: true });
    },
    plataforma: {
      // Um cofre de 16 MiB a cada identidade nova pesaria nos testes, que rodam juntos.
      blocoDoCofre: 1024 * 1024,
      cripto,
      cofre,
      abrirBanco(chave) {
        teste.chavesRecebidas.push(chave);
        teste.copias.push(chave.slice());
        if (teste.ilegivel) return Promise.reject(new Error('banco-ilegivel'));
        const aberto = abrirBancoNoArquivo(arquivo);
        let fechado = false;
        const banco: BancoPrincipal = {
          banco: aberto.banco,
          // Como o op-sqlite, fechar de novo não faz nada.
          fechar() {
            if (fechado) return;
            fechado = true;
            aberto.fechar();
          },
        };
        teste.bancos.push(banco);
        return Promise.resolve(banco);
      },
      apagarBanco() {
        rmSync(arquivo, { force: true });
        return Promise.resolve();
      },
      abrirCofre(chave) {
        teste.chavesDoCofre.push(chave.slice());
        if (!vazio() && chaveDoArquivo && !iguais(chave, chaveDoArquivo)) {
          return Promise.reject(new Error('banco-ilegivel'));
        }
        if (vazio()) chaveDoArquivo = chave.slice();
        const aberto = abrirBancoNoArquivo(arquivoDoCofre, 'TRUNCATE');
        let fechado = false;
        const cofreAberto: CofreAberto = {
          banco: aberto.banco,
          trocarChave(nova) {
            chaveDoArquivo = nova.slice();
            return Promise.resolve();
          },
          fechar() {
            if (fechado) return;
            fechado = true;
            teste.cofresAbertos.delete(cofreAberto);
            aberto.fechar();
          },
        };
        teste.cofresAbertos.add(cofreAberto);
        return Promise.resolve(cofreAberto);
      },
      truncarCofre() {
        teste.contagem.truncar++;
        if (teste.cofresAbertos.size > 0) return Promise.reject(new Error('cofre aberto'));
        if (existsSync(arquivoDoCofre)) truncateSync(arquivoDoCofre, 0);
        chaveDoArquivo = null;
        return Promise.resolve();
      },
      tocarCofre() {
        teste.contagem.tocar++;
        return Promise.resolve();
      },
      apagarArquivos() {
        teste.contagem.apagar++;
        if (teste.cofresAbertos.size > 0) return Promise.reject(new Error('cofre aberto'));
        for (const caminho of [arquivo, `${arquivo}-journal`, arquivoDoCofre]) {
          rmSync(caminho, { force: true });
          rmSync(`${caminho}-journal`, { force: true });
        }
        chaveDoArquivo = null;
        return Promise.resolve();
      },
    },
  };
  return teste;
}
