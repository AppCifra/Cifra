#!/usr/bin/env bash
# Prepara um servidor Debian 13 para o relay (SPEC, "Implantação"). Roda como root, com a chave
# pública SSH de quem vai operar; repetir não estraga:
#
#   bash preparar.sh 'ssh-ed25519 AAAA... nome'
#
# Deixa entrar só SSH, só com essa chave e só no usuário `cifra` (sudo sem senha), e trava a senha
# de toda conta. Liga as atualizações de segurança automáticas (Debian e Docker), a hora por NTS e os
# registros do sistema só na memória, e instala o Docker do repositório oficial, sem log de container.
# O relay sobe depois, pelo compose (docs/DESENVOLVIMENTO.md, "Servidor").
set -euo pipefail

CHAVE="${1:?uso: bash preparar.sh '<chave pública SSH>'}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USUARIO=cifra
# Impressão digital da chave que assina o repositório do Docker.
DOCKER_CHAVE=9DC858229FC7DD38854AE2D88D81803C0EBFCD88
# Sem perguntas; nas atualizações, os arquivos de configuração que já existem ficam como estão.
APT=(apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)
export DEBIAN_FRONTEND=noninteractive

falhar() {
  echo "$1" >&2
  exit 1
}

[[ $EUID -eq 0 ]] || falhar 'rode como root'
# shellcheck source=/dev/null
. /etc/os-release
[[ "$ID" == debian && "$VERSION_ID" == 13 ]] || falhar 'feito para o Debian 13'
ssh-keygen -l -f - <<<"$CHAVE" >/dev/null || falhar 'chave pública inválida'

apt-get update
"${APT[@]}" full-upgrade
"${APT[@]}" install ca-certificates curl gpg git sudo nftables chrony unattended-upgrades

# Registros do sistema só na memória; o que a instalação deixou no disco sai. Sem syslog e sem
# registro de login, que guardaria o IP de quem opera.
install -D -m 0644 "$AQUI/journald.conf" /etc/systemd/journald.conf.d/cifra.conf
systemctl restart systemd-journald
rm -rf /var/log/journal
for pacote in rsyslog libpam-wtmpdb wtmpdb libpam-lastlog2 lastlog2; do
  if dpkg -s "$pacote" >/dev/null 2>&1; then "${APT[@]}" purge "$pacote"; fi
done
rm -rf /var/lib/wtmpdb /var/lib/lastlog

# Firewall: entra só SSH. Tabela própria, carregada antes da rede, num serviço próprio: o
# nftables.service apaga todas as tabelas ao parar, inclusive as do Docker.
install -D -m 0644 "$AQUI/firewall.nft" /etc/cifra/firewall.nft
install -m 0644 "$AQUI/cifra-firewall.service" /etc/systemd/system/cifra-firewall.service
systemctl daemon-reload
systemctl disable nftables.service >/dev/null 2>&1 || true
systemctl enable cifra-firewall.service
systemctl reload-or-restart cifra-firewall.service

# Hora por NTS, em UTC.
install -D -m 0644 "$AQUI/chrony.sources" /etc/chrony/sources.d/cifra.sources
install -D -m 0644 "$AQUI/chrony.conf" /etc/chrony/conf.d/cifra.conf
timedatectl set-timezone Etc/UTC
systemctl restart chrony

# Atualizações de segurança automáticas, do Debian e do Docker.
install -m 0644 "$AQUI/atualizacoes.conf" /etc/apt/apt.conf.d/52cifra-atualizacoes

# Docker do repositório oficial, com a chave conferida pela impressão digital, sem log de container.
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
gpg --show-keys --with-colons /etc/apt/keyrings/docker.asc | grep -q "^fpr:::::::::$DOCKER_CHAVE:$" ||
  falhar 'a chave do repositório do Docker não confere'
chmod a+r /etc/apt/keyrings/docker.asc
cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $VERSION_CODENAME
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
if ! cmp -s "$AQUI/daemon.json" /etc/docker/daemon.json; then
  install -D -m 0644 "$AQUI/daemon.json" /etc/docker/daemon.json
  if systemctl is-active --quiet docker; then systemctl restart docker; fi
fi
apt-get update
"${APT[@]}" install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Quem opera: só a chave, sudo sem senha. Nenhuma conta fica com senha.
id "$USUARIO" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$USUARIO"
install -d -m 0700 -o "$USUARIO" -g "$USUARIO" "/home/$USUARIO/.ssh"
printf '%s\n' "$CHAVE" >"/home/$USUARIO/.ssh/authorized_keys"
chown "$USUARIO:$USUARIO" "/home/$USUARIO/.ssh/authorized_keys"
chmod 0600 "/home/$USUARIO/.ssh/authorized_keys"
printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$USUARIO" >/etc/sudoers.d/cifra
chmod 0440 /etc/sudoers.d/cifra
visudo -cqf /etc/sudoers.d/cifra
awk -F: '$2 !~ /^[!*]/ { print $1 }' /etc/shadow | while read -r conta; do passwd -l "$conta"; done

# SSH: só chave, só quem opera, sem root. O sshd fica com o primeiro valor que lê de cada opção, e
# o 00-cifra.conf vem antes dos outros arquivos do sshd_config.d.
grep -qx 'Include /etc/ssh/sshd_config.d/\*.conf' /etc/ssh/sshd_config ||
  falhar 'o sshd_config não lê o sshd_config.d'
install -m 0644 "$AQUI/sshd.conf" /etc/ssh/sshd_config.d/00-cifra.conf
sshd -t
efetivo="$(sshd -T)"
for opcao in 'permitrootlogin no' 'passwordauthentication no' 'kbdinteractiveauthentication no' \
  'authenticationmethods publickey' "allowusers $USUARIO"; do
  grep -qx "$opcao" <<<"$efetivo" || falhar "o sshd não ficou com: $opcao"
done
systemctl reload ssh

echo "pronto. Antes de fechar esta sessão, entre de novo como $USUARIO, em outra janela."
