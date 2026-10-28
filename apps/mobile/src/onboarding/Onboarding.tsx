// Onboarding: liga o fluxo (fluxo.ts) às telas. Gera e restaura com o núcleo; quando o fluxo
// chega a `guardando`, chama `aoConcluir`, que grava a identidade e pede biometria ou senha. Na
// restauração, o backup escolhido (RF-47) é aberto aqui, com as palavras, e vai junto. Os termos de
// uso (RF-62) abrem por cima da abertura, que fica como estava embaixo; o voltar do Android fecha.
import {
  abrirBackup,
  gerarIdentidade,
  restaurarIdentidade,
  type ConteudoDoBackup,
  type Identidade,
  type IdentidadeNova,
} from '@cifra/core';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { escolherBackup } from '../adaptadores/backup.ts';
import { cripto } from '../adaptadores/cripto.ts';
import { idiomaDasPalavras } from '../i18n.ts';
import { Abertura } from '../telas/Abertura.tsx';
import { Documento } from '../telas/Documento.tsx';
import { Palavras } from '../telas/Palavras.tsx';
import { Restaurada } from '../telas/Restaurada.tsx';
import { Restaurar } from '../telas/Restaurar.tsx';
import { avancar, INICIO } from './fluxo.ts';

interface PropsDoOnboarding {
  /** Grava a identidade. Rejeita se não conseguir; o fluxo volta e avisa. */
  readonly aoConcluir: (identidade: Identidade, backup: ConteudoDoBackup | null) => Promise<void>;
  /** O pânico acabou de apagar tudo (RF-48): a abertura diz isso uma vez. */
  readonly apagado?: boolean;
}

export function Onboarding({ aoConcluir, apagado = false }: PropsDoOnboarding) {
  const [estado, despachar] = useReducer(avancar, INICIO);
  const [lendoTermos, setLendoTermos] = useState(false);
  const fecharTermos = useCallback(() => {
    setLendoTermos(false);
  }, []);

  useEffect(() => {
    if (!lendoTermos) return;
    const assinatura = BackHandler.addEventListener('hardwareBackPress', () => {
      fecharTermos();
      return true;
    });
    return () => {
      assinatura.remove();
    };
  }, [lendoTermos, fecharTermos]);

  useEffect(() => {
    if (estado.tela !== 'guardando') return;
    let ativo = true;
    aoConcluir(estado.identidade, estado.backup).catch(() => {
      if (ativo) despachar({ tipo: 'naoGuardou' });
    });
    return () => {
      ativo = false;
    };
  }, [estado, aoConcluir]);

  const voltar = useCallback(() => {
    despachar({ tipo: 'voltar' });
  }, []);
  const cancelarPulo = useCallback(() => {
    despachar({ tipo: 'cancelarPulo' });
  }, []);

  const palavras = (
    nova: IdentidadeNova,
    confirmandoPulo: boolean,
    naoGuardou: boolean,
    guardando: boolean,
  ) => (
    <Palavras
      palavras={nova.palavras}
      confirmandoPulo={confirmandoPulo}
      naoGuardou={naoGuardou}
      guardando={guardando}
      aoAnotar={() => {
        despachar({ tipo: 'anotei' });
      }}
      aoPular={() => {
        despachar({ tipo: 'pular' });
      }}
      aoConfirmarPulo={() => {
        despachar({ tipo: 'confirmarPulo' });
      }}
      aoCancelarPulo={cancelarPulo}
      aoVoltar={voltar}
    />
  );

  const restaurada = (
    identidade: Identidade,
    naoGuardou: boolean,
    guardando: boolean,
    backup: ConteudoDoBackup | null,
    backupRecusado: boolean,
  ) => (
    <Restaurada
      identidade={identidade}
      naoGuardou={naoGuardou}
      guardando={guardando}
      backup={backup}
      backupRecusado={backupRecusado}
      aoEntrar={() => {
        despachar({ tipo: 'entrar' });
      }}
      aoVoltar={voltar}
      aoEscolherBackup={() => {
        void escolherBackup().then(
          (arquivo) => {
            if (arquivo) {
              despachar({ tipo: 'backup', backup: abrirBackup(cripto, identidade, arquivo) });
            }
          },
          () => {
            despachar({ tipo: 'backup', backup: null });
          },
        );
      }}
    />
  );

  switch (estado.tela) {
    case 'abertura':
      return (
        <>
          <View
            style={estilos.inteira}
            importantForAccessibility={lendoTermos ? 'no-hide-descendants' : 'auto'}
          >
            <Abertura
              nova={estado.nova}
              aoGerar={() => {
                despachar({ tipo: 'gerada', nova: gerarIdentidade(cripto, idiomaDasPalavras()) });
              }}
              aoContinuar={() => {
                despachar({ tipo: 'continuar' });
              }}
              aoRestaurar={() => {
                despachar({ tipo: 'irParaRestaurar' });
              }}
              aoLerTermos={() => {
                setLendoTermos(true);
              }}
              apagado={apagado}
            />
          </View>
          {lendoTermos && (
            <View style={StyleSheet.absoluteFill}>
              <Documento documento="termos" aoVoltar={fecharTermos} />
            </View>
          )}
        </>
      );
    case 'palavras':
      return palavras(estado.nova, estado.confirmandoPulo, estado.naoGuardou, false);
    case 'restaurar':
      return (
        <Restaurar
          problema={estado.problema}
          aoRestaurar={(texto) => {
            despachar({ tipo: 'restauracao', restauracao: restaurarIdentidade(cripto, texto) });
          }}
          aoVoltar={voltar}
        />
      );
    case 'restaurada':
      return restaurada(
        estado.identidade,
        estado.naoGuardou,
        false,
        estado.backup,
        estado.backupRecusado,
      );
    case 'guardando':
      return estado.origem === 'palavras' && estado.nova
        ? palavras(estado.nova, false, false, true)
        : restaurada(estado.identidade, false, true, estado.backup, false);
  }
}

const estilos = StyleSheet.create({ inteira: { flex: 1 } });
