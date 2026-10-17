import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      // Cada pacote vira um projeto com o nome do package.json, rodando em Node (RNF-15).
      'packages/*',
      // Nos apps, só a parte que roda em Node: conversões puras e o servidor de teste.
      'apps/*',
      {
        test: {
          name: 'repositorio',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
