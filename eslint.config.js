// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/coverage/',
    '**/dist/',
    // Pastas de ferramentas locais (começam com ponto), fora do repositório.
    '.*/',
    // Projetos nativos gerados pelo `expo prebuild`.
    'apps/mobile/android/',
    'apps/mobile/ios/',
    'apps/mobile/modules/*/android/build/',
    '**/.expo/',
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      // RNF-05: nenhum log de conteúdo, chave, ID ou IP, nem em debug.
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // Config plugins do Expo: CommonJS, rodam no Node durante o prebuild.
    files: ['apps/mobile/plugins/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { require: 'readonly', module: 'writable', process: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
