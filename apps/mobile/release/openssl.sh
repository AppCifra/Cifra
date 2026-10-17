#!/usr/bin/env bash
# O OpenSSL do SQLCipher do app, compilado do fonte oficial (docs/DEPENDENCIAS.md). Confere o
# tarball pelo SHA-256 e pela assinatura do OpenSSL, compila o libcrypto para as 4 ABIs do Android
# e empacota como AAR com prefab, num repositório Maven local em /opt/openssl/maven. O plugin
# `openssl` do app troca por ele o OpenSSL que o op-sqlite pede ao Maven Central.
#
# A data do build é a do release (SOURCE_DATE_EPOCH) e os caminhos são fixos: o mesmo fonte gera
# os mesmos binários.
set -euo pipefail

: "${OPENSSL_VERSAO:?}" "${OPENSSL_SHA256:?}" "${OPENSSL_CHAVE:?}"
NDK="${ANDROID_HOME}/ndk/27.1.12297006"
API=29
NOME="openssl-${OPENSSL_VERSAO}"
TRABALHO=/build
SAIDA="/opt/openssl/maven/org/cifra/thirdparty/openssl/${OPENSSL_VERSAO}"
URL="https://github.com/openssl/openssl/releases/download/${NOME}/${NOME}.tar.gz"

mkdir -p "$TRABALHO" "$SAIDA"
cd "$TRABALHO"
curl -fsSLo "${NOME}.tar.gz" "$URL"
curl -fsSLo "${NOME}.tar.gz.asc" "${URL}.asc"
echo "${OPENSSL_SHA256}  ${NOME}.tar.gz" | sha256sum -c -

# A assinatura só vale se vier da chave principal travada no Dockerfile.
GNUPGHOME="$(mktemp -d)"
export GNUPGHOME
gpg --batch --quiet --import /tmp/openssl/openssl-chave.asc
estado="$(gpg --batch --status-fd 1 --verify "${NOME}.tar.gz.asc" "${NOME}.tar.gz" 2>/dev/null)"
if ! grep -q "^\[GNUPG:\] VALIDSIG .* ${OPENSSL_CHAVE}\$" <<< "$estado"; then
  echo "${NOME}: a assinatura não é da chave ${OPENSSL_CHAVE}" >&2
  exit 1
fi
echo "assinatura: chave ${OPENSSL_CHAVE}"

tar -xzf "${NOME}.tar.gz"
FONTE="${TRABALHO}/${NOME}"
SOURCE_DATE_EPOCH="$(stat -c %Y "${FONTE}/VERSION.dat")"
export SOURCE_DATE_EPOCH
export ANDROID_NDK_ROOT="$NDK"
export PATH="${NDK}/toolchains/llvm/prebuilt/linux-x86_64/bin:${PATH}"

declare -A ALVOS=([arm64-v8a]=android-arm64 [armeabi-v7a]=android-arm [x86]=android-x86 [x86_64]=android-x86_64)
MODULO="${TRABALHO}/aar/prefab/modules/crypto"
for ABI in arm64-v8a armeabi-v7a x86 x86_64; do
  mkdir -p "${TRABALHO}/build-${ABI}"
  cd "${TRABALHO}/build-${ABI}"
  # no-autoload-config: o libcrypto não procura um openssl.cnf no aparelho. Os segmentos e o fim do
  # RELRO ficam alinhados a 16 KB, para os aparelhos com páginas de 16 KB.
  "${FONTE}/Configure" "${ALVOS[$ABI]}" "-D__ANDROID_API__=${API}" \
    --prefix=/opt/openssl --openssldir=/opt/openssl/ssl --libdir=lib \
    shared no-autoload-config no-tests no-docs \
    -Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384 > /dev/null
  make -j"$(nproc)" build_libs > /dev/null
  make install_dev DESTDIR="${TRABALHO}/instalado-${ABI}" > /dev/null

  instalado="${TRABALHO}/instalado-${ABI}/opt/openssl"
  libs="${MODULO}/libs/android.${ABI}"
  mkdir -p "$libs"
  cp "${instalado}/lib/libcrypto.so" "$libs/"
  cp -r "${instalado}/include" "$libs/include"
  printf '{"abi":"%s","api":%d,"ndk":27,"stl":"none"}\n' "$ABI" "$API" > "${libs}/abi.json"

  # O op-sqlite liga o libcrypto.so pelo nome, sem versão, e o Android exige 16 KB.
  dinamica="$(llvm-readelf -d "${libs}/libcrypto.so")"
  if ! grep -q 'Library soname: \[libcrypto.so\]' <<< "$dinamica"; then
    echo "libcrypto.so de ${ABI} com outro soname" >&2
    exit 1
  fi
  if [[ -n "$(llvm-readelf -lW "${libs}/libcrypto.so" | awk '$1 == "LOAD" && $NF != "0x4000"')" ]]; then
    echo "libcrypto.so de ${ABI} com segmento fora de 16 KB" >&2
    exit 1
  fi
done
# Os headers mudam por ABI (configuration.h): cada ABI leva os seus, e o include do módulo é o
# do arm64.
cp -r "${TRABALHO}/instalado-arm64-v8a/opt/openssl/include" "${MODULO}/include"
echo '{}' > "${MODULO}/module.json"
printf '{"schema_version":1,"name":"openssl","version":"%s","dependencies":[]}\n' \
  "$OPENSSL_VERSAO" > "${TRABALHO}/aar/prefab/prefab.json"
mkdir -p "${TRABALHO}/aar/META-INF"
cp "${FONTE}/LICENSE.txt" "${TRABALHO}/aar/META-INF/LICENSE.txt"
cat > "${TRABALHO}/aar/AndroidManifest.xml" <<EOF
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="org.cifra.thirdparty.openssl">
  <uses-sdk android:minSdkVersion="${API}" />
</manifest>
EOF

# O AAR é um zip: entradas em ordem e com a data do release.
python3 - "${TRABALHO}/aar" "${SAIDA}/${NOME}.aar" <<'PY'
import os, sys, time, zipfile
raiz, destino = sys.argv[1], sys.argv[2]
data = time.gmtime(int(os.environ['SOURCE_DATE_EPOCH']))[:6]
nomes = sorted(
    os.path.relpath(os.path.join(pasta, arquivo), raiz)
    for pasta, _, arquivos in os.walk(raiz)
    for arquivo in arquivos
)
with zipfile.ZipFile(destino, 'w') as aar:
    for nome in nomes:
        info = zipfile.ZipInfo(nome, data)
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        with open(os.path.join(raiz, nome), 'rb') as entrada:
            aar.writestr(info, entrada.read())
PY
cat > "${SAIDA}/${NOME}.pom" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>org.cifra.thirdparty</groupId>
  <artifactId>openssl</artifactId>
  <version>${OPENSSL_VERSAO}</version>
  <packaging>aar</packaging>
</project>
EOF

cd "${MODULO}/libs"
sha256sum android.*/libcrypto.so "${SAIDA}/${NOME}.aar"
rm -rf "$TRABALHO" "$GNUPGHOME"
