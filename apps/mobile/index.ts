import { registerRootComponent } from 'expo';
import { App } from './src/App.tsx';

// Release sem log (RNF-05): no build de produção, o console não escreve nada no logcat, nem o das
// bibliotecas. No desenvolvimento, fica como está.
if (!__DEV__) {
  const nada = () => undefined;
  Object.assign(console, {
    log: nada,
    info: nada,
    warn: nada,
    error: nada,
    debug: nada,
    trace: nada,
  });
}

registerRootComponent(App);
