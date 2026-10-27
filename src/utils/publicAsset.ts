/**
 * Fetch a file under `public/` and refuse the SPA fallback.
 *
 * `public/assets/` is mostly gitignored (ONNX weights, voice styles), and the
 * dev / preview server answers a missing path with `index.html` and status
 * 200. Decoding that page is how a clean checkout used to log
 * `Unable to decode audio data` and `Unexpected token '<'`. Every loader of an
 * optional asset goes through here so a missing file is a stated reason, not
 * a parse error two layers down.
 */

import { resolvePublicAsset } from './engineTelemetry';

export class MissingPublicAssetError extends Error {
    readonly path: string;
    readonly url: string;

    constructor(path: string, url: string, detail: string) {
        super(`${path} not found (${detail})`);
        this.name = 'MissingPublicAssetError';
        this.path = path;
        this.url = url;
    }
}

export function isMissingPublicAsset(error: unknown): error is MissingPublicAssetError {
    return error instanceof MissingPublicAssetError;
}

/** True when `response` is an HTML page standing in for the requested file. */
function isHtmlFallback(response: Response): boolean {
    const type = response.headers?.get?.('content-type') ?? '';
    return type.toLowerCase().includes('text/html');
}

/**
 * GET `relativePath` (relative to the app's base URL). Throws
 * {@link MissingPublicAssetError} for a 404 or an HTML fallback page.
 */
export async function fetchPublicAsset(relativePath: string, init?: RequestInit): Promise<Response> {
    const url = resolvePublicAsset(relativePath);
    let response: Response;
    try {
        response = await fetch(url, init);
    } catch (e) {
        throw new MissingPublicAssetError(relativePath, url, e instanceof Error ? e.message : String(e));
    }
    if (!response.ok) {
        throw new MissingPublicAssetError(relativePath, url, `HTTP ${response.status}`);
    }
    if (isHtmlFallback(response)) {
        throw new MissingPublicAssetError(relativePath, url, 'the server answered with an HTML page');
    }
    return response;
}

export async function fetchPublicJson<T>(relativePath: string): Promise<T> {
    const response = await fetchPublicAsset(relativePath);
    const text = await response.text();
    // Some static hosts send the fallback page as text/plain.
    if (text.trimStart().startsWith('<')) {
        throw new MissingPublicAssetError(relativePath, response.url || relativePath, 'the server answered with an HTML page');
    }
    return JSON.parse(text) as T;
}

export async function fetchPublicArrayBuffer(relativePath: string): Promise<ArrayBuffer> {
    return (await fetchPublicAsset(relativePath)).arrayBuffer();
}
