/**
 * Render an AI song without a human at the import modal (#1386).
 *
 *   pnpm run ai-song:render path/to/song.json --out out/my-song \
 *     [--formats wav,rbs,mid,xm] [--stems] [--engine303 open303|jc303] [--no-strict]
 *
 * Serves the built app (`dist/`, so run `pnpm run build` first) or uses
 * `--url`, boots it in headless Chromium with `?agent=1`, and drives
 * `window.__HYPHON_AGENT__`: import the song, render the mix through the
 * export modal's live-patch master, export .rbs / .mid / .xm, and write
 * `report.json` with the import warnings, the render report and per-stem
 * metrics (peak, LUFS, RMS and spectral centroid per bar).
 *
 * Exit codes: 0 ok · 1 usage / boot · 2 validation (or a strict-mode warning)
 * · 3 render or export failure · 4 silent master. See docs/ai-song-render.md.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { initializeHyphonAudio } from '../tests/helpers/boot';
import { EXIT, RENDER_FORMATS, parseFormats, renderAISongInPage, type RenderOptions } from './ai-song-render/render';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `Usage: pnpm run ai-song:render <song.json> [options]

  --out <dir>             Output directory (default: out/<song name>)
  --formats <list>        Comma list of ${RENDER_FORMATS.join(', ')} (default: all)
  --stems                 Also write stems/*.wav and their metrics
  --engine303 <engine>    open303 | jc303 — put every 303 voice on this engine
  --no-strict             Load the song even if the importer warns (default: warnings fail)
  --url <url>             Use a running Hyphon instead of serving dist/
  -h, --help              This text`;

interface CliArgs extends RenderOptions {
    song: string;
    out: string;
    url: string | null;
}

function parseArgs(argv: string[]): CliArgs {
    let song: string | null = null;
    let out: string | null = null;
    let url: string | null = null;
    const options: RenderOptions = { formats: [...RENDER_FORMATS], stems: false, strict: true };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const value = () => {
            const next = argv[++i];
            if (next === undefined || next.startsWith('--')) throw new Error(`${arg} needs a value`);
            return next;
        };
        switch (arg) {
            case '--': break;
            case '-h':
            case '--help':
                console.log(USAGE);
                process.exit(EXIT.ok);
                break;
            case '--out': out = value(); break;
            case '--formats': options.formats = parseFormats(value()); break;
            case '--stems': options.stems = true; break;
            case '--no-strict': options.strict = false; break;
            case '--url': url = value(); break;
            case '--engine303': {
                const engine = value();
                if (engine !== 'open303' && engine !== 'jc303') throw new Error(`--engine303 must be open303 or jc303, not "${engine}"`);
                options.engine303 = engine;
                break;
            }
            default:
                if (arg.startsWith('-')) throw new Error(`unknown option ${arg}`);
                if (song) throw new Error(`one song at a time (got ${song} and ${arg})`);
                song = arg;
        }
    }
    if (!song) throw new Error('no song given');
    return { ...options, song, out: out ?? join('out', basename(song, extname(song))), url };
}

function freePort(): Promise<number> {
    return new Promise((resolvePort, reject) => {
        const server = createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            server.close(() => (typeof address === 'object' && address ? resolvePort(address.port) : reject(new Error('no port'))));
        });
    });
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        try {
            if ((await fetch(url)).ok) return;
        } catch { /* not up yet */ }
        if (Date.now() > deadline) throw new Error(`${url} did not come up within ${timeoutMs / 1000}s`);
        await new Promise((r) => setTimeout(r, 250));
    }
}

/** `vite preview` of dist/ on a free port (it sets the COOP/COEP headers the app needs). */
async function serveDist(): Promise<{ url: string; server: ChildProcess }> {
    if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
        throw new Error('dist/ is missing — run `pnpm run build` first (or pass --url)');
    }
    const port = await freePort();
    const server = spawn(
        join(ROOT, 'node_modules', '.bin', 'vite'),
        ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
        { cwd: ROOT, stdio: 'ignore' },
    );
    const url = `http://127.0.0.1:${port}`;
    await waitForHttp(url, 60_000);
    return { url, server };
}

function summarize(report: Awaited<ReturnType<typeof renderAISongInPage>>['report'], out: string): string {
    const lines = [`${report.ok ? '✓' : '✗'} ${report.import.title ?? '(untitled)'} → ${out} (exit ${report.exitCode})`];
    for (const error of report.errors) lines.push(`  error: ${error}`);
    for (const warning of report.import.warnings) lines.push(`  import warning: ${warning}`);
    for (const skip of report.render?.report.automation.notRendered ?? []) lines.push(`  lane not rendered: ${skip.lane} (${skip.reason})`);
    const master = report.metrics?.master;
    if (master) {
        lines.push(`  mix.wav: ${master.durationSeconds}s, peak ${master.peakDbfs ?? '-inf'} dBFS, ${master.integratedLufs ?? '-inf'} LUFS`);
    }
    lines.push(`  files: ${report.files.join(', ') || '(none)'}`);
    return lines.join('\n');
}

async function main(): Promise<number> {
    let args: CliArgs;
    try {
        args = parseArgs(process.argv.slice(2));
    } catch (error) {
        console.error(`ai-song:render: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
        return EXIT.usage;
    }

    let songJson: string;
    try {
        songJson = readFileSync(resolve(args.song), 'utf8');
    } catch (error) {
        console.error(`ai-song:render: cannot read ${args.song}: ${error instanceof Error ? error.message : String(error)}`);
        return EXIT.usage;
    }

    let server: ChildProcess | null = null;
    const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    try {
        let url = args.url;
        if (!url) {
            const served = await serveDist();
            server = served.server;
            url = served.url;
        }
        const page = await browser.newPage({ baseURL: url });
        await initializeHyphonAudio(page, { query: 'agent=1', allowConsoleNoise: true });

        const { report, files } = await renderAISongInPage(page, songJson, args);
        const out = resolve(args.out);
        mkdirSync(out, { recursive: true });
        for (const file of files) {
            mkdirSync(dirname(join(out, file.path)), { recursive: true });
            writeFileSync(join(out, file.path), file.bytes);
        }
        writeFileSync(join(out, 'report.json'), `${JSON.stringify({ song: args.song, ...report }, null, 2)}\n`);
        console.log(summarize(report, args.out));
        return report.exitCode;
    } catch (error) {
        console.error(`ai-song:render: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        return EXIT.usage;
    } finally {
        await browser.close();
        server?.kill();
    }
}

process.exit(await main());
