// Adaptador da porta CofreDeChaves no Android: react-native-keychain sobre o Keystore.
// `desbloqueio`: AES-GCM no Keystore, liberado por biometria forte ou pela senha do aparelho (RF-40).
// `aparelho`: AES-GCM no Keystore sem autenticação, para o que precisa funcionar com o app bloqueado.
//
// Antes de ler, o módulo próprio confere no Keystore se a chave que protege o segredo ainda vale,
// sem pedir nada: quando o bloqueio de tela sai, o Android apaga ou invalida essa chave, e a
// biblioteca só descobriria depois de pedir a biometria (RNF-07).
//
// Limite: a biblioteca só aceita texto, então o segredo atravessa o JS em base64 e não dá para
// zerar essa cópia; ela some quando o coletor de lixo do Hermes passar (docs/SPIKE.md).
import { ErroDoCofre, type CofreDeChaves, type NomeDoSegredo, type Protecao } from '@cifra/core';
import * as Keychain from 'react-native-keychain';
import { cofreNativo, type EstadoDaChave } from '../../modules/cifra-plataforma/index.ts';
import { deBase64, paraBase64, pedidoCancelado } from './formato.ts';

const NOMES: readonly NomeDoSegredo[] = ['chave-mestra', 'chave-da-caixa', 'preferencias'];
const USUARIO = 'cifra';

/** Textos do pedido de biometria; vêm da tradução, nunca fixos aqui. */
export interface TextosDoPedido {
  readonly titulo: string;
  readonly cancelar: string;
}

/** Guardar e ler podem pedir biometria ou senha; cada um tem o próprio título. */
export type OperacaoDoCofre = 'guardar' | 'ler';

export interface OpcoesDoCofre {
  readonly textos: (operacao: OperacaoDoCofre) => TextosDoPedido;
  /**
   * Exige chave em hardware (TEE ou StrongBox). Emuladores não têm: lá o spike roda com `false`.
   * A regra para aparelhos reais é decisão pendente (docs/SPIKE.md).
   */
  readonly exigirHardware: boolean;
}

/** O serviço na biblioteca, que também é o nome da chave no Keystore. */
const servico = (nome: NomeDoSegredo) => `org.cifra.app.${nome}`;

/** O estado da chave do Keystore que protege o segredo, sem pedir biometria. */
export const estadoDaChave = (nome: NomeDoSegredo): Promise<EstadoDaChave> =>
  cofreNativo.estadoDaChave(servico(nome));

export function criarCofreDeChaves({ textos, exigirHardware }: OpcoesDoCofre): CofreDeChaves {
  const cofre: CofreDeChaves = {
    async guardar(nome: NomeDoSegredo, segredo: Uint8Array, protecao: Protecao) {
      const comDesbloqueio = protecao === 'desbloqueio';
      const { titulo, cancelar } = textos('guardar');
      await Keychain.setGenericPassword(USUARIO, paraBase64(segredo), {
        service: servico(nome),
        storage: comDesbloqueio
          ? Keychain.STORAGE_TYPE.AES_GCM
          : Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
        ...(comDesbloqueio
          ? {
              accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
              authenticationPrompt: { title: titulo, cancel: cancelar },
            }
          : {}),
        ...(exigirHardware ? { securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE } : {}),
      });
    },

    async ler(nome) {
      const service = servico(nome);
      if (!(await Keychain.hasGenericPassword({ service }))) return null;
      if ((await estadoDaChave(nome)) !== 'valida') throw new ErroDoCofre('perdido');
      const { titulo, cancelar } = textos('ler');
      let lido: false | Keychain.UserCredentials;
      try {
        lido = await Keychain.getGenericPassword({
          service,
          // A biblioteca monta o pedido da leitura por esta opção: sem ela, só aceita a digital e
          // esconde a senha do aparelho (RF-40). Segredos sem autenticação não abrem pedido nenhum.
          accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
          authenticationPrompt: { title: titulo, cancel: cancelar },
        });
      } catch (erro) {
        if (erro instanceof Error && pedidoCancelado(erro.message)) {
          throw new ErroDoCofre('cancelado', { cause: erro });
        }
        throw erro;
      }
      return lido ? deBase64(lido.password) : null;
    },

    async destruir(nome) {
      await Keychain.resetGenericPassword({ service: servico(nome) });
    },

    // Pânico (RF-48): tenta destruir cada um, mesmo que outro falhe, e só então avisa a falha.
    async destruirTudo() {
      let falhou = false;
      for (const nome of NOMES) {
        try {
          await cofre.destruir(nome);
        } catch {
          falhou = true;
        }
      }
      if (falhou) throw new Error('nem todo segredo foi destruído');
    },
  };
  return cofre;
}

/** Nível de segurança que o Keystore deste aparelho oferece para chaves com autenticação. */
export function nivelDoKeystore(): Promise<Keychain.SECURITY_LEVEL | null> {
  return Keychain.getSecurityLevel({
    accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
  });
}
