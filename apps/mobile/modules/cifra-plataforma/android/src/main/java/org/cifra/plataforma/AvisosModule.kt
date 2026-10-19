package org.cifra.plataforma

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.os.Build
import android.os.IBinder
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.types.OptimizedRecord

// Notificações cegas (RF-42), sem Google. O serviço em primeiro plano mantém o processo vivo com o
// app fora da frente: o correio segue até o app bloquear, e depois o vigia (no JS) abre a caixa e
// avisa de mensagem nova. O aviso diz só "nova mensagem": nem remetente, nem conteúdo, nem
// contagem. Os textos vêm do JS, na língua da interface. Nada aqui escreve log (RNF-05).
class AvisosModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CifraAvisos")

    // O Android só deixa ligar o serviço com o app na frente: o JS liga ao abrir e ao desbloquear.
    AsyncFunction("ligar") { textos: TextosDosAvisos ->
      val contexto = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      criarCanais(contexto, textos)
      val intencao = Intent(contexto, ServicoDeAvisos::class.java).putExtra(ServicoDeAvisos.TEXTO, textos.servico)
      contexto.startForegroundService(intencao)
      // Sem valor de volta: o Expo não converte o ComponentName do startForegroundService, e a
      // promessa falharia com o serviço já ligado.
      Unit
    }

    // O pedido de parar entra na fila do serviço, depois de um ligar que ainda não subiu: parar
    // antes do startForeground derruba o app.
    AsyncFunction("desligar") {
      val contexto = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      try {
        contexto.startService(Intent(contexto, ServicoDeAvisos::class.java).setAction(ServicoDeAvisos.PARAR))
      } catch (_: IllegalStateException) {
        // Fora da frente e sem o serviço, o Android recusa o pedido: não há o que parar.
      }
      contexto.getSystemService(NotificationManager::class.java).cancel(ID_DA_MENSAGEM)
    }

    AsyncFunction("avisar") { textos: TextosDosAvisos ->
      val contexto = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      criarCanais(contexto, textos)
      val aviso = Notification.Builder(contexto, CANAL_DE_MENSAGENS)
        .setSmallIcon(R.drawable.cifra_aviso)
        .setColor(FOSFORO)
        .setContentText(textos.novaMensagem)
        .setContentIntent(abrirApp(contexto))
        .setAutoCancel(true)
        .setCategory(Notification.CATEGORY_MESSAGE)
        .build()
      contexto.getSystemService(NotificationManager::class.java).notify(ID_DA_MENSAGEM, aviso)
    }

    AsyncFunction("limpar") {
      val contexto = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      contexto.getSystemService(NotificationManager::class.java).cancel(ID_DA_MENSAGEM)
    }

    AsyncFunction("permitidas") {
      val contexto = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      contexto.getSystemService(NotificationManager::class.java).areNotificationsEnabled()
    }
  }

  companion object {
    const val CANAL_DE_MENSAGENS = "mensagens"
    const val CANAL_DO_SERVICO = "servico"
    const val ID_DA_MENSAGEM = 1
    const val ID_DO_SERVICO = 2

    /** O acento do design, na cor do ícone: fósforo. */
    val FOSFORO = Color.parseColor("#C6F432")

    /** Recriar o canal com o mesmo ID só troca o nome: o que a pessoa ajustou nele fica. */
    fun criarCanais(contexto: Context, textos: TextosDosAvisos) {
      val gerente = contexto.getSystemService(NotificationManager::class.java)
      gerente.createNotificationChannel(
        NotificationChannel(CANAL_DE_MENSAGENS, textos.canalDeMensagens, NotificationManager.IMPORTANCE_DEFAULT).apply {
          setShowBadge(false)
        },
      )
      gerente.createNotificationChannel(
        NotificationChannel(CANAL_DO_SERVICO, textos.canalDoServico, NotificationManager.IMPORTANCE_MIN).apply {
          setShowBadge(false)
        },
      )
    }

    fun abrirApp(contexto: Context): PendingIntent? {
      val intencao = contexto.packageManager.getLaunchIntentForPackage(contexto.packageName) ?: return null
      return PendingIntent.getActivity(contexto, 0, intencao, PendingIntent.FLAG_IMMUTABLE)
    }
  }
}

// Com o R8 do release, a conversão por reflexão do Record falha (o campo some para o kotlin-reflect):
// a anotação faz o plugin do Expo gerar a conversão na compilação.
@OptimizedRecord
class TextosDosAvisos : Record {
  @Field val canalDeMensagens: String = ""
  @Field val canalDoServico: String = ""
  @Field val servico: String = ""
  @Field val novaMensagem: String = ""
}

/**
 * O serviço em primeiro plano: só o aviso fixo, discreto (canal de importância mínima). Não faz
 * rede: quem fala com o relay é o JS, no mesmo processo. Parado pelo sistema, não volta sozinho; o
 * app liga de novo quando a pessoa abre o Cifra.
 */
class ServicoDeAvisos : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Os pedidos chegam na ordem: o de parar só vale se nenhum de ligar veio depois dele.
    if (intent?.action == PARAR) {
      stopSelf(startId)
      return START_NOT_STICKY
    }
    val texto = intent?.getStringExtra(TEXTO) ?: ""
    val aviso = Notification.Builder(this, AvisosModule.CANAL_DO_SERVICO)
      .setSmallIcon(R.drawable.cifra_aviso)
      .setColor(AvisosModule.FOSFORO)
      .setContentText(texto)
      .setContentIntent(AvisosModule.abrirApp(this))
      .setOngoing(true)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(AvisosModule.ID_DO_SERVICO, aviso, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(AvisosModule.ID_DO_SERVICO, aviso)
    }
    return START_NOT_STICKY
  }

  companion object {
    const val TEXTO = "texto"
    const val PARAR = "org.cifra.plataforma.PARAR"
  }
}
