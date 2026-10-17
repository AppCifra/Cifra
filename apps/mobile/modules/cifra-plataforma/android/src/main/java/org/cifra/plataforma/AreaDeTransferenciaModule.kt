package org.cifra.plataforma

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import android.os.SystemClock
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Copiar (RF-52) e copiar o ID (RF-45). O texto vai marcado como sensível: o Android não o mostra
// na prévia do que foi copiado. Depois do prazo, sai da área de transferência, se ainda for o que o
// Cifra copiou. Desde o Android 10, só o app na frente consegue ler a área de transferência: com o
// Cifra por trás, não dá para conferir se o texto ainda é o nosso, e ele só sai quando o Cifra
// volta para a frente (nunca o texto que outro app copiou depois).
class AreaDeTransferenciaModule : Module() {
  private val principal = Handler(Looper.getMainLooper())
  /** A hora em que o Android registrou o nosso texto; zero quando não há nada a limpar. */
  private var copiadoEm = 0L
  private var venceEm = 0L
  private var naFrente = true
  private val conferir = Runnable { limparSeVenceu() }

  override fun definition() = ModuleDefinition {
    Name("CifraAreaDeTransferencia")

    AsyncFunction("copiar") { texto: String, segundos: Int ->
      val area = area()
      val clipe = ClipData.newPlainText("", texto)
      clipe.description.extras = PersistableBundle().apply { putBoolean(SENSIVEL, true) }
      area.setPrimaryClip(clipe)
      copiadoEm = area.primaryClipDescription?.timestamp ?: 0L
      venceEm = SystemClock.elapsedRealtime() + segundos * 1000L
      principal.removeCallbacks(conferir)
      principal.postDelayed(conferir, segundos * 1000L)
    }.runOnQueue(Queues.MAIN)

    // Pânico (RF-48): tira na hora o que o Cifra copiou, sem esperar o prazo. O app está na frente.
    AsyncFunction("esquecer") {
      venceEm = 0L
      principal.removeCallbacks(conferir)
      limparSeVenceu()
    }.runOnQueue(Queues.MAIN)

    OnActivityEntersForeground {
      naFrente = true
      principal.post(conferir)
    }

    OnActivityEntersBackground {
      naFrente = false
    }

    OnDestroy {
      principal.removeCallbacks(conferir)
    }
  }

  private fun area(): ClipboardManager {
    val contexto = appContext.reactContext ?: throw Exceptions.ReactContextLost()
    return contexto.getSystemService(ClipboardManager::class.java)
  }

  /** Na frente e depois do prazo: tira o texto, se ele ainda é o que o Cifra copiou. */
  private fun limparSeVenceu() {
    if (copiadoEm == 0L || !naFrente || SystemClock.elapsedRealtime() < venceEm) return
    val area = try {
      area()
    } catch (_: Exception) {
      return
    }
    if (area.primaryClipDescription?.timestamp == copiadoEm) area.clearPrimaryClip()
    copiadoEm = 0L
  }

  private companion object {
    /** `ClipDescription.EXTRA_IS_SENSITIVE`, que só tem nome a partir do Android 13. */
    val SENSIVEL: String =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        ClipDescription.EXTRA_IS_SENSITIVE
      } else {
        "android.content.extra.IS_SENSITIVE"
      }
  }
}
