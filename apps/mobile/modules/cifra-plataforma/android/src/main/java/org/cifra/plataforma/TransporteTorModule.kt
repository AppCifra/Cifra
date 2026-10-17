package org.cifra.plataforma

import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.typedarray.Uint8Array
import okhttp3.Call
import okhttp3.Dns
import okhttp3.MediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.BufferedSink
import okio.ByteString
import okio.ByteString.Companion.toByteString
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.Socket
import java.net.SocketAddress
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import javax.net.SocketFactory
import kotlin.concurrent.thread

// Canal binário até o relay (porta Transporte). Com Tor, cada conexão sai pelo SOCKS5 do Orbot,
// com a credencial do circuito que o JS pediu: o Tor só põe no mesmo circuito conexões com a mesma
// credencial (IsolateSOCKSAuth). O nome do host vai para o Tor dentro do pedido SOCKS, sem
// resolver: o .onion funciona e nenhuma consulta DNS sai do aparelho. Sem o Orbot, a conexão falha
// com "tor-indisponivel" e nunca tenta o caminho direto (RF-44, RNF-06). Nada aqui escreve log
// (RNF-05).
//
// O HTTP dos anexos passa pelo mesmo caminho, com a credencial do circuito pedido. A transferência
// parada por 60 s cai, a resposta maior que o limite é recusada (o app também não confia no relay)
// e o JS pode cancelar no meio. O progresso vai ao JS de tanto em tanto.
class TransporteTorModule : Module() {
  private val conexoes = ConcurrentHashMap<Int, WebSocket>()
  private val proximoId = AtomicInteger(1)
  private val pedidosHttp = ConcurrentHashMap<Int, Call>()
  /** Cancelados antes de o pedido sair: o JS pode cancelar antes de a thread começar. */
  private val canceladosHttp = ConcurrentHashMap.newKeySet<Int>()

  override fun definition() = ModuleDefinition {
    Name("CifraTransporte")

    Events("mensagem", "fechou", "progresso")

    // portaSocks nula: conexão direta, só aceita para wss:// (o JS valida o endereço antes).
    AsyncFunction("conectar") { endereco: String, portaSocks: Int?, credencial: String?, promise: Promise ->
      thread(name = "cifra-conectar") {
        if (portaSocks != null && (credencial == null || !socksResponde(portaSocks))) {
          promise.reject(CodedException("tor-indisponivel", "tor-indisponivel", null))
          return@thread
        }
        abrir(endereco, portaSocks, credencial, promise)
      }
    }

    Function("enviar") { id: Int, dados: Uint8Array ->
      val bytes = ByteArray(dados.byteLength)
      dados.read(bytes, 0, bytes.size)
      val enviado = conexoes[id]?.send(bytes.toByteString()) ?: false
      bytes.fill(0)
      if (!enviado) throw CodedException("conexao-fechada", "conexao-fechada", null)
    }

    AsyncFunction("fechar") { id: Int ->
      conexoes.remove(id)?.close(1000, null)
    }

    // O corpo chega como ByteArray: o Expo copia o Uint8Array na thread do JS, antes de começar.
    AsyncFunction("http") {
        numero: Int, metodo: String, endereco: String, portaSocks: Int?, credencial: String?,
        corpo: ByteArray?, limite: Int, promise: Promise ->
      thread(name = "cifra-http") {
        if (portaSocks != null && (credencial == null || !socksResponde(portaSocks))) {
          promise.reject(CodedException("tor-indisponivel", "tor-indisponivel", null))
          return@thread
        }
        pedirHttp(numero, metodo, endereco, portaSocks, credencial, corpo, limite, promise)
      }
    }

    Function("cancelarHttp") { numero: Int ->
      canceladosHttp.add(numero)
      pedidosHttp[numero]?.cancel()
    }

    OnDestroy {
      conexoes.values.forEach { it.cancel() }
      conexoes.clear()
      pedidosHttp.values.forEach { it.cancel() }
      pedidosHttp.clear()
    }
  }

  /** O cliente de uma conexão: com Tor, pelo SOCKS5 do Orbot com a credencial do circuito. */
  private fun cliente(portaSocks: Int?, credencial: String?, montar: OkHttpClient.Builder.() -> Unit): OkHttpClient =
    OkHttpClient.Builder()
      .connectTimeout(60, TimeUnit.SECONDS)
      .apply(montar)
      .apply {
        proxy(Proxy.NO_PROXY)
        if (portaSocks != null && credencial != null) {
          // O SOCKS embutido do Java só aceita uma credencial para o app inteiro. Aqui o OkHttp
          // conecta "direto" a um socket que faz o SOCKS5 com a credencial desta conexão.
          dns(NomeSemResolver)
          socketFactory(FabricaPeloTor(portaSocks, credencial.toByteArray(Charsets.US_ASCII)))
        }
      }
      .build()

  /**
   * Faz o pedido e lê a resposta em pedaços, sem passar de `limite`. Sem receber nem mandar nada
   * por 60 s, cai. Devolve o status e o corpo.
   */
  private fun pedirHttp(
    numero: Int,
    metodo: String,
    endereco: String,
    portaSocks: Int?,
    credencial: String?,
    corpo: ByteArray?,
    limite: Int,
    promise: Promise,
  ) {
    val cliente = cliente(portaSocks, credencial) {
      readTimeout(PARADA_EM_SEGUNDOS, TimeUnit.SECONDS)
      writeTimeout(PARADA_EM_SEGUNDOS, TimeUnit.SECONDS)
      // Um pedido só: sem repetir sozinho, nem seguir redirecionamento.
      retryOnConnectionFailure(false)
      followRedirects(false)
      followSslRedirects(false)
    }
    val progresso = Progresso { fracao -> sendEvent("progresso", mapOf("numero" to numero, "fracao" to fracao)) }
    val corpoDoPedido = when {
      corpo != null -> CorpoComProgresso(corpo, progresso)
      metodo == "PUT" -> CorpoComProgresso(ByteArray(0), progresso)
      else -> null
    }
    val chamada = cliente.newCall(Request.Builder().url(endereco).method(metodo, corpoDoPedido).build())
    pedidosHttp[numero] = chamada
    if (canceladosHttp.remove(numero)) chamada.cancel()
    try {
      chamada.execute().use { resposta ->
        val corpoDaResposta = resposta.body
        val tamanho = corpoDaResposta?.contentLength() ?: 0L
        if (tamanho > limite) throw IOException("grande")
        val saida = ByteArrayOutputStream(if (tamanho in 1..limite.toLong()) tamanho.toInt() else 0)
        corpoDaResposta?.byteStream()?.use { entrada ->
          val pedaco = ByteArray(PEDACO)
          var lidos = 0L
          while (true) {
            val n = entrada.read(pedaco)
            if (n < 0) break
            lidos += n
            if (lidos > limite) throw IOException("grande")
            saida.write(pedaco, 0, n)
            if (tamanho > 0) progresso.avisar(lidos.toDouble() / tamanho)
          }
        }
        promise.resolve(mapOf("status" to resposta.code, "corpo" to saida.toByteArray()))
      }
    } catch (erro: Exception) {
      // Só o código: a mensagem da exceção pode trazer o endereço (RNF-05).
      val codigo = if (chamada.isCanceled()) "cancelado" else "relay-inacessivel"
      promise.reject(CodedException(codigo, erro.javaClass.simpleName, null))
    } finally {
      pedidosHttp.remove(numero)
      canceladosHttp.remove(numero)
      corpo?.fill(0)
      cliente.dispatcher.executorService.shutdown()
      cliente.connectionPool.evictAll()
    }
  }

  /** Avisa o progresso a cada 1%, e sempre no fim. */
  private class Progresso(private val enviar: (Double) -> Unit) {
    private var avisado = -1.0

    fun avisar(fracao: Double) {
      if (fracao < 1.0 && fracao - avisado < 0.01) return
      avisado = fracao
      enviar(fracao)
    }
  }

  /** O corpo do PUT, escrito em pedaços: o progresso acompanha o que saiu. */
  private class CorpoComProgresso(private val bytes: ByteArray, private val progresso: Progresso) : RequestBody() {
    override fun contentType(): MediaType? = null

    override fun contentLength(): Long = bytes.size.toLong()

    override fun writeTo(sink: BufferedSink) {
      var posicao = 0
      while (posicao < bytes.size) {
        val parte = minOf(PEDACO, bytes.size - posicao)
        sink.write(bytes, posicao, parte)
        sink.flush()
        posicao += parte
        progresso.avisar(posicao.toDouble() / bytes.size)
      }
    }
  }

  /** O Orbot escuta SOCKS só em 127.0.0.1. Se a porta não responde, o Tor está indisponível. */
  private fun socksResponde(porta: Int): Boolean =
    try {
      Socket().use { it.connect(InetSocketAddress(LOCAL, porta), 2_000) }
      true
    } catch (_: Exception) {
      false
    }

  private fun abrir(endereco: String, portaSocks: Int?, credencial: String?, promise: Promise) {
    val cliente = cliente(portaSocks, credencial) {
      readTimeout(0, TimeUnit.SECONDS)
      pingInterval(30, TimeUnit.SECONDS)
    }

    val id = proximoId.getAndIncrement()
    val aberta = AtomicBoolean(false)

    cliente.newWebSocket(
      Request.Builder().url(endereco).build(),
      object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
          conexoes[id] = webSocket
          aberta.set(true)
          promise.resolve(id)
        }

        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
          sendEvent("mensagem", mapOf("id" to id, "dados" to Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)))
        }

        // O protocolo só tem mensagens binárias: texto é descartado.
        override fun onMessage(webSocket: WebSocket, text: String) = Unit

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
          webSocket.close(1000, null)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
          encerrar()
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
          if (aberta.get()) {
            encerrar()
          } else {
            // Só o nome da classe da exceção: a mensagem pode trazer endereço (RNF-05).
            promise.reject(CodedException("relay-inacessivel", t.javaClass.simpleName, null))
          }
        }

        private fun encerrar() {
          if (conexoes.remove(id) != null) sendEvent("fechou", mapOf("id" to id))
          cliente.dispatcher.executorService.shutdown()
        }
      },
    )
  }

  private companion object {
    val LOCAL: InetAddress = InetAddress.getByAddress(byteArrayOf(127, 0, 0, 1))

    /** Transferência de anexo parada por este tempo cai (o relay tem o mesmo prazo). */
    const val PARADA_EM_SEGUNDOS = 60L

    /** O corpo vai e vem em pedaços de 64 KiB. */
    const val PEDACO = 65_536
  }

  /**
   * O nome do host vai para o Tor dentro do pedido SOCKS. Este endereço só carrega o nome até o
   * socket: nunca há consulta DNS local, e nada conecta a 0.0.0.0.
   */
  private object NomeSemResolver : Dns {
    override fun lookup(hostname: String): List<InetAddress> =
      listOf(InetAddress.getByAddress(hostname, byteArrayOf(0, 0, 0, 0)))
  }

  /** Só cria sockets sem conectar: o OkHttp chama `connect` com o destino. */
  private class FabricaPeloTor(private val porta: Int, private val credencial: ByteArray) : SocketFactory() {
    override fun createSocket(): Socket = SocketPeloTor(porta, credencial)

    override fun createSocket(host: String?, port: Int): Socket = throw UnsupportedOperationException()

    override fun createSocket(host: String?, port: Int, localHost: InetAddress?, localPort: Int): Socket =
      throw UnsupportedOperationException()

    override fun createSocket(host: InetAddress?, port: Int): Socket = throw UnsupportedOperationException()

    override fun createSocket(address: InetAddress?, port: Int, localAddress: InetAddress?, localPort: Int): Socket =
      throw UnsupportedOperationException()
  }

  /**
   * Conecta ao SOCKS5 do Orbot e pede o destino pelo nome (RFC 1928), autenticando com usuário e
   * senha (RFC 1929). A credencial vai nos dois campos: o Tor não confere, só separa os circuitos.
   */
  private class SocketPeloTor(private val porta: Int, private val credencial: ByteArray) : Socket() {
    override fun connect(endpoint: SocketAddress, timeout: Int) {
      val destino = endpoint as? InetSocketAddress ?: throw IOException("destino")
      super.connect(InetSocketAddress(LOCAL, porta), timeout)
      val anterior = soTimeout
      soTimeout = if (timeout > 0) timeout else 60_000
      try {
        negociar(destino.hostString, destino.port)
      } finally {
        soTimeout = anterior
      }
    }

    private fun negociar(host: String, portaDoDestino: Int) {
      val nome = host.toByteArray(Charsets.US_ASCII)
      if (nome.isEmpty() || nome.size > 255 || credencial.isEmpty() || credencial.size > 255) {
        throw IOException("socks")
      }
      val saida = getOutputStream()
      val entrada = DataInputStream(getInputStream())

      // Só oferece usuário e senha: sem credencial, conexões diferentes dividiriam circuito.
      saida.write(byteArrayOf(5, 1, 2))
      saida.flush()
      if (entrada.readUnsignedByte() != 5 || entrada.readUnsignedByte() != 2) throw IOException("socks")

      saida.write(byteArrayOf(1, credencial.size.toByte()) + credencial + byteArrayOf(credencial.size.toByte()) + credencial)
      saida.flush()
      if (entrada.readUnsignedByte() != 1 || entrada.readUnsignedByte() != 0) throw IOException("socks")

      saida.write(
        byteArrayOf(5, 1, 0, 3, nome.size.toByte()) + nome +
          byteArrayOf((portaDoDestino shr 8).toByte(), portaDoDestino.toByte()),
      )
      saida.flush()
      if (entrada.readUnsignedByte() != 5) throw IOException("socks")
      val codigo = entrada.readUnsignedByte()
      entrada.readUnsignedByte()
      val tamanho = when (entrada.readUnsignedByte()) {
        1 -> 4
        4 -> 16
        3 -> entrada.readUnsignedByte()
        else -> throw IOException("socks")
      }
      entrada.readFully(ByteArray(tamanho + 2))
      if (codigo != 0) throw IOException("socks-$codigo")
    }
  }
}
