package org.cifra.plataforma

import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.UserNotAuthenticatedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.RandomAccessFile
import java.security.KeyStore
import java.security.UnrecoverableKeyException
import javax.crypto.Cipher
import javax.crypto.SecretKey

// Estado da chave do Keystore que protege um segredo do cofre, sem pedir biometria (RNF-07).
// Quando a pessoa tira o bloqueio de tela, o Android apaga ou invalida as chaves que exigiam
// desbloqueio. A react-native-keychain não distingue isso: com a chave apagada, cria outra na
// leitura seguinte, pede a biometria e só então falha. O app confere aqui antes de ler.
//
// Também o arquivo do cofre das conversas ocultas: zerar no lugar, para o cofre novo nascer no
// mesmo arquivo, e tocar a data, para o cofre em uso e o vazio ficarem iguais.
//
// E o pânico (RF-48): apagar os arquivos do banco e do cofre, com os diários, e o cache do app. As
// chaves já foram destruídas antes: o que sobrar no chip é ruído.
class CofreModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CifraCofre")

    // `valida`: abre (talvez depois da biometria). `ausente`: o aparelho apagou a chave.
    // `invalidada`: a chave existe, mas nunca mais abre.
    AsyncFunction("estadoDaChave") { nome: String ->
      val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      val chave =
        try {
          keyStore.getKey(nome, null) as? SecretKey
        } catch (e: UnrecoverableKeyException) {
          return@AsyncFunction "invalidada"
        } ?: return@AsyncFunction "ausente"
      try {
        // Só prepara a cifra: nada é cifrado e nenhum pedido aparece.
        Cipher.getInstance("AES/GCM/NoPadding").init(Cipher.ENCRYPT_MODE, chave)
        "valida"
      } catch (e: KeyPermanentlyInvalidatedException) {
        "invalidada"
      } catch (e: UserNotAuthenticatedException) {
        // A chave vale; só falta o desbloqueio, que a leitura pede.
        "valida"
      }
    }

    // Zera o arquivo no lugar: 0 byte, o mesmo arquivo (o mesmo inode e a mesma data de criação).
    // Quem chama já fechou o banco. O que não existe fica como está.
    AsyncFunction("truncar") { caminho: String ->
      val arquivo = File(caminho)
      if (arquivo.exists()) RandomAccessFile(arquivo, "rw").use { it.setLength(0) }
    }

    // Apaga os arquivos que existem e tudo o que está no cache do app: o MP4 temporário da limpeza
    // do vídeo que tenha ficado e o que as bibliotecas guardem ali. A pasta fica.
    AsyncFunction("apagar") { caminhos: List<String> ->
      for (caminho in caminhos) File(caminho).delete()
      appContext.reactContext?.cacheDir?.listFiles()?.forEach { it.deleteRecursively() }
    }

    // A data de agora nos arquivos que existem.
    AsyncFunction("tocar") { caminhos: List<String> ->
      val agora = System.currentTimeMillis()
      for (caminho in caminhos) {
        val arquivo = File(caminho)
        if (arquivo.exists()) arquivo.setLastModified(agora)
      }
    }
  }
}
