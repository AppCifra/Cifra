package org.cifra.plataforma

import android.content.Context
import android.graphics.SurfaceTexture
import android.media.MediaDataSource
import android.media.MediaPlayer
import android.view.Surface
import android.view.TextureView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

// O vídeo toca da memória (RF-36): os bytes decifrados ficam numa tabela por número, e o MediaPlayer
// lê deles por um MediaDataSource, sem nenhum arquivo. Soltar zera os bytes. A imagem vai para um
// TextureView, que o FLAG_SECURE da janela também cobre.
class VideoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CifraVideo")

    Function("carregar") { bytes: ByteArray -> VideosNaMemoria.guardar(bytes) }

    Function("soltar") { numero: Int -> VideosNaMemoria.soltar(numero) }

    View(VideoNaTela::class) {
      Events("onPronto", "onFim")

      Prop("fonte") { tela: VideoNaTela, fonte: Int -> tela.mudarFonte(fonte) }

      Prop("tocando") { tela: VideoNaTela, tocando: Boolean -> tela.mudarTocando(tocando) }

      OnViewDestroys { tela: VideoNaTela -> tela.soltar() }
    }
  }
}

/** Os vídeos abertos, pelo número que o JS recebeu ao carregar. */
internal object VideosNaMemoria {
  private val videos = ConcurrentHashMap<Int, ByteArray>()
  private val proximo = AtomicInteger(1)

  fun guardar(bytes: ByteArray): Int {
    val numero = proximo.getAndIncrement()
    videos[numero] = bytes
    return numero
  }

  fun ler(numero: Int): ByteArray? = videos[numero]

  fun soltar(numero: Int) {
    videos.remove(numero)?.fill(0)
  }
}

class VideoNaTela(context: Context, appContext: AppContext) :
  ExpoView(context, appContext),
  TextureView.SurfaceTextureListener {
  override val shouldUseAndroidLayout = true

  private val onPronto by EventDispatcher()
  private val onFim by EventDispatcher()
  private var superficie: Surface? = null
  private var player: MediaPlayer? = null
  private var pronto = false
  private var fonte = 0
  private var tocando = false

  init {
    addView(TextureView(context).also { it.surfaceTextureListener = this }, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  fun mudarFonte(nova: Int) {
    if (nova == fonte) return
    fonte = nova
    preparar()
  }

  fun mudarTocando(sim: Boolean) {
    tocando = sim
    aplicar()
  }

  fun soltar() {
    soltarPlayer()
  }

  private fun preparar() {
    soltarPlayer()
    val bytes = VideosNaMemoria.ler(fonte) ?: return
    val alvo = superficie ?: return
    val novo = MediaPlayer()
    player = novo
    try {
      novo.setDataSource(FonteNaMemoria(bytes))
      novo.setSurface(alvo)
      novo.setOnPreparedListener {
        pronto = true
        onPronto(mapOf("duracao" to it.duration))
        aplicar()
      }
      novo.setOnCompletionListener {
        tocando = false
        onFim(mapOf())
      }
      novo.setOnErrorListener { _, _, _ -> true }
      novo.prepareAsync()
    } catch (_: Exception) {
      soltarPlayer()
    }
  }

  private fun aplicar() {
    val atual = player ?: return
    if (!pronto) return
    if (tocando && !atual.isPlaying) atual.start() else if (!tocando && atual.isPlaying) atual.pause()
  }

  private fun soltarPlayer() {
    player?.release()
    player = null
    pronto = false
  }

  override fun onSurfaceTextureAvailable(textura: SurfaceTexture, largura: Int, altura: Int) {
    superficie = Surface(textura)
    preparar()
  }

  override fun onSurfaceTextureSizeChanged(textura: SurfaceTexture, largura: Int, altura: Int) = Unit

  override fun onSurfaceTextureDestroyed(textura: SurfaceTexture): Boolean {
    soltarPlayer()
    superficie?.release()
    superficie = null
    return true
  }

  override fun onSurfaceTextureUpdated(textura: SurfaceTexture) = Unit
}

/** O vídeo lido direto dos bytes na memória. */
private class FonteNaMemoria(private val bytes: ByteArray) : MediaDataSource() {
  override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
    if (position >= bytes.size) return -1
    val quantos = minOf(size.toLong(), bytes.size - position).toInt()
    System.arraycopy(bytes, position.toInt(), buffer, offset, quantos)
    return quantos
  }

  override fun getSize(): Long = bytes.size.toLong()

  override fun close() = Unit
}
