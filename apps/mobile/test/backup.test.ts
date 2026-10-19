import {
  abrirBackup,
  conteudoDoBackup,
  gerarIdentidade,
  identidadeDaSemente,
  type ConteudoDoBackup,
} from '@cifra/core';
import { criarI18n } from '@cifra/i18n';
import { formatarId, lerId } from '@cifra/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { cripto } from '../../../packages/core/test/adaptadores/sodium-node.ts';
import { conversa, relogio, type Pessoa } from '../../../packages/core/test/correio-de-teste.ts';
import { ControleDoApp, type EmUso } from '../src/controle.ts';
import { ConversasDoApp, type MidiaDoApp } from '../src/conversas.ts';
import { nomeDoBackup, resumoDoBackup } from '../src/formato-do-backup.ts';
import { abrirSessao, criarSessao } from '../src/sessao.ts';
import { plataformaDeTeste, type PlataformaDeTeste } from './plataforma.ts';

// O backup pela tela (RF-46, RF-47): exportar pelo "salvar como" do sistema, sem bloquear o app
// enquanto ele está aberto, e importar na restauração, junto com a identidade. A plataforma é de
// mentira: anota o que o app pediu.

const pt = criarI18n('pt-BR').t;
const en = criarI18n('en').t;

const testes: PlataformaDeTeste[] = [];

afterEach(() => {
  for (const teste of testes.splice(0)) {
    for (const banco of teste.bancos) banco.fechar();
    teste.limpar();
  }
});

interface SalvarComo {
  /** O que foi salvo, e quantos seletores do sistema estavam abertos na hora. */
  readonly salvos: {
    readonly bytes: Uint8Array;
    readonly nome: string;
    readonly abertos: number;
  }[];
  resposta: 'salvar' | 'cancelar' | 'falhar';
}

function conversasDe(p: Pessoa) {
  const salvarComo: SalvarComo = { salvos: [], resposta: 'salvar' };
  const seletores = { abertos: 0 };
  const nada = () => Promise.reject(new Error('fora do teste'));
  const midia: MidiaDoApp = {
    escolherMidia: nada,
    escolherArquivos: nada,
    preparar: nada,
    salvar: nada,
    copiar: nada,
    esquecerImagens: () => undefined,
    salvarArquivo(bytes, nome) {
      if (salvarComo.resposta === 'falhar') return Promise.reject(new Error('nao-salvou'));
      if (salvarComo.resposta === 'cancelar') return Promise.resolve(false);
      salvarComo.salvos.push({ bytes: bytes.slice(), nome, abertos: seletores.abertos });
      return Promise.resolve(true);
    },
  };
  const app = new ConversasDoApp({
    agenda: p.agenda,
    correio: p.correio,
    temporarias: p.temporarias,
    identidade: p.identidade,
    aoSubstituir: () => undefined,
    midia,
    semBloquear: async (acao) => {
      seletores.abertos++;
      try {
        return await acao();
      } finally {
        seletores.abertos--;
      }
    },
  });
  return { app, salvarComo, seletores };
}

describe('exportar o backup pelos ajustes (RF-46)', () => {
  it('sai pelo "salvar como" do sistema, sem bloquear o app, e só abre com as palavras', async () => {
    const [alice, bob] = await conversa();
    await alice.agenda.renomear(bob.id, 'Bob');
    const { app, salvarComo } = conversasDe(alice);

    const resultado = await app.exportarBackup(
      { tema: 'claro', idioma: 'pt-BR' },
      'Cifra backup 2026-10-15',
    );
    expect(resultado).toBe('salvo');
    const [salvo] = salvarComo.salvos;
    // O app não bloqueia enquanto o "salvar como" está na frente.
    expect(salvo?.abertos).toBe(1);
    expect(salvo?.nome).toBe('Cifra backup 2026-10-15');
    const conteudo = abrirBackup(cripto, alice.identidade, salvo?.bytes ?? new Uint8Array(0));
    expect(conteudo?.preferencias).toEqual({ tema: 'claro', idioma: 'pt-BR' });
    expect(conteudo?.contatos.map((c) => [formatarId(c.contato), c.apelido])).toEqual([
      [bob.id, 'Bob'],
    ]);
    expect(abrirBackup(cripto, bob.identidade, salvo?.bytes ?? new Uint8Array(0))).toBeNull();
  });

  it('cancelar o "salvar como" não é erro; não conseguir gravar, sim', async () => {
    const [alice] = await conversa();
    const { app, salvarComo } = conversasDe(alice);
    salvarComo.resposta = 'cancelar';
    expect(await app.exportarBackup({ tema: 'escuro', idioma: null }, 'x')).toBe('cancelado');
    salvarComo.resposta = 'falhar';
    expect(await app.exportarBackup({ tema: 'escuro', idioma: null }, 'x')).toBe('falhou');
    expect(salvarComo.salvos).toEqual([]);
  });

  it('o nome sugerido leva a data de hoje, e o resumo diz de quando é e quantos contatos tem', () => {
    const instante = new Date(2026, 9, 15, 23, 50).getTime();
    expect(nomeDoBackup(pt, instante)).toBe('Cifra backup 2026-10-15');
    expect(nomeDoBackup(en, instante)).toBe('Cifra backup 2026-10-15');
    const contato = (aceito: boolean) => ({
      contato: new Uint8Array(10),
      aceito,
      bloqueado: !aceito,
      verificado: false,
      apelido: null,
      criadoEm: 0,
      timer: 0,
      timerDesde: 0,
      timerPorAvisar: false,
      printsBloqueados: false,
      printsDesde: 0,
      recebidasAte: 0,
      cartao: null,
    });
    const backup = (contatos: ConteudoDoBackup['contatos']): ConteudoDoBackup => ({
      criadoEm: instante,
      ajustes: {
        timer_padrao: 0,
        timer_da_nota: 0,
        baixar_sozinho: 1,
        confirmacoes_de_leitura: 0,
        indicador_de_digitacao: 0,
        bloquear_sozinho: 300,
        bloquear_capturas: 1,
      },
      preferencias: { tema: 'escuro', idioma: null },
      contatos,
    });
    // O ID bloqueado que veio de um pedido não conta como contato.
    expect(resumoDoBackup(pt, backup([contato(true), contato(false)]))).toBe(
      'backup de 15/10/2026 · 1 contato',
    );
    expect(resumoDoBackup(pt, backup([contato(true), contato(true)]))).toBe(
      'backup de 15/10/2026 · 2 contatos',
    );
    expect(resumoDoBackup(en, backup([]))).toBe('backup from 10/15/2026 · 0 contacts');
  });
});

describe('importar o backup na restauração (RF-47)', () => {
  /** O backup da Alice e a mesma identidade, restaurada com as palavras em outro aparelho. */
  async function backupDaAlice() {
    const [alice, bob] = await conversa();
    await alice.agenda.renomear(bob.id, 'Bob');
    await alice.agenda.verificar(bob.id, true);
    await alice.agenda.mudarTimerPadrao(3600);
    const meuId = lerId(alice.id);
    if (!meuId) throw new Error('ID');
    const conteudo = await conteudoDoBackup(
      alice.banco.banco,
      meuId,
      { tema: 'claro', idioma: 'en' },
      relogio.agora(),
    );
    const restaurada = identidadeDaSemente(cripto, alice.identidade.semente.slice());
    return { alice, bob, conteudo, restaurada };
  }

  it('os contatos, as verificações e os ajustes entram junto com a identidade', async () => {
    const { bob, conteudo, restaurada } = await backupDaAlice();
    const teste = plataformaDeTeste();
    testes.push(teste);
    (await criarSessao(teste.plataforma, restaurada, conteudo)).banco.fechar();

    const sessao = await abrirSessao(teste.plataforma);
    if (!sessao) throw new Error('sem sessão');
    try {
      const [contato] = await sessao.banco.banco.consultar(
        'SELECT aceito, verificado, apelido FROM contatos WHERE contato = ?',
        [lerId(bob.id) ?? new Uint8Array(0)],
      );
      expect(contato).toEqual({ aceito: 1, verificado: 1, apelido: 'Bob' });
      expect(await sessao.banco.banco.consultar('SELECT timer_padrao FROM ajustes')).toEqual([
        { timer_padrao: 3600 },
      ]);
      // Nenhuma mensagem nem sessão de antes.
      expect(await sessao.banco.banco.consultar('SELECT count(*) AS n FROM mensagens')).toEqual([
        { n: 0 },
      ]);
      expect(await sessao.banco.banco.consultar('SELECT count(*) AS n FROM sessoes')).toEqual([
        { n: 0 },
      ]);
    } finally {
      sessao.banco.fechar();
    }
  });

  it('pelo onboarding: entrar com o backup já abre com os contatos', async () => {
    const { conteudo, restaurada } = await backupDaAlice();
    const teste = plataformaDeTeste();
    testes.push(teste);
    const controle = new ControleDoApp<EmUso>({
      plataforma: teste.plataforma,
      iniciar: () => ({ parar: () => Promise.resolve() }),
      emPrimeiroPlano: () => true,
    });
    await controle.abrir();
    await controle.concluirOnboarding(restaurada, conteudo);
    const { estado } = controle;
    if (estado.tipo !== 'pronto') throw new Error(estado.tipo);
    expect(estado.sessao.identidade.id).toBe(restaurada.id);
    expect(await estado.sessao.banco.banco.consultar('SELECT count(*) AS n FROM contatos')).toEqual(
      [{ n: 1 }],
    );
  });

  it('se não conseguir guardar, nada do backup fica', async () => {
    const { conteudo } = await backupDaAlice();
    const teste = plataformaDeTeste();
    testes.push(teste);
    teste.cofre.falharAoGuardar = true;
    await expect(
      criarSessao(teste.plataforma, gerarIdentidade(cripto, 'portugues').identidade, conteudo),
    ).rejects.toThrow();
    teste.cofre.falharAoGuardar = false;
    expect(await abrirSessao(teste.plataforma)).toBeNull();
  });
});
