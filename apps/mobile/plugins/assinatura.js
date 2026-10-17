// Assinatura do release com a chave do Cifra. A chave e a senha nunca entram no repositório nem no
// projeto gerado: o Gradle lê do ambiente na hora do build (CIFRA_ASSINATURA_ARQUIVO,
// CIFRA_ASSINATURA_SENHA e, se o apelido não for "cifra", CIFRA_ASSINATURA_APELIDO). Sem elas, o
// release continua com a chave de depuração do modelo, que serve para testar e não para distribuir.
// Todas as versões saem com a mesma chave: o Android só atualiza o app com a assinatura de antes.
const { withAppBuildGradle } = require('expo/config-plugins');

const CONFIGURACAO = `        release {
            if (System.getenv('CIFRA_ASSINATURA_ARQUIVO')) {
                storeFile file(System.getenv('CIFRA_ASSINATURA_ARQUIVO'))
                storePassword System.getenv('CIFRA_ASSINATURA_SENHA')
                keyAlias System.getenv('CIFRA_ASSINATURA_APELIDO') ?: 'cifra'
                keyPassword System.getenv('CIFRA_ASSINATURA_SENHA')
            }
        }
`;

const ESCOLHA =
  "signingConfig System.getenv('CIFRA_ASSINATURA_ARQUIVO') ? signingConfigs.release : signingConfigs.debug";

/** O build.gradle do app com a configuração de assinatura do release, uma vez só. */
function comAssinatura(gradle) {
  if (gradle.includes(ESCOLHA)) return gradle;
  const assinaturas = /( {4}signingConfigs \{\n {8}debug \{\n[^}]*\}\n)/;
  if (!assinaturas.test(gradle)) {
    throw new Error('assinatura: signingConfigs.debug não encontrado no build.gradle');
  }
  let novo = gradle.replace(assinaturas, (trecho) => `${trecho}${CONFIGURACAO}`);
  const release =
    /( {8}release \{\n(?: {12}\/\/[^\n]*\n)*) {12}signingConfig signingConfigs\.debug\n/;
  if (!release.test(novo)) {
    throw new Error('assinatura: signingConfig do release não encontrado no build.gradle');
  }
  novo = novo.replace(release, (_, inicio) => `${inicio}            ${ESCOLHA}\n`);
  return novo;
}

function assinatura(config) {
  return withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = comAssinatura(mod.modResults.contents);
    return mod;
  });
}

module.exports = assinatura;
module.exports.comAssinatura = comAssinatura;
