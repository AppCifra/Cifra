// O backup no Android (RF-47): na restauração, a pessoa escolhe o arquivo no seletor do sistema, o
// mesmo dos anexos, e o app lê os bytes, até o tamanho máximo de um backup. Nenhuma permissão: o
// app só lê o que ela escolheu, enquanto escolhe.
import { TAMANHO_MAXIMO_DO_BACKUP } from '@cifra/core';
import { anexosNativos } from '../../modules/cifra-plataforma/index.ts';

/**
 * O arquivo escolhido, ou `null` se a pessoa cancelou. Rejeita se ele não abre ou passa do tamanho
 * máximo.
 */
export async function escolherBackup(): Promise<Uint8Array | null> {
  const [escolhido] = await anexosNativos.escolher('arquivo', 1);
  if (!escolhido) return null;
  const { bytes } = await anexosNativos.lerDocumento(escolhido.endereco, TAMANHO_MAXIMO_DO_BACKUP);
  return bytes;
}
