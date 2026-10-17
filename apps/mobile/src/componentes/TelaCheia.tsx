// A foto ou o vídeo em tela cheia, por cima da conversa, com o salvar no celular (RF-53). O vídeo
// toca da memória (RF-36): os bytes vão para o módulo nativo e são zerados aqui; ao fechar, o
// nativo zera a cópia dele.
import { useEffect, useState } from 'react';
import { BackHandler, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VideoNativo, videoNativo } from '../../modules/cifra-plataforma/index.ts';
import type { Traduzir } from '../i18n.ts';
import { criarEstilos, fontes, useCores } from '../tema.ts';
import { BotaoDeIcone } from './Botoes.tsx';
import { Icone } from './Icone.tsx';

export type MidiaNaTela =
  | { readonly tipo: 'imagem'; readonly endereco: string }
  | {
      readonly tipo: 'video';
      readonly bytes: Uint8Array;
      readonly largura: number;
      readonly altura: number;
    };

interface PropsDaTelaCheia {
  readonly t: Traduzir;
  readonly midia: MidiaNaTela | null;
  readonly aoSalvar: () => void;
  readonly aoFechar: () => void;
}

export function TelaCheia({ t, midia, aoSalvar, aoFechar }: PropsDaTelaCheia) {
  const cores = useCores();
  const estilos = useEstilos();
  const margens = useSafeAreaInsets();
  const [fonte, setFonte] = useState(0);
  const [tocando, setTocando] = useState(false);

  useEffect(() => {
    if (midia?.tipo !== 'video') return;
    const numero = videoNativo.carregar(midia.bytes);
    // A cópia do JS sai da memória: quem toca é o nativo.
    midia.bytes.fill(0);
    setFonte(numero);
    setTocando(true);
    return () => {
      setFonte(0);
      setTocando(false);
      videoNativo.soltar(numero);
    };
  }, [midia]);

  useEffect(() => {
    if (!midia) return;
    const assinatura = BackHandler.addEventListener('hardwareBackPress', () => {
      aoFechar();
      return true;
    });
    return () => {
      assinatura.remove();
    };
  }, [midia, aoFechar]);

  if (!midia) return null;
  return (
    <View style={[StyleSheet.absoluteFill, estilos.tela, { paddingTop: margens.top }]}>
      <View style={estilos.topo}>
        <BotaoDeIcone icone="voltar" rotulo={t('anexo.fechar')} aoTocar={aoFechar} />
        <View style={estilos.espaco} />
        <Pressable
          accessibilityRole="button"
          onPress={aoSalvar}
          style={({ pressed }) => [estilos.salvar, pressed && estilos.tocado]}
        >
          <Icone nome="baixar" tamanho={18} cor={cores.texto} />
          <Text style={estilos.textoDoSalvar}>{t('anexo.salvar')}</Text>
        </Pressable>
      </View>
      <View style={[estilos.meio, { marginBottom: margens.bottom }]}>
        {midia.tipo === 'imagem' ? (
          <Image source={{ uri: midia.endereco }} resizeMode="contain" style={estilos.foto} />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tocando ? t('anexo.pausar') : t('anexo.tocarVideo')}
            onPress={() => {
              setTocando((agora) => !agora);
            }}
            style={[estilos.video, { aspectRatio: midia.largura / Math.max(1, midia.altura) }]}
          >
            {fonte > 0 && (
              <VideoNativo
                fonte={fonte}
                tocando={tocando}
                onFim={() => {
                  setTocando(false);
                }}
                style={StyleSheet.absoluteFill}
              />
            )}
            {!tocando && (
              <View style={estilos.tocar}>
                <Icone nome="tocar" tamanho={26} cor={cores.texto} />
              </View>
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

const useEstilos = criarEstilos((cores) => ({
  tela: { backgroundColor: cores.fundo },
  topo: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 6 },
  espaco: { flex: 1 },
  salvar: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: cores.superficie,
  },
  tocado: { transform: [{ scale: 0.98 }] },
  textoDoSalvar: { fontFamily: fontes.media, fontSize: 14.5, color: cores.texto },
  meio: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  foto: { width: '100%', height: '100%' },
  video: { width: '100%', maxHeight: '100%', alignItems: 'center', justifyContent: 'center' },
  tocar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11,12,11,0.55)',
  },
}));
