// Movimento reduzido: quando o sistema pede, as telas e os painéis só esmaecem (RNF-18).
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useMovimentoReduzido(): boolean {
  const [reduzido, setReduzido] = useState(false);
  useEffect(() => {
    let ativo = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((valor) => {
        if (ativo) setReduzido(valor);
      })
      .catch(() => undefined);
    const assinatura = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduzido);
    return () => {
      ativo = false;
      assinatura.remove();
    };
  }, []);
  return reduzido;
}
