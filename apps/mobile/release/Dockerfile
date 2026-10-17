# Ambiente Linux para gerar o APK de release. No Windows, o Controle Inteligente de Aplicativos
# bloqueia o compilador do Hermes (hermesc.exe, sem assinatura); aqui ele roda normalmente.
# Tudo travado: imagem pelo digest, JDK pela versão do pacote Debian, ferramentas do Android pelo
# SHA-256, pacotes do SDK pela versão exata e o OpenSSL pelo SHA-256 e pela assinatura.
FROM node:24-bookworm@sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4 AS base

RUN apt-get update \
  && apt-get install -y --no-install-recommends openjdk-17-jdk-headless=17.0.20.1+1-1~deb12u1 unzip \
  && rm -rf /var/lib/apt/lists/*

ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
ENV ANDROID_HOME=/opt/android
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

ARG FERRAMENTAS=commandlinetools-linux-13114758_latest.zip
ARG FERRAMENTAS_SHA256=7ec965280a073311c339e571cd5de778b9975026cfcbe79f2b1cdcb1e15317ee
RUN curl -fsSLo /tmp/ferramentas.zip "https://dl.google.com/android/repository/${FERRAMENTAS}" \
  && echo "${FERRAMENTAS_SHA256}  /tmp/ferramentas.zip" | sha256sum -c - \
  && mkdir -p "${ANDROID_HOME}/cmdline-tools" \
  && unzip -q /tmp/ferramentas.zip -d "${ANDROID_HOME}/cmdline-tools" \
  && mv "${ANDROID_HOME}/cmdline-tools/cmdline-tools" "${ANDROID_HOME}/cmdline-tools/latest" \
  && rm /tmp/ferramentas.zip

# As mesmas licenças do Android SDK que o Android Studio pede para aceitar.
RUN yes | "${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager" --licenses > /dev/null \
  && "${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager" \
    "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006" "cmake;3.22.1" > /dev/null

RUN corepack enable

# O OpenSSL do SQLCipher, compilado do fonte oficial (openssl.sh). A assinatura vale só da chave
# principal do OpenSSL, com a impressão digital publicada em openssl-library.org/source.
FROM base AS openssl
ARG OPENSSL_VERSAO=3.5.9
ARG OPENSSL_SHA256=603f5602e2eef00d77fbd429d34dcd5822bb301757a1bc9cdb24c670f1eb859a
ARG OPENSSL_CHAVE=B146647E45A7B33947AB226B2A2C87D161692D40
COPY openssl-chave.asc openssl.sh /tmp/openssl/
RUN bash /tmp/openssl/openssl.sh

# Só o repositório Maven do OpenSSL, para o build de desenvolvimento no PC:
# docker build --target openssl-maven --output type=local,dest=apps/mobile/openssl apps/mobile/release
FROM scratch AS openssl-maven
COPY --from=openssl /opt/openssl/maven /maven

FROM base
COPY --from=openssl /opt/openssl/maven /opt/openssl/maven
ENV CIFRA_OPENSSL_MAVEN=/opt/openssl/maven
COPY gerar.sh /usr/local/bin/gerar-release
ENTRYPOINT ["bash", "/usr/local/bin/gerar-release"]
