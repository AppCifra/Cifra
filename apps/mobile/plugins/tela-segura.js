// Liga o FLAG_SECURE no MainActivity.onCreate, antes de o JS carregar (RF-41). Prints e gravações
// saem em branco e o app some do multitarefa desde o primeiro quadro. O JS só desliga se a pessoa
// escolher (src/adaptadores/tela.ts).
//
// O FLAG_SECURE não vale para o preenchimento automático: ao tocar num campo, o Android monta a
// estrutura da tela e entrega ao serviço de preenchimento e, pela captura de conteúdo, ao serviço
// de sugestões do sistema. Os rótulos de acessibilidade vão junto, e os dos balões levam o texto
// das mensagens. Por isso o MainActivity também desliga a captura de conteúdo antes de a tela
// começar e tira a árvore inteira do preenchimento automático, com ou sem print liberado.
const { withMainActivity } = require('expo/config-plugins');

const IMPORTACOES = [
  'import android.view.View',
  'import android.view.WindowManager',
  'import android.view.contentcapture.ContentCaptureManager',
];
const LIGAR =
  '    window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)';
const SEM_CAPTURA =
  '    getSystemService(ContentCaptureManager::class.java)?.setContentCaptureEnabled(false)';
// Sem a imagem do multitarefa, mesmo com o print liberado: o Android grava essa imagem no disco do
// sistema, fora do banco cifrado. A partir do Android 13.
const SEM_IMAGEM_NO_MULTITAREFA =
  '    if (android.os.Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(false)';
const SEM_PREENCHIMENTO =
  '    window.decorView.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS';

/**
 * O MainActivity com a tela segura, sem captura de conteúdo e fora do preenchimento automático,
 * cada parte uma vez só. A árvore só existe depois do `super.onCreate`, que monta a tela com o tema.
 */
function comTelaSegura(codigo) {
  const onCreate = /override fun onCreate\(savedInstanceState: Bundle\?\) \{\n/;
  const superOnCreate = /\n *super\.onCreate\([^)\n]*\);?\n/;
  if (!onCreate.test(codigo))
    throw new Error('tela-segura: onCreate não encontrado no MainActivity');
  if (!superOnCreate.test(codigo))
    throw new Error('tela-segura: super.onCreate não encontrado no MainActivity');
  let novo = codigo;
  if (!novo.includes(LIGAR)) novo = novo.replace(onCreate, (trecho) => `${trecho}${LIGAR}\n`);
  if (!novo.includes(SEM_CAPTURA)) novo = novo.replace(`${LIGAR}\n`, `${LIGAR}\n${SEM_CAPTURA}\n`);
  if (!novo.includes(SEM_IMAGEM_NO_MULTITAREFA))
    novo = novo.replace(`${SEM_CAPTURA}\n`, `${SEM_CAPTURA}\n${SEM_IMAGEM_NO_MULTITAREFA}\n`);
  if (!novo.includes(SEM_PREENCHIMENTO))
    novo = novo.replace(superOnCreate, (trecho) => `${trecho}${SEM_PREENCHIMENTO}\n`);
  const faltam = IMPORTACOES.filter((linha) => !novo.split('\n').includes(linha));
  if (faltam.length > 0) novo = novo.replace(/^(package [^\n]+\n)/, `$1\n${faltam.join('\n')}\n`);
  return novo;
}

function telaSegura(config) {
  return withMainActivity(config, (mod) => {
    if (mod.modResults.language !== 'kt')
      throw new Error('tela-segura: MainActivity em Kotlin esperado');
    mod.modResults.contents = comTelaSegura(mod.modResults.contents);
    return mod;
  });
}

module.exports = telaSegura;
module.exports.comTelaSegura = comTelaSegura;
