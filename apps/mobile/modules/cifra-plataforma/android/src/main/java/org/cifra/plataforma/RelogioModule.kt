package org.cifra.plataforma

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.ConcurrentHashMap

// O relógio do app fora da frente (RF-40, RF-42). No Android, os timers do JS param com o app em
// segundo plano; os daqui seguem numa thread própria enquanto o processo vive (o serviço de
// notificação o mantém vivo). Eles não contam o tempo com o aparelho dormindo, então o prazo do
// bloqueio sozinho fica com o AlarmManager, que acorda o aparelho na hora (sem permissão de alarme
// exato: o Android pode atrasar alguns minutos com o aparelho parado).
//
// Ao voltar para a frente depois do prazo, uma capa da cor do fundo cobre a janela antes do primeiro
// quadro: a conversa não aparece nem por um instante antes da tela de bloqueio. O JS tira a capa
// quando a tela de bloqueio está desenhada.
class RelogioModule : Module() {
  private val linha = HandlerThread("cifra-relogio").apply { start() }
  private val handler = Handler(linha.looper)
  private val esperas = ConcurrentHashMap<Int, Pair<Runnable, Promise>>()

  /** Quando o bloqueio vence, no relógio que conta o aparelho dormindo; nulo sem prazo armado. */
  @Volatile private var prazo: Long? = null
  @Volatile private var corDaCapa: Int = Color.BLACK
  private var capa: View? = null
  private var receptor: BroadcastReceiver? = null

  override fun definition() = ModuleDefinition {
    Name("CifraRelogio")

    Events("bloquear")

    OnCreate {
      val contexto = appContext.reactContext ?: return@OnCreate
      val novo = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
          sendEvent("bloquear", mapOf<String, Any>())
        }
      }
      val filtro = IntentFilter(acaoDoAlarme(contexto))
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        contexto.registerReceiver(novo, filtro, Context.RECEIVER_NOT_EXPORTED)
      } else {
        contexto.registerReceiver(novo, filtro)
      }
      receptor = novo
    }

    OnDestroy {
      receptor?.let { r -> appContext.reactContext?.let { runCatching { it.unregisterReceiver(r) } } }
      receptor = null
      appContext.reactContext?.let { cancelarAlarme(it) }
      esperas.values.forEach { (tarefa, promessa) ->
        handler.removeCallbacks(tarefa)
        promessa.resolve(false)
      }
      esperas.clear()
      linha.quitSafely()
    }

    /** Milissegundos desde que o aparelho ligou, contando o tempo dormindo. */
    Function("decorrido") { SystemClock.elapsedRealtime().toDouble() }

    /** Resolve com `true` depois de `ms`, ou com `false` se for cancelado antes. */
    AsyncFunction("esperar") { numero: Int, ms: Double, promessa: Promise ->
      val tarefa = Runnable { esperas.remove(numero)?.second?.resolve(true) }
      esperas[numero] = tarefa to promessa
      handler.postDelayed(tarefa, ms.toLong().coerceAtLeast(0))
    }

    Function("cancelar") { numero: Int ->
      esperas.remove(numero)?.let { (tarefa, promessa) ->
        handler.removeCallbacks(tarefa)
        promessa.resolve(false)
      }
    }

    /**
     * Arma o bloqueio para daqui a `ms`. Quando vence, o JS recebe `bloquear`, com o app na frente ou
     * não. `cor` é a do fundo do tema, para a capa.
     */
    Function("armarBloqueio") { ms: Double, cor: String ->
      val contexto = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val vence = SystemClock.elapsedRealtime() + ms.toLong().coerceAtLeast(0)
      prazo = vence
      corDaCapa = runCatching { Color.parseColor(cor) }.getOrDefault(Color.BLACK)
      val alarmes = contexto.getSystemService(AlarmManager::class.java)
      alarmes.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, vence, intencao(contexto))
    }

    Function("desarmarBloqueio") {
      prazo = null
      appContext.reactContext?.let { cancelarAlarme(it) }
    }

    /** Tira a capa, se houver. */
    AsyncFunction("descobrir") {
      capa?.let { atual -> (atual.parent as? ViewGroup)?.removeView(atual) }
      capa = null
    }.runOnQueue(Queues.MAIN)

    // Antes do primeiro quadro: com o prazo vencido, a janela volta coberta e o JS bloqueia.
    OnActivityEntersForeground {
      val vence = prazo ?: return@OnActivityEntersForeground
      if (SystemClock.elapsedRealtime() < vence) return@OnActivityEntersForeground
      prazo = null
      cobrir()
      sendEvent("bloquear", mapOf<String, Any>())
    }
  }

  private fun cobrir() {
    val atividade = appContext.currentActivity ?: return
    if (capa != null) return
    val raiz = atividade.window.decorView as? ViewGroup ?: return
    val nova = View(atividade).apply {
      setBackgroundColor(corDaCapa)
      isClickable = true
      importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    }
    raiz.addView(nova, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    capa = nova
  }

  private fun acaoDoAlarme(contexto: Context) = "${contexto.packageName}.BLOQUEAR_SOZINHO"

  private fun intencao(contexto: Context): PendingIntent =
    PendingIntent.getBroadcast(
      contexto,
      0,
      Intent(acaoDoAlarme(contexto)).setPackage(contexto.packageName),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

  private fun cancelarAlarme(contexto: Context) {
    contexto.getSystemService(AlarmManager::class.java).cancel(intencao(contexto))
  }
}
