// Altura do teclado aberto. No Android 16 o app ocupa a tela inteira e é desenhado atrás do
// teclado: quem fica embaixo (o campo da conversa, um painel com campo) sobe essa altura.
import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

export function useAlturaDoTeclado(): number {
  const [altura, setAltura] = useState(0);
  useEffect(() => {
    const abriu = Keyboard.addListener('keyboardDidShow', (evento) => {
      setAltura(evento.endCoordinates.height);
    });
    const fechou = Keyboard.addListener('keyboardDidHide', () => {
      setAltura(0);
    });
    return () => {
      abriu.remove();
      fechou.remove();
    };
  }, []);
  return altura;
}
