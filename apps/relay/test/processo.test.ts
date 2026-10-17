import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ClienteDoRelay } from '../scripts/cliente.ts';
import { sondar } from '../scripts/sonda.ts';
import { lerTexto, listarArquivos } from './arquivos.ts';

// RNF-05: nenhum log de conteúdo, chave, ID ou IP no relay, e sem relatório de erro. O processo roda
// como no Docker e não pode escrever nada, nem quando falha.

const PRINCIPAL = fileURLToPath(new URL('../src/principal.ts', import.meta.url));

const pastas: string[] = [];

afterEach(() => {
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true });
});

function portaLivre(): Promise<number> {
  return new Promise((pronto) => {
    const servidor = createServer().listen(0, '127.0.0.1', () => {
      const { port } = servidor.address() as AddressInfo;
      servidor.close(() => {
        pronto(port);
      });
    });
  });
}

interface Processo {
  readonly saida: () => string;
  readonly fim: Promise<number | null>;
  parar(): void;
}

/** Sobe o relay como o Dockerfile sobe, com o ambiente dado. */
function rodar(ambiente: Record<string, string>): Processo {
  const pasta = mkdtempSync(join(tmpdir(), 'cifra-processo-'));
  pastas.push(pasta);
  const filho = spawn(process.execPath, ['--no-warnings', PRINCIPAL], {
    env: { ...process.env, CIFRA_BANCO: join(pasta, 'relay.sqlite'), ...ambiente },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let saida = '';
  filho.stdout.on('data', (pedaco: Buffer) => (saida += pedaco.toString()));
  filho.stderr.on('data', (pedaco: Buffer) => (saida += pedaco.toString()));
  return {
    saida: () => saida,
    fim: new Promise((pronto) => filho.on('exit', pronto)),
    parar: () => filho.kill(),
  };
}

async function esperarConectar(endereco: string): Promise<void> {
  for (let tentativa = 0; tentativa < 100; tentativa++) {
    try {
      await (await ClienteDoRelay.conectar(endereco)).fechar();
      return;
    } catch {
      await new Promise((pronto) => setTimeout(pronto, 100));
    }
  }
  throw new Error('o relay não subiu');
}

describe('o processo do relay não escreve nada (RNF-05)', () => {
  it('atende um app do começo ao fim sem uma linha em stdout ou stderr', async () => {
    const porta = await portaLivre();
    const relay = rodar({ CIFRA_PORTA: String(porta) });
    const endereco = `ws://127.0.0.1:${String(porta)}`;
    await esperarConectar(endereco);
    await sondar(endereco);
    // Um cliente que manda lixo também não gera linha nenhuma.
    const modificado = await ClienteDoRelay.conectar(endereco);
    modificado.enviarCru(new Uint8Array([0x04, 0, 0, 0, 1, 2, 3]));
    await modificado.fechamento;
    relay.parar();
    await relay.fim;
    expect(relay.saida()).toBe('');
  });

  it('configuração inválida sai com o código 2, em silêncio', async () => {
    const relay = rodar({ CIFRA_PORTA: 'oitenta' });
    expect(await relay.fim).toBe(2);
    expect(relay.saida()).toBe('');
  });

  it('porta ocupada sai com o código 3, em silêncio', async () => {
    const ocupada = createServer();
    await new Promise<void>((pronto) => ocupada.listen(0, '127.0.0.1', pronto));
    const { port } = ocupada.address() as AddressInfo;
    try {
      const relay = rodar({ CIFRA_PORTA: String(port) });
      expect(await relay.fim).toBe(3);
      expect(relay.saida()).toBe('');
    } finally {
      ocupada.close();
    }
  });
});

describe('o código do relay não lê IP nem escreve log (RNF-05)', () => {
  it('src/ não toca no endereço de quem conecta, em cabeçalho de proxy nem em console', () => {
    const proibidos = [
      /remoteAddress/,
      /remotePort/,
      /x-forwarded-for/i,
      /x-real-ip/i,
      /\bforwarded\b/i,
      /\bconsole\./,
      /process\.(stdout|stderr)/,
    ];
    const achados = listarArquivos('src', '.ts').flatMap((arquivo) =>
      proibidos
        .filter((padrao) => padrao.test(lerTexto(arquivo)))
        .map((padrao) => `${arquivo}: ${String(padrao)}`),
    );
    expect(achados).toEqual([]);
  });
});
