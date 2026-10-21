package org.cifra.plataforma

import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorSpace
import android.graphics.Matrix
import android.graphics.Paint
import android.media.ExifInterface
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.ext.SdkExtensions
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import com.facebook.drawee.backends.pipeline.Fresco
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.io.RandomAccessFile
import java.io.Serializable
import java.nio.ByteBuffer
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.max
import kotlin.math.min

// Fotos, vídeos e arquivos (RF-32 a RF-36, RF-53). Os seletores são os do sistema: o app não pede
// permissão de galeria nem de arquivos, e só lê o que a pessoa escolheu, enquanto escolhe.
//
// - Foto (RF-32): decodificada e recodificada em JPEG 85 (PNG, se tiver transparência), no máximo
//   2048 px no lado maior, em sRGB, de pé (a orientação do EXIF vira pixels). O arquivo novo não
//   leva nada do original: nem EXIF (GPS, modelo, data), nem miniatura, nem perfil de cor. GIF vira
//   foto parada. O JPEG sai sem o perfil de cor que o Android embute.
// - Vídeo (RF-33): as trilhas de vídeo e de áudio vão para um MP4 novo, sem recodificar e sem
//   metadados (sem localização, sem modelo). O MP4 passa por um arquivo temporário no cache do app,
//   zerado e apagado logo depois; a cópia para assim que passa do limite do anexo. A capa é um
//   quadro em JPEG.
// - Documento (RF-34): vai como está, sem o nome nem as datas do arquivo.
// - A miniatura (JPEG pequeno) vai dentro da mensagem, desfocada até o anexo baixar.
// - Salvar no celular (RF-53) só acontece quando a pessoa pede: foto e vídeo na galeria (álbum
//   Cifra), documento em Download/Cifra, com um nome neutro e a data do salvamento.
// - O backup (RF-46) sai pelo "salvar como" do sistema: a pessoa escolhe a pasta e o nome.
//
// Nada aqui escreve log (RNF-05).
class AnexosModule : Module() {
  private lateinit var seletor: AppContextActivityResultLauncher<PedidoDoSeletor, ArrayList<String>>
  private lateinit var criador: AppContextActivityResultLauncher<PedidoDoArquivo, String>

  private val contexto: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("CifraAnexos")

    RegisterActivityContracts {
      seletor = registerForActivityResult(ContratoDoSeletor())
      criador = registerForActivityResult(ContratoDoArquivoNovo())
    }

    // `midia`: fotos e vídeos; `arquivo`: qualquer arquivo. Até `limite` itens; vazio se cancelou.
    AsyncFunction("escolher") Coroutine { tipo: String, limite: Int ->
      val enderecos = seletor.launch(PedidoDoSeletor(tipo == "midia", limite))
      val resolver = contexto.contentResolver
      enderecos.take(limite).map { endereco ->
        mapOf("endereco" to endereco, "formato" to (resolver.getType(Uri.parse(endereco)) ?: GENERICO))
      }
    }

    AsyncFunction("prepararImagem") { endereco: String ->
      val uri = Uri.parse(endereco)
      prepararImagem { contexto.contentResolver.openInputStream(uri) ?: throw naoAbre() }
    }

    // A verificação técnica limpa uma foto montada na memória, com EXIF de teste.
    AsyncFunction("prepararImagemDosBytes") { bytes: ByteArray ->
      prepararImagem { ByteArrayInputStream(bytes) }
    }

    // `maximo`: os bytes que cabem no maior anexo (o limite vem do protocolo, pelo JS).
    AsyncFunction("prepararVideo") { endereco: String, maximo: Int ->
      prepararVideo(Uri.parse(endereco), maximo)
    }

    AsyncFunction("lerDocumento") { endereco: String, maximo: Int ->
      val uri = Uri.parse(endereco)
      val resolver = contexto.contentResolver
      val bytes = (resolver.openInputStream(uri) ?: throw naoAbre()).use { lerAte(it, maximo) }
      mapOf("bytes" to bytes, "formato" to (resolver.getType(uri) ?: GENERICO))
    }

    AsyncFunction("salvarNoCelular") { bytes: ByteArray, formato: String, arquivo: String ->
      try {
        salvarNoCelular(bytes, formato, arquivo)
      } finally {
        bytes.fill(0)
      }
    }

    // O "salvar como" do sistema, com o nome sugerido. Devolve `false` se a pessoa cancelou. Os bytes
    // são zerados depois de gravados.
    AsyncFunction("salvarArquivo") Coroutine { bytes: ByteArray, nome: String ->
      try {
        val endereco = criador.launch(PedidoDoArquivo(nome))
        if (endereco.isEmpty()) false else salvarEm(Uri.parse(endereco), bytes)
      } finally {
        bytes.fill(0)
      }
    }

    // As imagens que a tela decodificou ficam no cache de memória do Fresco: no bloqueio, saem.
    Function("esquecerImagens") {
      try {
        Fresco.getImagePipeline().clearMemoryCaches()
      } catch (_: Exception) {
        // Sem o Fresco iniciado, não há o que esquecer.
      }
    }

    // A verificação técnica: um JPEG simples, para montar o EXIF de teste em cima.
    AsyncFunction("jpegDeTeste") {
      val bitmap = Bitmap.createBitmap(64, 48, Bitmap.Config.ARGB_8888)
      Canvas(bitmap).apply {
        drawColor(Color.rgb(198, 244, 50))
        drawCircle(32f, 24f, 14f, Paint().apply { color = Color.rgb(11, 12, 11) })
      }
      comprimir(bitmap, Bitmap.CompressFormat.JPEG, 90).also { bitmap.recycle() }
    }
  }

  // ------------------------------------------------------------------ seletor

  /** `midia`: fotos e vídeos. */
  private data class PedidoDoSeletor(val midia: Boolean, val limite: Int) : Serializable

  /**
   * O seletor de fotos do Android (sem permissão nenhuma) quando existe; senão, o de documentos.
   * As permissões de leitura valem só enquanto o app usa: nada fica registrado depois.
   */
  private class ContratoDoSeletor : AppContextActivityResultContract<PedidoDoSeletor, ArrayList<String>> {
    override fun createIntent(context: Context, input: PedidoDoSeletor): Intent =
      if (input.midia && seletorDeFotosDisponivel()) {
        Intent(ACAO_DO_SELETOR_DE_FOTOS).apply {
          if (input.limite > 1) putExtra(EXTRA_DO_LIMITE, min(input.limite, LIMITE_DO_SELETOR))
        }
      } else {
        Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
          addCategory(Intent.CATEGORY_OPENABLE)
          type = "*/*"
          if (input.midia) putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "video/*"))
          putExtra(Intent.EXTRA_ALLOW_MULTIPLE, input.limite > 1)
        }
      }

    override fun parseResult(input: PedidoDoSeletor, resultCode: Int, intent: Intent?): ArrayList<String> {
      val enderecos = ArrayList<String>()
      if (resultCode != Activity.RESULT_OK || intent == null) return enderecos
      val clipe = intent.clipData
      if (clipe != null) {
        for (i in 0 until clipe.itemCount) clipe.getItemAt(i).uri?.let { enderecos.add(it.toString()) }
      } else {
        intent.data?.let { enderecos.add(it.toString()) }
      }
      return enderecos
    }

    private fun seletorDeFotosDisponivel(): Boolean =
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ||
        (
          Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
            SdkExtensions.getExtensionVersion(Build.VERSION_CODES.R) >= 2
          )
  }

  /** O nome sugerido no "salvar como". */
  private data class PedidoDoArquivo(val nome: String) : Serializable

  /** O "salvar como" do sistema (ACTION_CREATE_DOCUMENT): sem permissão de armazenamento. */
  private class ContratoDoArquivoNovo : AppContextActivityResultContract<PedidoDoArquivo, String> {
    override fun createIntent(context: Context, input: PedidoDoArquivo): Intent =
      Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = GENERICO
        putExtra(Intent.EXTRA_TITLE, input.nome)
      }

    override fun parseResult(input: PedidoDoArquivo, resultCode: Int, intent: Intent?): String =
      if (resultCode == Activity.RESULT_OK) intent?.data?.toString() ?: "" else ""
  }

  /** Grava os bytes no arquivo que a pessoa criou; se não der, apaga o arquivo vazio e lança. */
  private fun salvarEm(destino: Uri, bytes: ByteArray): Boolean {
    val resolver = contexto.contentResolver
    try {
      (resolver.openOutputStream(destino, "wt") ?: throw CodedException("nao-salvou", "nao-salvou", null)).use {
        it.write(bytes)
      }
    } catch (erro: Exception) {
      try {
        DocumentsContract.deleteDocument(resolver, destino)
      } catch (_: Exception) {
        // O provedor não deixa apagar: fica o arquivo vazio.
      }
      throw CodedException("nao-salvou", erro.javaClass.simpleName, null)
    }
    return true
  }

  // ------------------------------------------------------------------ foto

  /** Recodifica a foto: nada do arquivo original passa, só os pixels. */
  private fun prepararImagem(abrir: () -> InputStream): Map<String, Any> {
    val medidas = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    abrir().use { BitmapFactory.decodeStream(it, null, medidas) }
    if (medidas.outWidth <= 0 || medidas.outHeight <= 0) throw naoAbre()
    val orientacao = try {
      abrir().use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }
    } catch (_: Exception) {
      ExifInterface.ORIENTATION_NORMAL
    }
    var amostra = 1
    while (max(medidas.outWidth, medidas.outHeight) / (amostra * 2) >= LADO_DA_FOTO) amostra *= 2
    val opcoes = BitmapFactory.Options().apply {
      inSampleSize = amostra
      inPreferredConfig = Bitmap.Config.ARGB_8888
      inPreferredColorSpace = ColorSpace.get(ColorSpace.Named.SRGB)
    }
    val decodificada = abrir().use { BitmapFactory.decodeStream(it, null, opcoes) } ?: throw naoAbre()
    val escala = min(1f, LADO_DA_FOTO.toFloat() / max(decodificada.width, decodificada.height))
    val matriz = Matrix().apply {
      postScale(escala, escala)
      when (orientacao) {
        ExifInterface.ORIENTATION_ROTATE_90 -> postRotate(90f)
        ExifInterface.ORIENTATION_ROTATE_180 -> postRotate(180f)
        ExifInterface.ORIENTATION_ROTATE_270 -> postRotate(270f)
        ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> postScale(-1f, 1f)
        ExifInterface.ORIENTATION_FLIP_VERTICAL -> postScale(1f, -1f)
        ExifInterface.ORIENTATION_TRANSPOSE -> {
          postRotate(90f)
          postScale(-1f, 1f)
        }
        ExifInterface.ORIENTATION_TRANSVERSE -> {
          postRotate(270f)
          postScale(-1f, 1f)
        }
      }
    }
    val final = Bitmap.createBitmap(decodificada, 0, 0, decodificada.width, decodificada.height, matriz, true)
    if (final !== decodificada) decodificada.recycle()
    try {
      val transparente = final.hasAlpha()
      val bytes = if (transparente) {
        comprimir(final, Bitmap.CompressFormat.PNG, 100)
      } else {
        comprimir(final, Bitmap.CompressFormat.JPEG, QUALIDADE_DA_FOTO)
      }
      return mapOf(
        "bytes" to bytes,
        "formato" to if (transparente) "image/png" else "image/jpeg",
        "largura" to final.width,
        "altura" to final.height,
        "miniatura" to miniatura(final),
      )
    } finally {
      final.recycle()
    }
  }

  private fun comprimir(bitmap: Bitmap, formato: Bitmap.CompressFormat, qualidade: Int): ByteArray {
    val bytes = ByteArrayOutputStream().also { bitmap.compress(formato, qualidade, it) }.toByteArray()
    return if (formato == Bitmap.CompressFormat.JPEG) semPerfilDeCor(bytes) else bytes
  }

  /**
   * Tira o perfil de cor (APP2 ICC_PROFILE) que o Android põe no JPEG: a foto já está em sRGB, e
   * sem perfil ela é lida como sRGB. Assim o arquivo não leva nem o perfil genérico do aparelho.
   */
  private fun semPerfilDeCor(jpeg: ByteArray): ByteArray {
    if (jpeg.size < 4 || jpeg[0] != 0xFF.toByte() || jpeg[1] != 0xD8.toByte()) return jpeg
    val saida = ByteArrayOutputStream(jpeg.size)
    saida.write(jpeg, 0, 2)
    var i = 2
    while (i + 4 <= jpeg.size && jpeg[i] == 0xFF.toByte()) {
      val marcador = jpeg[i + 1].toInt() and 0xFF
      // Daqui em diante vêm os dados da imagem: vão inteiros.
      if (marcador == 0xDA) break
      val tamanho = ((jpeg[i + 2].toInt() and 0xFF) shl 8) or (jpeg[i + 3].toInt() and 0xFF)
      val fim = i + 2 + tamanho
      if (tamanho < 2 || fim > jpeg.size) return jpeg
      val perfil = marcador == 0xE2 && tamanho >= 13 && String(jpeg, i + 4, 11, Charsets.US_ASCII) == "ICC_PROFILE"
      if (!perfil) saida.write(jpeg, i, fim - i)
      i = fim
    }
    saida.write(jpeg, i, jpeg.size - i)
    return saida.toByteArray()
  }

  /** Um JPEG pequeno do quadro, que cabe dentro da mensagem. */
  private fun miniatura(origem: Bitmap): ByteArray = jpegAte(origem, LADO_DA_MINIATURA, LIMITE_DA_MINIATURA)

  /**
   * O quadro reduzido a `lado` px no lado maior, em JPEG, sem passar de `limite` bytes: a qualidade
   * e o tamanho baixam até caber. A transparência vira o fundo escuro do app.
   */
  private fun jpegAte(origem: Bitmap, lado: Int, limite: Int): ByteArray {
    var medida = lado
    while (medida >= 8) {
      val escala = min(1f, medida.toFloat() / max(origem.width, origem.height))
      val largura = max(1, (origem.width * escala).toInt())
      val altura = max(1, (origem.height * escala).toInt())
      val reduzida = Bitmap.createBitmap(largura, altura, Bitmap.Config.ARGB_8888)
      val escalada = Bitmap.createScaledBitmap(origem, largura, altura, true)
      Canvas(reduzida).apply {
        drawColor(Color.rgb(11, 12, 11))
        drawBitmap(escalada, 0f, 0f, null)
      }
      if (escalada !== origem) escalada.recycle()
      try {
        for (qualidade in intArrayOf(70, 55, 40, 25)) {
          val bytes = comprimir(reduzida, Bitmap.CompressFormat.JPEG, qualidade)
          if (bytes.size <= limite) return bytes
        }
      } finally {
        reduzida.recycle()
      }
      medida = medida * 3 / 4
    }
    return ByteArray(0)
  }

  // ------------------------------------------------------------------ vídeo

  /**
   * Passa as trilhas de vídeo e de áudio para um MP4 novo, sem recodificar: o que o MP4 original
   * tinha de metadados (localização, modelo, datas) não vai. A rotação vai como indicação do MP4.
   */
  private fun prepararVideo(uri: Uri, maximo: Int): Map<String, Any> {
    val leitor = MediaMetadataRetriever()
    try {
      leitor.setDataSource(contexto, uri)
      val rotacao = leitor.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
      val larguraNoArquivo = leitor.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
      val alturaNoArquivo = leitor.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
      val deLado = rotacao == 90 || rotacao == 270
      val duracao = leitor.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
      val quadro = leitor.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC) ?: throw naoAbre()
      val capa: ByteArray
      val miniatura: ByteArray
      try {
        capa = jpegAte(quadro, LADO_DA_CAPA, LIMITE_DA_CAPA)
        miniatura = miniatura(quadro)
      } finally {
        quadro.recycle()
      }
      if (capa.isEmpty() || larguraNoArquivo <= 0 || alturaNoArquivo <= 0) throw naoAbre()
      val bytes = remuxar(uri, rotacao, maximo - capa.size)
      return mapOf(
        "bytes" to bytes,
        "formato" to "video/mp4",
        "largura" to if (deLado) alturaNoArquivo else larguraNoArquivo,
        "altura" to if (deLado) larguraNoArquivo else alturaNoArquivo,
        "duracao" to duracao.toDouble(),
        "capa" to capa,
        "miniatura" to miniatura,
      )
    } finally {
      leitor.release()
    }
  }

  /**
   * O MP4 novo, lido do arquivo temporário, que é zerado e apagado antes de devolver. O arquivo tem
   * pelo menos as amostras: quando elas passam de `maximo`, recusa sem copiar o resto.
   */
  private fun remuxar(uri: Uri, rotacao: Int, maximo: Int): ByteArray {
    val temporario = File.createTempFile("cifra", ".mp4", contexto.cacheDir)
    try {
      val extrator = MediaExtractor()
      var muxer: MediaMuxer? = null
      try {
        extrator.setDataSource(contexto, uri, null)
        muxer = MediaMuxer(temporario.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        val trilhas = HashMap<Int, Int>()
        var maiorAmostra = 1024 * 1024
        var temVideo = false
        for (i in 0 until extrator.trackCount) {
          val formato = extrator.getTrackFormat(i)
          val tipo = formato.getString(MediaFormat.KEY_MIME) ?: continue
          val video = tipo.startsWith("video/")
          if (!video && !tipo.startsWith("audio/")) continue
          val trilha = try {
            muxer.addTrack(formato)
          } catch (erro: Exception) {
            // Áudio num formato que o MP4 não aceita fica de fora; vídeo assim, não dá.
            if (video) throw naoAbre() else continue
          }
          if (video) temVideo = true
          trilhas[i] = trilha
          extrator.selectTrack(i)
          if (formato.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
            maiorAmostra = max(maiorAmostra, formato.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE))
          }
        }
        if (!temVideo) throw naoAbre()
        muxer.setOrientationHint(rotacao)
        muxer.start()
        val amostra = ByteBuffer.allocate(maiorAmostra)
        val info = MediaCodec.BufferInfo()
        var copiados = 0L
        while (true) {
          val tamanho = extrator.readSampleData(amostra, 0)
          if (tamanho < 0) break
          val trilha = trilhas[extrator.sampleTrackIndex]
          if (trilha != null) {
            copiados += tamanho
            if (copiados > maximo) throw grandeDemais()
            val chave = (extrator.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC) != 0
            info.set(0, tamanho, extrator.sampleTime, if (chave) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
            muxer.writeSampleData(trilha, amostra, info)
          }
          extrator.advance()
        }
        muxer.stop()
      } finally {
        try {
          muxer?.release()
        } catch (_: Exception) {
          // Parado no meio: o arquivo temporário sai abaixo.
        }
        extrator.release()
      }
      if (temporario.length() > maximo) throw grandeDemais()
      return temporario.readBytes()
    } finally {
      zerarEApagar(temporario)
    }
  }

  private fun zerarEApagar(arquivo: File) {
    try {
      RandomAccessFile(arquivo, "rw").use { saida ->
        val zeros = ByteArray(PEDACO)
        var restante = saida.length()
        saida.seek(0)
        while (restante > 0) {
          val parte = min(restante, PEDACO.toLong()).toInt()
          saida.write(zeros, 0, parte)
          restante -= parte
        }
        saida.fd.sync()
      }
    } catch (_: Exception) {
      // Sem conseguir zerar, ao menos apaga.
    }
    arquivo.delete()
  }

  // ------------------------------------------------------------------ documento e salvar

  /** Lê até `maximo` bytes; mais que isso, recusa. */
  private fun lerAte(entrada: InputStream, maximo: Int): ByteArray {
    val saida = ByteArrayOutputStream()
    val pedaco = ByteArray(PEDACO)
    while (true) {
      val n = entrada.read(pedaco)
      if (n < 0) break
      if (saida.size() + n > maximo) throw grandeDemais()
      saida.write(pedaco, 0, n)
    }
    if (saida.size() == 0) throw naoAbre()
    return saida.toByteArray()
  }

  /** Grava pelo MediaStore, sem permissão de armazenamento: só o que a pessoa pediu para salvar. */
  private fun salvarNoCelular(bytes: ByteArray, formato: String, arquivo: String) {
    val volume = MediaStore.VOLUME_EXTERNAL_PRIMARY
    val (colecao, pasta) = when (arquivo) {
      "imagem" -> MediaStore.Images.Media.getContentUri(volume) to "${Environment.DIRECTORY_PICTURES}/Cifra"
      "video" -> MediaStore.Video.Media.getContentUri(volume) to "${Environment.DIRECTORY_MOVIES}/Cifra"
      else -> MediaStore.Downloads.getContentUri(volume) to "${Environment.DIRECTORY_DOWNLOADS}/Cifra"
    }
    val extensao = MimeTypeMap.getSingleton().getExtensionFromMimeType(formato)
    val nome = "Cifra " + SimpleDateFormat("yyyy-MM-dd HH-mm-ss", Locale.ROOT).format(Date()) +
      (extensao?.let { ".$it" } ?: "")
    val resolver = contexto.contentResolver
    val valores = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, nome)
      put(MediaStore.MediaColumns.MIME_TYPE, formato)
      put(MediaStore.MediaColumns.RELATIVE_PATH, pasta)
      put(MediaStore.MediaColumns.IS_PENDING, 1)
    }
    val destino = resolver.insert(colecao, valores) ?: throw CodedException("nao-salvou", "nao-salvou", null)
    try {
      (resolver.openOutputStream(destino) ?: throw CodedException("nao-salvou", "nao-salvou", null)).use {
        it.write(bytes)
      }
      resolver.update(destino, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
    } catch (erro: Exception) {
      resolver.delete(destino, null, null)
      throw CodedException("nao-salvou", erro.javaClass.simpleName, null)
    }
  }

  private fun naoAbre() = CodedException("nao-abre", "nao-abre", null)

  private fun grandeDemais() = CodedException("grande", "grande", null)

  private companion object {
    const val GENERICO = "application/octet-stream"

    const val LADO_DA_FOTO = 2048
    const val QUALIDADE_DA_FOTO = 85
    const val LADO_DA_CAPA = 720
    const val LIMITE_DA_CAPA = 61_440
    const val LADO_DA_MINIATURA = 40
    const val LIMITE_DA_MINIATURA = 1536
    const val PEDACO = 65_536

    /** `MediaStore.ACTION_PICK_IMAGES` e o limite dele, pelo nome: valem também no Android 11 e 12 atualizados. */
    const val ACAO_DO_SELETOR_DE_FOTOS = "android.provider.action.PICK_IMAGES"
    const val EXTRA_DO_LIMITE = "android.provider.extra.PICK_IMAGES_MAX"
    const val LIMITE_DO_SELETOR = 10
  }
}
