package org.cifra.plataforma

import android.os.Build
import android.view.View
import android.view.WindowInsetsController
import android.view.WindowManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Bloqueio de print e gravação de tela (RF-41). O FLAG_SECURE já nasce ligado no
// MainActivity.onCreate (plugin tela-segura), antes do JS; daqui o JS só desliga se a pessoa
// escolher, e religa depois.
//
// As barras do sistema seguem o tema (RF-39): no claro, os ícones da barra de navegação ficam
// escuros, senão somem no fundo claro. A barra de status fica com o StatusBar do React Native.
class TelaSeguraModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CifraTelaSegura")

    AsyncFunction("definir") { segura: Boolean ->
      val janela = (appContext.currentActivity ?: throw Exceptions.MissingActivity()).window
      if (segura) {
        janela.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
      } else {
        janela.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("estaSegura") {
      val janela = (appContext.currentActivity ?: throw Exceptions.MissingActivity()).window
      (janela.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE) != 0
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("definirNavegacaoClara") { clara: Boolean ->
      val janela = (appContext.currentActivity ?: throw Exceptions.MissingActivity()).window
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        val mascara = WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
        janela.insetsController?.setSystemBarsAppearance(if (clara) mascara else 0, mascara)
      } else {
        // Android 10: as bandeiras antigas da decorView.
        @Suppress("DEPRECATION")
        val bandeira = View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        val vista = janela.decorView
        @Suppress("DEPRECATION")
        vista.systemUiVisibility =
          if (clara) vista.systemUiVisibility or bandeira else vista.systemUiVisibility and bandeira.inv()
      }
    }.runOnQueue(Queues.MAIN)
  }
}
