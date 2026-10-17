package org.cifra.plataforma

import android.view.View
import android.view.ViewTreeObserver
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

// Teclado incógnito (RF-43): todo campo que ganha o foco pede ao teclado para não aprender o que é
// digitado (IME_FLAG_NO_PERSONALIZED_LEARNING). O TextInput do React Native não tem essa opção, então
// o módulo ouve as mudanças de foco da janela e acrescenta a bandeira antes de o teclado conectar;
// se o teclado já estava conectado ao campo, ele recomeça com a bandeira. Vale para a mensagem, a
// busca, as 12 palavras, o ID e o apelido, e para qualquer campo novo.
class TecladoModule : Module() {
  private var observada: WeakReference<View>? = null

  private val ouvinte = ViewTreeObserver.OnGlobalFocusChangeListener { _, novo -> marcar(novo) }

  override fun definition() = ModuleDefinition {
    Name("CifraTeclado")

    OnActivityEntersForeground {
      val raiz = appContext.currentActivity?.window?.decorView ?: return@OnActivityEntersForeground
      if (observada?.get() === raiz) return@OnActivityEntersForeground
      observada?.get()?.viewTreeObserver?.takeIf { it.isAlive }?.removeOnGlobalFocusChangeListener(ouvinte)
      raiz.viewTreeObserver.addOnGlobalFocusChangeListener(ouvinte)
      observada = WeakReference(raiz)
      marcar(raiz.findFocus())
    }

    OnDestroy {
      observada?.get()?.viewTreeObserver?.takeIf { it.isAlive }?.removeOnGlobalFocusChangeListener(ouvinte)
      observada = null
    }

    AsyncFunction("campoEmFoco") {
      val campo = appContext.currentActivity?.window?.decorView?.findFocus() as? EditText
      when {
        campo == null -> "sem-campo"
        campo.imeOptions and EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING != 0 -> "sem-aprender"
        else -> "aprende"
      }
    }.runOnQueue(Queues.MAIN)
  }

  private fun marcar(vista: View?) {
    val campo = vista as? EditText ?: return
    val bandeira = EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
    if (campo.imeOptions and bandeira != 0) return
    campo.imeOptions = campo.imeOptions or bandeira
    val teclado = campo.context.getSystemService(InputMethodManager::class.java)
    if (teclado.isActive(campo)) teclado.restartInput(campo)
  }
}
