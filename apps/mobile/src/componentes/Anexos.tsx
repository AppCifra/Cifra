// Os anexos na conversa (components/media e TransferButton do design, recriados em React Native):
// a foto (miniatura desfocada até baixar, moldura de 4 px, meta embaixo, nunca por cima), o vídeo
// (a capa, o tocar e a duração), o arquivo (a extensão, "documento.<ext>", o tamanho e o SHA-256
// curto), o botão de transferência com o progresso e o cancelar, e a citação de uma resposta. Num
// pedido de conversa, nada baixa nem aparece: nem a miniatura.
import type { ResumoDoAnexo } from '@cifra/core';
import { useMemo, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { enderecoDeDados } from '../adaptadores/formato.ts';
import {
  duracaoLegivel,
  extensaoDoFormato,
  proporcaoDoBalao,
  sha256Curto,
  tamanhoLegivel,
} from '../formato-do-anexo.ts';
import type { Traduzir } from '../i18n.ts';
import { criarEstilos, fontes, useCores, type Cores } from '../tema.ts';
import { Icone } from './Icone.tsx';
import { Aro } from './Timer.tsx';

/** A largura da área da foto e do vídeo no balão, como no design. */
export const LARGURA_DA_MIDIA = 240;

/** O texto e o fundo sobre o balão: na sua mensagem, a tinta escura sobre o fósforo. */
function coresDoBalao(cores: Cores, deMim: boolean) {
  return deMim
    ? { texto: cores.sobreAcento, fundo: 'rgba(11,12,11,0.12)', tile: 'rgba(11,12,11,0.1)' }
    : { texto: cores.texto, fundo: cores.fundo, tile: cores.superficie2 };
}

/** O botão de baixar (seta) ou de cancelar (x), com o aro do progresso. */
export function BotaoDeTransferencia({
  ocupado,
  progresso,
  tamanho = 44,
  sobreAcento,
  rotulo,
  aoTocar,
}: {
  readonly ocupado: boolean;
  readonly progresso: number;
  readonly tamanho?: number;
  readonly sobreAcento: boolean;
  readonly rotulo: string;
  readonly aoTocar: () => void;
}) {
  const cores = useCores();
  const estilos = useEstilos();
  const { texto, fundo } = coresDoBalao(cores, sobreAcento);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={rotulo}
      hitSlop={tamanho < 44 ? (44 - tamanho) / 2 : 0}
      onPress={aoTocar}
      style={[
        estilos.transferencia,
        { width: tamanho, height: tamanho, borderRadius: tamanho / 2, backgroundColor: fundo },
      ]}
    >
      {ocupado && (
        <View style={estilos.aro}>
          <Aro fracao={progresso} cor={texto} lado={tamanho - 2} traco={2} apagado={0.2} />
        </View>
      )}
      <Icone
        nome={ocupado ? 'fechar' : 'baixar'}
        tamanho={Math.round(tamanho * 0.42)}
        traco={2}
        cor={texto}
      />
    </Pressable>
  );
}

export type SituacaoDoAnexo = 'pronto' | 'parado' | 'baixando' | 'subindo' | 'sem' | 'pedido';

/** Em que pé o anexo está, para o balão. */
export function situacaoDo(anexo: ResumoDoAnexo, deMim: boolean, pedido: boolean): SituacaoDoAnexo {
  if (pedido) return 'pedido';
  switch (anexo.estado) {
    case 'enviar':
      return deMim ? 'subindo' : 'parado';
    case 'baixar':
      return 'baixando';
    case 'manual':
      return 'parado';
    case 'indisponivel':
    case 'invalido':
      return 'sem';
    default:
      return 'pronto';
  }
}

interface PropsDoAnexo {
  readonly t: Traduzir;
  readonly anexo: ResumoDoAnexo;
  readonly deMim: boolean;
  readonly pedido: boolean;
  /** A foto aberta, ou a capa do vídeo, quando já está aqui (data:). */
  readonly endereco: string | null;
  readonly progresso: number | null;
  readonly separador: string;
  readonly aoBaixar: () => void;
  readonly aoCancelar: () => void;
  readonly aoAbrir: () => void;
}

/** A foto ou o vídeo: a área da imagem, com o que cabe nela agora. */
export function MidiaDoBalao({
  t,
  anexo,
  deMim,
  pedido,
  endereco,
  progresso,
  separador,
  aoBaixar,
  aoCancelar,
  aoAbrir,
}: PropsDoAnexo) {
  const cores = useCores();
  const estilos = useEstilos();
  const situacao = situacaoDo(anexo, deMim, pedido);
  const miniatura = useMemo(
    () =>
      anexo.miniatura.length > 0 && !pedido ? enderecoDeDados('image/jpeg', anexo.miniatura) : null,
    [anexo.miniatura, pedido],
  );
  const altura = Math.round(LARGURA_DA_MIDIA / proporcaoDoBalao(anexo.largura, anexo.altura));
  const tamanho = tamanhoLegivel(anexo.tamanho, separador);
  const ocupado = situacao === 'baixando' || situacao === 'subindo';
  const video = anexo.arquivo === 'video';

  let sobre: ReactNode = null;
  if (situacao === 'parado') {
    sobre = (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('anexo.baixar')}, ${tamanho}`}
        onPress={aoBaixar}
        style={estilos.pilulaDeBaixar}
      >
        <Icone nome="baixar" tamanho={16} traco={2} cor={cores.texto} />
        <Text style={estilos.textoDaPilula}>{tamanho}</Text>
      </Pressable>
    );
  } else if (ocupado) {
    sobre = (
      <BotaoDeTransferencia
        ocupado
        progresso={progresso ?? 0}
        sobreAcento={false}
        rotulo={t('anexo.cancelar')}
        aoTocar={aoCancelar}
      />
    );
  } else if (situacao === 'pronto' && video) {
    sobre = (
      <View style={estilos.tocar}>
        <Icone nome="tocar" tamanho={20} cor={cores.texto} />
      </View>
    );
  } else if (situacao === 'sem' || situacao === 'pedido') {
    sobre = (
      <View style={estilos.semAnexo}>
        <Icone nome={video ? 'tocar' : 'imagem'} tamanho={28} traco={1.6} cor={cores.secundario} />
        <Text style={estilos.textoSemAnexo}>
          {situacao === 'pedido'
            ? t('anexo.pedido')
            : anexo.estado === 'invalido'
              ? t('anexo.invalido')
              : t('anexo.indisponivel')}
        </Text>
      </View>
    );
  }

  const imagem = situacao === 'pronto' && endereco ? endereco : miniatura;
  return (
    <Pressable
      accessibilityRole={situacao === 'pronto' ? 'button' : undefined}
      accessibilityLabel={
        situacao === 'pronto' ? (video ? t('anexo.tocarVideo') : t('anexo.abrirFoto')) : undefined
      }
      disabled={situacao !== 'pronto'}
      onPress={aoAbrir}
      style={[estilos.areaDaMidia, { height: altura }]}
    >
      {imagem && (
        <Image
          source={{ uri: imagem }}
          blurRadius={imagem === miniatura ? 12 : 0}
          resizeMode="cover"
          style={StyleSheet.absoluteFill}
        />
      )}
      {sobre}
    </Pressable>
  );
}

/** A linha do meio do balão de foto e vídeo: o progresso, ou a duração do vídeo. */
export function inicioDoRodape(
  t: Traduzir,
  anexo: ResumoDoAnexo,
  situacao: SituacaoDoAnexo,
  progresso: number | null,
  separador: string,
): string | null {
  if (situacao === 'baixando' || situacao === 'subindo') {
    return t('anexo.progresso', {
      porcento: String(Math.round((progresso ?? 0) * 100)),
      tamanho: tamanhoLegivel(anexo.tamanho, separador),
    });
  }
  return anexo.arquivo === 'video' ? duracaoLegivel(anexo.duracao) : null;
}

/** O nome que o documento mostra: "documento.pdf", sem o nome original. */
export function nomeDoDocumento(t: Traduzir, formato: string): string {
  const ext = extensaoDoFormato(formato);
  return ext ? t('anexo.documento', { ext }) : t('anexo.documentoSemExtensao');
}

/** O arquivo: o quadrado com a extensão, o nome, o tamanho e o SHA-256 curto, ou o progresso. */
export function ArquivoDoBalao({
  t,
  anexo,
  deMim,
  pedido,
  progresso,
  separador,
  aoBaixar,
  aoCancelar,
  aoAbrir,
}: Omit<PropsDoAnexo, 'endereco'>) {
  const cores = useCores();
  const estilos = useEstilos();
  const situacao = situacaoDo(anexo, deMim, pedido);
  const { texto, tile } = coresDoBalao(cores, deMim);
  const ext = extensaoDoFormato(anexo.formato);
  const ocupado = situacao === 'baixando' || situacao === 'subindo';
  const tamanho = tamanhoLegivel(anexo.tamanho, separador);
  const detalhe = ocupado
    ? t('anexo.progresso', { porcento: String(Math.round((progresso ?? 0) * 100)), tamanho })
    : situacao === 'sem'
      ? anexo.estado === 'invalido'
        ? t('anexo.invalido')
        : t('anexo.indisponivel')
      : situacao === 'pedido'
        ? t('anexo.pedido')
        : [tamanho, anexo.sha256 && t('anexo.sha256', { hash: sha256Curto(anexo.sha256) })]
            .filter(Boolean)
            .join(' · ');
  return (
    <Pressable
      disabled={situacao !== 'pronto'}
      onPress={aoAbrir}
      accessibilityRole={situacao === 'pronto' ? 'button' : undefined}
      style={estilos.arquivo}
    >
      <View style={[estilos.tile, { backgroundColor: tile }]}>
        {ext ? (
          <Text style={[estilos.textoDoTile, { color: texto }]}>
            {ext.slice(0, 4).toUpperCase()}
          </Text>
        ) : (
          <Icone nome="arquivo" tamanho={20} cor={texto} />
        )}
      </View>
      <View style={estilos.textosDoArquivo}>
        <Text numberOfLines={1} style={[estilos.nomeDoArquivo, { color: texto }]}>
          {nomeDoDocumento(t, anexo.formato)}
        </Text>
        <Text numberOfLines={1} style={[estilos.detalheDoArquivo, { color: texto }]}>
          {detalhe}
        </Text>
      </View>
      {(situacao === 'parado' || ocupado) && (
        <BotaoDeTransferencia
          ocupado={ocupado}
          progresso={progresso ?? 0}
          tamanho={36}
          sobreAcento={deMim}
          rotulo={ocupado ? t('anexo.cancelar') : t('anexo.baixar')}
          aoTocar={ocupado ? aoCancelar : aoBaixar}
        />
      )}
    </Pressable>
  );
}

/** A mensagem que uma resposta cita: quem escreveu e uma linha dela, ou "mensagem apagada". */
export function Citacao({
  nome,
  texto,
  deMim,
  apagada,
  sobreAcento,
}: {
  readonly nome: string;
  readonly texto: string;
  readonly deMim: boolean;
  readonly apagada: boolean;
  readonly sobreAcento: boolean;
}) {
  const cores = useCores();
  const estilos = useEstilos();
  const { texto: cor, tile } = coresDoBalao(cores, sobreAcento);
  return (
    <View style={[estilos.citacao, { backgroundColor: tile }]}>
      <View
        style={[
          estilos.barraDaCitacao,
          {
            backgroundColor: sobreAcento
              ? cores.sobreAcento
              : deMim
                ? cores.acento
                : cores.secundario,
          },
        ]}
      />
      <View style={estilos.textosDaCitacao}>
        <Text numberOfLines={1} style={[estilos.nomeDaCitacao, { color: cor }]}>
          {nome}
        </Text>
        <Text
          numberOfLines={2}
          style={[estilos.textoDaCitacao, { color: cor }, apagada && estilos.apagada]}
        >
          {texto}
        </Text>
      </View>
    </View>
  );
}

/** O interruptor do design (Switch): fósforo quando ligado. */
export function Interruptor({ ligado }: { readonly ligado: boolean }) {
  const cores = useCores();
  const estilos = useEstilos();
  return (
    <View style={[estilos.trilho, { backgroundColor: ligado ? cores.acento : cores.linha }]}>
      <View
        style={[
          estilos.botao,
          { backgroundColor: ligado ? cores.sobreAcento : cores.fundo },
          ligado && estilos.botaoLigado,
        ]}
      />
    </View>
  );
}

const useEstilos = criarEstilos((cores) => ({
  transferencia: { alignItems: 'center', justifyContent: 'center' },
  aro: { position: 'absolute', top: 1, left: 1 },
  areaDaMidia: {
    width: LARGURA_DA_MIDIA,
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cores.superficie2,
  },
  pilulaDeBaixar: {
    height: 36,
    paddingLeft: 11,
    paddingRight: 14,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: cores.fundo,
  },
  textoDaPilula: { fontFamily: fontes.mono, fontSize: 12, color: cores.texto },
  tocar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11,12,11,0.55)',
  },
  semAnexo: { alignItems: 'center', gap: 8, paddingHorizontal: 16 },
  textoSemAnexo: {
    fontFamily: fontes.mono,
    fontSize: 11,
    color: cores.secundario,
    textAlign: 'center',
  },
  arquivo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tile: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  textoDoTile: { fontFamily: fontes.mono, fontSize: 11, letterSpacing: 0.44 },
  textosDoArquivo: { flex: 1, minWidth: 0, gap: 2 },
  nomeDoArquivo: { fontFamily: fontes.media, fontSize: 14.5 },
  detalheDoArquivo: { fontFamily: fontes.mono, fontSize: 11, opacity: 0.62 },
  citacao: { flexDirection: 'row', borderRadius: 12, overflow: 'hidden', marginBottom: 4 },
  barraDaCitacao: { width: 3 },
  textosDaCitacao: { flex: 1, paddingVertical: 6, paddingHorizontal: 9, gap: 1 },
  nomeDaCitacao: { fontFamily: fontes.mono, fontSize: 11, opacity: 0.75 },
  textoDaCitacao: { fontFamily: fontes.regular, fontSize: 13.5, lineHeight: 18 },
  apagada: { fontFamily: fontes.mono, fontSize: 11.5, opacity: 0.7 },
  trilho: { width: 46, height: 28, borderRadius: 14, justifyContent: 'center' },
  botao: { position: 'absolute', top: 3, left: 3, width: 22, height: 22, borderRadius: 11 },
  botaoLigado: { transform: [{ translateX: 18 }] },
}));
