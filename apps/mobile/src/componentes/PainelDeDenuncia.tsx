// Denunciar (RF-63): o painel manda os crimes direto às autoridades e mostra o e-mail do projeto;
// num contato ou pedido, também copia o ID dele, para a denúncia. O app não abre o e-mail nem o
// navegador: quem denuncia escreve de onde quiser, fora do Cifra. O texto copiado é sensível e sai
// da área de transferência sozinho, como o ID; copiar fecha o painel, e a tela mostra o recado.
import { Text, View } from 'react-native';
import type { ConversasDoApp } from '../conversas.ts';
import { EMAIL_DO_PROJETO } from '../denuncia.ts';
import { useTextos } from '../i18n.ts';
import { criarEstilos, fontes, raios, tipos } from '../tema.ts';
import { Botao } from './Botao.tsx';
import { Painel } from './Painel.tsx';

interface PropsDoPainelDeDenuncia {
  readonly conversas: ConversasDoApp;
  readonly visivel: boolean;
  readonly aoFechar: () => void;
  /** Na segurança do contato (ou do pedido): o ID e o nome dele. Nos ajustes, nenhum. */
  readonly contato?: { readonly id: string; readonly nome: string };
  readonly aoCopiar: (copiado: 'id' | 'email') => void;
}

export function PainelDeDenuncia({
  conversas,
  visivel,
  aoFechar,
  contato,
  aoCopiar,
}: PropsDoPainelDeDenuncia) {
  const estilos = useEstilos();
  const t = useTextos();
  const copiar = (texto: string, copiado: 'id' | 'email') => {
    void conversas.copiarTexto(texto).then((copiou) => {
      if (copiou) aoCopiar(copiado);
    });
  };

  return (
    <Painel
      visivel={visivel}
      aoFechar={aoFechar}
      rolavel
      titulo={
        contato ? t('denuncia.tituloDoContato', { nome: contato.nome }) : t('denuncia.titulo')
      }
      descricao={t(contato ? 'denuncia.descricaoDoContato' : 'denuncia.descricao')}
    >
      <View style={estilos.email}>
        <Text style={estilos.rotulo}>{t('denuncia.rotulo')}</Text>
        <Text style={estilos.valor}>{EMAIL_DO_PROJETO}</Text>
      </View>
      {contato && (
        <Botao
          titulo={t('denuncia.copiarId')}
          pequeno
          desativado={!conversas.comMidia}
          aoTocar={() => {
            copiar(contato.id, 'id');
          }}
        />
      )}
      <Botao
        titulo={t('denuncia.copiarEmail')}
        variante={contato ? 'fantasma' : 'primario'}
        pequeno
        desativado={!conversas.comMidia}
        aoTocar={() => {
          copiar(EMAIL_DO_PROJETO, 'email');
        }}
      />
    </Painel>
  );
}

const useEstilos = criarEstilos((cores) => ({
  email: {
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: raios.campo,
    borderWidth: 1,
    borderColor: cores.linha,
  },
  rotulo: { ...tipos.rotulo, color: cores.secundario },
  valor: { fontFamily: fontes.mono, fontSize: 13.5, lineHeight: 20, color: cores.texto },
}));
