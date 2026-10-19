import { describe, expect, it } from 'vitest';
import { AvisosDoApp, type PlataformaDosAvisos, type TextosDosAvisos } from '../src/avisos.ts';
import { i18n } from '../src/i18n.ts';

// Notificações cegas (RF-42): o serviço só liga com o app na frente, identidade e o ajuste ligado;
// o aviso diz só "nova mensagem", sem remetente nem conteúdo.

function plataformaDeTeste() {
  const chamadas: string[] = [];
  const avisos: TextosDosAvisos[] = [];
  const plataforma: PlataformaDosAvisos = {
    ligar: () => {
      chamadas.push('ligar');
      return Promise.resolve();
    },
    desligar: () => {
      chamadas.push('desligar');
      return Promise.resolve();
    },
    avisar: (textos) => {
      avisos.push(textos);
      return Promise.resolve();
    },
    limpar: () => {
      chamadas.push('limpar');
      return Promise.resolve();
    },
    pedirPermissao: () => Promise.resolve(true),
  };
  return { plataforma, chamadas, avisos };
}

describe('notificações cegas (RF-42)', () => {
  it('liga com o app na frente, identidade e o ajuste; desliga sem eles', async () => {
    const { plataforma, chamadas } = plataformaDeTeste();
    const app = new AvisosDoApp(plataforma, i18n.t.bind(i18n));
    await app.sincronizar({ naFrente: false, temIdentidade: true, ligadas: true });
    expect(chamadas).toEqual([]);
    await app.sincronizar({ naFrente: true, temIdentidade: true, ligadas: true });
    expect(chamadas).toEqual(['ligar']);
    // Fora da frente, o serviço que já estava ligado continua.
    await app.sincronizar({ naFrente: false, temIdentidade: true, ligadas: true });
    expect(chamadas).toEqual(['ligar']);
    await app.sincronizar({ naFrente: true, temIdentidade: true, ligadas: false });
    expect(chamadas).toEqual(['ligar', 'desligar']);
    await app.sincronizar({ naFrente: true, temIdentidade: false, ligadas: false });
    expect(chamadas).toEqual(['ligar', 'desligar']);
  });

  it('um pedido de ligar que falha pode ter ligado o serviço: desligar ainda pede para parar', async () => {
    const { plataforma, chamadas } = plataformaDeTeste();
    // O sistema liga o serviço, e a resposta ao app chega como erro.
    const falha: PlataformaDosAvisos = {
      ...plataforma,
      ligar: (textos) => plataforma.ligar(textos).then(() => Promise.reject(new Error('falhou'))),
    };
    const app = new AvisosDoApp(falha, i18n.t.bind(i18n));
    await app.sincronizar({ naFrente: true, temIdentidade: true, ligadas: true });
    await app.sincronizar({ naFrente: true, temIdentidade: true, ligadas: false });
    expect(chamadas).toEqual(['ligar', 'desligar']);
    // Sem identidade (o pânico, outro aparelho), o mesmo.
    await app.sincronizar({ naFrente: true, temIdentidade: true, ligadas: true });
    await app.sincronizar({ naFrente: true, temIdentidade: false, ligadas: true });
    expect(chamadas).toEqual(['ligar', 'desligar', 'ligar', 'desligar']);
  });

  it('o aviso diz só "nova mensagem", sem remetente nem conteúdo', async () => {
    const { plataforma, avisos } = plataformaDeTeste();
    await i18n.changeLanguage('pt-BR');
    await new AvisosDoApp(plataforma, i18n.t.bind(i18n)).novaMensagem();
    expect(avisos.map((textos) => textos.novaMensagem)).toEqual(['Nova mensagem']);
    await i18n.changeLanguage('en');
    await new AvisosDoApp(plataforma, i18n.t.bind(i18n)).novaMensagem();
    expect(avisos.at(-1)?.novaMensagem).toBe('New message');
  });
});
