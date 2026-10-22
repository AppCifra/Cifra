// O app com a identidade aberta: a pilha de telas sobre a lista de conversas. O voltar do Android
// tira a tela de cima; na lista, ele sai do app (e o app bloqueia).
import { paraHex } from '@cifra/protocol';
import { useCallback, useEffect, useState } from 'react';
import { BackHandler } from 'react-native';
import { deHex } from '../adaptadores/formato.ts';
import { Pilha } from '../componentes/Pilha.tsx';
import type { ConversasDoApp } from '../conversas.ts';
import type { PreferenciasDoApp } from '../preferencias.ts';
import {
  empilhar,
  PILHA_INICIAL,
  semAConversa,
  semAsConversas,
  voltar,
  type Pilha as PilhaDeTelas,
  type TelaDoApp,
} from '../navegacao.ts';
import { Ajustes } from './Ajustes.tsx';
import { CodigoSecreto } from './CodigoSecreto.tsx';
import { Conversa } from './Conversa.tsx';
import { Conversas } from './Conversas.tsx';
import { Encaminhar } from './Encaminhar.tsx';
import { Pedidos } from './Pedidos.tsx';
import { Politica } from './Politica.tsx';
import { Seguranca } from './Seguranca.tsx';

const chaveDe = (tela: TelaDoApp) => ('id' in tela ? `${tela.tipo}:${tela.id}` : tela.tipo);

export function Principal({
  conversas,
  preferencias,
  aoMudarNotificacoes,
  aoApagarTudo,
}: {
  readonly conversas: ConversasDoApp;
  readonly preferencias: PreferenciasDoApp;
  /** Ligar pede a permissão do sistema; devolve se ficaram ligadas. */
  readonly aoMudarNotificacoes: (ligar: boolean) => Promise<boolean>;
  /** Pânico (RF-48): apaga tudo deste celular. */
  readonly aoApagarTudo: () => void;
}) {
  const [pilha, setPilha] = useState<PilhaDeTelas>(PILHA_INICIAL);
  const abrir = useCallback((tela: TelaDoApp) => {
    setPilha((atual) => empilhar(atual, tela));
  }, []);
  const voltarUma = useCallback(() => {
    setPilha((atual) => voltar(atual));
  }, []);
  const sumir = useCallback((id: string) => {
    setPilha((atual) => semAConversa(atual, id));
  }, []);

  // As ocultas fecharam: as telas delas saem (RF-24).
  useEffect(
    () =>
      conversas.aoFecharOcultas((ids) => {
        setPilha((atual) => semAsConversas(atual, ids));
      }),
    [conversas],
  );

  useEffect(() => {
    if (pilha.length <= 1) return;
    const assinatura = BackHandler.addEventListener('hardwareBackPress', () => {
      voltarUma();
      return true;
    });
    return () => {
      assinatura.remove();
    };
  }, [pilha.length, voltarUma]);

  const desenhar = (tela: TelaDoApp, topo: boolean) => {
    switch (tela.tipo) {
      case 'conversas':
        return <Conversas conversas={conversas} preferencias={preferencias} abrir={abrir} />;
      case 'ajustes':
        return (
          <Ajustes
            conversas={conversas}
            preferencias={preferencias}
            aoMudarNotificacoes={aoMudarNotificacoes}
            aoVoltar={voltarUma}
            abrir={abrir}
            aoApagarTudo={aoApagarTudo}
          />
        );
      case 'codigo':
        return <CodigoSecreto conversas={conversas} aoVoltar={voltarUma} />;
      case 'politica':
        return <Politica aoVoltar={voltarUma} />;
      case 'pedidos':
        return <Pedidos conversas={conversas} aoVoltar={voltarUma} abrir={abrir} />;
      case 'conversa':
        return (
          <Conversa
            conversas={conversas}
            id={tela.id}
            naFrente={topo}
            aoVoltar={voltarUma}
            aoAbrirSeguranca={() => {
              abrir({ tipo: 'seguranca', id: tela.id });
            }}
            aoSumir={() => {
              sumir(tela.id);
            }}
            aoEncaminhar={(mensagens) => {
              abrir({ tipo: 'encaminhar', id: tela.id, mensagens: mensagens.map(paraHex) });
            }}
          />
        );
      case 'encaminhar':
        return (
          <Encaminhar
            conversas={conversas}
            origem={tela.id}
            mensagens={tela.mensagens.map(deHex)}
            aoVoltar={voltarUma}
          />
        );
      case 'seguranca':
        return (
          <Seguranca
            conversas={conversas}
            id={tela.id}
            aoVoltar={voltarUma}
            aoSumir={() => {
              sumir(tela.id);
            }}
          />
        );
    }
  };

  return (
    <Pilha
      telas={pilha.map((tela, i) => ({
        chave: chaveDe(tela),
        conteudo: desenhar(tela, i === pilha.length - 1),
      }))}
    />
  );
}
