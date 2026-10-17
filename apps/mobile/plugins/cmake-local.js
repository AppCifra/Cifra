// Só para desenvolvimento no Windows: o ninja do CMake 3.22.1 (padrão do Android Gradle Plugin)
// não lida com caminhos acima de 260 caracteres, e os caminhos do pnpm passam disso. Com
// CIFRA_CMAKE_DIR apontando para um CMake 3.31+ do SDK, grava `cmake.dir` no local.properties.
// Sem a variável, não faz nada (Linux, macOS e CI seguem o padrão).
const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('expo/config-plugins');

module.exports = function cmakeLocal(config) {
  return withDangerousMod(config, [
    'android',
    (mod) => {
      const pasta = process.env.CIFRA_CMAKE_DIR;
      if (!pasta) return mod;
      const arquivo = path.join(mod.modRequest.platformProjectRoot, 'local.properties');
      const anterior = fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8') : '';
      const linhas = anterior
        .split('\n')
        .filter((linha) => linha && !linha.startsWith('cmake.dir='));
      // Barra normal: no local.properties a contrabarra é caractere de escape.
      linhas.push(`cmake.dir=${pasta.split(path.win32.sep).join('/')}`);
      fs.writeFileSync(arquivo, `${linhas.join('\n')}\n`);
      return mod;
    },
  ]);
};
