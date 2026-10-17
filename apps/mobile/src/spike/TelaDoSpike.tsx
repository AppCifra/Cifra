// Verificação técnica do spike: roda as verificações no aparelho e mostra o resultado. Só abre no
// build de desenvolvimento, com EXPO_PUBLIC_CIFRA_VERIFICACAO=1 (App.tsx).
import type { criarI18n } from '@cifra/i18n';
import { useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  criarCofreDeChaves,
  estadoDaChave,
  nivelDoKeystore,
} from '../adaptadores/cofre-de-chaves.ts';
import { cripto } from '../adaptadores/cripto.ts';
import { definirTelaSegura, telaEstaSegura } from '../adaptadores/tela.ts';
import {
  verificarBancoCifrado,
  verificarConversa,
  verificarExclusaoReal,
  verificarLibsodium,
  verificarLimpezaDeFoto,
  verificarOcultas,
  verificarPrivacidade,
  verificarProtocoloNoAparelho,
  verificarRelay,
  verificarTor,
  verificarTorIndisponivel,
  type Linha,
} from './verificacoes.ts';

type T = ReturnType<typeof criarI18n>['t'];
type Secao =
  | 'cripto'
  | 'protocolo'
  | 'banco'
  | 'exclusao'
  | 'anexos'
  | 'privacidade'
  | 'ocultas'
  | 'cofre'
  | 'tela'
  | 'tor'
  | 'relay';

const COR = {
  fundo: '#0B0C0B',
  superficie: '#151715',
  linha: '#262A26',
  texto: '#E9EBE4',
  secundario: '#8D9289',
  perigo: '#FF5A43',
  acento: '#C6F432',
  sobreAcento: '#0B0C0B',
} as const;

/** Mensagem do erro e, se houver, da causa (o módulo nativo põe ali só o nome da exceção). */
function descrever(erro: unknown): string {
  if (!(erro instanceof Error)) return 'erro';
  return erro.cause instanceof Error ? `${erro.message} (${erro.cause.message})` : erro.message;
}

function falha(nome: string, erro: unknown): Linha {
  return { nome, ok: false, erro: descrever(erro) };
}

export function TelaDoSpike({ t }: { t: T }) {
  const [resultados, setResultados] = useState<Partial<Record<Secao, readonly Linha[]>>>({});
  const [rodando, setRodando] = useState<Secao | null>(null);
  const [endereco, setEndereco] = useState('');
  const [relay, setRelay] = useState('');
  const [painel, setPainel] = useState(false);
  const chaveGuardada = useRef<Uint8Array | null>(null);

  const cofre = criarCofreDeChaves({
    exigirHardware: false,
    textos: () => ({ titulo: t('spike.pedido.titulo'), cancelar: t('spike.pedido.cancelar') }),
  });

  async function rodar(secao: Secao, operacao: () => Promise<readonly Linha[]>, acumular = false) {
    setRodando(secao);
    let novas: readonly Linha[];
    try {
      novas = await operacao();
    } catch (erro) {
      novas = [falha(secao, erro)];
    }
    setResultados((atual) => ({
      ...atual,
      [secao]: acumular ? [...(atual[secao] ?? []), ...novas] : novas,
    }));
    setRodando(null);
  }

  // O teste usa o lugar da chave mestra do app. Com uma identidade no aparelho, gravar ou destruir
  // aqui perderia os dados dela: a seção recusa, e o teste roda numa instalação limpa.
  const semIdentidade = async (): Promise<Linha[] | null> =>
    chaveGuardada.current === null && (await estadoDaChave('chave-mestra')) !== 'ausente'
      ? [falha('cofre.ha-uma-identidade', new Error('chave mestra do app no aparelho'))]
      : null;

  const guardar = (protecao: 'desbloqueio' | 'aparelho') =>
    rodar(
      'cofre',
      async () => {
        const recusa = await semIdentidade();
        if (recusa) return recusa;
        const segredo = cripto.randombytes_buf(32);
        await cofre.guardar('chave-mestra', segredo, protecao);
        chaveGuardada.current = segredo;
        const estado = await estadoDaChave('chave-mestra');
        return [
          { nome: `cofre.guardar-${protecao}`, ok: true, erro: '' },
          { nome: `cofre.nivel-${String(await nivelDoKeystore())}`, ok: true, erro: '' },
          { nome: `cofre.estado-${estado}`, ok: estado === 'valida', erro: '' },
        ];
      },
      true,
    );

  const ler = () =>
    rodar(
      'cofre',
      async () => {
        try {
          const lido = await cofre.ler('chave-mestra');
          const esperado = chaveGuardada.current;
          const igual =
            lido !== null &&
            esperado !== null &&
            lido.length === esperado.length &&
            lido.every((b, i) => b === esperado[i]);
          return [
            {
              nome: lido === null ? 'cofre.ler-vazio' : 'cofre.ler-igual',
              ok: igual || (lido === null && esperado === null),
              erro: '',
            },
          ];
        } catch (erro) {
          return [falha('cofre.ler-recusado', erro)];
        }
      },
      true,
    );

  const destruir = () =>
    rodar(
      'cofre',
      async () => {
        const recusa = await semIdentidade();
        if (recusa) return recusa;
        await cofre.destruir('chave-mestra');
        chaveGuardada.current = null;
        const estado = await estadoDaChave('chave-mestra');
        return [
          { nome: 'cofre.destruir', ok: (await cofre.ler('chave-mestra')) === null, erro: '' },
          { nome: `cofre.estado-${estado}`, ok: estado === 'ausente', erro: '' },
        ];
      },
      true,
    );

  const conferirTela = (rotulo: string) =>
    rodar(
      'tela',
      async () => [
        { nome: `tela.${rotulo}-secure-${String(await telaEstaSegura())}`, ok: true, erro: '' },
      ],
      true,
    );

  const botao = (rotulo: string, acao: () => unknown, destaque = false) => (
    <Pressable
      key={rotulo}
      accessibilityRole="button"
      disabled={rodando !== null}
      onPress={() => void acao()}
      style={({ pressed }) => [
        estilos.botao,
        destaque && estilos.botaoDestaque,
        pressed && estilos.pressionado,
      ]}
    >
      <Text style={[estilos.botaoTexto, destaque && estilos.botaoTextoDestaque]}>{rotulo}</Text>
    </Pressable>
  );

  const secao = (id: Secao, botoes: ReactNode) => (
    <View style={estilos.cartao} key={id}>
      <Text style={estilos.rotulo}>{t(`spike.secoes.${id}`)}</Text>
      <View style={estilos.botoes}>{botoes}</View>
      {rodando === id && <Text style={estilos.meta}>{t('spike.estado.rodando')}</Text>}
      {(resultados[id] ?? []).map((linha, i) => (
        <Text key={`${linha.nome}-${i}`} style={[estilos.meta, !linha.ok && estilos.falha]}>
          {linha.nome} · {linha.ok ? t('spike.estado.ok') : t('spike.estado.falhou')}
          {linha.ms !== undefined ? ` · ${t('spike.tempo', { ms: linha.ms })}` : ''}
          {linha.erro ? ` · ${linha.erro}` : ''}
        </Text>
      ))}
    </View>
  );

  return (
    <ScrollView style={estilos.tela} contentContainerStyle={estilos.conteudo}>
      <Text style={estilos.titulo}>{t('spike.titulo')}</Text>
      <Text style={estilos.descricao}>{t('spike.descricao')}</Text>

      {secao(
        'cripto',
        botao(t('spike.acoes.rodar'), () => rodar('cripto', verificarLibsodium), true),
      )}
      {secao(
        'protocolo',
        botao(t('spike.acoes.rodar'), () => rodar('protocolo', verificarProtocoloNoAparelho), true),
      )}
      {secao(
        'banco',
        botao(t('spike.acoes.rodar'), () => rodar('banco', verificarBancoCifrado), true),
      )}
      {secao(
        'exclusao',
        botao(t('spike.acoes.rodar'), () => rodar('exclusao', verificarExclusaoReal), true),
      )}
      {secao(
        'anexos',
        botao(t('spike.acoes.rodar'), () => rodar('anexos', verificarLimpezaDeFoto), true),
      )}
      {secao(
        'privacidade',
        botao(t('spike.acoes.rodar'), () => rodar('privacidade', verificarPrivacidade), true),
      )}
      {secao(
        'ocultas',
        botao(t('spike.acoes.rodar'), () => rodar('ocultas', verificarOcultas), true),
      )}
      {secao('cofre', [
        botao(t('spike.acoes.guardar'), () => guardar('desbloqueio'), true),
        botao(t('spike.acoes.guardarSemAutenticacao'), () => guardar('aparelho')),
        botao(t('spike.acoes.ler'), ler),
        botao(t('spike.acoes.destruir'), destruir),
      ])}
      {secao('tela', [
        botao(t('spike.acoes.rodar'), () => conferirTela('agora'), true),
        botao(t('spike.acoes.permitirPrint'), async () => {
          await definirTelaSegura(false);
          await conferirTela('depois-de-permitir');
        }),
        botao(t('spike.acoes.bloquearPrint'), async () => {
          await definirTelaSegura(true);
          await conferirTela('depois-de-bloquear');
        }),
        botao(t('spike.acoes.abrirPainel'), () => {
          setPainel(true);
        }),
      ])}
      {secao('tor', [
        <TextInput
          key="endereco"
          value={endereco}
          onChangeText={setEndereco}
          placeholder={t('spike.enderecoOnion')}
          placeholderTextColor={COR.secundario}
          autoCapitalize="none"
          autoCorrect={false}
          style={estilos.campo}
        />,
        botao(
          t('spike.acoes.conectar'),
          () => rodar('tor', () => verificarTor(endereco.trim()), true),
          true,
        ),
        botao(t('spike.acoes.rodar'), () =>
          rodar('tor', () => verificarTorIndisponivel(endereco.trim()), true),
        ),
      ])}

      {secao('relay', [
        <TextInput
          key="relay"
          value={relay}
          onChangeText={setRelay}
          placeholder={t('spike.enderecoRelay')}
          placeholderTextColor={COR.secundario}
          autoCapitalize="none"
          autoCorrect={false}
          style={estilos.campo}
        />,
        botao(
          t('spike.acoes.rodar'),
          () => rodar('relay', () => verificarRelay(relay.trim()), true),
          true,
        ),
        botao(t('spike.acoes.conversa'), () =>
          rodar('relay', () => verificarConversa(relay.trim()), true),
        ),
      ])}

      <Modal
        visible={painel}
        transparent
        animationType="none"
        onRequestClose={() => {
          setPainel(false);
        }}
      >
        <View style={estilos.fundoDoPainel}>
          <View style={estilos.painel}>
            <Text style={estilos.descricao}>{t('spike.painel')}</Text>
            {botao(
              t('spike.acoes.fecharPainel'),
              () => {
                setPainel(false);
              },
              true,
            )}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: COR.fundo },
  conteudo: { paddingHorizontal: 20, paddingVertical: 48, gap: 16 },
  titulo: { color: COR.texto, fontSize: 28, fontWeight: '500', letterSpacing: -0.8 },
  descricao: { color: COR.secundario, fontSize: 15, lineHeight: 21 },
  cartao: { backgroundColor: COR.superficie, borderRadius: 22, padding: 16, gap: 10 },
  rotulo: {
    color: COR.secundario,
    fontFamily: 'monospace',
    fontSize: 12,
    textTransform: 'uppercase',
  },
  botoes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  botao: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COR.linha,
  },
  botaoDestaque: { backgroundColor: COR.acento, borderColor: COR.acento },
  pressionado: { transform: [{ scale: 0.98 }] },
  botaoTexto: { color: COR.texto, fontSize: 15, fontWeight: '500' },
  botaoTextoDestaque: { color: COR.sobreAcento },
  meta: { color: COR.texto, fontFamily: 'monospace', fontSize: 12 },
  falha: { color: COR.perigo },
  campo: {
    flexBasis: '100%',
    minHeight: 44,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: COR.linha,
    color: COR.texto,
    fontFamily: 'monospace',
    paddingHorizontal: 12,
  },
  fundoDoPainel: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  painel: { backgroundColor: COR.superficie, borderRadius: 34, padding: 24, gap: 16 },
});
