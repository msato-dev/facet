// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

const nodeBuiltins = ['fs', 'node:*', 'path', 'os', 'child_process', 'crypto', 'electron', 'chokidar']

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'release/**',
      'node_modules/**',
      'docs/mock/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-empty-pattern': 'off',
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: nodeBuiltins,
              message: 'Renderer must not access Node or Electron directly; use window.facet.',
            },
            { group: ['**/main/**'], message: 'Renderer must not import Main code.' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: nodeBuiltins, message: 'shared/ must stay pure (no Node/Electron).' },
            {
              group: ['**/main/**', '**/renderer/**'],
              message: 'shared/ must not depend on main or renderer.',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', 'window', 'document'],
    },
  },
)
