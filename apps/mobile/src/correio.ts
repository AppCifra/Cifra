// As conversas do app: liga o núcleo (agenda, correio e temporárias) aos adaptadores do Android,
// com Tor (Orbot) ligado, como manda o padrão do RF-44. O endereço do relay vem do build
// (EXPO_PUBLIC_CIFRA_RELAY); sem ele, ou com um endereço que não serve para o cartão, o app não
// conecta a nada, e só a parte local funciona. O endereço do relay oficial entra quando ele existir.
import {
  Agenda,
  Cofre,
  Correio,
  criarExclusivo,
  Temporarias,
  Vigia,
  type CofreDeChaves,
} from '@cifra/core';
import { enderecoDeRelayValido } from '@cifra/protocol';
import { midiaDoAndroid } from './adaptadores/anexos.ts';
import { cripto } from './adaptadores/cripto.ts';
import { relogio } from './adaptadores/relogio.ts';
import { definirTelaSegura } from './adaptadores/tela.ts';
import { criarTransporte, PORTA_SOCKS_DO_ORBOT } from './adaptadores/transporte.ts';
import { ConversasDoApp } from './conversas.ts';
import type { Plataforma, Sessao } from './sessao.ts';

export const ENDERECO_DO_RELAY = process.env.EXPO_PUBLIC_CIFRA_RELAY ?? '';

/**
 * Liga o vigia do app bloqueado (RF-42): a chave da caixa sai do Keystore sem biometria, e o vigia
 * abre a caixa pelo Tor e chama `aoChegar` a cada mensagem nova. Devolve o que para o vigia e zera
 * a chave; `null` sem relay ou sem caixa guardada.
 */
export async function iniciarVigia(
  cofre: CofreDeChaves,
  aoChegar: () => void,
): Promise<{ parar(): Promise<void> } | null> {
  if (!enderecoDeRelayValido(ENDERECO_DO_RELAY)) return null;
  const semente = await cofre.ler('chave-da-caixa');
  if (!semente) return null;
  const vigia = new Vigia({
    cripto,
    transporte: criarTransporte({ portaSocks: PORTA_SOCKS_DO_ORBOT }),
    relogio,
    relay: ENDERECO_DO_RELAY,
    sementeDaCaixa: semente,
  });
  const cancelar = vigia.aoChegar(aoChegar);
  vigia.iniciar();
  return {
    async parar() {
      cancelar();
      await vigia.parar();
      cripto.memzero(semente);
    },
  };
}

/**
 * Abre as conversas da sessão: a agenda, a limpeza das temporárias e, com relay, o correio, que
 * publica o cartão, abre a caixa e entrega a fila enquanto o app está aberto. Os três dividem o
 * acesso ao banco. `semBloquear` roda o seletor de fotos e arquivos sem o app bloquear ao sair da
 * frente por causa dele. O cofre das conversas ocultas abre pelo código na busca, com o mesmo
 * transporte: os circuitos do correio dele têm prefixo próprio.
 */
export function iniciarConversas(
  sessao: Sessao,
  aoSubstituir: () => void,
  semBloquear: <T>(acao: () => Promise<T>) => Promise<T>,
  plataforma: Pick<Plataforma, 'abrirCofre' | 'truncarCofre' | 'tocarCofre'>,
): ConversasDoApp {
  const { identidade } = sessao;
  const banco = sessao.banco.banco;
  const exclusivo = criarExclusivo();
  const agenda = new Agenda({ cripto, banco, relogio, identidade, exclusivo });
  const comRelay = enderecoDeRelayValido(ENDERECO_DO_RELAY);
  const transporte = comRelay ? criarTransporte({ portaSocks: PORTA_SOCKS_DO_ORBOT }) : null;
  const correio = transporte
    ? new Correio({
        cripto,
        banco,
        transporte,
        relogio,
        identidade,
        sementeDaCaixa: sessao.sementeDaCaixa,
        relay: ENDERECO_DO_RELAY,
        exclusivo,
      })
    : null;
  const temporarias = new Temporarias({ banco, relogio, exclusivo });
  const conversas = new ConversasDoApp({
    agenda,
    correio,
    temporarias,
    identidade,
    aoSubstituir,
    midia: midiaDoAndroid,
    semBloquear,
    tela: { definirSegura: definirTelaSegura },
    ocultas: {
      cripto,
      segredo: sessao.segredoDoCofre,
      abrir: (chave) => plataforma.abrirCofre(chave),
      truncar: () => plataforma.truncarCofre(),
      tocar: () => plataforma.tocarCofre(),
      montar: (bancoDoCofre) =>
        new Cofre({
          cripto,
          relogio,
          identidade,
          banco: bancoDoCofre,
          transporte,
          relay: comRelay ? ENDERECO_DO_RELAY : null,
          principal: { banco, exclusivo, correio },
        }),
    },
  });
  conversas.iniciar();
  return conversas;
}
