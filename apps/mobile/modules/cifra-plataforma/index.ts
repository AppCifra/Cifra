// Ponte JS dos módulos nativos do Cifra (Android). Só tipos e a busca do módulo: a lógica fica nos
// adaptadores em src/adaptadores/.
import { NativeModule, requireNativeModule, requireNativeView } from 'expo';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

type EventosDoTransporte = {
  /** Mensagem binária recebida, em base64 (o evento atravessa a ponte como texto). */
  mensagem: (evento: { id: number; dados: string }) => void;
  /** A conexão caiu sem o app pedir: o relay fechou ou a rede caiu. A que o app fecha não avisa. */
  fechou: (evento: { id: number }) => void;
  /** Quanto do pedido HTTP já foi ou veio, de 0 a 1. */
  progresso: (evento: { numero: number; fracao: number }) => void;
};

declare class CifraTransporte extends NativeModule<EventosDoTransporte> {
  /**
   * `portaSocks` nula: conexão direta, e `credencial` também nula. Com Tor, a credencial vai como
   * usuário e senha do SOCKS: conexões com credencial diferente saem por circuitos diferentes.
   * Rejeita com `tor-indisponivel` ou `relay-inacessivel`.
   */
  conectar(endereco: string, portaSocks: number | null, credencial: string | null): Promise<number>;
  /** Lança `conexao-fechada` se a conexão já caiu. */
  enviar(id: number, dados: Uint8Array): void;
  fechar(id: number): Promise<void>;
  /**
   * Um pedido HTTP (os anexos), com as mesmas regras de `conectar`. `numero` identifica o pedido
   * no progresso e no cancelamento. Rejeita com `tor-indisponivel`, `relay-inacessivel` ou
   * `cancelado`.
   */
  http(
    numero: number,
    metodo: string,
    endereco: string,
    portaSocks: number | null,
    credencial: string | null,
    corpo: Uint8Array | null,
    limite: number,
  ): Promise<{ status: number; corpo: Uint8Array }>;
  cancelarHttp(numero: number): void;
}

declare class CifraTelaSegura extends NativeModule {
  definir(segura: boolean): Promise<void>;
  estaSegura(): Promise<boolean>;
  /** No tema claro, os ícones da barra de navegação ficam escuros. */
  definirNavegacaoClara(clara: boolean): Promise<void>;
}

/** `ausente`: o aparelho apagou a chave. `invalidada`: ela existe, mas nunca mais abre. */
export type EstadoDaChave = 'valida' | 'ausente' | 'invalidada';

declare class CifraCofre extends NativeModule {
  /** Estado da chave do Keystore com este nome, sem pedir biometria. */
  estadoDaChave(nome: string): Promise<EstadoDaChave>;
  /** Zera o arquivo no lugar (0 byte, o mesmo arquivo), se ele existir. */
  truncar(caminho: string): Promise<void>;
  /** A data de agora nos arquivos que existem. */
  tocar(caminhos: string[]): Promise<void>;
  /**
   * Pânico: apaga os arquivos que existem e tudo o que estiver no cache do app (o MP4 temporário da
   * limpeza do vídeo e o que as bibliotecas guardem ali).
   */
  apagar(caminhos: string[]): Promise<void>;
}

/** Uma foto limpa: recodificada, de pé, sem metadados. */
export interface ImagemPreparada {
  bytes: Uint8Array;
  formato: string;
  largura: number;
  altura: number;
  miniatura: Uint8Array;
}

/** Um vídeo sem metadados, com a capa e a miniatura. */
export interface VideoPreparado extends ImagemPreparada {
  duracao: number;
  capa: Uint8Array;
}

/**
 * Os erros vêm como código: `nao-abre` (formato que o celular não lê), `grande` (passa do limite)
 * e `nao-salvou`.
 */
declare class CifraAnexos extends NativeModule {
  /** O seletor do sistema: `midia` (fotos e vídeos) ou `arquivo`. Vazio se a pessoa cancelou. */
  escolher(
    tipo: 'midia' | 'arquivo',
    limite: number,
  ): Promise<{ endereco: string; formato: string }[]>;
  prepararImagem(endereco: string): Promise<ImagemPreparada>;
  prepararImagemDosBytes(bytes: Uint8Array): Promise<ImagemPreparada>;
  prepararVideo(endereco: string, maximo: number): Promise<VideoPreparado>;
  lerDocumento(endereco: string, maximo: number): Promise<{ bytes: Uint8Array; formato: string }>;
  salvarNoCelular(bytes: Uint8Array, formato: string, arquivo: string): Promise<void>;
  /** O "salvar como" do sistema, com o nome sugerido: o backup. `false` se a pessoa cancelou. */
  salvarArquivo(bytes: Uint8Array, nome: string): Promise<boolean>;
  esquecerImagens(): void;
  jpegDeTeste(): Promise<Uint8Array>;
}

declare class CifraVideo extends NativeModule {
  /** Guarda os bytes do vídeo na memória nativa e devolve o número que a tela usa para tocar. */
  carregar(bytes: Uint8Array): number;
  /** Zera e esquece os bytes. */
  soltar(numero: number): void;
}

declare class CifraAreaDeTransferencia extends NativeModule {
  /** Copia marcado como sensível; sai da área de transferência depois de `segundos`. */
  copiar(texto: string, segundos: number): Promise<void>;
  /** Pânico: tira na hora o que o Cifra copiou, se ainda for o texto dele. */
  esquecer(): Promise<void>;
}

type EventosDoRelogio = {
  /** O prazo do bloqueio sozinho venceu: com o app na frente ou não. */
  bloquear: () => void;
};

declare class CifraRelogio extends NativeModule<EventosDoRelogio> {
  /** Milissegundos desde que o aparelho ligou, contando o tempo dormindo. */
  decorrido(): number;
  /** Resolve com `true` depois de `ms`, mesmo com o app fora da frente; com `false` se cancelado. */
  esperar(numero: number, ms: number): Promise<boolean>;
  cancelar(numero: number): void;
  /** Arma o bloqueio sozinho para daqui a `ms`; `cor` é a do fundo, para a capa. */
  armarBloqueio(ms: number, cor: string): void;
  desarmarBloqueio(): void;
  /** Tira a capa que cobriu a janela ao voltar depois do prazo. */
  descobrir(): Promise<void>;
}

/** Os textos do serviço de notificação; vêm da tradução, nunca fixos no nativo. */
export interface TextosDosAvisos {
  canalDeMensagens: string;
  canalDoServico: string;
  servico: string;
  novaMensagem: string;
}

declare class CifraAvisos extends NativeModule {
  /** Liga o serviço em primeiro plano, com o aviso fixo. Só funciona com o app na frente. */
  ligar(textos: TextosDosAvisos): Promise<void>;
  desligar(): Promise<void>;
  /** "Nova mensagem", sem remetente nem conteúdo. */
  avisar(textos: TextosDosAvisos): Promise<void>;
  /** Tira o aviso de mensagem nova, se houver. */
  limpar(): Promise<void>;
  /** Se o Android deixa o app mostrar notificações. */
  permitidas(): Promise<boolean>;
}

declare class CifraTeclado extends NativeModule {
  /**
   * O campo com o foco agora: `sem-campo`, `sem-aprender` (o teclado foi avisado para não
   * aprender) ou `aprende`. Só a verificação técnica usa.
   */
  campoEmFoco(): Promise<'sem-campo' | 'sem-aprender' | 'aprende'>;
}

export interface PropsDoVideoNativo extends ViewProps {
  /** O número que `carregar` devolveu. */
  fonte: number;
  tocando: boolean;
  onPronto?: (evento: { nativeEvent: { duracao: number } }) => void;
  onFim?: () => void;
}

export const transporteNativo = requireNativeModule<CifraTransporte>('CifraTransporte');
export const telaSeguraNativa = requireNativeModule<CifraTelaSegura>('CifraTelaSegura');
export const cofreNativo = requireNativeModule<CifraCofre>('CifraCofre');
export const anexosNativos = requireNativeModule<CifraAnexos>('CifraAnexos');
export const videoNativo = requireNativeModule<CifraVideo>('CifraVideo');
export const areaDeTransferenciaNativa = requireNativeModule<CifraAreaDeTransferencia>(
  'CifraAreaDeTransferencia',
);
export const relogioNativo = requireNativeModule<CifraRelogio>('CifraRelogio');
export const avisosNativos = requireNativeModule<CifraAvisos>('CifraAvisos');
export const tecladoNativo = requireNativeModule<CifraTeclado>('CifraTeclado');
export const VideoNativo: ComponentType<PropsDoVideoNativo> = requireNativeView('CifraVideo');
