// Peças da conversa (components/chat do design): balão, nota de sistema, nota da conversa, campo de
// busca e o campo de escrever. Os campos pedem ao teclado que não aprenda nem sugira nada (RF-43).
// O balão de uma mensagem temporária mostra o anel e quanto falta, e se desfaz (desfoque, escala e
// esmaecer) nos últimos 600 ms, para sumir no horário.
//
// O balão leva por cima a citação de uma resposta e o anexo (foto, vídeo ou arquivo), fica marcado
// quando selecionado, e o campo de escrever tem o clipe de anexar dentro da pílula e, acima dele, a
// mensagem que está sendo respondida. Arrastar o balão para a direita também responde.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, PanResponder, Pressable, Text, TextInput, View } from 'react-native';
import {
  deslocamentoDoArraste,
  eArrasteParaResponder,
  LIMIAR_DA_RESPOSTA,
  respondeAoSoltar,
} from '../gesto.ts';
import { marcarUso } from '../uso.ts';
import { criarEstilos, fontes, movimento, useCores } from '../tema.ts';
import { Icone } from './Icone.tsx';
import { useMovimentoReduzido } from './movimento.ts';
import { AnelDoTimer, TimerDiscreto } from './Timer.tsx';

const SEM_APRENDER = {
  autoCapitalize: 'none',
  autoComplete: 'off',
  autoCorrect: false,
  spellCheck: false,
  importantForAutofill: 'no',
} as const;

/** O balão que vence se desfaz nos últimos 600 ms, como no design. */
const DESFAZER_EM = 600;

/** O maior desfoque do balão que se desfaz, em px. */
const DESFOQUE = 8;

export function CampoDeBusca({
  valor,
  aoMudar,
  rotulo,
}: {
  readonly valor: string;
  readonly aoMudar: (texto: string) => void;
  readonly rotulo: string;
}) {
  const cores = useCores();
  const estilos = useEstilos();
  return (
    <View style={estilos.busca}>
      <Icone nome="buscar" tamanho={17} cor={cores.secundario} />
      <View style={estilos.areaDaBusca}>
        {/* A dica fica num texto por cima, numa linha só, terminando em "…" se não couber: a dica do
            próprio campo quebra a linha com a fonte do celular grande e sai cortada pela metade. */}
        {valor === '' && (
          <Text
            numberOfLines={1}
            importantForAccessibility="no-hide-descendants"
            style={estilos.dicaDaBusca}
          >
            {rotulo}
          </Text>
        )}
        <TextInput
          {...SEM_APRENDER}
          value={valor}
          onChangeText={(texto) => {
            marcarUso();
            aoMudar(texto);
          }}
          accessibilityLabel={rotulo}
          cursorColor={cores.acento}
          selectionColor={cores.acento}
          style={estilos.campoDaBusca}
        />
      </View>
    </View>
  );
}

/**
 * O esmaecer, a escala e o desfoque do balão que vence. Começa a tempo de terminar no prazo; com
 * movimento reduzido, só esmaece.
 */
function useDesfazer(expiraEm: number | null, reduzido: boolean) {
  const presenca = useRef(new Animated.Value(1)).current;
  const [desfoque, setDesfoque] = useState(0);

  useEffect(() => {
    if (expiraEm === null) return;
    const duracao = reduzido ? movimento.reduzido : DESFAZER_EM;
    const animacao = Animated.timing(presenca, {
      toValue: 0,
      duration: duracao,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    });
    const espera = setTimeout(
      () => {
        animacao.start();
      },
      Math.max(0, expiraEm - duracao - Date.now()),
    );
    return () => {
      clearTimeout(espera);
      animacao.stop();
    };
  }, [expiraEm, reduzido, presenca]);

  useEffect(() => {
    if (reduzido) return;
    const ouvinte = presenca.addListener(({ value }) => {
      const px = Math.round((1 - value) * DESFOQUE);
      setDesfoque((atual) => (atual === px ? atual : px));
    });
    return () => {
      presenca.removeListener(ouvinte);
    };
  }, [presenca, reduzido]);

  const escala = presenca.interpolate({
    inputRange: [0, 1],
    outputRange: [reduzido ? 1 : 0.94, 1],
  });
  return { presenca, escala, desfoque };
}

/**
 * Arrastar o balão para a direita responde (RF-55). O balão segue o dedo e o ícone de responder
 * aparece onde ele estava; soltar depois do limiar chama `aoArrastar`, e o balão volta ao lugar.
 * Com movimento reduzido, o balão fica parado e só o ícone aparece, ao lado dele.
 */
function useArrastar(aoArrastar: (() => void) | undefined, reduzido: boolean) {
  const arraste = useRef(new Animated.Value(0)).current;
  // O respondedor nasce no primeiro render e lê daqui o que vale agora.
  const atual = useRef({ aoArrastar, reduzido });
  useEffect(() => {
    atual.current = { aoArrastar, reduzido };
  }, [aoArrastar, reduzido]);

  const [respondedor] = useState(() => {
    const voltar = () => {
      Animated.timing(arraste, {
        toValue: 0,
        duration: atual.current.reduzido ? movimento.reduzido : movimento.base,
        easing: movimento.curva,
        useNativeDriver: true,
      }).start();
    };
    return PanResponder.create({
      // Só arraste de lado: o toque, o segurar e a rolagem da conversa seguem como antes.
      onMoveShouldSetPanResponder: (_evento, gesto) =>
        atual.current.aoArrastar !== undefined && eArrasteParaResponder(gesto.dx, gesto.dy),
      onPanResponderMove: (_evento, gesto) => {
        arraste.setValue(deslocamentoDoArraste(gesto.dx));
      },
      onPanResponderRelease: (_evento, gesto) => {
        if (respondeAoSoltar(gesto.dx)) atual.current.aoArrastar?.();
        voltar();
      },
      onPanResponderTerminationRequest: () => true,
      onPanResponderTerminate: voltar,
    });
  });

  // O ícone cresce e aparece até o limiar: cheio, soltar já responde.
  const faixa = { inputRange: [0, LIMIAR_DA_RESPOSTA], extrapolate: 'clamp' as const };
  return {
    gestos: respondedor.panHandlers,
    balao: { transform: [{ translateX: reduzido ? 0 : arraste }] },
    icone: {
      opacity: arraste.interpolate({ ...faixa, outputRange: [0, 1] }),
      transform: [
        { scale: reduzido ? 1 : arraste.interpolate({ ...faixa, outputRange: [0.4, 1] }) },
      ],
    },
  };
}

interface PropsDoBalao {
  readonly texto: string;
  readonly deMim: boolean;
  /** Junto da anterior do mesmo lado: o canto que se encosta fica reto. */
  readonly agrupado: boolean;
  /** A hora e, nas suas, o status: "14:02 · enviada". */
  readonly rodape: string;
  /** Mensagem temporária: quanto falta ("19m") e a fração do anel. */
  readonly prazo?: { readonly restante: string; readonly fracao: number } | undefined;
  /** Quando some, no relógio do aparelho; nula sem timer. */
  readonly expiraEm: number | null;
  /** Segurar o balão seleciona a mensagem (RF-51). */
  readonly aoSegurar: () => void;
  /** O nome da ação de segurar, para quem lê a tela. */
  readonly rotuloDaAcao: string;
  /** Tocar: com a seleção aberta, soma ou tira a mensagem dela. */
  readonly aoTocar?: (() => void) | undefined;
  /** Arrastar para a direita responde (RF-55); sem isto, o balão não se arrasta. */
  readonly aoArrastar?: (() => void) | undefined;
  readonly selecionado?: boolean | undefined;
  /** A citação e o anexo, por cima do texto. */
  readonly topo?: ReactNode;
  /** `midia`: foto ou vídeo, com a moldura de 4 px; `arquivo`: a linha do documento. */
  readonly forma?: 'texto' | 'midia' | 'arquivo' | undefined;
  /** O que vai à esquerda do rodapé: o progresso, ou a duração do vídeo. */
  readonly inicioDoRodape?: ReactNode;
}

export function Balao({
  texto,
  deMim,
  agrupado,
  rodape,
  prazo,
  expiraEm,
  aoSegurar,
  rotuloDaAcao,
  aoTocar,
  aoArrastar,
  selecionado = false,
  topo,
  forma = 'texto',
  inicioDoRodape,
}: PropsDoBalao) {
  const cores = useCores();
  const estilos = useEstilos();
  const reduzido = useMovimentoReduzido();
  const { presenca, escala, desfoque } = useDesfazer(expiraEm, reduzido);
  const arrastar = useArrastar(aoArrastar, reduzido);
  const raios = deMim
    ? agrupado
      ? { borderTopRightRadius: 6, borderBottomRightRadius: 6 }
      : { borderBottomRightRadius: 6 }
    : agrupado
      ? { borderTopLeftRadius: 6, borderBottomLeftRadius: 6 }
      : { borderBottomLeftRadius: 6 };
  const cor = deMim ? cores.sobreAcento : cores.texto;
  return (
    <Animated.View
      style={[
        estilos.lado,
        deMim ? estilos.meu : estilos.dele,
        !agrupado && estilos.solto,
        selecionado && estilos.selecionado,
        {
          opacity: presenca,
          transform: [{ scale: escala }],
          transformOrigin: deMim ? 'right bottom' : 'left bottom',
        },
        desfoque > 0 && { filter: [{ blur: desfoque }] },
      ]}
    >
      <View style={estilos.envoltorio}>
        {aoArrastar && (
          <Animated.View
            pointerEvents="none"
            style={[
              reduzido ? (deMim ? estilos.iconeAntes : estilos.iconeDepois) : estilos.iconeAtras,
              arrastar.icone,
            ]}
          >
            <Icone nome="responder" tamanho={20} traco={1.9} cor={cores.secundario} />
          </Animated.View>
        )}
        <Animated.View {...arrastar.gestos} style={arrastar.balao}>
          <Pressable
            onLongPress={aoSegurar}
            onPress={aoTocar}
            accessibilityState={{ selected: selecionado }}
            accessibilityActions={[{ name: 'longpress', label: rotuloDaAcao }]}
            onAccessibilityAction={(evento) => {
              if (evento.nativeEvent.actionName === 'longpress') aoSegurar();
            }}
            style={[
              estilos.balao,
              forma === 'midia' && estilos.balaoDeMidia,
              forma === 'arquivo' && estilos.balaoDeArquivo,
              { backgroundColor: deMim ? cores.acento : cores.superficie },
              raios,
            ]}
          >
            {topo}
            {texto !== '' && (
              <Text
                selectable={false}
                style={[estilos.textoDoBalao, forma === 'midia' && estilos.legenda, { color: cor }]}
              >
                {texto}
              </Text>
            )}
            <View
              style={[
                estilos.rodapeDoBalao,
                forma === 'midia' && estilos.rodapeDaMidia,
                inicioDoRodape ? estilos.rodapeComInicio : null,
              ]}
            >
              {inicioDoRodape ? (
                <Text style={[estilos.textoDoRodape, estilos.inicioDoRodape, { color: cor }]}>
                  {inicioDoRodape}
                </Text>
              ) : null}
              {prazo && (
                <>
                  <AnelDoTimer fracao={prazo.fracao} cor={cor} />
                  <Text style={[estilos.textoDoRodape, { color: cor }]}>{prazo.restante}</Text>
                  <Text style={[estilos.textoDoRodape, { color: cor }]}>·</Text>
                </>
              )}
              <Text style={[estilos.textoDoRodape, { color: cor }]}>{rodape}</Text>
            </View>
          </Pressable>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

/** A nota de sistema no meio da conversa (SystemNote do design): o timer mudou, uma expirou. */
export function NotaDeSistema({ texto }: { readonly texto: string }) {
  const estilos = useEstilos();
  return (
    <View style={estilos.notaDeSistema}>
      <Text style={estilos.textoDaNotaDeSistema}>{texto}</Text>
    </View>
  );
}

/** A nota no alto da conversa (E2EBanner do design): tracejada, em mono. */
export function NotaDaConversa({ texto }: { readonly texto: string }) {
  const estilos = useEstilos();
  return (
    <View style={estilos.nota}>
      <Text style={estilos.textoDaNota}>{texto}</Text>
    </View>
  );
}

interface PropsDoCompositor {
  readonly valor: string;
  readonly aoMudar: (texto: string) => void;
  readonly aoEnviar: () => void;
  readonly rotulo: string;
  readonly rotuloDoEnviar: string;
  /** O clipe dentro da pílula: abre o painel "Anexar". */
  readonly anexar?: { readonly rotulo: string; readonly aoTocar: () => void } | undefined;
  /** A mensagem que está sendo respondida, acima do campo (RF-55). */
  readonly resposta?: ReactNode;
  /** Na prévia dos anexos, a legenda é opcional: o enviar fica ativo sem texto. */
  readonly enviarSemTexto?: boolean | undefined;
  /** O timer da próxima mensagem, discreto, dentro do campo: tocar escolhe outro (RF-26). */
  readonly timer?:
    | {
        readonly rotulo: string;
        readonly rotuloAcessivel: string;
        /** Um timer só desta mensagem, diferente do da conversa. */
        readonly proprio: boolean;
        readonly aoTocar: () => void;
      }
    | undefined;
}

export function Compositor({
  valor,
  aoMudar,
  aoEnviar,
  rotulo,
  rotuloDoEnviar,
  anexar,
  resposta,
  enviarSemTexto = false,
  timer,
}: PropsDoCompositor) {
  const cores = useCores();
  const estilos = useEstilos();
  const pronto = enviarSemTexto || valor.trim().length > 0;
  return (
    <View>
      {resposta}
      <View style={estilos.compositor}>
        <View style={[estilos.caixaDoTexto, anexar && estilos.caixaComClipe]}>
          {anexar && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={anexar.rotulo}
              onPress={anexar.aoTocar}
              // 34 de largura no desenho; o toque chega a 44 (RNF-18).
              hitSlop={{ left: 5, right: 5 }}
              style={estilos.clipe}
            >
              <Icone nome="anexar" tamanho={19} cor={cores.secundario} />
            </Pressable>
          )}
          <TextInput
            {...SEM_APRENDER}
            value={valor}
            onChangeText={(texto) => {
              marcarUso();
              aoMudar(texto);
            }}
            accessibilityLabel={rotulo}
            placeholder={rotulo}
            placeholderTextColor={cores.secundario}
            cursorColor={cores.acento}
            selectionColor={cores.acento}
            multiline
            style={estilos.campoDoTexto}
          />
          {timer && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={timer.rotuloAcessivel}
              onPress={timer.aoTocar}
              style={estilos.timerDoCampo}
            >
              <TimerDiscreto
                rotulo={timer.rotulo}
                cor={timer.proprio ? cores.texto : cores.secundario}
              />
            </Pressable>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={rotuloDoEnviar}
          accessibilityState={{ disabled: !pronto }}
          disabled={!pronto}
          onPress={aoEnviar}
          style={[estilos.enviar, !pronto && estilos.enviarApagado]}
        >
          <Icone nome="enviar" tamanho={20} traco={2.2} cor={cores.sobreAcento} />
        </Pressable>
      </View>
    </View>
  );
}

const useEstilos = criarEstilos((cores) => ({
  // A altura do design é o mínimo: com a fonte do celular grande, a busca cresce em vez de cortar.
  busca: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: cores.superficie,
  },
  areaDaBusca: { flex: 1, justifyContent: 'center' },
  dicaDaBusca: {
    position: 'absolute',
    left: 0,
    right: 0,
    pointerEvents: 'none',
    fontFamily: fontes.regular,
    fontSize: 15,
    color: cores.secundario,
  },
  campoDaBusca: {
    minHeight: 44,
    padding: 0,
    fontFamily: fontes.regular,
    fontSize: 15,
    color: cores.texto,
  },
  lado: { flexDirection: 'row' },
  meu: { justifyContent: 'flex-end' },
  dele: { justifyContent: 'flex-start' },
  solto: { marginTop: 8 },
  selecionado: { backgroundColor: cores.superficie2, borderRadius: 12 },
  envoltorio: { maxWidth: '78%' },
  // O ícone de responder fica atrás do balão, perto de onde ele começa: aparece quando ele anda.
  iconeAtras: { position: 'absolute', top: 0, bottom: 0, left: 20, justifyContent: 'center' },
  // Com movimento reduzido o balão não anda: o ícone vai ao lado dele, no espaço livre da linha.
  iconeAntes: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: '100%',
    marginRight: 12,
    justifyContent: 'center',
  },
  iconeDepois: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '100%',
    marginLeft: 12,
    justifyContent: 'center',
  },
  balaoDeMidia: { paddingTop: 4, paddingHorizontal: 4, paddingBottom: 5 },
  balaoDeArquivo: { width: 268, paddingTop: 8, paddingLeft: 8, paddingRight: 10, paddingBottom: 6 },
  legenda: { paddingTop: 6, paddingHorizontal: 8 },
  rodapeDaMidia: { paddingTop: 3, paddingHorizontal: 8 },
  rodapeComInicio: { alignSelf: 'stretch' },
  inicioDoRodape: { marginRight: 'auto' },
  balao: {
    maxWidth: '100%',
    paddingTop: 8,
    paddingHorizontal: 12,
    paddingBottom: 6,
    borderRadius: 18,
    gap: 2,
  },
  textoDoBalao: { fontFamily: fontes.regular, fontSize: 15.5, lineHeight: 21.4 },
  rodapeDoBalao: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    opacity: 0.62,
  },
  textoDoRodape: { fontFamily: fontes.mono, fontSize: 10.5 },
  notaDeSistema: {
    alignSelf: 'center',
    marginVertical: 8,
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: 10,
    backgroundColor: cores.superficie,
  },
  textoDaNotaDeSistema: {
    textAlign: 'center',
    fontFamily: fontes.mono,
    fontSize: 11,
    color: cores.secundario,
  },
  nota: {
    alignSelf: 'center',
    maxWidth: 280,
    marginTop: 4,
    marginBottom: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: cores.linha,
    borderRadius: 14,
  },
  textoDaNota: {
    textAlign: 'center',
    fontFamily: fontes.mono,
    fontSize: 11,
    lineHeight: 17,
    color: cores.secundario,
  },
  compositor: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  caixaComClipe: { paddingLeft: 6 },
  clipe: { width: 34, height: 44, alignItems: 'center', justifyContent: 'center' },
  caixaDoTexto: {
    flex: 1,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 16,
    paddingRight: 4,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: cores.linha,
    backgroundColor: cores.superficie,
  },
  campoDoTexto: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingVertical: 10,
    fontFamily: fontes.regular,
    fontSize: 16,
    color: cores.texto,
  },
  // 44 px de toque (RNF-18), dentro do campo de 46.
  timerDoCampo: {
    minWidth: 44,
    height: 44,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  enviar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cores.acento,
  },
  enviarApagado: { opacity: 0.35, transform: [{ scale: 0.9 }] },
}));
