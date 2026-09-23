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
  // React Compiler-style rules. Deferred from Phase A (rules-of-hooks,
  // exhaustive-deps, set-state-in-effect are now ON). ~103 findings, concentrated in
  // AISongModal.tsx (refs) and useStepHandler.ts (preserve-manual-memoization).
  // Owner: noahc42 — target: 2026-11-30.
  'react-hooks/refs': 'off',
  'react-hooks/immutability': 'off',
  'react-hooks/preserve-manual-memoization': 'off',
  'react-refresh/only-export-components': 'off',
  '@typescript-eslint/no-unused-vars': 'off',
  '@typescript-eslint/no-explicit-any': 'off',
  '@typescript-eslint/ban-ts-comment': 'off',
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
      // AudioWorklet modules must use Vite ?worker&url — raw .ts hrefs 404 in production.
      // (new URL(...audio-worklets/*.ts) is guarded by src/__tests__/audioWorkletModuleUrls.test.ts)
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='addModule'] > Literal[value=/\\.(ts|tsx)$/]",
          message:
            'audioWorklet.addModule must use a bundler-emitted URL (?worker&url), not a raw .ts path.',
        },
        {
          selector:
            "CallExpression[callee.property.name='addModule'][arguments.0.type='Literal']:not([arguments.0.value=/\\.(ts|tsx)$/]), CallExpression[callee.property.name='addModule'][arguments.0.type='TemplateLiteral']",
          message:
            "audioWorklet.addModule must use a bundler-emitted URL (?worker&url), not a string path — addModule('x.js') 404s in production (#1177).",
        },
      ],
      // #1134: the monolithic samplerPlayback.ts and audio/playback/*Playback.ts
      // barrel were deleted as unreachable duplicates. Ban both relative and
      // @/-aliased re-imports so the shadow stack can't silently return.
      // Anchored with regexes (not glob `patterns`) because gitignore-style
      // glob matching can't distinguish the deleted flat file from the still
      // -live `samplerPlayback/` split-module folder that shares its name.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(^|/)audioEngine/samplerPlayback$',
              message:
                'samplerPlayback.ts was deleted as a dead duplicate. Import from ./audioEngine/samplerPlayback/playSamplerVoice or ./audioEngine/samplerPlayback/samplerControls instead.',
            },
            {
              regex: '(^|/)audio/playback/(synthPlayback|drumPlayback|samplerPlayback)$',
              message:
                'This module was deleted as a dead duplicate (#1134). The live sampler/synth/drum playback code lives under src/hooks/audioEngine/.',
            },
            {
              regex: '(^|/)audio/playback(/index)?$',
              message:
                "audio/playback's barrel index.ts was deleted as a dead re-export. Import PlaybackHealthMonitor directly from '@/audio/playback/PlaybackHealthMonitor'.",
            },
          ],
        },
      ],
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
  // `ESLINT_RATCHET=1` (scripts/lint-ratchet.mjs) — every rule this file keeps
  // 'off' is switched to 'error' so its violations can be counted and compared
  // against eslint-baseline.json. Any NEW 'off' entry above is picked up
  // automatically; it must also get a baseline entry or the ratchet fails.
  ...(process.env.ESLINT_RATCHET === '1'
    ? [
        {
          files: ['**/*.{ts,tsx}'],
          rules: Object.fromEntries(
            Object.keys({
              ...legacyRelaxedRules,
              ...deferredTypeCheckedRules,
              ...gradualTypeRules,
            }).map((rule) => [rule, 'error']),
          ),
        },
      ]
    : []),
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
