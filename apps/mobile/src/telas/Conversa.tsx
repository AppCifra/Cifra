// A conversa, como no design: cabeçalho com identicon, nome, selo de verificado (RF-38), a linha
// da conexão e a pílula do timer (RF-25); as mensagens, com a hora e, nas suas, o status (RF-14),
// o anel das temporárias (RF-27) e as notas de sistema no meio; e embaixo o campo de escrever, com
// o timer da próxima mensagem (RF-26). Num pedido de conversa (RF-07), no lugar do campo: aceitar,
// recusar ou bloquear. Num contato bloqueado (RF-08), o aviso e o desbloquear. Na nota pessoal
// (RF-19), nada sai do aparelho.
//
// Segurar um balão seleciona a mensagem (RF-51), e a barra do alto troca o cabeçalho pela contagem
// e pelas ações (responder, copiar, encaminhar, salvar e apagar). O clipe do campo abre o painel
// "Anexar"; o que a pessoa escolhe passa pela limpeza e aparece na prévia, com a legenda (RF-56).
// Fotos e vídeos abrem em tela cheia, com o salvar no celular (RF-53).
import type { ArquivoParaEnviar, ItemDaConversa, Mensagem } from '@cifra/core';
import { paraHex, TIMER_MAXIMO_EM_SEGUNDOS } from '@cifra/protocol';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { BackHandler, FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { enderecoDeDados } from '../adaptadores/formato.ts';
import {
  ArquivoDoBalao,
  Citacao,
  inicioDoRodape,
  MidiaDoBalao,
  nomeDoDocumento,
  situacaoDo,
  type SituacaoDoAnexo,
} from '../componentes/Anexos.tsx';
import { Botao } from '../componentes/Botao.tsx';
import { BotaoDeIcone } from '../componentes/Botoes.tsx';
import { Balao, Compositor, NotaDaConversa, NotaDeSistema } from '../componentes/Conversa.tsx';
import { SeloDeVerificado } from '../componentes/Icone.tsx';
import { IdenticonNaMoldura } from '../componentes/ItemDaConversa.tsx';
import { Painel } from '../componentes/Painel.tsx';
import { PainelDoTimer } from '../componentes/PainelDoTimer.tsx';
import { Previa, type ItemDaPrevia } from '../componentes/Previa.tsx';
import { DURACAO_DO_RECADO, Recado } from '../componentes/Recado.tsx';
import { GrupoDeLinhas, LinhaDeValor } from '../componentes/Seguranca.tsx';
import { TelaCheia, type MidiaNaTela } from '../componentes/TelaCheia.tsx';
import { PilulaDoTimer } from '../componentes/Timer.tsx';
import { useAlturaDoTeclado } from '../componentes/teclado.ts';
import { Cabecalho } from '../componentes/Topo.tsx';
import type { ConversasDoApp, ResultadoAoEnviar } from '../conversas.ts';
import { separadorDecimal } from '../formato-do-anexo.ts';
import { hora, instanteDaMensagem, nomeDaConversa, textoDaPrevia } from '../formato-da-conversa.ts';
import {
  agruparNotas,
  fracaoRestante,
  maximoPersonalizado,
  OPCOES_DO_TIMER,
  opcoesDaMensagem,
  rotuloCurto,
  rotuloLongo,
  tempoRestante,
  textoDaNota,
  type ItemNaTela,
} from '../formato-do-timer.ts';
import { i18n, useTextos, type Traduzir } from '../i18n.ts';
import { criarEstilos, fontes, tipos } from '../tema.ts';
import { rotuloDaRede, useAgora, useLeitura, useTelaProtegida, useVersao } from './dados.ts';

interface PropsDaConversa {
  readonly conversas: ConversasDoApp;
  readonly id: string;
  /** A tela está no topo da pilha: só aí o que chega é marcado como lido. */
  readonly naFrente: boolean;
  readonly aoVoltar: () => void;
  readonly aoAbrirSeguranca: () => void;
  /** O pedido foi recusado ou bloqueado: a conversa some. */
  readonly aoSumir: () => void;
  /** Abre o encaminhar com as mensagens escolhidas (RF-54). */
  readonly aoEncaminhar: (mensagens: readonly Uint8Array[]) => void;
}

type PainelAberto = 'timer' | 'timerDaMensagem' | 'apagar' | 'anexar' | 'documento' | null;

type MensagemNaTela = Extract<ItemDaConversa, { tipo: 'mensagem' }>;

/** O recado do desfazer some este tanto antes do prazo do desfazer. */
const FOLGA_DO_DESFAZER = 500;

const hex = paraHex;

/**
 * Sem a confirmação de leitura ligada aqui, o "lida" do contato aparece como "enviada": ela vale
 * só entre quem liga (RF-17).
 */
function rodapeDe(t: Traduzir, mensagem: Mensagem, nota: boolean, mostrarLida: boolean): string {
  const quando = hora(instanteDaMensagem(mensagem));
  if (!mensagem.deMim || nota || mensagem.status === 'recebida') return quando;
  const status = mensagem.status === 'lida' && !mostrarLida ? 'enviada' : mensagem.status;
  return `${quando} · ${t(`conversa.status.${status}`)}`;
}

/** A chave de cada item na lista: o ID da mensagem; nas notas, o instante e a vez. */
function chavesDe(itens: readonly ItemNaTela[]): string[] {
  const vistas = new Map<string, number>();
  return itens.map((item) => {
    if (item.tipo === 'mensagem') return hex(item.mensagem.id);
    const base = `nota:${item.nota.tipo}:${String(item.nota.instante)}`;
    const vez = (vistas.get(base) ?? 0) + 1;
    vistas.set(base, vez);
    return `${base}:${String(vez)}`;
  });
}

/** O endereço da foto, ou da capa do vídeo, quando ela já está neste aparelho. */
function useEnderecoDoAnexo(
  conversas: ConversasDoApp,
  id: string,
  item: MensagemNaTela,
  pedido: boolean,
): string | null {
  const { anexo, mensagem } = item;
  const pronto =
    anexo !== null && !pedido && situacaoDo(anexo, mensagem.deMim, pedido) === 'pronto';
  const tipo = anexo?.arquivo;
  return useLeitura(async () => {
    if (!pronto) return null;
    if (tipo === 'imagem') return conversas.imagem(id, mensagem.id);
    if (tipo === 'video') return conversas.capa(id, mensagem.id);
    return null;
  }, [pronto, tipo, id, hex(mensagem.id)]);
}

/** O progresso da transferência da mensagem, sem ler a conversa de novo. */
function useProgresso(conversas: ConversasDoApp, mensagem: Uint8Array): number | null {
  return useSyncExternalStore(conversas.aoMudarProgresso, () => conversas.progresso(mensagem));
}

/** Se o contato está escrevendo agora (RF-18). */
function useDigitando(conversas: ConversasDoApp, id: string): boolean {
  return useSyncExternalStore(conversas.aoMudarDigitacao, () => conversas.digitando(id));
}

/** O balão "digitando…" do design, do lado do contato, no fim da conversa. */
function BalaoDigitando({ texto }: { readonly texto: string }) {
  const estilos = useEstilos();
  return (
    <View style={estilos.linhaDoDigitando}>
      <View style={estilos.balaoDoDigitando}>
        <Text accessibilityLiveRegion="polite" style={estilos.textoDoDigitando}>
          {texto}
        </Text>
      </View>
    </View>
  );
}

/** O progresso no rodapé da foto ou do vídeo a caminho: "42% · 1,8 MB". */
function ProgressoNoRodape({
  t,
  conversas,
  anexo,
  situacao,
  mensagem,
  separador,
}: {
  readonly t: Traduzir;
  readonly conversas: ConversasDoApp;
  readonly anexo: NonNullable<MensagemNaTela['anexo']>;
  readonly situacao: SituacaoDoAnexo;
  readonly mensagem: Uint8Array;
  readonly separador: string;
}) {
  const progresso = useProgresso(conversas, mensagem);
  return inicioDoRodape(t, anexo, situacao, progresso, separador);
}

interface PropsDoAnexoNaConversa {
  readonly t: Traduzir;
  readonly conversas: ConversasDoApp;
  readonly id: string;
  readonly item: MensagemNaTela;
  readonly pedido: boolean;
  readonly aoAbrir: (item: MensagemNaTela, endereco: string | null) => void;
}

/** O anexo dentro do balão, com o que ele precisa ler (a foto aberta e o progresso). */
function AnexoNaConversa({ t, conversas, id, item, pedido, aoAbrir }: PropsDoAnexoNaConversa) {
  const endereco = useEnderecoDoAnexo(conversas, id, item, pedido);
  const progresso = useProgresso(conversas, item.mensagem.id);
  const { anexo, mensagem } = item;
  if (!anexo) return null;
  const separador = separadorDecimal(i18n.language);
  const props = {
    t,
    anexo,
    deMim: mensagem.deMim,
    pedido,
    progresso,
    separador,
    aoBaixar: () => {
      void conversas.baixar(id, mensagem.id);
    },
    aoCancelar: () => {
      if (mensagem.deMim) void conversas.cancelarEnvio(id, mensagem.id);
      else void conversas.pararDownload(id, mensagem.id);
    },
    aoAbrir: () => {
      aoAbrir(item, endereco);
    },
  };
  return anexo.arquivo === 'documento' ? (
    <ArquivoDoBalao {...props} />
  ) : (
    <MidiaDoBalao {...props} endereco={endereco} />
  );
}

export function Conversa({
  conversas,
  id,
  naFrente,
  aoVoltar,
  aoAbrirSeguranca,
  aoSumir,
  aoEncaminhar,
}: PropsDaConversa) {
  const estilos = useEstilos();
  const t = useTextos();
  const margens = useSafeAreaInsets();
  const teclado = useAlturaDoTeclado();
  const versao = useVersao(conversas);
  const digitando = useDigitando(conversas, id);
  useEffect(
    () => () => {
      conversas.parouDeEscrever(id);
    },
    [conversas, id],
  );
  const [texto, setTexto] = useState('');
  const [aviso, setAviso] = useState<Exclude<ResultadoAoEnviar, 'ok'> | null>(null);
  const [painel, setPainel] = useState<PainelAberto>(null);
  /** As mensagens selecionadas (RF-51), pelo ID em hexadecimal. */
  const [selecao, setSelecao] = useState<ReadonlySet<string>>(new Set());
  const [respondendo, setRespondendo] = useState<Mensagem | null>(null);
  const [documento, setDocumento] = useState<MensagemNaTela | null>(null);
  const [naTelaCheia, setNaTelaCheia] = useState<{
    readonly midia: MidiaNaTela;
    readonly mensagem: Uint8Array;
  } | null>(null);
  const [previa, setPrevia] = useState<{
    readonly itens: ItemDaPrevia[] | null;
    readonly atual: number;
    readonly aviso: string | null;
  } | null>(null);
  /** O timer só da próxima mensagem; `null`: o da conversa. */
  const [timerDaProxima, setTimerDaProxima] = useState<number | null>(null);
  const [desfazer, setDesfazer] = useState<{
    readonly ids: readonly Uint8Array[];
    readonly ate: number;
  } | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  const resumo = useLeitura(() => conversas.agendaDe(id).conversa(id), [versao, id]);
  const itens = useLeitura(() => conversas.agendaDe(id).itens(id), [versao, id]) ?? [];
  useTelaProtegida(conversas, resumo?.printsBloqueados ?? false);
  const semTimer =
    useLeitura(() => conversas.agendaDe(id).temMensagensSemTimer(id), [versao, id]) ?? false;
  const naTela = useMemo(() => agruparNotas(itens), [itens]);
  const chaves = useMemo(() => chavesDe(naTela), [naTela]);
  const comPrazo = naTela.some((i) => i.tipo === 'mensagem' && i.mensagem.expiraEm !== null);
  const agora = useAgora(comPrazo);
  const mensagensNaTela = useMemo(
    () => naTela.filter((i): i is MensagemNaTela => i.tipo === 'mensagem'),
    [naTela],
  );
  const selecionadas = mensagensNaTela.filter((i) => selecao.has(hex(i.mensagem.id)));
  const selecionando = selecao.size > 0;
  const fechar = useCallback(() => {
    setPainel(null);
  }, []);
  const sairDaSelecao = useCallback(() => {
    setSelecao(new Set());
  }, []);

  useEffect(() => {
    if (naFrente) void conversas.ler(id);
  }, [conversas, id, naFrente, versao]);

  // O desfazer sai da tela um pouco antes do prazo: nunca se oferece o que não dá mais.
  useEffect(() => {
    if (!desfazer) return;
    const fim = setTimeout(
      () => {
        setDesfazer(null);
      },
      Math.max(0, desfazer.ate - Date.now() - FOLGA_DO_DESFAZER),
    );
    return () => {
      clearTimeout(fim);
    };
  }, [desfazer]);

  useEffect(() => {
    if (!recado) return;
    const fim = setTimeout(() => {
      setRecado(null);
    }, DURACAO_DO_RECADO);
    return () => {
      clearTimeout(fim);
    };
  }, [recado]);

  // Com a seleção aberta, o voltar do Android só sai dela.
  useEffect(() => {
    if (!selecionando) return;
    const assinatura = BackHandler.addEventListener('hardwareBackPress', () => {
      sairDaSelecao();
      return true;
    });
    return () => {
      assinatura.remove();
    };
  }, [selecionando, sairDaSelecao]);

  // Mensagem que sumiu (venceu, apagada) sai da seleção e da resposta.
  useEffect(() => {
    const existentes = new Set(mensagensNaTela.map((i) => hex(i.mensagem.id)));
    setSelecao((atual) => {
      const restante = [...atual].filter((chave) => existentes.has(chave));
      return restante.length === atual.size ? atual : new Set(restante);
    });
    setRespondendo((atual) => (atual && !existentes.has(hex(atual.id)) ? null : atual));
  }, [mensagensNaTela]);

  const timerDaConversa = resumo?.timer ?? 0;
  // O timer da próxima não passa do da conversa, mesmo se ele mudar enquanto isso.
  const timerDaMensagem =
    timerDaProxima !== null && (timerDaConversa === 0 || timerDaProxima <= timerDaConversa)
      ? timerDaProxima
      : null;

  if (!resumo) return <View style={estilos.tela} />;
  const nota = resumo.tipo === 'nota';
  const pedido = resumo.tipo === 'pedido';
  const nome = nomeDaConversa(t, resumo);
  const linhaDeBaixo = nota
    ? t('conversa.nota')
    : digitando
      ? t('conversa.digitando')
      : rotuloDaRede(t, conversas.rede);
  // Nada sai para um pedido nem para um bloqueado: o timer e o apagar pra todos não aparecem.
  const podeEnviar = nota || (resumo.tipo === 'contato' && !resumo.bloqueado);
  const separador = separadorDecimal(i18n.language);
  const timerDoCampo = timerDaMensagem ?? timerDaConversa;
  const timerDoCampoProps = {
    rotulo: rotuloCurto(t, timerDoCampo),
    rotuloAcessivel: t('timer.mensagem.rotulo', { tempo: rotuloLongo(t, timerDoCampo) }),
    proprio: timerDaMensagem !== null,
    aoTocar: () => {
      setPainel('timerDaMensagem');
    },
  };

  const enviar = () => {
    const enviado = texto;
    conversas.parouDeEscrever(id, true);
    const ttl = timerDaMensagem ?? undefined;
    const resposta = respondendo?.id;
    setTexto('');
    void conversas.enviar(id, enviado, ttl, resposta).then((resultado) => {
      if (resultado === 'ok') {
        setAviso(null);
        setTimerDaProxima(null);
        setRespondendo(null);
        return;
      }
      // Não saiu: o texto volta para o campo.
      setTexto(enviado);
      setAviso(resultado);
    });
  };

  const agir = (acao: Parameters<ConversasDoApp['mudar']>[0], some = false) => {
    void conversas.mudar(acao, id).then(() => {
      if (some) aoSumir();
    });
  };

  const alternar = (mensagem: Mensagem) => {
    setSelecao((atual) => {
      const nova = new Set(atual);
      const chave = hex(mensagem.id);
      if (nova.has(chave)) nova.delete(chave);
      else nova.add(chave);
      return nova;
    });
  };

  const ids = selecionadas.map((i) => i.mensagem.id);

  const apagarSoAqui = () => {
    fechar();
    sairDaSelecao();
    void conversas.apagarSoAqui(id, ids).then((ate) => {
      setDesfazer({ ids, ate });
    });
  };

  const salvar = async (mensagens: readonly Uint8Array[]) => {
    const salvos = await conversas.salvar(id, mensagens);
    setRecado(
      salvos === 0
        ? t('anexo.naoSalvou')
        : salvos === 1
          ? t('anexo.salvo')
          : t('anexo.salvos', { n: salvos }),
    );
  };

  /** A pessoa tocou num anexo pronto: a foto e o vídeo abrem em tela cheia; o documento, o salvar. */
  const abrirAnexo = (item: MensagemNaTela, endereco: string | null) => {
    if (selecionando) {
      alternar(item.mensagem);
      return;
    }
    const { anexo, mensagem } = item;
    if (!anexo) return;
    if (anexo.arquivo === 'documento') {
      setDocumento(item);
      setPainel('documento');
    } else if (anexo.arquivo === 'imagem') {
      void (endereco ? Promise.resolve(endereco) : conversas.imagem(id, mensagem.id)).then(
        (aberto) => {
          if (aberto)
            setNaTelaCheia({ midia: { tipo: 'imagem', endereco: aberto }, mensagem: mensagem.id });
        },
      );
    } else {
      void conversas.video(id, mensagem.id).then((bytes) => {
        if (!bytes) return;
        setNaTelaCheia({
          midia: { tipo: 'video', bytes, largura: anexo.largura, altura: anexo.altura },
          mensagem: mensagem.id,
        });
      });
    }
  };

  /** Escolhe no seletor do sistema, limpa cada arquivo e abre a prévia. */
  const escolher = (tipo: 'midia' | 'arquivo') => {
    fechar();
    void conversas.escolher(tipo).then(async (escolhidos) => {
      if (escolhidos.length === 0) return;
      setPrevia({ itens: null, atual: 0, aviso: null });
      const prontos: ItemDaPrevia[] = [];
      let deFora = 0;
      for (const [indice, escolhido] of escolhidos.entries()) {
        const preparado = await conversas.preparar(escolhido);
        if (typeof preparado === 'string') {
          deFora++;
          continue;
        }
        prontos.push({
          chave: String(indice),
          arquivo: preparado,
          endereco: enderecoDaPrevia(preparado),
          legenda: '',
        });
      }
      const aviso =
        deFora === 0
          ? null
          : deFora === 1
            ? t('previa.umDeFora')
            : t('previa.variosDeFora', { n: deFora });
      if (prontos.length === 0) {
        setPrevia(null);
        if (aviso) setRecado(aviso);
        return;
      }
      setPrevia({ itens: prontos, atual: 0, aviso });
    });
  };

  const enviarPrevia = () => {
    const lista = previa?.itens;
    if (!lista) return;
    const ttl = timerDaMensagem ?? undefined;
    const resposta = respondendo?.id;
    setPrevia(null);
    setRespondendo(null);
    setTimerDaProxima(null);
    void (async () => {
      for (const [indice, item] of lista.entries()) {
        const resultado = await conversas.enviarAnexo(id, item.arquivo, {
          legenda: item.legenda,
          ttl,
          // A resposta vai só com o primeiro.
          resposta: indice === 0 ? resposta : undefined,
        });
        if (resultado !== 'ok') setAviso(resultado);
      }
    })();
  };

  const titulo = (
    <View style={estilos.quem}>
      <IdenticonNaMoldura id={resumo.id} tamanho={20} moldura={38} />
      <View style={estilos.nomes}>
        <View style={estilos.linhaDoNome}>
          <Text numberOfLines={1} style={estilos.nome}>
            {nome}
          </Text>
          {resumo.verificado && <SeloDeVerificado tamanho={14} />}
        </View>
        <Text numberOfLines={1} style={estilos.subtitulo}>
          {linhaDeBaixo}
        </Text>
      </View>
    </View>
  );

  const prontosParaEncaminhar = selecionadas.every(
    ({ mensagem, anexo }) =>
      anexo === null || situacaoDo(anexo, mensagem.deMim, pedido) === 'pronto',
  );
  const comAnexoPronto = selecionadas.some(
    ({ mensagem, anexo }) =>
      anexo !== null && situacaoDo(anexo, mensagem.deMim, pedido) === 'pronto',
  );
  const comTexto = selecionadas.some(({ mensagem }) => mensagem.texto.trim() !== '');

  const barraDaSelecao = (
    <View style={estilos.barra}>
      <BotaoDeIcone icone="fechar" rotulo={t('selecao.fechar')} aoTocar={sairDaSelecao} />
      <Text
        accessibilityLabel={t('selecao.selecionadas', { n: selecao.size })}
        style={estilos.contagem}
      >
        {selecao.size}
      </Text>
      {podeEnviar && selecao.size === 1 && (
        <BotaoDeIcone
          icone="responder"
          rotulo={t('selecao.responder')}
          aoTocar={() => {
            setRespondendo(selecionadas[0]?.mensagem ?? null);
            sairDaSelecao();
          }}
        />
      )}
      {conversas.comMidia && comTexto && (
        <BotaoDeIcone
          icone="copiar"
          rotulo={t('selecao.copiar')}
          aoTocar={() => {
            void conversas.copiar(id, ids).then((copiou) => {
              if (copiou) setRecado(t('selecao.copiado'));
            });
            sairDaSelecao();
          }}
        />
      )}
      {!pedido && prontosParaEncaminhar && (
        <BotaoDeIcone
          icone="encaminhar"
          rotulo={t('selecao.encaminhar')}
          aoTocar={() => {
            sairDaSelecao();
            aoEncaminhar(ids);
          }}
        />
      )}
      {conversas.comMidia && comAnexoPronto && (
        <BotaoDeIcone
          icone="baixar"
          rotulo={t('selecao.salvar')}
          aoTocar={() => {
            sairDaSelecao();
            void salvar(ids);
          }}
        />
      )}
      <BotaoDeIcone
        icone="lixeira"
        rotulo={t('selecao.apagar')}
        aoTocar={() => {
          setPainel('apagar');
        }}
      />
    </View>
  );

  let embaixo;
  if (resumo.bloqueado) {
    embaixo = (
      <View style={estilos.acoes}>
        <Text style={estilos.avisoCentral}>{t('conversa.bloqueado')}</Text>
        <Botao
          titulo={t('conversa.desbloquear')}
          variante="fantasma"
          pequeno
          aoTocar={() => {
            agir((agenda) => agenda.desbloquear(id), resumo.tipo === 'pedido');
          }}
        />
      </View>
    );
  } else if (pedido) {
    embaixo = (
      <View style={estilos.acoes}>
        <Text style={estilos.descricaoDoPedido}>{t('conversa.pedido.descricao')}</Text>
        <Botao
          titulo={t('conversa.pedido.aceitar')}
          pequeno
          aoTocar={() => {
            void conversas.aceitar(id);
          }}
        />
        <Botao
          titulo={t('conversa.pedido.recusar')}
          variante="fantasma"
          pequeno
          aoTocar={() => {
            agir((agenda) => agenda.recusar(id), true);
          }}
        />
        <Botao
          titulo={t('conversa.pedido.bloquear')}
          variante="perigo"
          pequeno
          aoTocar={() => {
            agir((agenda) => agenda.bloquear(id), true);
          }}
        />
      </View>
    );
  } else {
    embaixo = (
      <>
        {aviso && (
          <Text accessibilityLiveRegion="polite" style={estilos.avisoCentral}>
            {t(
              aviso === 'longa'
                ? 'conversa.longa'
                : aviso === 'timer'
                  ? 'conversa.timerInvalido'
                  : 'conversa.falhou',
            )}
          </Text>
        )}
        <Compositor
          valor={texto}
          aoMudar={(novo) => {
            setTexto(novo);
            setAviso(null);
            conversas.escrevendo(id, novo);
          }}
          aoEnviar={enviar}
          rotulo={t('conversa.mensagem')}
          rotuloDoEnviar={t('conversa.enviar')}
          anexar={
            conversas.comMidia
              ? {
                  rotulo: t('anexo.anexar'),
                  aoTocar: () => {
                    setPainel('anexar');
                  },
                }
              : undefined
          }
          resposta={
            respondendo && (
              <View style={estilos.resposta}>
                <View style={estilos.citacaoDaResposta}>
                  <Citacao
                    nome={respondendo.deMim || nota ? t('resposta.voce') : nome}
                    texto={textoDaPrevia(t, respondendo)}
                    deMim={respondendo.deMim}
                    apagada={false}
                    sobreAcento={false}
                  />
                </View>
                <BotaoDeIcone
                  icone="fechar"
                  rotulo={t('resposta.cancelar')}
                  tamanhoDoIcone={18}
                  aoTocar={() => {
                    setRespondendo(null);
                  }}
                />
              </View>
            )
          }
          timer={timerDoCampoProps}
        />
      </>
    );
  }

  const renderizar = ({ item, index }: { readonly item: ItemNaTela; readonly index: number }) => {
    if (item.tipo === 'nota') {
      return <NotaDeSistema texto={textoDaNota(t, item.nota, item.quantas)} />;
    }
    const { mensagem, anexo, citada } = item;
    // A lista vem de baixo para cima: o item anterior na conversa é o próximo no índice.
    const anterior = naTela[naTela.length - 2 - index];
    const situacao = anexo ? situacaoDo(anexo, mensagem.deMim, pedido) : null;
    const aCaminho = situacao === 'baixando' || situacao === 'subindo';
    const citacao = citada && (
      <Citacao
        nome={citada.mensagem === null || citada.mensagem.deMim || nota ? t('resposta.voce') : nome}
        texto={citada.mensagem ? textoDaPrevia(t, citada.mensagem) : t('resposta.apagada')}
        deMim={citada.mensagem?.deMim ?? false}
        apagada={citada.mensagem === null}
        sobreAcento={mensagem.deMim}
      />
    );
    return (
      <Balao
        texto={mensagem.texto}
        deMim={mensagem.deMim}
        agrupado={anterior?.tipo === 'mensagem' && anterior.mensagem.deMim === mensagem.deMim}
        rodape={rodapeDe(t, mensagem, nota, conversas.privacidade.confirmacoesDeLeitura)}
        prazo={
          mensagem.expiraEm === null
            ? undefined
            : {
                restante: tempoRestante(t, mensagem.expiraEm - agora),
                fracao: fracaoRestante(mensagem, agora),
              }
        }
        expiraEm={mensagem.expiraEm}
        aoSegurar={() => {
          alternar(mensagem);
        }}
        aoTocar={
          selecionando
            ? () => {
                alternar(mensagem);
              }
            : undefined
        }
        aoArrastar={
          podeEnviar && !selecionando
            ? () => {
                setRespondendo(mensagem);
              }
            : undefined
        }
        selecionado={selecao.has(hex(mensagem.id))}
        rotuloDaAcao={t('selecao.selecionar')}
        forma={anexo ? (anexo.arquivo === 'documento' ? 'arquivo' : 'midia') : 'texto'}
        inicioDoRodape={
          anexo && anexo.arquivo !== 'documento' && situacao ? (
            aCaminho ? (
              <ProgressoNoRodape
                t={t}
                conversas={conversas}
                anexo={anexo}
                situacao={situacao}
                mensagem={mensagem.id}
                separador={separador}
              />
            ) : (
              inicioDoRodape(t, anexo, situacao, null, separador)
            )
          ) : null
        }
        topo={
          <>
            {citacao}
            {anexo && (
              <AnexoNaConversa
                t={t}
                conversas={conversas}
                id={id}
                item={item}
                pedido={pedido}
                aoAbrir={abrirAnexo}
              />
            )}
          </>
        }
      />
    );
  };

  const varias = selecionadas.length > 1;
  return (
    <View
      style={[
        estilos.tela,
        { paddingTop: margens.top, paddingBottom: Math.max(margens.bottom, teclado) + 8 },
      ]}
    >
      <View style={estilos.topo}>
        {selecionando ? (
          barraDaSelecao
        ) : (
          <Cabecalho aoVoltar={aoVoltar}>
            {nota ? (
              titulo
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${nome}. ${t('conversa.abrirSeguranca')}`}
                onPress={aoAbrirSeguranca}
                style={estilos.quemTocavel}
              >
                {titulo}
              </Pressable>
            )}
            {podeEnviar && (
              <PilulaDoTimer
                rotulo={rotuloCurto(t, timerDaConversa)}
                ativo={timerDaConversa > 0}
                rotuloAcessivel={t('timer.conversa.rotulo', {
                  tempo: rotuloLongo(t, timerDaConversa),
                })}
                aoTocar={() => {
                  setPainel('timer');
                }}
              />
            )}
          </Cabecalho>
        )}
      </View>
      <FlatList
        inverted
        data={[...naTela].reverse()}
        keyExtractor={(_, i) => chaves[chaves.length - 1 - i] ?? String(i)}
        contentContainerStyle={estilos.mensagens}
        renderItem={renderizar}
        extraData={selecao}
        // A lista é invertida: o cabeçalho fica embaixo, depois da última mensagem.
        ListHeaderComponent={digitando ? <BalaoDigitando texto={t('conversa.digitando')} /> : null}
        ListFooterComponent={
          <NotaDaConversa texto={nota ? t('conversa.nota') : t('conversa.cifrada')} />
        }
      />
      {embaixo}

      <Recado
        visivel={desfazer !== null || recado !== null}
        texto={
          recado ??
          (desfazer && desfazer.ids.length > 1
            ? nota
              ? t('conversa.notasApagadas')
              : t('conversa.apagadas')
            : nota
              ? t('conversa.notaApagada')
              : t('conversa.apagada'))
        }
        embaixo={Math.max(margens.bottom, teclado) + 80}
        acao={
          recado === null && desfazer
            ? {
                rotulo: t('conversa.desfazer'),
                aoTocar: () => {
                  void conversas.desfazer(id, desfazer.ids);
                  setDesfazer(null);
                },
              }
            : undefined
        }
      />

      <PainelDoTimer
        visivel={painel === 'timer'}
        aoFechar={fechar}
        titulo={t('timer.conversa.titulo')}
        descricao={nota ? t('timer.conversa.descricaoDaNota') : t('timer.conversa.descricao')}
        valor={timerDaConversa}
        opcoes={OPCOES_DO_TIMER}
        maximo={TIMER_MAXIMO_EM_SEGUNDOS}
        nota={nota}
        perguntarAnteriores={semTimer}
        aoEscolher={(segundos, anteriores) => {
          fechar();
          setTimerDaProxima(null);
          void conversas.mudarTimer(id, segundos, anteriores);
        }}
      />

      <PainelDoTimer
        visivel={painel === 'timerDaMensagem'}
        aoFechar={fechar}
        titulo={t('timer.mensagem.titulo')}
        descricao={t('timer.mensagem.descricao')}
        valor={timerDaMensagem ?? timerDaConversa}
        opcoes={opcoesDaMensagem(timerDaConversa)}
        maximo={maximoPersonalizado(timerDaConversa)}
        nota={nota}
        perguntarAnteriores={false}
        aoEscolher={(segundos) => {
          fechar();
          setTimerDaProxima(segundos === timerDaConversa ? null : segundos);
        }}
      />

      <Painel
        visivel={painel === 'apagar'}
        aoFechar={fechar}
        titulo={varias ? t('conversa.apagar.tituloVarias') : t('conversa.apagar.titulo')}
        descricao={
          nota
            ? varias
              ? t('conversa.apagar.descricaoDaNotaVarias')
              : t('conversa.apagar.descricaoDaNota')
            : podeEnviar
              ? varias
                ? t('conversa.apagar.descricaoVarias')
                : t('conversa.apagar.descricao')
              : varias
                ? t('conversa.apagar.descricaoSoAquiVarias')
                : t('conversa.apagar.descricaoSoAqui')
        }
      >
        {podeEnviar && !nota && (
          <Botao
            titulo={t('conversa.apagar.paraTodos')}
            variante="perigo"
            pequeno
            aoTocar={() => {
              fechar();
              sairDaSelecao();
              void conversas.apagarParaTodos(id, ids);
            }}
          />
        )}
        <Botao
          titulo={nota ? t('conversa.apagar.nota') : t('conversa.apagar.soAqui')}
          variante={nota || !podeEnviar ? 'perigo' : 'fantasma'}
          pequeno
          aoTocar={apagarSoAqui}
        />
        <Botao
          titulo={t('conversa.apagar.cancelar')}
          variante="fantasma"
          pequeno
          aoTocar={fechar}
        />
      </Painel>

      <Painel
        visivel={painel === 'anexar'}
        aoFechar={fechar}
        titulo={t('anexo.painel.titulo')}
        descricao={t('anexo.painel.descricao')}
      >
        <GrupoDeLinhas>
          <LinhaDeValor
            rotulo={t('anexo.painel.midia')}
            aoTocar={() => {
              escolher('midia');
            }}
          />
          <LinhaDeValor
            rotulo={t('anexo.painel.arquivo')}
            aoTocar={() => {
              escolher('arquivo');
            }}
          />
        </GrupoDeLinhas>
        <Text style={estilos.explicacao}>{t('anexo.painel.arquivoAviso')}</Text>
      </Painel>

      <Painel
        visivel={painel === 'documento'}
        aoFechar={fechar}
        titulo={documento?.anexo ? nomeDoDocumento(t, documento.anexo.formato) : ''}
        descricao={t('anexo.salvarDescricao')}
      >
        <Botao
          titulo={t('anexo.salvar')}
          pequeno
          aoTocar={() => {
            fechar();
            if (documento) void salvar([documento.mensagem.id]);
          }}
        />
        <Botao titulo={t('anexo.cancelar')} variante="fantasma" pequeno aoTocar={fechar} />
      </Painel>

      <Previa
        t={t}
        visivel={previa !== null}
        itens={previa?.itens ?? null}
        atual={previa?.atual ?? 0}
        aviso={previa?.aviso ?? null}
        separador={separador}
        timer={timerDoCampoProps}
        aoEscolher={(indice) => {
          setPrevia((atual) => (atual ? { ...atual, atual: indice } : atual));
        }}
        aoMudarLegenda={(legenda) => {
          setPrevia((atual) =>
            atual?.itens
              ? {
                  ...atual,
                  itens: atual.itens.map((item, i) =>
                    i === atual.atual ? { ...item, legenda } : item,
                  ),
                }
              : atual,
          );
        }}
        aoTirar={() => {
          setPrevia((atual) => {
            if (!atual?.itens) return atual;
            const itensRestantes = atual.itens.filter((_, i) => i !== atual.atual);
            if (itensRestantes.length === 0) return null;
            return {
              ...atual,
              itens: itensRestantes,
              atual: Math.min(atual.atual, itensRestantes.length - 1),
            };
          });
        }}
        aoEnviar={enviarPrevia}
        aoFechar={() => {
          setPrevia(null);
        }}
      />

      <TelaCheia
        t={t}
        midia={naTelaCheia?.midia ?? null}
        aoSalvar={() => {
          if (naTelaCheia) void salvar([naTelaCheia.mensagem]);
        }}
        aoFechar={() => {
          setNaTelaCheia(null);
        }}
      />
    </View>
  );
}

/** O que a prévia mostra de cada arquivo: a foto, ou a capa do vídeo. */
function enderecoDaPrevia(arquivo: ArquivoParaEnviar): string | null {
  if (arquivo.arquivo === 'imagem') return enderecoDeDados(arquivo.formato, arquivo.bytes);
  if (arquivo.arquivo === 'video' && arquivo.capa)
    return enderecoDeDados('image/jpeg', arquivo.capa);
  return null;
}

const useEstilos = criarEstilos((cores) => ({
  linhaDoDigitando: { flexDirection: 'row', marginTop: 6 },
  balaoDoDigitando: {
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 18,
    borderBottomLeftRadius: 6,
    backgroundColor: cores.superficie,
  },
  textoDoDigitando: { fontFamily: fontes.mono, fontSize: 12, color: cores.secundario },
  tela: { flex: 1, backgroundColor: cores.fundo },
  topo: { borderBottomWidth: 1, borderBottomColor: cores.linha, paddingBottom: 4 },
  quemTocavel: { flex: 1, minWidth: 0, borderRadius: 12 },
  quem: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 4 },
  nomes: { flex: 1, minWidth: 0, gap: 2 },
  linhaDoNome: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  nome: { flexShrink: 1, fontFamily: fontes.seminegrito, fontSize: 16, color: cores.texto },
  subtitulo: { fontFamily: fontes.mono, fontSize: 11, color: cores.secundario },
  barra: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: 8,
    minHeight: 58,
  },
  contagem: { flex: 1, paddingLeft: 6, fontFamily: fontes.mono, fontSize: 16, color: cores.texto },
  mensagens: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 14, gap: 3 },
  acoes: { gap: 10, paddingHorizontal: 20, paddingTop: 12 },
  descricaoDoPedido: { ...tipos.pequeno, color: cores.secundario, textAlign: 'center' },
  avisoCentral: { ...tipos.monoPequeno, color: cores.secundario, textAlign: 'center' },
  resposta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 14,
    paddingRight: 6,
    paddingTop: 6,
  },
  citacaoDaResposta: { flex: 1 },
  explicacao: {
    paddingHorizontal: 4,
    fontFamily: fontes.regular,
    fontSize: 12.5,
    lineHeight: 17.5,
    color: cores.secundario,
  },
}));
