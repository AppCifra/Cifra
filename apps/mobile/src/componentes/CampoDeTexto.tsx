// Campo de texto do design: fundo da tela, linha fina e raio 15. Em mono para colar IDs, chaves e
// palavras. O teclado não aprende nem sugere nada do que é digitado aqui.
import { TextInput } from 'react-native';
import { marcarUso } from '../uso.ts';
import { criarEstilos, fontes, raios, useCores } from '../tema.ts';

interface PropsDoCampo {
  readonly valor: string;
  readonly aoMudar: (texto: string) => void;
  readonly rotulo: string;
  readonly mono?: boolean;
  readonly multilinha?: boolean;
  /** Só números, com o teclado numérico. */
  readonly numerico?: boolean;
}

export function CampoDeTexto({
  valor,
  aoMudar,
  rotulo,
  mono = false,
  multilinha = false,
  numerico = false,
}: PropsDoCampo) {
  const cores = useCores();
  const estilos = useEstilos();
  return (
    <TextInput
      value={valor}
      onChangeText={(texto) => {
        marcarUso();
        aoMudar(texto);
      }}
      accessibilityLabel={rotulo}
      placeholder={rotulo}
      placeholderTextColor={cores.secundario}
      cursorColor={cores.acento}
      selectionColor={cores.acento}
      multiline={multilinha}
      textAlignVertical={multilinha ? 'top' : 'center'}
      // Sem sugestão, correção nem preenchimento automático. No Android, "visible-password" pede
      // ao teclado que não guarde o que foi digitado; o teclado anônimo completo é o RF-43.
      autoCapitalize="none"
      autoComplete="off"
      autoCorrect={false}
      spellCheck={false}
      importantForAutofill="no"
      keyboardType={numerico ? 'number-pad' : 'visible-password'}
      style={[
        estilos.campo,
        mono ? estilos.mono : estilos.texto,
        multilinha ? estilos.multilinha : estilos.linhaUnica,
      ]}
    />
  );
}

const useEstilos = criarEstilos((cores) => ({
  campo: {
    borderWidth: 1,
    borderColor: cores.linha,
    borderRadius: raios.campo,
    backgroundColor: cores.fundo,
    color: cores.texto,
    paddingHorizontal: 16,
  },
  linhaUnica: { height: 50 },
  multilinha: { minHeight: 132, paddingVertical: 14 },
  texto: { fontFamily: fontes.regular, fontSize: 15 },
  mono: { fontFamily: fontes.mono, fontSize: 15, letterSpacing: 0.45, lineHeight: 24 },
}));
