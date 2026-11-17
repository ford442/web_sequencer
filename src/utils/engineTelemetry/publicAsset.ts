/**
 * Resolve a path under Vite's `public/` directory to an absolute URL.
 *
 * Public assets live at the deployment root (e.g. dist/hyphon_native.wasm), but
 * application code is bundled under assets/. A bare `./foo` string breaks both
 * dynamic import() (resolved relative to assets/index.js) and subdirectory
 * deploys (e.g. https://host/hyphon/). Using document.baseURI + BASE_URL yields
 * a stable absolute URL in every context.
 */
export function resolvePublicAsset(relativePath: string): string {
  const base =
    typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL
      ? import.meta.env.BASE_URL
      : './';

  const normalized = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;

  if (typeof window !== 'undefined' && window.location?.href) {
    try {
      const assetRoot = new URL(base, window.location.href);
      return new URL(normalized, assetRoot).href;
    } catch {
      // fall through to relative path
    }
  }

  return `${base}${normalized}`;
}
