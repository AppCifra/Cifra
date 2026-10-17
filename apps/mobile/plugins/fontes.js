// Copia as fontes do design (Geist e Geist Mono, licença OFL) de assets/fontes para os assets do
// Android. O React Native acha cada arquivo pelo nome: `fontFamily: 'Geist-Medium'` usa
// assets/fonts/Geist-Medium.ttf. Versão e SHA-256 de cada arquivo estão em docs/DEPENDENCIAS.md.
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function fontes(config) {
  return withDangerousMod(config, [
    'android',
    (mod) => {
      const origem = path.join(mod.modRequest.projectRoot, 'assets', 'fontes');
      const destino = path.join(
        mod.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'assets',
        'fonts',
      );
      fs.mkdirSync(destino, { recursive: true });
      const arquivos = fs.readdirSync(origem).filter((nome) => nome.endsWith('.ttf'));
      if (arquivos.length === 0) throw new Error('fontes: nenhuma fonte em assets/fontes');
      for (const arquivo of arquivos) {
        fs.copyFileSync(path.join(origem, arquivo), path.join(destino, arquivo));
      }
      return mod;
    },
  ]);
};
