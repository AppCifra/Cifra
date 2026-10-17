// Release sem log (RNF-05): liga o R8 no build de produção e tira as chamadas do android.util.Log
// do app e das bibliotecas (react-native-keychain e o próprio React Native escrevem no logcat). O
// R8 só tira o que tem `-assumenosideeffects` quando otimiza, e o arquivo padrão do Expo
// (`proguard-android.txt`) desliga a otimização: o plugin troca pelo `proguard-android-optimize.txt`.
// O nome das classes fica (`-dontobfuscate`): o código é aberto, e não há o que esconder.
const fs = require('node:fs');
const path = require('node:path');
const {
  withAppBuildGradle,
  withDangerousMod,
  withGradleProperties,
} = require('expo/config-plugins');

const MINIFICAR = 'android.enableMinifyInReleaseBuilds';

const REGRAS = `
# Cifra: release sem log (RNF-05). O R8 tira as chamadas do android.util.Log, também as das
# bibliotecas. O que a máquina virtual do Android escreve sozinha fica fora do alcance do app.
-dontobfuscate
-assumenosideeffects class android.util.Log {
  public static boolean isLoggable(java.lang.String, int);
  public static int v(...);
  public static int d(...);
  public static int i(...);
  public static int w(...);
  public static int e(...);
  public static int wtf(...);
  public static int println(...);
}
`;

/** As propriedades do gradle.properties com o R8 ligado no release, uma vez só. */
function comMinificacao(propriedades) {
  return [
    ...propriedades.filter((item) => !(item.type === 'property' && item.key === MINIFICAR)),
    { type: 'property', key: MINIFICAR, value: 'true' },
  ];
}

/** O build.gradle do app com o arquivo de regras que deixa o R8 otimizar. */
function comOtimizacao(gradle) {
  const otimizado = gradle.replace(
    /getDefaultProguardFile\(["']proguard-android\.txt["']\)/g,
    'getDefaultProguardFile("proguard-android-optimize.txt")',
  );
  if (!otimizado.includes('proguard-android-optimize.txt')) {
    throw new Error(
      'release-sem-log: arquivo de regras do Proguard não encontrado no build.gradle',
    );
  }
  return otimizado;
}

/** As regras do app com as do Cifra no fim, uma vez só. */
function comRegrasSemLog(regras) {
  return regras.includes('-assumenosideeffects class android.util.Log') ? regras : regras + REGRAS;
}

function releaseSemLog(config) {
  config = withGradleProperties(config, (mod) => {
    mod.modResults = comMinificacao(mod.modResults);
    return mod;
  });
  config = withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = comOtimizacao(mod.modResults.contents);
    return mod;
  });
  return withDangerousMod(config, [
    'android',
    (mod) => {
      const arquivo = path.join(mod.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
      const atual = fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8') : '';
      fs.writeFileSync(arquivo, comRegrasSemLog(atual));
      return mod;
    },
  ]);
}

module.exports = releaseSemLog;
module.exports.comMinificacao = comMinificacao;
module.exports.comOtimizacao = comOtimizacao;
module.exports.comRegrasSemLog = comRegrasSemLog;
