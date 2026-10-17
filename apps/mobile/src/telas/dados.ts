// Como as telas leem as conversas: de novo a cada novidade (mensagem, status, contato mexido).
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ConversasDoApp, EstadoDaRede } from '../conversas.ts';
import type { Traduzir } from '../i18n.ts';

/** O número da última novidade: muda, e quem usa lê de novo. */
export function useVersao(conversas: ConversasDoApp): number {
  return useSyncExternalStore(conversas.aoMudar, () => conversas.versao);
}

/**
 * Numa conversa com prints bloqueados (RF-58), a tela fica sem print enquanto aparece, mesmo com o
 * ajuste geral desligado.
 */
export function useTelaProtegida(conversas: ConversasDoApp, protegida: boolean): void {
  useEffect(() => (protegida ? conversas.protegerTela() : undefined), [conversas, protegida]);
}

/** O resultado de `ler`, refeito quando a versão (ou outra dependência) muda. */
export function useLeitura<T>(ler: () => Promise<T>, dependencias: readonly unknown[]): T | null {
  const [valor, setValor] = useState<T | null>(null);
  useEffect(() => {
    let ativo = true;
    ler()
      .then((lido) => {
        if (ativo) setValor(lido);
      })
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
    // `ler` muda a cada desenho; quem chama diz do que ele depende.
  }, dependencias);
  return valor;
}

export function rotuloDaRede(t: Traduzir, rede: EstadoDaRede): string {
  if (rede === 'conectado') return t('rede.conectado');
  if (rede === 'sem-tor') return t('rede.semTor');
  return rede === 'conectando' ? t('rede.conectando') : t('rede.semConexao');
}

/** A hora do aparelho, de segundo em segundo enquanto `ativo`: a contagem das temporárias. */
export function useAgora(ativo: boolean): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!ativo) return;
    setAgora(Date.now());
    const relogio = setInterval(() => {
      setAgora(Date.now());
    }, 1000);
    return () => {
      clearInterval(relogio);
    };
  }, [ativo]);
  return agora;
}
