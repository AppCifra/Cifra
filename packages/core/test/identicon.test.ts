import { randomBytes } from 'node:crypto';
import { formatarId } from '@cifra/protocol';
import { describe, expect, it } from 'vitest';
import { celulasDoIdenticon, type Celula, type Grade } from '../src/index.ts';

// Gerados rodando o código do protótipo do design, sem mudança, sobre os IDs do próprio protótipo
// e os dos vetores de ID. "#" é célula cheia, "." vazia e "*" acento.
const DESENHOS = [
  {
    id: '7F3A-KP9W-2HXC-M4TT',
    grade6: ['.#..#.', '#.##.#', '.####.', '#*##*#', '#....#', '......'],
    grade5: ['.#.#.', '#.#.#', '.###.', '*###*', '#...#'],
  },
  {
    id: 'K4RO-7Q2M-ZX9P-D3TA',
    grade6: ['#....#', '......', '..##..', '##..##', '..##..', '#*##*#'],
    grade5: ['#...#', '.....', '..#..', '*#.#*', '..#..'],
  },
  {
    id: '0000-0000-0000-0000',
    grade6: ['......', '..##..', '#....#', '......', '.#..#.', '.#**#.'],
    grade5: ['.....', '..#..', '#...#', '.....', '.*.*.'],
  },
  {
    // Na grade 5, o acento caiu na coluna do meio: é uma célula só.
    id: 'A64Y-Y115-SZVP-TC2Y',
    grade6: ['..##..', '#.##.#', '#....#', '#*##*#', '#....#', '######'],
    grade5: ['..#..', '#.*.#', '#...#', '#####', '#...#'],
  },
  {
    id: 'D65H-8D0J-J5KX-F235',
    grade6: ['##..##', '*....*', '.#..#.', '.####.', '.####.', '######'],
    grade5: ['#*.*#', '#...#', '.#.#.', '.###.', '.###.'],
  },
  {
    id: 'NHZX-THFK-8Q4A-ZSNZ',
    grade6: ['######', '######', '......', '..**..', '..##..', '..##..'],
    grade5: ['#####', '#*#*#', '.....', '..#..', '..#..'],
  },
  {
    id: '1VWY-3D2X-1WZS-7G1N',
    grade6: ['.#..#.', '.#..#.', '######', '##..##', '.####.', '*#..#*'],
    grade5: ['.#.#.', '.*.*.', '#####', '##.##', '.###.'],
  },
  {
    id: '8T5P-5MQN-NNV2-5Y6M',
    grade6: ['######', '.#..#.', '..##..', '*.##.*', '######', '.####.'],
    grade5: ['#####', '.#.#.', '..#..', '*.#.*', '#####'],
  },
  {
    id: 'JWH3-RF3G-445W-3D8T',
    grade6: ['#....#', '#....#', '..##..', '.####.', '######', '##**##'],
    grade5: ['#...#', '*...*', '..#..', '.###.', '#####'],
  },
  {
    id: 'TWJR-T15E-YJAJ-SNQH',
    grade6: ['.####.', '#....#', '#.**.#', '##..##', '..##..', '.####.'],
    grade5: ['.###.', '#...#', '#.#.#', '#*.*#', '..#..'],
  },
  {
    id: 'WVJ4-KKY1-E9TC-V166',
    grade6: ['#....#', '.#**#.', '##..##', '######', '##..##', '.####.'],
    grade5: ['#...#', '.###.', '##.##', '*###*', '##.##'],
  },
  {
    id: 'QZB0-9Z4G-CGBB-0XBH',
    grade6: ['#.##.#', '.####.', '*####*', '......', '.#..#.', '######'],
    grade5: ['#.#.#', '.#*#.', '#####', '.....', '.#.#.'],
  },
] as const;

const SIMBOLO: Readonly<Record<Celula, string>> = { vazia: '.', cheia: '#', acento: '*' };

function desenho(id: string, grade: Grade): string[] {
  const celulas = celulasDoIdenticon(id, grade);
  return Array.from({ length: grade }, (_, y) =>
    celulas
      .slice(y * grade, (y + 1) * grade)
      .map((celula) => SIMBOLO[celula])
      .join(''),
  );
}

const idSorteado = () => formatarId(Uint8Array.from(randomBytes(10)));

describe('identicon', () => {
  it('sai igual ao do protótipo do design, nas grades 6 e 5', () => {
    for (const { id, grade6, grade5 } of DESENHOS) {
      expect(desenho(id, 6)).toEqual(grade6);
      expect(desenho(id, 5)).toEqual(grade5);
    }
  });

  it('é sempre o mesmo para o mesmo ID', () => {
    for (let i = 0; i < 50; i++) {
      const id = idSorteado();
      expect(celulasDoIdenticon(id, 6)).toEqual(celulasDoIdenticon(id, 6));
      expect(celulasDoIdenticon(id, 5)).toEqual(celulasDoIdenticon(id, 5));
    }
  });

  it('é espelhado e leva o acento numa célula cheia e na espelhada dela', () => {
    for (let i = 0; i < 500; i++) {
      const id = idSorteado();
      for (const grade of [5, 6] as const) {
        const celulas = celulasDoIdenticon(id, grade);
        expect(celulas).toHaveLength(grade * grade);
        const ligada = (x: number, y: number) => celulas[y * grade + x] !== 'vazia';
        const acento = (x: number, y: number) => celulas[y * grade + x] === 'acento';
        for (let y = 0; y < grade; y++) {
          for (let x = 0; x < grade; x++) {
            expect(ligada(x, y)).toBe(ligada(grade - 1 - x, y));
            expect(acento(x, y)).toBe(acento(grade - 1 - x, y));
          }
        }
        const acentos = celulas.filter((celula) => celula === 'acento').length;
        const algumaCheia = celulas.some((celula) => celula !== 'vazia');
        if (!algumaCheia) expect(acentos).toBe(0);
        else if (grade === 6) expect(acentos).toBe(2);
        else expect([1, 2]).toContain(acentos);
      }
    }
  });
});
