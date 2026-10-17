import { describe, expect, it } from 'vitest';
import {
  ANEXOS_SUBINDO,
  BITS_DO_ID,
  CARACTERES_DO_ID,
  CONEXOES_SIMULTANEAS,
  ESPACO_DOS_ANEXOS_EM_MB,
  INTERVALO_DO_PING_EM_SEGUNDOS,
  JANELA_DE_ENTREGA,
  LIMITE_DO_TEXTO,
  MAXIMO_DE_PREKEYS,
  MAXIMO_DE_RELAYS,
  OCIOSIDADE_EM_SEGUNDOS,
  PACOTES_POR_CAIXA,
  PARADA_DO_ANEXO_EM_SEGUNDOS,
  PINGS_SEM_RESPOSTA,
  RETENCAO_DA_CAIXA_EM_DIAS,
  RETENCAO_DO_ANEXO_EM_DIAS,
  RETENCAO_DO_CARTAO_EM_DIAS,
  RETENCAO_DO_PACOTE_EM_DIAS,
  TAMANHO_DO_PACOTE,
  TAXAS,
  TIMER_MAXIMO_EM_SEGUNDOS,
  TIMER_MINIMO_EM_SEGUNDOS,
  TOLERANCIA_DO_RELOGIO_EM_HORAS,
  TRANSFERENCIAS_DE_ANEXOS,
} from '../src/index.ts';

describe('limites do protocolo (valores iniciais do SPEC)', () => {
  it('todo pacote de mensagem tem exatamente 4096 bytes', () => {
    expect(TAMANHO_DO_PACOTE).toBe(4096);
  });

  it('o texto vai até 3500 bytes e cabe no pacote', () => {
    expect(LIMITE_DO_TEXTO).toBe(3500);
    expect(LIMITE_DO_TEXTO).toBeLessThan(TAMANHO_DO_PACOTE);
  });

  it('o relay guarda pacote e anexo por 14 dias, cartão sem renovação e caixa sem abertura por 90', () => {
    expect(RETENCAO_DO_PACOTE_EM_DIAS).toBe(14);
    expect(RETENCAO_DO_ANEXO_EM_DIAS).toBe(14);
    expect(RETENCAO_DO_CARTAO_EM_DIAS).toBe(90);
    expect(RETENCAO_DA_CAIXA_EM_DIAS).toBe(90);
  });

  it('o ID de 80 bits vira 16 caracteres em base32 (5 bits por caractere)', () => {
    expect(BITS_DO_ID).toBe(80);
    expect(CARACTERES_DO_ID).toBe(BITS_DO_ID / 5);
  });

  it('cartão: até 100 one-time prekeys, de 1 a 3 relays e 24 h de tolerância no relógio', () => {
    expect(MAXIMO_DE_PREKEYS).toBe(100);
    expect(MAXIMO_DE_RELAYS).toBe(3);
    expect(TOLERANCIA_DO_RELOGIO_EM_HORAS).toBe(24);
  });

  it('caixa: até 1000 pacotes à espera, entregues em janelas de 100', () => {
    expect(PACOTES_POR_CAIXA).toBe(1000);
    expect(JANELA_DE_ENTREGA).toBe(100);
    expect(JANELA_DE_ENTREGA).toBeLessThanOrEqual(PACOTES_POR_CAIXA);
  });

  it('conexões: 1000 ao mesmo tempo, ociosa fecha em 5 min, ping a cada 30 s', () => {
    expect(CONEXOES_SIMULTANEAS).toBe(1000);
    expect(OCIOSIDADE_EM_SEGUNDOS).toBe(300);
    expect(INTERVALO_DO_PING_EM_SEGUNDOS).toBe(30);
    // Morta só depois de 2 pings sem resposta: de 60 a 90 s, porque pelo Tor a volta demora.
    expect(PINGS_SEM_RESPOSTA).toBe(2);
  });

  it('mensagens temporárias: timer de 10 s a 7 dias', () => {
    expect(TIMER_MINIMO_EM_SEGUNDOS).toBe(10);
    expect(TIMER_MAXIMO_EM_SEGUNDOS).toBe(7 * 24 * 3600);
  });

  it('taxas por conexão', () => {
    expect(TAXAS).toEqual({
      depositar: { rajada: 20, porMinuto: 60 },
      buscarCartao: { rajada: 10, porMinuto: 10 },
      publicarCartao: { rajada: 3, porMinuto: 1 },
      criarCaixa: { rajada: 3, porMinuto: 1 },
      apagarTudo: { rajada: 3, porMinuto: 1 },
      mensagens: { rajada: 100, porMinuto: 1200 },
    });
    // A taxa de mensagens, que fecha a conexão, fica acima de todas as outras somadas.
    const outras = [
      TAXAS.depositar,
      TAXAS.buscarCartao,
      TAXAS.publicarCartao,
      TAXAS.criarCaixa,
      TAXAS.apagarTudo,
    ];
    expect(TAXAS.mensagens.rajada).toBeGreaterThan(outras.reduce((s, t) => s + t.rajada, 0));
    expect(TAXAS.mensagens.porMinuto).toBeGreaterThan(outras.reduce((s, t) => s + t.porMinuto, 0));
  });

  it('anexos no relay: 16 subindo, 64 transferências, 4 GB e 60 s parado derruba', () => {
    expect(ANEXOS_SUBINDO).toBe(16);
    expect(TRANSFERENCIAS_DE_ANEXOS).toBe(64);
    expect(ANEXOS_SUBINDO).toBeLessThanOrEqual(TRANSFERENCIAS_DE_ANEXOS);
    expect(ESPACO_DOS_ANEXOS_EM_MB).toBe(4096);
    expect(PARADA_DO_ANEXO_EM_SEGUNDOS).toBe(60);
  });
});
