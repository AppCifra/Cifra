import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Servidor do relay (SPEC, "Implantação"): entra só SSH, só com chave; as atualizações de segurança
// entram sozinhas; a hora é autenticada; nada de registro em disco.

const ler = (caminho: string) =>
  readFileSync(new URL(caminho, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const servidor = (arquivo: string) => ler(`../servidor/${arquivo}`);

/** Linhas com conteúdo, sem os comentários. */
const linhas = (texto: string) =>
  texto
    .split('\n')
    .map((linha) => linha.trim())
    .filter((linha) => linha !== '' && !linha.startsWith('#') && !linha.startsWith('//'));

describe('servidor do relay', () => {
  it('o SSH só aceita chave, só de quem opera e sem root, antes dos outros arquivos do sshd', () => {
    expect(linhas(servidor('sshd.conf'))).toEqual(
      expect.arrayContaining([
        'PermitRootLogin no',
        'PasswordAuthentication no',
        'KbdInteractiveAuthentication no',
        'AuthenticationMethods publickey',
        'AllowUsers cifra',
        'AllowTcpForwarding local',
      ]),
    );
    // O sshd fica com o primeiro valor que lê de cada opção.
    expect(servidor('preparar.sh')).toContain('/etc/ssh/sshd_config.d/00-cifra.conf');
  });

  it('o firewall só deixa entrar SSH e não mexe nas regras do Docker', () => {
    const regras = linhas(servidor('firewall.nft'));
    expect(regras).toContain('type filter hook input priority filter; policy drop;');
    expect(regras.filter((regra) => regra.includes('dport'))).toEqual(['tcp dport 22 accept']);
    expect(regras).not.toContain('flush ruleset');
    expect(regras.filter((regra) => /^(table|delete)\b/.test(regra))).toEqual([
      'table inet cifra',
      'delete table inet cifra',
      'table inet cifra {',
    ]);
    expect(linhas(servidor('cifra-firewall.service'))).toContain(
      'ExecStop=-/usr/sbin/nft delete table inet cifra',
    );
  });

  it('o relay só publica porta no loopback, por onde o firewall não passa', () => {
    const portas = [
      ...ler('../docker-compose.yml').matchAll(/\n {4}ports:\n((?: {6}- .+\n)+)/g),
    ].flatMap(([, itens = '']) =>
      itens
        .trim()
        .split('\n')
        .map((item) => item.replace(/^\s*- '?|'?$/g, '')),
    );
    expect(portas).toEqual(['127.0.0.1:8080:8080']);
  });

  it('as atualizações de segurança do Debian e do Docker entram sozinhas, com reinício', () => {
    const apt = linhas(servidor('atualizacoes.conf'));
    expect(apt).toEqual(
      expect.arrayContaining([
        'APT::Periodic::Update-Package-Lists "1";',
        'APT::Periodic::Unattended-Upgrade "1";',
        '"origin=Docker,label=Docker CE,archive=${distro_codename}";',
        'Unattended-Upgrade::Automatic-Reboot "true";',
      ]),
    );
  });

  it('a hora só vem de fontes autenticadas (NTS), pelo menos duas', () => {
    const fontes = linhas(servidor('chrony.sources'));
    expect(fontes.length).toBeGreaterThanOrEqual(3);
    for (const fonte of fontes) expect(fonte).toMatch(/^server \S+ iburst nts$/);
    expect(linhas(servidor('chrony.conf'))).toEqual(['authselectmode require', 'minsources 2']);
  });

  it('nada de registro em disco: o sistema só na memória e o Docker sem log de container', () => {
    expect(linhas(servidor('journald.conf'))).toContain('Storage=volatile');
    expect(JSON.parse(servidor('daemon.json'))).toMatchObject({ 'log-driver': 'none' });
  });

  it('o Docker vem do repositório oficial, com a chave conferida', () => {
    const script = servidor('preparar.sh');
    expect(script).toMatch(/^set -euo pipefail$/m);
    expect(script).toContain('DOCKER_CHAVE=9DC858229FC7DD38854AE2D88D81803C0EBFCD88');
    expect(script).toContain('URIs: https://download.docker.com/linux/debian');
  });
});
