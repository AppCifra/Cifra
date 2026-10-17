// Dados do app fora dos backups do sistema (RNF-09). O `allowBackup: false` do app.json desliga o
// backup na nuvem, mas no Android 12 ou mais novo alguns fabricantes ainda copiam os dados na
// transferência entre aparelhos. As regras de extração excluem tudo nas duas: nuvem e
// transferência. Sem `allowBackup: false`, o prebuild para.
const fs = require('node:fs');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const NOME = 'regras_de_extracao';

/** Todos os lugares em que um app guarda arquivos no Android, com e sem o aparelho desbloqueado. */
const DOMINIOS = [
  'root',
  'file',
  'database',
  'sharedpref',
  'external',
  'device_root',
  'device_file',
  'device_database',
  'device_sharedpref',
];

/** O XML das regras: cada domínio inteiro (`.`) fica de fora da nuvem e da transferência. */
function regrasDeExtracao() {
  const excluir = DOMINIOS.map((dominio) => `    <exclude domain="${dominio}" path="." />`).join(
    '\n',
  );
  return `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
${excluir}
  </cloud-backup>
  <device-transfer>
${excluir}
  </device-transfer>
</data-extraction-rules>
`;
}

/** Aponta o `<application>` do manifesto para as regras. */
function ligarRegras(manifesto) {
  const [aplicacao] = manifesto.manifest.application ?? [];
  if (!aplicacao) throw new Error('sem-backup: <application> não encontrado');
  aplicacao.$['android:dataExtractionRules'] = `@xml/${NOME}`;
  return manifesto;
}

function semBackup(expoConfig) {
  if (expoConfig.android?.allowBackup !== false) {
    throw new Error('sem-backup: o app.json precisa de "android": { "allowBackup": false }');
  }
  const comArquivo = withDangerousMod(expoConfig, [
    'android',
    (mod) => {
      const pasta = path.join(
        mod.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml',
      );
      fs.mkdirSync(pasta, { recursive: true });
      fs.writeFileSync(path.join(pasta, `${NOME}.xml`), regrasDeExtracao());
      return mod;
    },
  ]);
  return withAndroidManifest(comArquivo, (mod) => {
    ligarRegras(mod.modResults);
    return mod;
  });
}

module.exports = semBackup;
module.exports.DOMINIOS = DOMINIOS;
module.exports.regrasDeExtracao = regrasDeExtracao;
module.exports.ligarRegras = ligarRegras;
