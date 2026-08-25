import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

/**
 * Type-safety rules ratcheted up area-by-area. Globally off so `pnpm lint`
 * stays green; enabled per directory as each surface is cleaned up.
 * `pnpm run lint:strict` turns the full set on for CI gating.
 */
const gradualTypeRules = {
  '@typescript-eslint/no-floating-promises': 'off',
  '@typescript-eslint/no-unsafe-assignment': 'off',
  '@typescript-eslint/no-unsafe-member-access': 'off',
  '@typescript-eslint/no-unsafe-call': 'off',
  '@typescript-eslint/no-unsafe-return': 'off',
  '@typescript-eslint/no-unsafe-argument': 'off',
  '@typescript-eslint/no-misused-promises': 'off',
  '@typescript-eslint/require-await': 'off',
  '@typescript-eslint/no-redundant-type-constituents': 'off',
}

/** Full safety set for `lint:strict` / future CI gating. */
const strictTypeRules = Object.fromEntries(
  Object.keys(gradualTypeRules).map((rule) => [rule, 'error']),
)

/** Rules from recommendedTypeChecked kept off until each area is cleaned up. */
const deferredTypeCheckedRules = {
  '@typescript-eslint/no-unnecessary-type-assertion': 'off',
  '@typescript-eslint/unbound-method': 'off',
  '@typescript-eslint/no-base-to-string': 'off',
  '@typescript-eslint/no-implied-eval': 'off',
  '@typescript-eslint/no-duplicate-type-constituents': 'off',
  '@typescript-eslint/prefer-promise-reject-errors': 'off',
};

const legacyRelaxedRules = {
  'react-hooks/refs': 'off',
  'react-refresh/only-export-components': 'off',
  'react-hooks/immutability': 'off',
  'react-hooks/rules-of-hooks': 'off',
  'react-hooks/set-state-in-effect': 'off',
  'react-hooks/preserve-manual-memoization': 'off',
  '@typescript-eslint/no-unused-vars': 'off',
  '@typescript-eslint/no-explicit-any': 'off',
  '@typescript-eslint/ban-ts-comment': 'off',
  'react-hooks/exhaustive-deps': 'off',
  '@typescript-eslint/no-non-null-asserted-optional-chain': 'off',
  'no-var': 'off',
  'no-case-declarations': 'off',
  'no-empty': 'off',
}

const typeAwareLanguageOptions = {
  ecmaVersion: 2020,
  globals: globals.browser,
  parserOptions: {
    project: ['./tsconfig.eslint.json'],
    tsconfigRootDir: import.meta.dirname,
  },
}

export default defineConfig([
  globalIgnores([
    'dist',
    'emsdk/**',
    'assembly/**',
    'emscripten/**',
    'jc303_wasm/**',
    'rubberband/**',
    'public/**',
    'patch_*.ts',
    'test_perf.ts',
    'scripts/*.mjs',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: typeAwareLanguageOptions,
    rules: {
      ...legacyRelaxedRules,
      ...deferredTypeCheckedRules,
      ...gradualTypeRules,
    },
  },
  // Phase 1: pure library surface (utils + engines)
  {
    files: ['src/utils/**/*.{ts,tsx}', 'src/engines/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
    },
  },
  // Phase 2: hooks surface
  {
    files: ['src/hooks/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
    },
  },
  // `ESLINT_STRICT=1 pnpm run lint` — full safety set for CI gating
  ...(process.env.ESLINT_STRICT === '1'
    ? [
        {
          files: ['**/*.{ts,tsx}'],
          rules: strictTypeRules,
        },
      ]
    : []),
])
