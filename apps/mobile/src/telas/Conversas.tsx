// A lista de conversas (RF-11), como no design: status da rede, busca só neste aparelho (RF-12),
// a entrada dos pedidos de conversa (RF-07), a lista com a nota pessoal (RF-19) e o "+", que abre
// o painel "Nova conversa" para colar um ID (RF-06), com o próprio ID, que copia (RF-45). O sol ou a
// lua troca o tema (RF-39), e o ícone de ajustes abre os ajustes. O coração abre o painel das
// doações, com o endereço Monero, que copia (RF-60).
//
// Conversas ocultas: o texto da busca que pode ser o código secreto, parado por 0,8 s, tenta abrir
// o cofre (RF-22). Abriu: a busca é limpa, e a seção "ocultas" aparece no topo, com a linha que
// fecha; a busca passa a olhar também as ocultas. Não abriu: nada muda.
import { codigoAceito, type ResultadoDaBusca } from '@cifra/core';
import { lerId } from '@cifra/protocol';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ResumoDaConversa } from '@cifra/core';

/** A busca parada por este tempo tenta abrir as ocultas com o texto. */
const ESPERA_DO_CODIGO = 800;
import { Botao } from '../componentes/Botao.tsx';
import { BotaoDeIcone, BotaoFlutuante } from '../componentes/Botoes.tsx';
import { CampoDeTexto } from '../componentes/CampoDeTexto.tsx';
import { CampoDeBusca } from '../componentes/Conversa.tsx';
import { Etiqueta, ItemDaConversa } from '../componentes/ItemDaConversa.tsx';
import { Painel } from '../componentes/Painel.tsx';
import { Recado, useRecado } from '../componentes/Recado.tsx';
import { RotuloDeSecao } from '../componentes/RotuloDeSecao.tsx';
import { PontoDeStatus } from '../componentes/Topo.tsx';
import type { ConversasDoApp, ErroAoAdicionar } from '../conversas.ts';
import { ENDERECO_MONERO } from '../doacao.ts';
import { horarioDaLista, nomeDaConversa, previaDaConversa } from '../formato-da-conversa.ts';
import { idNaTela } from '../formato-do-id.ts';
import { rotuloCurto } from '../formato-do-timer.ts';
import { idiomaAtivo, useTextos, type Traduzir } from '../i18n.ts';
import type { TelaDoApp } from '../navegacao.ts';
import type { PreferenciasDoApp } from '../preferencias.ts';
import { criarEstilos, fontes, raios, tipos, useTema } from '../tema.ts';
import { rotuloDaRede, useLeitura, useVersao } from './dados.ts';

const ERROS = {
  'id-invalido': 'nova.erros.idInvalido',
  inexistente: 'nova.erros.inexistente',
  invalido: 'nova.erros.invalido',
  'sem-conexao': 'nova.erros.semConexao',
  recusou: 'nova.erros.recusou',
  bloqueado: 'nova.erros.bloqueado',
} as const satisfies Record<ErroAoAdicionar, string>;

interface PropsDasConversas {
  readonly conversas: ConversasDoApp;
  readonly preferencias: PreferenciasDoApp;
  readonly abrir: (tela: TelaDoApp) => void;
}

function Linha({
  t,
  resumo,
  agora,
  previa,
  abrir,
}: {
  readonly t: Traduzir;
  readonly resumo: ResumoDaConversa;
  readonly agora: number;
  readonly previa?: string;
  readonly abrir: (tela: TelaDoApp) => void;
}) {
  return (
    <ItemDaConversa
      id={resumo.id}
      nome={nomeDaConversa(t, resumo)}
      verificado={resumo.verificado}
      horario={resumo.ultima ? horarioDaLista(t, resumo.atividade, agora) : ''}
      // Conversa com prints bloqueados (RF-58): nem a lista nem a busca mostram o texto dela.
      previa={
        resumo.printsBloqueados
          ? t('conversas.previaPrints')
          : (previa ?? previaDaConversa(t, resumo))
      }
      naoLidas={resumo.naoLidas}
      timer={resumo.timer > 0 ? rotuloCurto(t, resumo.timer) : undefined}
      aoTocar={() => {
        abrir({ tipo: 'conversa', id: resumo.id });
      }}
    />
  );
}

export function Conversas({ conversas, preferencias, abrir }: PropsDasConversas) {
  const estilos = useEstilos();
  const tema = useTema();
  const [recado, mostrarRecado] = useRecado();
  const t = useTextos();
  const margens = useSafeAreaInsets();
  const versao = useVersao(conversas);
  const [busca, setBusca] = useState('');
  const [novaAberta, setNovaAberta] = useState(false);
  const [doacaoAberta, setDoacaoAberta] = useState(false);
  const { agenda } = conversas;
  const agora = Date.now();

  const lista = useLeitura(() => agenda.conversas(), [versao]) ?? [];
  const pedidos =
    useLeitura(
      async () => (await agenda.pedidos()).length + (await agenda.bloqueados()).length,
      [versao],
    ) ?? 0;
  const naFila = useLeitura(async () => (await agenda.pedidos()).length, [versao]) ?? 0;
  // A busca acha a conversa pelo nome que a lista mostra, que muda com o idioma.
  const idioma = idiomaAtivo();
  const resultado = useLeitura(
    () => agenda.buscar(busca, (resumo) => nomeDaConversa(t, resumo)),
    [versao, busca, idioma],
  );
  const buscando = busca.trim() !== '';
  const { ocultas } = conversas;
  const listaOculta =
    useLeitura(() => (ocultas ? ocultas.conversas() : Promise.resolve(null)), [versao]) ?? null;
  const resultadoOculto: ResultadoDaBusca | null =
    useLeitura(
      () =>
        ocultas && buscando
          ? ocultas.buscar(busca, (resumo) => nomeDaConversa(t, resumo))
          : Promise.resolve(null),
      [versao, busca, idioma],
    ) ?? null;
  const comOcultas =
    resultadoOculto !== null &&
    resultadoOculto.conversas.length + resultadoOculto.mensagens.length > 0;
  const nada =
    !!resultado && resultado.conversas.length + resultado.mensagens.length === 0 && !comOcultas;

  // O texto parado pode ser o código secreto: tenta abrir as ocultas. Errado, nada muda.
  useEffect(() => {
    if (conversas.ocultasAbertas || !codigoAceito(busca)) return;
    const espera = setTimeout(() => {
      void conversas.tentarAbrirOcultas(busca).then((abriu) => {
        if (abriu) setBusca('');
      });
    }, ESPERA_DO_CODIGO);
    return () => {
      clearTimeout(espera);
    };
  }, [busca, conversas]);

  // As ocultas fecharam: a busca é limpa (RF-24).
  useEffect(
    () =>
      conversas.aoFecharOcultas(() => {
        setBusca('');
      }),
    [conversas],
  );

  const cabeca = (
    <>
      <View style={estilos.alto}>
        <PontoDeStatus
          ligado={conversas.rede === 'conectado'}
          rotulo={rotuloDaRede(t, conversas.rede)}
        />
        <View style={estilos.icones}>
          <BotaoDeIcone
            icone="coracao"
            rotulo={t('conversas.apoiar')}
            aoTocar={() => {
              setDoacaoAberta(true);
            }}
          />
          <BotaoDeIcone
            icone={tema === 'escuro' ? 'sol' : 'lua'}
            rotulo={t(tema === 'escuro' ? 'conversas.temaClaro' : 'conversas.temaEscuro')}
            aoTocar={() => {
              void preferencias
                .mudar({ tema: tema === 'escuro' ? 'claro' : 'escuro' })
                .catch(() => undefined);
            }}
          />
          <BotaoDeIcone
            icone="ajustes"
            rotulo={t('conversas.ajustes')}
            aoTocar={() => {
              abrir({ tipo: 'ajustes' });
            }}
          />
        </View>
      </View>
      <Text accessibilityRole="header" style={estilos.titulo}>
        {t('conversas.titulo')}
      </Text>
      <View style={estilos.busca}>
        <CampoDeBusca valor={busca} aoMudar={setBusca} rotulo={t('conversas.buscar')} />
      </View>
    </>
  );

  return (
    <View style={[estilos.tela, { paddingTop: margens.top + 10 }]}>
      {/* Uma lista só, buscando ou não: o campo de busca fica sempre no mesmo lugar e não perde o
          foco quando o resultado aparece. */}
      <FlatList
        data={buscando ? [] : lista}
        keyExtractor={(resumo) => resumo.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: margens.bottom + 110 }}
        ListHeaderComponent={
          <>
            {cabeca}
            {buscando ? (
              <>
                {nada && <Text style={estilos.nada}>{t('conversas.resultados.nada')}</Text>}
                {resultado && resultado.conversas.length > 0 && (
                  <View style={estilos.secao}>
                    <RotuloDeSecao texto={t('conversas.resultados.conversas')} />
                  </View>
                )}
                {resultado?.conversas.map((resumo) => (
                  <Linha key={resumo.id} t={t} resumo={resumo} agora={agora} abrir={abrir} />
                ))}
                {resultado && resultado.mensagens.length > 0 && (
                  <View style={estilos.secao}>
                    <RotuloDeSecao texto={t('conversas.resultados.mensagens')} />
                  </View>
                )}
                {resultado?.mensagens.map(({ mensagem, conversa }, i) => (
                  <Linha
                    key={i}
                    t={t}
                    resumo={{ ...conversa, ultima: mensagem, naoLidas: 0 }}
                    agora={agora}
                    previa={mensagem.texto.replace(/\s+/g, ' ')}
                    abrir={abrir}
                  />
                ))}
                {comOcultas && (
                  <View style={estilos.secao}>
                    <RotuloDeSecao texto={t('conversas.ocultas.rotulo')} />
                  </View>
                )}
                {resultadoOculto?.conversas.map((resumo) => (
                  <Linha key={resumo.id} t={t} resumo={resumo} agora={agora} abrir={abrir} />
                ))}
                {resultadoOculto?.mensagens.map(({ mensagem, conversa }, i) => (
                  <Linha
                    key={`oculta-${String(i)}`}
                    t={t}
                    resumo={{ ...conversa, ultima: mensagem, naoLidas: 0 }}
                    agora={agora}
                    previa={mensagem.texto.replace(/\s+/g, ' ')}
                    abrir={abrir}
                  />
                ))}
              </>
            ) : (
              <>
                {listaOculta && (
                  <>
                    <View style={estilos.secao}>
                      <RotuloDeSecao texto={t('conversas.ocultas.rotulo')} />
                    </View>
                    {listaOculta.length === 0 && (
                      <Text style={estilos.vazia}>{t('conversas.ocultas.vazia')}</Text>
                    )}
                    {listaOculta.map((resumo) => (
                      <Linha key={resumo.id} t={t} resumo={resumo} agora={agora} abrir={abrir} />
                    ))}
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        void conversas.fecharOcultas();
                      }}
                      style={({ pressed }) => [
                        estilos.pedidos,
                        estilos.fecharOcultas,
                        pressed && estilos.tocado,
                      ]}
                    >
                      <Text style={estilos.textoDosPedidos}>{t('conversas.ocultas.fechar')}</Text>
                    </Pressable>
                  </>
                )}
                {pedidos > 0 && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      abrir({ tipo: 'pedidos' });
                    }}
                    style={({ pressed }) => [estilos.pedidos, pressed && estilos.tocado]}
                  >
                    <Text style={estilos.textoDosPedidos}>{t('conversas.pedidos')}</Text>
                    {naFila > 0 && <Etiqueta>{naFila}</Etiqueta>}
                    <Text style={estilos.seta}>›</Text>
                  </Pressable>
                )}
              </>
            )}
          </>
        }
        renderItem={({ item }) => <Linha t={t} resumo={item} agora={agora} abrir={abrir} />}
        ListFooterComponent={
          buscando ? null : <Text style={estilos.rodape}>{t('conversas.rodape')}</Text>
        }
      />
      <BotaoFlutuante
        rotulo={t('conversas.nova')}
        embaixo={margens.bottom + 38}
        aoTocar={() => {
          setNovaAberta(true);
        }}
      />
      <NovaConversa
        conversas={conversas}
        visivel={novaAberta}
        aoFechar={() => {
          setNovaAberta(false);
        }}
        aoAbrir={(id) => {
          setNovaAberta(false);
          abrir({ tipo: 'conversa', id });
        }}
        aoCopiar={() => {
          mostrarRecado(t('ajustes.idCopiado'));
        }}
      />
      <Doacao
        conversas={conversas}
        visivel={doacaoAberta}
        aoFechar={() => {
          setDoacaoAberta(false);
        }}
        aoCopiar={() => {
          setDoacaoAberta(false);
          mostrarRecado(t('doacao.copiado'));
        }}
      />
      <Recado visivel={recado !== null} texto={recado ?? ''} embaixo={margens.bottom + 24} />
    </View>
  );
}

/** O painel "Nova conversa": colar o ID e iniciar; embaixo, o próprio ID, que copia (RF-45). */
function NovaConversa({
  conversas,
  visivel,
  aoFechar,
  aoAbrir,
  aoCopiar,
}: {
  readonly conversas: ConversasDoApp;
  readonly visivel: boolean;
  readonly aoFechar: () => void;
  readonly aoAbrir: (id: string) => void;
  readonly aoCopiar: () => void;
}) {
  const estilos = useEstilos();
  const t = useTextos();
  const [texto, setTexto] = useState('');
  const [procurando, setProcurando] = useState(false);
  const [erro, setErro] = useState<ErroAoAdicionar | null>(null);

  const iniciar = () => {
    setProcurando(true);
    setErro(null);
    void conversas.adicionar(texto).then((resultado) => {
      setProcurando(false);
      if (resultado.ok) {
        setTexto('');
        aoAbrir(resultado.id);
      } else {
        setErro(resultado.erro);
      }
    });
  };

  return (
    <Painel
      visivel={visivel}
      aoFechar={aoFechar}
      titulo={t('nova.titulo')}
      descricao={t('nova.descricao')}
    >
      <CampoDeTexto
        valor={texto}
        aoMudar={(novo) => {
          setTexto(novo);
          setErro(null);
        }}
        rotulo={t('nova.campo')}
        mono
      />
      {erro && (
        <Text accessibilityLiveRegion="polite" style={estilos.erro}>
          {t(ERROS[erro])}
        </Text>
      )}
      <Botao
        titulo={procurando ? t('nova.procurando') : t('nova.iniciar')}
        aoTocar={iniciar}
        pequeno
        desativado={procurando || lerId(texto) === null}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityHint={conversas.comMidia ? t('ajustes.tocarParaCopiar') : undefined}
        disabled={!conversas.comMidia}
        onPress={() => {
          void conversas.copiarTexto(conversas.meuId).then((copiou) => {
            if (copiou) aoCopiar();
          });
        }}
        style={({ pressed }) => [estilos.seuId, pressed && estilos.tocado]}
      >
        <Text style={estilos.rotuloDoSeuId}>{t('nova.seuId')}</Text>
        <Text style={estilos.valorDoSeuId}>{idNaTela(conversas.meuId)}</Text>
      </Pressable>
    </Painel>
  );
}

/**
 * O painel das doações (RF-60): o endereço Monero inteiro, para conferir, e o copiar,
 * que fecha o painel. O texto copiado é sensível e sai da área de transferência sozinho, como o ID.
 */
function Doacao({
  conversas,
  visivel,
  aoFechar,
  aoCopiar,
}: {
  readonly conversas: ConversasDoApp;
  readonly visivel: boolean;
  readonly aoFechar: () => void;
  readonly aoCopiar: () => void;
}) {
  const estilos = useEstilos();
  const t = useTextos();
  return (
    <Painel
      visivel={visivel}
      aoFechar={aoFechar}
      titulo={t('doacao.titulo')}
      descricao={t('doacao.descricao')}
    >
      <View style={estilos.endereco}>
        <Text style={estilos.rotuloDoEndereco}>{t('doacao.rotulo')}</Text>
        <Text style={estilos.valorDoEndereco}>{ENDERECO_MONERO}</Text>
      </View>
      <Botao
        titulo={t('doacao.copiar')}
        pequeno
        desativado={!conversas.comMidia}
        aoTocar={() => {
          void conversas.copiarTexto(ENDERECO_MONERO).then((copiou) => {
            if (copiou) aoCopiar();
          });
        }}
      />
    </Painel>
  );
}

const useEstilos = criarEstilos((cores) => ({
  tela: { flex: 1, backgroundColor: cores.fundo },
  alto: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingLeft: 20,
    paddingRight: 12,
    paddingTop: 10,
    paddingBottom: 4,
    minHeight: 44,
  },
  icones: { flexDirection: 'row', gap: 4 },
  titulo: {
    ...tipos.titulo,
    color: cores.texto,
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 14,
  },
  busca: { paddingHorizontal: 20, paddingBottom: 10 },
  secao: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6 },
  nada: {
    paddingHorizontal: 40,
    paddingTop: 24,
    textAlign: 'center',
    fontFamily: fontes.mono,
    fontSize: 11,
    lineHeight: 17.6,
    color: cores.secundario,
  },
  pedidos: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 6,
    paddingHorizontal: 18,
    borderRadius: 20,
    backgroundColor: cores.superficie,
  },
  tocado: { backgroundColor: cores.superficie2 },
  fecharOcultas: { marginTop: 8, marginBottom: 14 },
  vazia: {
    paddingHorizontal: 20,
    paddingBottom: 10,
    fontFamily: fontes.mono,
    fontSize: 11,
    lineHeight: 17.6,
    color: cores.secundario,
  },
  textoDosPedidos: { flex: 1, fontFamily: fontes.regular, fontSize: 15, color: cores.texto },
  seta: { fontFamily: fontes.mono, fontSize: 13, color: cores.secundario },
  rodape: {
    marginTop: 24,
    marginHorizontal: 40,
    textAlign: 'center',
    fontFamily: fontes.mono,
    fontSize: 11,
    lineHeight: 17.6,
    color: cores.secundario,
  },
  erro: { ...tipos.monoPequeno, color: cores.texto },
  seuId: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    borderRadius: raios.campo,
    borderWidth: 1,
    borderColor: cores.linha,
  },
  rotuloDoSeuId: { fontFamily: fontes.regular, fontSize: 14, color: cores.secundario },
  // Com a fonte do celular grande, o ID quebra a linha dentro da caixa em vez de sair dela.
  valorDoSeuId: {
    flexShrink: 1,
    fontFamily: fontes.mono,
    fontSize: 13.5,
    color: cores.texto,
    textAlign: 'right',
  },
  endereco: {
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: raios.campo,
    borderWidth: 1,
    borderColor: cores.linha,
  },
  rotuloDoEndereco: { ...tipos.rotulo, color: cores.secundario },
  valorDoEndereco: { fontFamily: fontes.mono, fontSize: 13.5, lineHeight: 20, color: cores.texto },
}));
