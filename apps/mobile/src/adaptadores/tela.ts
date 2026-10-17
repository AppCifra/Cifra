// Bloqueio de print e gravação (RF-41). Já nasce ligado no MainActivity.onCreate; daqui o app só
// desliga se a pessoa escolher nos ajustes.
import { telaSeguraNativa } from '../../modules/cifra-plataforma/index.ts';

export const definirTelaSegura = (segura: boolean) => telaSeguraNativa.definir(segura);

export const telaEstaSegura = () => telaSeguraNativa.estaSegura();

/** As barras do sistema no tema claro ou escuro (RF-39). Sem a tela na frente, não faz nada. */
export const definirBarrasDoTema = (clara: boolean) =>
  telaSeguraNativa.definirNavegacaoClara(clara).catch(() => undefined);
