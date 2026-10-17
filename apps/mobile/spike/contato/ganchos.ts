// Deixa o Node carregar o núcleo direto do TypeScript: as listas do BIP39 são importadas como JSON
// sem atributo de importação, que o Metro e o Vite aceitam e o Node não.
import { registerHooks } from 'node:module';

registerHooks({
  load(url, contexto, proximo) {
    if (!url.endsWith('.json')) return proximo(url, contexto);
    return proximo(url, { ...contexto, importAttributes: { type: 'json' } });
  },
});
