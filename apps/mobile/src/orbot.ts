// O Orbot, sem o qual o Cifra não se conecta (RF-44), e a página dele na loja de apps do celular
// (RF-64). O `market://` abre a loja que o celular tiver (Play, F-Droid, Aurora), nunca o navegador,
// que sairia do Tor. É o único link do app, e o teste confere.

export const PACOTE_DO_ORBOT = 'org.torproject.android';

export const ORBOT_NA_LOJA = `market://details?id=${PACOTE_DO_ORBOT}`;
