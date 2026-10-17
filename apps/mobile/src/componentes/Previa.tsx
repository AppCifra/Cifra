// A prévia antes de enviar (RF-56), como no WhatsApp: a versão já limpa de cada foto, vídeo ou
// arquivo escolhido, em tela cheia, com a legenda de cada um, o timer da próxima mensagem e o
// enviar. Até 10 itens; cada um vira uma mensagem, sem álbum.
import type { ArquivoParaEnviar } from '@cifra/core';
import { useEffect } from 'react';
import { BackHandler, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tamanhoLegivel } from '../formato-do-anexo.ts';
import type { Traduzir } from '../i18n.ts';
import { criarEstilos, fontes, useCores } from '../tema.ts';
import { nomeDoDocumento } from './Anexos.tsx';
import { BotaoDeIcone } from './Botoes.tsx';
import { Compositor } from './Conversa.tsx';
import { Icone } from './Icone.tsx';
import { useAlturaDoTeclado } from './teclado.ts';

export interface ItemDaPrevia {
  readonly chave: string;
  readonly arquivo: ArquivoParaEnviar;
  /** A foto ou a capa do vídeo, para mostrar (data:). */
  readonly endereco: string | null;
  readonly legenda: string;
}

interface PropsDaPrevia {
  readonly t: Traduzir;
  readonly visivel: boolean;
  /** `null`: ainda preparando. */
  readonly itens: readonly ItemDaPrevia[] | null;
  readonly atual: number;
  readonly aviso: string | null;
  readonly separador: string;
  readonly timer: {
    readonly rotulo: string;
    readonly rotuloAcessivel: string;
    readonly proprio: boolean;
    readonly aoTocar: () => void;
  };
  readonly aoEscolher: (indice: number) => void;
  readonly aoMudarLegenda: (texto: string) => void;
  readonly aoTirar: () => void;
  readonly aoEnviar: () => void;
  readonly aoFechar: () => void;
}

export function Previa({
  t,
  visivel,
  itens,
  atual,
  aviso,
  separador,
  timer,
  aoEscolher,
  aoMudarLegenda,
  aoTirar,
  aoEnviar,
  aoFechar,
}: PropsDaPrevia) {
  const cores = useCores();
  const estilos = useEstilos();
  const margens = useSafeAreaInsets();
  const teclado = useAlturaDoTeclado();

  useEffect(() => {
    if (!visivel) return;
    const assinatura = BackHandler.addEventListener('hardwareBackPress', () => {
      aoFechar();
      return true;
    });
    return () => {
      assinatura.remove();
    };
  }, [visivel, aoFechar]);

  if (!visivel) return null;
  const item = itens?.[atual] ?? null;
  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        estilos.tela,
        { paddingTop: margens.top, paddingBottom: Math.max(margens.bottom, teclado) + 8 },
      ]}
    >
      <View style={estilos.topo}>
        <BotaoDeIcone icone="fechar" rotulo={t('anexo.fechar')} aoTocar={aoFechar} />
        <View style={estilos.espaco} />
        {item && <BotaoDeIcone icone="lixeira" rotulo={t('previa.tirar')} aoTocar={aoTirar} />}
      </View>
      <View style={estilos.meio}>
        {!item ? (
          <Text style={estilos.aviso}>{t('previa.preparando')}</Text>
        ) : item.arquivo.arquivo === 'documento' ? (
          <View style={estilos.documento}>
            <Icone nome="arquivo" tamanho={44} traco={1.4} cor={cores.secundario} />
            <Text style={estilos.nome}>{nomeDoDocumento(t, item.arquivo.formato)}</Text>
            <Text style={estilos.aviso}>
              {tamanhoLegivel(item.arquivo.bytes.length, separador)}
            </Text>
          </View>
        ) : (
          item.endereco && (
            <View style={estilos.imagem}>
              <Image source={{ uri: item.endereco }} resizeMode="contain" style={estilos.foto} />
              {item.arquivo.arquivo === 'video' && (
                <View style={estilos.tocar}>
                  <Icone nome="tocar" tamanho={24} cor={cores.texto} />
                </View>
              )}
            </View>
          )
        )}
      </View>
      {itens && itens.length > 1 && (
        <ScrollView horizontal contentContainerStyle={estilos.faixa}>
          {itens.map((outro, indice) => (
            <Pressable
              key={outro.chave}
              accessibilityRole="button"
              accessibilityState={{ selected: indice === atual }}
              onPress={() => {
                aoEscolher(indice);
              }}
              style={[estilos.miniatura, indice === atual && estilos.miniaturaAtual]}
            >
              {outro.endereco ? (
                <Image source={{ uri: outro.endereco }} style={StyleSheet.absoluteFill} />
              ) : (
                <Icone nome="arquivo" tamanho={22} cor={cores.secundario} />
              )}
            </Pressable>
          ))}
        </ScrollView>
      )}
      {aviso && <Text style={[estilos.aviso, estilos.avisoEmbaixo]}>{aviso}</Text>}
      {item && (
        <Compositor
          valor={item.legenda}
          aoMudar={aoMudarLegenda}
          aoEnviar={aoEnviar}
          rotulo={t('previa.legenda')}
          rotuloDoEnviar={t('previa.enviar')}
          enviarSemTexto
          timer={timer}
        />
      )}
    </View>
  );
}

const useEstilos = criarEstilos((cores) => ({
  tela: { backgroundColor: cores.fundo },
  topo: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 6 },
  espaco: { flex: 1 },
  meio: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  imagem: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  foto: { width: '100%', height: '100%' },
  tocar: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11,12,11,0.55)',
  },
  documento: { alignItems: 'center', gap: 10 },
  nome: { fontFamily: fontes.media, fontSize: 16, color: cores.texto },
  aviso: { fontFamily: fontes.mono, fontSize: 12, color: cores.secundario, textAlign: 'center' },
  avisoEmbaixo: { paddingHorizontal: 20, paddingTop: 8 },
  faixa: { gap: 8, paddingHorizontal: 14, paddingTop: 10 },
  miniatura: {
    width: 56,
    height: 56,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cores.superficie,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  miniaturaAtual: { borderColor: cores.acento },
}));
