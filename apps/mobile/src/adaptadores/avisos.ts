// Notificações cegas no Android (RF-42): o módulo nativo (serviço em primeiro plano e o aviso) e o
// pedido de permissão do sistema, que só existe do Android 13 em diante.
import { PermissionsAndroid, Platform } from 'react-native';
import { avisosNativos } from '../../modules/cifra-plataforma/index.ts';
import type { PlataformaDosAvisos } from '../avisos.ts';

const PEDE_PERMISSAO = Platform.OS === 'android' && Platform.Version >= 33;

export const avisosDoAndroid: PlataformaDosAvisos = {
  ligar: (textos) => avisosNativos.ligar({ ...textos }),
  desligar: () => avisosNativos.desligar(),
  avisar: (textos) => avisosNativos.avisar({ ...textos }),
  limpar: () => avisosNativos.limpar(),
  async pedirPermissao() {
    if (!PEDE_PERMISSAO) return avisosNativos.permitidas();
    const resultado = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    return resultado === PermissionsAndroid.RESULTS.GRANTED;
  },
};
