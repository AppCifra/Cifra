// APIs que o Hermes oferece e que os tipos do React Native não declaram. Sem DOM: só o que o app usa.
declare function btoa(dados: string): string;
declare function atob(dados: string): string;
declare const performance: { now(): number };
/** Verdadeiro no build de desenvolvimento; no de release, o Metro troca por `false`. */
declare const __DEV__: boolean;
// O Expo grava no pacote, na hora de gerar, as variáveis EXPO_PUBLIC_* do ambiente.
declare namespace NodeJS {
  interface ProcessEnv {
    /** "1" abre a verificação técnica no lugar do app, só no build de desenvolvimento. */
    readonly EXPO_PUBLIC_CIFRA_VERIFICACAO?: string;
    /** Endereço do relay: vai no cartão, e é onde o app conecta. Sem ele, o app não conecta. */
    readonly EXPO_PUBLIC_CIFRA_RELAY?: string;
  }
}
