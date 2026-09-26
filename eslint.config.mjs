import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.local/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly', URL: 'readonly' },
    },
  },
  {
    files: ['tools/lab/*.js'],
    languageOptions: {
      globals: {
        document: 'readonly',
        history: 'readonly',
        location: 'readonly',
        fetch: 'readonly',
      },
    },
  },
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
);
