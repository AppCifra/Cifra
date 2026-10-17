// O Cifra roda do Android 10 em diante (SPEC, "Plataformas"): o salvar no celular pelo MediaStore
// sem permissão de armazenamento, e a área de transferência que só o app da frente lê. O Expo lê a
// versão mínima de `android.minSdkVersion`, no gradle.properties.
const { withGradleProperties } = require('expo/config-plugins');

const CHAVE = 'android.minSdkVersion';
const VERSAO_MINIMA = '29';

/** As propriedades do gradle.properties com a versão mínima, uma vez só. */
function comVersaoMinima(propriedades) {
  return [
    ...propriedades.filter((item) => !(item.type === 'property' && item.key === CHAVE)),
    { type: 'property', key: CHAVE, value: VERSAO_MINIMA },
  ];
}

function androidMinimo(config) {
  return withGradleProperties(config, (mod) => {
    mod.modResults = comVersaoMinima(mod.modResults);
    return mod;
  });
}

module.exports = androidMinimo;
module.exports.VERSAO_MINIMA = VERSAO_MINIMA;
module.exports.comVersaoMinima = comVersaoMinima;
