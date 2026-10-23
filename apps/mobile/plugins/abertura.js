// Abertura do app no fundo escuro, com o wordmark do ícone no meio, do Android 10 ao 16 (SPEC,
// "Abertura"). O MainActivity abre com o tema da abertura do modelo do Expo, que só tem a grade do
// modelo como fundo: no Android 12 ou mais novo, a abertura saía branca, com o ícone num círculo
// escuro; no 10 e no 11, a janela mostrava a grade esticada.
//
// No Android 12 ou mais novo, quem desenha a abertura é o sistema: a cor vem do tema, e o ícone é o
// adaptável. Com o fundo do ícone igual ao da abertura, o sistema desenha só a camada da frente,
// ampliada em 192/160, e os 108 dp da camada viram 288 dp. No 10 e no 11, a abertura é o fundo da
// janela: a cor e, no meio, a mesma camada no mesmo tamanho.
const fs = require('node:fs');
const path = require('node:path');
const {
  AndroidConfig,
  withAndroidColors,
  withAndroidStyles,
  withDangerousMod,
} = require('expo/config-plugins');

const TEMA = 'Theme.App.SplashScreen';
const COR = 'fundo_da_abertura';
const DESENHO = 'abertura';
const LADO_DA_CAMADA = '288dp';

/** O fundo da janela no Android 10 e no 11: a cor e a camada da frente do ícone no meio. */
function desenhoDaAbertura() {
  return `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
  <item android:drawable="@color/${COR}" />
  <item
    android:width="${LADO_DA_CAMADA}"
    android:height="${LADO_DA_CAMADA}"
    android:gravity="center"
    android:drawable="@mipmap/ic_launcher_foreground" />
</layer-list>
`;
}

/** O tema da abertura com o fundo da janela e a cor da abertura do sistema, cada um uma vez só. */
function comTemaDaAbertura(estilos) {
  if (!AndroidConfig.Styles.getStyleParent(estilos, { name: TEMA })) {
    throw new Error(`abertura: ${TEMA} não encontrado no styles.xml`);
  }
  estilos.resources.$ = {
    ...estilos.resources.$,
    'xmlns:tools': 'http://schemas.android.com/tools',
  };
  const comFundo = AndroidConfig.Styles.assignStylesValue(estilos, {
    add: true,
    parent: { name: TEMA },
    name: 'android:windowBackground',
    value: `@drawable/${DESENHO}`,
  });
  return AndroidConfig.Styles.assignStylesValue(comFundo, {
    add: true,
    parent: { name: TEMA },
    name: 'android:windowSplashScreenBackground',
    value: `@color/${COR}`,
    targetApi: '31',
  });
}

function abertura(expoConfig) {
  const cor = expoConfig.android?.adaptiveIcon?.backgroundColor;
  if (!cor) {
    throw new Error(
      'abertura: o app.json precisa de "android": { "adaptiveIcon": { "backgroundColor" } }',
    );
  }
  const comCor = withAndroidColors(expoConfig, (mod) => {
    mod.modResults = AndroidConfig.Colors.assignColorValue(mod.modResults, {
      name: COR,
      value: cor,
    });
    return mod;
  });
  const comDesenho = withDangerousMod(comCor, [
    'android',
    (mod) => {
      const pasta = path.join(
        mod.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'drawable',
      );
      fs.mkdirSync(pasta, { recursive: true });
      fs.writeFileSync(path.join(pasta, `${DESENHO}.xml`), desenhoDaAbertura());
      return mod;
    },
  ]);
  return withAndroidStyles(comDesenho, (mod) => {
    mod.modResults = comTemaDaAbertura(mod.modResults);
    return mod;
  });
}

module.exports = abertura;
module.exports.desenhoDaAbertura = desenhoDaAbertura;
module.exports.comTemaDaAbertura = comTemaDaAbertura;
