// A identidade que as palavras guardam, para a pessoa conferir o ID antes de entrar (RF-03). Antes
// de entrar, dá para escolher um backup (RF-47): os contatos e os ajustes voltam com ele. O arquivo
// só abre com as mesmas palavras.
import type { ConteudoDoBackup, Identidade } from '@cifra/core';
import { useEffect } from 'react';
import { BackHandler, Text, View } from 'react-native';
import { Botao } from '../componentes/Botao.tsx';
import { CartaoDeIdentidade } from '../componentes/CartaoDeIdentidade.tsx';
import { Marca } from '../componentes/Marca.tsx';
import { Tela } from '../componentes/Tela.tsx';
import { resumoDoBackup } from '../formato-do-backup.ts';
import { useTextos } from '../i18n.ts';
import { criarEstilos, tipos } from '../tema.ts';

interface PropsDaRestaurada {
  readonly identidade: Identidade;
  readonly naoGuardou: boolean;
  readonly guardando: boolean;
  readonly aoEntrar: () => void;
  readonly aoVoltar: () => void;
  /** O backup escolhido, já aberto; `null` sem backup. */
  readonly backup: ConteudoDoBackup | null;
  /** O último arquivo escolhido não abriu com estas palavras. */
  readonly backupRecusado: boolean;
  /** Abre o seletor de arquivos do sistema. */
  readonly aoEscolherBackup: () => void;
}

export function Restaurada({
  identidade,
  naoGuardou,
  guardando,
  aoEntrar,
  aoVoltar,
  backup,
  backupRecusado,
  aoEscolherBackup,
}: PropsDaRestaurada) {
  const estilos = useEstilos();
  const t = useTextos();

  useEffect(() => {
    if (guardando) return;
    const assinatura = BackHandler.addEventListener('hardwareBackPress', () => {
      aoVoltar();
      return true;
    });
    return () => {
      assinatura.remove();
    };
  }, [guardando, aoVoltar]);

  return (
    <Tela>
      <Marca />
      <View style={estilos.meio}>
        <View style={estilos.textos}>
          <Text accessibilityRole="header" style={estilos.titulo}>
            {t('restaurar.restaurada.titulo')}
          </Text>
          <Text style={estilos.descricao}>{t('restaurar.restaurada.descricao')}</Text>
        </View>
        <CartaoDeIdentidade id={identidade.id} legenda={t('identidade.sua')} />
        <Text accessibilityLiveRegion="polite" style={estilos.aviso}>
          {backupRecusado
            ? t('restaurar.restaurada.backupRecusado')
            : backup
              ? resumoDoBackup(t, backup)
              : t('restaurar.restaurada.dicaBackup')}
        </Text>
        {naoGuardou && <Text style={estilos.aviso}>{t('guardar.erro')}</Text>}
      </View>
      <View style={estilos.acoes}>
        <Botao
          titulo={t('restaurar.restaurada.entrar')}
          desativado={guardando}
          aoTocar={aoEntrar}
        />
        <Botao
          titulo={t('restaurar.restaurada.usarBackup')}
          variante="fantasma"
          pequeno
          desativado={guardando}
          aoTocar={aoEscolherBackup}
        />
        <Botao
          titulo={t('restaurar.voltar')}
          variante="fantasma"
          pequeno
          desativado={guardando}
          aoTocar={aoVoltar}
        />
      </View>
    </Tela>
  );
}

const useEstilos = criarEstilos((cores) => ({
  meio: { flex: 1, justifyContent: 'center', gap: 34, paddingVertical: 24 },
  textos: { gap: 14 },
  titulo: { ...tipos.titulo, color: cores.texto },
  descricao: { ...tipos.corpoGrande, color: cores.secundario },
  aviso: { ...tipos.monoPequeno, color: cores.texto },
  acoes: { gap: 14 },
}));
