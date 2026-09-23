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
        output: {
          // react/react-dom change far less often than app code, so pin them to
          // their own chunk for long-term browser caching across deploys.
          // three.js, the RBS importer/exporter and XM export are reachable only
          // via dynamic import() — Studio3D and the route-split modals in
          // App.tsx — so Rollup's default code-splitting already isolates them
          // and they need no entry here. onnxruntime-web is equally async-only
          // (src/services/ortRuntime.ts) but IS named, because a stable chunk
          // name is what dist-budget.json needs to hold it to a size. Naming a
          // chunk assigns it an identity; it does not make it eager.
          // Vite 8 equivalent: build.rolldownOptions.output.codeSplitting.groups
          //   [{ name: 'vendor-react', test: /node_modules\/(react|react-dom|scheduler)\// },
          //    { name: 'vendor-onnx',  test: /node_modules\/onnxruntime-web\// }]
          // Object-form manualChunks is removed in Vite 8 and function-form is
          // deprecated there, so this is written in the shape that survives the
          // migration. Keep the group set small: over-eager grouping makes caching
          // worse, because one transitive patch invalidates a shared chunk.
          manualChunks(id) {
            if (/[/\\]node_modules[/\\](react|react-dom|scheduler)[/\\]/.test(id)) {
              return 'vendor-react';
            }
            // Naming ORT's chunk does not make it eager — every consumer reaches
            // it through a dynamic import() in src/services/ortRuntime.ts. The
            // stable name is what lets dist-budget.json hold it to a size, and
            // check-release-dist.mjs asserts it stays out of the entry graph.
            if (/[/\\]node_modules[/\\]onnxruntime-web[/\\]/.test(id)) {
              return 'vendor-onnx';
            }
          },
        },
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
