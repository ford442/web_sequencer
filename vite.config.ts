/// <reference types="vitest" />
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { defineConfig, mergeConfig } from 'vitest/config';
import type { Plugin, ResolvedConfig } from 'vite';
import unitTestConfig from './vitest.unit.config';
import { vitestSharedConfig } from './vitest.shared';

/**
 * Emits dist/precache-manifest.json — the list of hashed shell files
 * public/sw.js precaches at install — and stamps a build id into the copy
 * of public/sw.js that ships in dist/, so the browser's service-worker
 * update check (a byte-diff of sw.js itself) actually notices a new
 * release even though sw.js's logic never needs to change between builds.
 *
 * See docs/deployment/ADR_PWA_SERVICE_WORKER_COEP.md for the caching policy
 * this encodes (which asset classes are eagerly precached vs. cached
 * opportunistically at runtime vs. never cached at all).
 */
function hyphonPrecacheManifestPlugin(): Plugin {
  let resolved: ResolvedConfig;
  return {
    name: 'hyphon-precache-manifest',
    apply: 'build',
    configResolved(config) {
      resolved = config;
    },
    closeBundle() {
      const outDir = path.isAbsolute(resolved.build.outDir)
        ? resolved.build.outDir
        : path.join(resolved.root, resolved.build.outDir);
      if (!fs.existsSync(outDir)) return;

      // Runtime-cacheable-only assets are deliberately excluded from the
      // eager precache list: they are large (the threaded hyphon_native.wasm
      // build, the vendored Pyodide runtime) and are instead cached
      // opportunistically by sw.js the first time the page fetches them.
      const runtimeOnlyPatterns = [
        /(^|\/)hyphon_native.*\.(wasm|js)$/,
        /\.wasm$/,
        /(^|\/)pyodide\//,
        /(^|\/)wam\//,
        /(^|\/)osc\//,
        /\.(wav|mp3)$/,
      ];
      const shellExts = new Set(['.js', '.css', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif', '.woff', '.woff2']);
      const skipNames = new Set(['index.html', 'manifest.webmanifest', 'sw.js', 'precache-manifest.json']);

      function walk(dir: string, base = ''): string[] {
        const out: string[] = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          const rel = base ? `${base}/${entry.name}` : entry.name;
          if (entry.isDirectory()) out.push(...walk(full, rel));
          else out.push(rel);
        }
        return out;
      }

      const shell = ['./', './index.html', './manifest.webmanifest', './precache-manifest.json'];
      for (const rel of walk(outDir)) {
        if (rel.endsWith('.map') || skipNames.has(path.basename(rel))) continue;
        if (!shellExts.has(path.extname(rel))) continue;
        if (runtimeOnlyPatterns.some((re) => re.test(rel))) continue;
        shell.push(`./${rel}`);
      }

      const manifestBody = { generatedAt: Date.now(), shell };
      const version = crypto.createHash('sha256').update(JSON.stringify(manifestBody)).digest('hex').slice(0, 16);
      fs.writeFileSync(
        path.join(outDir, 'precache-manifest.json'),
        JSON.stringify({ version, ...manifestBody }, null, 2),
      );

      const swSrcPath = path.join(resolved.root, 'public', 'sw.js');
      if (fs.existsSync(swSrcPath)) {
        const stamped = fs.readFileSync(swSrcPath, 'utf8').replace('__HYPHON_BUILD_ID__', version);
        fs.writeFileSync(path.join(outDir, 'sw.js'), stamped);
      }
    },
  };
}

export default mergeConfig(
  vitestSharedConfig,
  defineConfig({
    plugins: [hyphonPrecacheManifestPlugin()],
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
      watch: {
        ignored: ['**/emsdk/**'],
      },
    },
    preview: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    },
    build: {
      rollupOptions: {
        external: ['loader.mjs'],
      },
      sourcemap:
        process.env.HYPHON_SOURCEMAP === 'hidden'
          ? 'hidden'
          : process.env.HYPHON_SOURCEMAP === '1',
      outDir: 'dist',
    },
    test: unitTestConfig.test,
  }),
);
