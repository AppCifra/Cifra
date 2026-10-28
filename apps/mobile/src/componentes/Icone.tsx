// Ícones do design (components/icons): traços de ponta redonda numa grade de 24, refeitos com Views
// nas mesmas coordenadas dos SVG, sem biblioteca de SVG. Cada traço é um retângulo de cantos
// redondos girado; cada círculo, uma borda. Os arcos e as curvas dos caminhos viram segmentos
// curtos; tocar e pausar são cheios, como no design. Responder, encaminhar e o coração vêm do
// Lucide, como o design manda para os ícones que faltam. Só desenho: quem lê a tela ouve o rótulo
// do botão.
import { StyleSheet, View } from 'react-native';
import { useCores } from '../tema.ts';

type Forma =
  | {
      readonly tipo: 'linha';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
    }
  | { readonly tipo: 'circulo'; readonly cx: number; readonly cy: number; readonly r: number }
  /** Triângulo cheio apontando para a direita (o tocar). */
  | {
      readonly tipo: 'triangulo';
      readonly x: number;
      readonly y: number;
      readonly largura: number;
      readonly altura: number;
    }
  /** Retângulo cheio de cantos redondos (o pausar). */
  | {
      readonly tipo: 'bloco';
      readonly x: number;
      readonly y: number;
      readonly largura: number;
      readonly altura: number;
      readonly raio: number;
    };

const linha = (x1: number, y1: number, x2: number, y2: number): Forma => ({
  tipo: 'linha',
  x1,
  y1,
  x2,
  y2,
});
const circulo = (cx: number, cy: number, r: number): Forma => ({ tipo: 'circulo', cx, cy, r });

/** Pontos de um arco do SVG (raio único, sem rotação) a partir de (x1, y1), sem o primeiro. */
function arco(
  x1: number,
  y1: number,
  r: number,
  grande: boolean,
  horario: boolean,
  x2: number,
  y2: number,
): (readonly [number, number])[] {
  const mx = (x1 - x2) / 2;
  const my = (y1 - y2) / 2;
  const d2 = mx * mx + my * my;
  if (d2 === 0) return [];
  const raio = Math.max(r, Math.sqrt(d2));
  const fator = (grande === horario ? -1 : 1) * Math.sqrt(Math.max(0, (raio * raio - d2) / d2));
  const cx = fator * my + (x1 + x2) / 2;
  const cy = -fator * mx + (y1 + y2) / 2;
  const inicio = Math.atan2(y1 - cy, x1 - cx);
  let volta = Math.atan2(y2 - cy, x2 - cx) - inicio;
  if (horario && volta < 0) volta += 2 * Math.PI;
  if (!horario && volta > 0) volta -= 2 * Math.PI;
  const passos = Math.max(2, Math.ceil(Math.abs(volta) / (Math.PI / 8)));
  return Array.from({ length: passos }, (_, i) => {
    const angulo = inicio + (volta * (i + 1)) / passos;
    return [cx + raio * Math.cos(angulo), cy + raio * Math.sin(angulo)] as const;
  });
}

/**
 * Os traços de um caminho do SVG: M, L, H, V, A (raio único, sem rotação), C e Z, maiúsculas
 * (absolutas) e minúsculas (relativas). Arcos e curvas viram segmentos curtos.
 */
function caminho(d: string): Forma[] {
  const partes = d.match(/[a-zA-Z]|-?\d*\.?\d+/g) ?? [];
  const formas: Forma[] = [];
  let i = 0;
  let comando = 'M';
  let x = 0;
  let y = 0;
  let inicioX = 0;
  let inicioY = 0;
  const numero = () => Number(partes[i++]);
  const ir = (nx: number, ny: number) => {
    formas.push(linha(x, y, nx, ny));
    x = nx;
    y = ny;
  };
  while (i < partes.length) {
    const parte = partes[i] ?? '';
    if (/[a-zA-Z]/.test(parte)) {
      comando = parte;
      i++;
      if (comando === 'Z' || comando === 'z') {
        ir(inicioX, inicioY);
        continue;
      }
    }
    const relativo = comando === comando.toLowerCase();
    const bx = relativo ? x : 0;
    const by = relativo ? y : 0;
    switch (comando.toUpperCase()) {
      case 'M':
        x = bx + numero();
        y = by + numero();
        inicioX = x;
        inicioY = y;
        comando = relativo ? 'l' : 'L';
        break;
      case 'L':
        ir(bx + numero(), by + numero());
        break;
      case 'H':
        ir(bx + numero(), y);
        break;
      case 'V':
        ir(x, by + numero());
        break;
      case 'C': {
        const [x1, y1, x2, y2] = [bx + numero(), by + numero(), bx + numero(), by + numero()];
        const [x3, y3] = [bx + numero(), by + numero()];
        const [x0, y0] = [x, y];
        for (let passo = 1; passo <= 8; passo++) {
          const t = passo / 8;
          const u = 1 - t;
          ir(
            u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
            u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
          );
        }
        break;
      }
      case 'A': {
        const r = numero();
        numero();
        numero();
        const grande = numero() === 1;
        const horario = numero() === 1;
        const [nx, ny] = [bx + numero(), by + numero()];
        for (const [px, py] of arco(x, y, r, grande, horario, nx, ny)) ir(px, py);
        x = nx;
        y = ny;
        break;
      }
      default:
        i++;
    }
  }
  return formas;
}

/** O `rect` do SVG com cantos redondos, como caminho. */
function retangulo(x: number, y: number, largura: number, altura: number, r: number): Forma[] {
  const [direita, baixo] = [x + largura, y + altura];
  return caminho(
    `M${String(x + r)} ${String(y)}H${String(direita - r)}A${String(r)} ${String(r)} 0 0 1 ${String(direita)} ${String(y + r)}` +
      `V${String(baixo - r)}A${String(r)} ${String(r)} 0 0 1 ${String(direita - r)} ${String(baixo)}` +
      `H${String(x + r)}A${String(r)} ${String(r)} 0 0 1 ${String(x)} ${String(baixo - r)}` +
      `V${String(y + r)}A${String(r)} ${String(r)} 0 0 1 ${String(x + r)} ${String(y)}`,
  );
}

/** Os caminhos de Icon.jsx, ponto a ponto. */
const DESENHOS = {
  voltar: [linha(15, 5, 8, 12), linha(8, 12, 15, 19)],
  mais: [linha(12, 5, 12, 19), linha(5, 12, 19, 12)],
  enviar: [linha(12, 19, 12, 5), linha(5.5, 11.5, 12, 5), linha(12, 5, 18.5, 11.5)],
  buscar: [circulo(11, 11, 6.5), linha(20, 20, 16, 16)],
  timer: [
    circulo(12, 13, 7.5),
    linha(12, 9, 12, 13),
    linha(12, 13, 14.5, 14.5),
    linha(9.5, 2.5, 14.5, 2.5),
  ],
  // "sliders" no design.
  ajustes: [
    linha(4, 7, 13, 7),
    linha(17, 7, 20, 7),
    linha(4, 17, 7, 17),
    linha(11, 17, 20, 17),
    circulo(15, 7, 2),
    circulo(9, 17, 2),
  ],
  baixar: [linha(12, 5, 12, 19), linha(5.5, 12.5, 12, 19), linha(12, 19, 18.5, 12.5)],
  // "sun" e "moon" no design: a troca de tema na lista (RF-39).
  sol: [
    circulo(12, 12, 4),
    linha(12, 2.5, 12, 4.5),
    linha(12, 19.5, 12, 21.5),
    linha(4.6, 4.6, 6, 6),
    linha(18, 18, 19.4, 19.4),
    linha(2.5, 12, 4.5, 12),
    linha(19.5, 12, 21.5, 12),
    linha(4.6, 19.4, 6, 18),
    linha(18, 6, 19.4, 4.6),
  ],
  lua: caminho('M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'),
  copiar: [
    ...retangulo(8, 8, 12, 12, 2.5),
    ...caminho('M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2'),
  ],
  // Do Lucide (ISC): image, file, paperclip, x, trash, play, pause, reply, forward, heart e
  // circle-help.
  imagem: [
    ...retangulo(3, 3, 18, 18, 2),
    circulo(9, 9, 2),
    ...caminho('m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'),
  ],
  arquivo: [
    ...caminho('M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'),
    ...caminho('M14 2v4a2 2 0 0 0 2 2h4'),
  ],
  anexar: caminho(
    'm21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48',
  ),
  fechar: [linha(18, 6, 6, 18), linha(6, 6, 18, 18)],
  lixeira: [
    linha(3, 6, 21, 6),
    ...caminho('M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6'),
    ...caminho('M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2'),
  ],
  tocar: [{ tipo: 'triangulo', x: 6, y: 3, largura: 14, altura: 18 }],
  pausar: [
    { tipo: 'bloco', x: 14, y: 4, largura: 4, altura: 16, raio: 1 },
    { tipo: 'bloco', x: 6, y: 4, largura: 4, altura: 16, raio: 1 },
  ],
  responder: [...caminho('M20 18v-2a4 4 0 0 0-4-4H4'), ...caminho('m9 17-5-5 5-5')],
  encaminhar: [...caminho('m15 17 5-5-5-5'), ...caminho('M4 18v-2a4 4 0 0 1 4-4h12')],
  // O apoiar da lista (RF-60).
  coracao: caminho(
    'M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5',
  ),
  // O "?" do status da conexão (RF-64).
  ajuda: [
    circulo(12, 12, 10),
    ...caminho('M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3'),
    ...caminho('M12 17h.01'),
  ],
} as const satisfies Record<string, readonly Forma[]>;

export type NomeDoIcone = keyof typeof DESENHOS;

/** Desenha as formas numa caixa de `tamanho`, com a grade de `grade` unidades. */
export function Desenho({
  formas,
  tamanho,
  grade,
  traco,
  cor,
}: {
  readonly formas: readonly Forma[];
  readonly tamanho: number;
  readonly grade: number;
  readonly traco: number;
  readonly cor: string;
}) {
  const escala = tamanho / grade;
  const espessura = traco * escala;
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ width: tamanho, height: tamanho }}
    >
      {formas.map((forma, i) => {
        if (forma.tipo === 'triangulo') {
          return (
            <View
              key={i}
              style={[
                estilos.forma,
                {
                  left: forma.x * escala,
                  top: forma.y * escala,
                  width: 0,
                  height: 0,
                  borderTopWidth: (forma.altura / 2) * escala,
                  borderBottomWidth: (forma.altura / 2) * escala,
                  borderLeftWidth: forma.largura * escala,
                  borderTopColor: 'transparent',
                  borderBottomColor: 'transparent',
                  borderLeftColor: cor,
                },
              ]}
            />
          );
        }
        if (forma.tipo === 'bloco') {
          return (
            <View
              key={i}
              style={[
                estilos.forma,
                {
                  left: forma.x * escala,
                  top: forma.y * escala,
                  width: forma.largura * escala,
                  height: forma.altura * escala,
                  borderRadius: forma.raio * escala,
                  backgroundColor: cor,
                },
              ]}
            />
          );
        }
        if (forma.tipo === 'circulo') {
          const lado = forma.r * 2 * escala + espessura;
          return (
            <View
              key={i}
              style={[
                estilos.forma,
                {
                  left: forma.cx * escala - lado / 2,
                  top: forma.cy * escala - lado / 2,
                  width: lado,
                  height: lado,
                  borderRadius: lado / 2,
                  borderWidth: espessura,
                  borderColor: cor,
                },
              ]}
            />
          );
        }
        const dx = (forma.x2 - forma.x1) * escala;
        const dy = (forma.y2 - forma.y1) * escala;
        // A ponta redonda passa meia espessura de cada lado, como o `stroke-linecap: round`.
        const comprimento = Math.hypot(dx, dy) + espessura;
        return (
          <View
            key={i}
            style={[
              estilos.forma,
              {
                left: ((forma.x1 + forma.x2) / 2) * escala - comprimento / 2,
                top: ((forma.y1 + forma.y2) / 2) * escala - espessura / 2,
                width: comprimento,
                height: espessura,
                borderRadius: espessura / 2,
                backgroundColor: cor,
                transform: [{ rotate: `${String(Math.atan2(dy, dx))}rad` }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

interface PropsDoIcone {
  readonly nome: NomeDoIcone;
  readonly tamanho?: number;
  readonly traco?: number;
  readonly cor?: string;
}

/** Sem `cor`, o ícone tem a cor do texto do tema. */
export function Icone({ nome, tamanho = 20, traco = 1.8, cor }: PropsDoIcone) {
  const cores = useCores();
  return (
    <Desenho
      formas={DESENHOS[nome]}
      tamanho={tamanho}
      grade={24}
      traco={traco}
      cor={cor ?? cores.texto}
    />
  );
}

/** O selo de verificado (VerifiedMark): disco fósforo com o visto na tinta escura. */
export function SeloDeVerificado({ tamanho = 15 }: { readonly tamanho?: number }) {
  const cores = useCores();
  return (
    <View
      accessible={false}
      style={{
        width: tamanho,
        height: tamanho,
        borderRadius: tamanho / 2,
        backgroundColor: cores.acento,
      }}
    >
      <Desenho
        formas={[linha(5, 8.2, 7, 10.2), linha(7, 10.2, 11, 6)]}
        tamanho={tamanho}
        grade={16}
        traco={1.6}
        cor={cores.sobreAcento}
      />
    </View>
  );
}

const estilos = StyleSheet.create({
  forma: { position: 'absolute' },
});
