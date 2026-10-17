#!/usr/bin/env bash
# Gera o APK de release a partir do último commit do repositório montado em /repo (só leitura).
# Mudanças que não estão em commit ficam de fora: o APK sai sempre do mesmo código versionado.
# Com REF, sai de outro ponto: por exemplo, o de `git stash create`, para conferir o release de
# mudanças ainda sem commit, sem mexer no histórico.
#
# Assinatura: com a chave montada em /chave/cifra-release.jks (só leitura) e a senha em
# CIFRA_ASSINATURA_SENHA, sai assinado com a chave do Cifra. Sem elas, com a chave de depuração do
# modelo, que serve para testar e não para distribuir. FORMATO=aab gera o pacote da Play Store.
set -euo pipefail

git config --global --add safe.directory /repo
rm -rf /work
mkdir -p /work
REF="${REF:-HEAD}"
git -C /repo archive "$REF" | tar -x -C /work

CHAVE=/chave/cifra-release.jks
if [[ -f "$CHAVE" && -n "${CIFRA_ASSINATURA_SENHA:-}" ]]; then
  export CIFRA_ASSINATURA_ARQUIVO="$CHAVE"
  echo "assinatura: chave do Cifra"
else
  unset CIFRA_ASSINATURA_ARQUIVO
  echo "assinatura: chave de depuração (só para testar, não distribua)"
fi

cd /work
pnpm install --frozen-lockfile

cd apps/mobile
pnpm exec expo prebuild --platform android --no-install

cd android
ARQUITETURAS="${ARQUITETURAS:-arm64-v8a,x86_64}"
if [[ "${FORMATO:-apk}" == "aab" ]]; then
  ./gradlew bundleRelease -PreactNativeArchitectures="$ARQUITETURAS" --console=plain
  cp app/build/outputs/bundle/release/app-release.aab /saida/cifra-release.aab
  SAIDA=/saida/cifra-release.aab
else
  ./gradlew assembleRelease -PreactNativeArchitectures="$ARQUITETURAS" --console=plain
  cp app/build/outputs/apk/release/app-release.apk /saida/cifra-release.apk
  SAIDA=/saida/cifra-release.apk
  "${ANDROID_HOME}/build-tools/36.0.0/apksigner" verify --print-certs "$SAIDA" | grep 'SHA-256'
fi
echo "commit: $(git -C /repo rev-parse --short "$REF")"
sha256sum "$SAIDA"
