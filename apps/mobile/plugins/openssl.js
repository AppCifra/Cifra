// O OpenSSL do SQLCipher compilado do fonte oficial (apps/mobile/release/openssl.sh), no lugar do
// que o op-sqlite pede ao Maven Central (`io.github.ronickg:openssl`, publicado por uma conta
// pessoal). O repositório Maven local vem de CIFRA_OPENSSL_MAVEN, na imagem do release, ou de
// apps/mobile/openssl/maven, no PC (docs/DESENVOLVIMENTO.md, "OpenSSL"). Sem ele, o build para.
const { withProjectBuildGradle } = require('expo/config-plugins');

const VERSAO = '3.5.9';
const MARCA = '// OpenSSL do Cifra (plugin openssl)';

/** O build.gradle da raiz com o repositório local e a troca do OpenSSL, uma vez só. */
function comOpenssl(gradle) {
  if (gradle.includes(MARCA)) return gradle;
  return `${gradle.trimEnd()}

${MARCA}
def opensslDoCifra = new File(System.getenv('CIFRA_OPENSSL_MAVEN') ?: new File(rootDir, '../openssl/maven').canonicalPath)
if (!new File(opensslDoCifra, 'org/cifra/thirdparty/openssl/${VERSAO}/openssl-${VERSAO}.aar').exists()) {
  throw new GradleException("OpenSSL ${VERSAO} não encontrado em \${opensslDoCifra}: veja \\"OpenSSL\\" em docs/DESENVOLVIMENTO.md")
}
allprojects {
  repositories {
    exclusiveContent {
      forRepository { maven { url = opensslDoCifra.toURI() } }
      filter { includeGroup 'org.cifra.thirdparty' }
    }
  }
  configurations.configureEach {
    resolutionStrategy.dependencySubstitution {
      substitute module('io.github.ronickg:openssl') using module('org.cifra.thirdparty:openssl:${VERSAO}')
    }
  }
}
`;
}

function openssl(config) {
  return withProjectBuildGradle(config, (mod) => {
    mod.modResults.contents = comOpenssl(mod.modResults.contents);
    return mod;
  });
}

module.exports = openssl;
module.exports.comOpenssl = comOpenssl;
module.exports.VERSAO = VERSAO;
