import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist',
    'emsdk/**',
    'assembly/**',
    'emscripten/**',
    'jc303_wasm/**',
    'rubberband/**',
    'public/**',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser, }, rules: { 'react-hooks/refs': 'off',  'react-refresh/only-export-components': 'off', 'react-hooks/immutability': 'off',  'react-hooks/rules-of-hooks': 'off', 'react-hooks/set-state-in-effect': 'off', 'react-hooks/preserve-manual-memoization': 'off',  '@typescript-eslint/no-unused-vars': 'off', '@typescript-eslint/no-explicit-any': 'off', '@typescript-eslint/ban-ts-comment': 'off', 'react-hooks/exhaustive-deps': 'off', '@typescript-eslint/no-non-null-asserted-optional-chain': 'off', 'no-var': 'off', 'no-case-declarations': 'off', 'no-empty': 'off' },
  },
])
