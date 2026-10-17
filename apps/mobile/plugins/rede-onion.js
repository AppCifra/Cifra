// Política de rede do Android: texto claro (ws://) só para endereços .onion, em que o Tor já
// cifra e autentica o serviço. Todo o resto exige TLS. No build de depuração, o Metro local
// também passa, porque o app de desenvolvimento busca o JS por http.
const fs = require('node:fs');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const NOME = 'seguranca_de_rede';

const config = (dominiosLocais) => `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="true">onion</domain>${dominiosLocais
      .map((dominio) => `\n    <domain includeSubdomains="false">${dominio}</domain>`)
      .join('')}
  </domain-config>
</network-security-config>
`;

function escrever(raiz, variante, conteudo) {
  const pasta = path.join(raiz, 'app', 'src', variante, 'res', 'xml');
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, `${NOME}.xml`), conteudo);
}

module.exports = function redeOnion(expoConfig) {
  const comArquivos = withDangerousMod(expoConfig, [
    'android',
    (mod) => {
      const raiz = mod.modRequest.platformProjectRoot;
      escrever(raiz, 'main', config([]));
      escrever(raiz, 'debug', config(['localhost', '127.0.0.1', '10.0.2.2']));
      return mod;
    },
  ]);
  return withAndroidManifest(comArquivos, (mod) => {
    const [aplicacao] = mod.modResults.manifest.application ?? [];
    if (!aplicacao) throw new Error('rede-onion: <application> não encontrado');
    aplicacao.$['android:networkSecurityConfig'] = `@xml/${NOME}`;
    return mod;
  });
};
