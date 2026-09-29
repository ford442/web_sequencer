/**
 * Regression test for the `check:root` hygiene gate.
 *
 * The gate is only useful if it actually fails when clutter reappears, so this
 * runs the real script in a child process: once against the clean tree, and
 * once with a merge artifact planted (removed again in `finally`, including on
 * assertion failure).
 */

import { describe, expect, it, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const SCRIPT = join(ROOT, 'scripts', 'check-root.mjs');

interface RunResult {
    status: number;
    output: string;
}

function runCheckRoot(): RunResult {
    try {
        const output = execFileSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
        return { status: 0, output };
    } catch (error) {
        const failure = error as { status?: number; stdout?: string; stderr?: string };
        return {
            status: failure.status ?? 1,
            output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
        };
    }
}

const PLANTED: string[] = [];

function plant(relativePath: string): void {
    const full = join(ROOT, relativePath);
    writeFileSync(full, '<<<<<<< HEAD\n');
    PLANTED.push(full);
}

function plantDir(relativePath: string): void {
    const full = join(ROOT, relativePath);
    mkdirSync(full, { recursive: true });
    PLANTED.push(full);
}

afterEach(() => {
    while (PLANTED.length > 0) {
        const full = PLANTED.pop()!;
        if (existsSync(full)) rmSync(full, { recursive: true });
    }
});

describe('check:root hygiene gate', () => {
    it('passes on the current tree', () => {
        const result = runCheckRoot();
        expect(result.output).toContain('check:root OK');
        expect(result.status).toBe(0);
    });

    it('fails when a *.orig merge artifact reappears', () => {
        plant('src/__checkroot_fixture__.orig');
        const result = runCheckRoot();
        expect(result.status).not.toBe(0);
        expect(result.output).toMatch(/Merge artifact left in tree/);
        expect(result.output).toContain('__checkroot_fixture__.orig');
    });

    it('fails for *.rej too, and anywhere in the tree, not just the root', () => {
        plant('src/hooks/__checkroot_fixture__.rej');
        const result = runCheckRoot();
        expect(result.status).not.toBe(0);
        expect(result.output).toMatch(/Merge artifact left in tree/);
    });

    it('reports every artifact at once rather than stopping at the first', () => {
        plant('src/__checkroot_fixture_a__.orig');
        plant('src/audio/__checkroot_fixture_b__.rej');
        const result = runCheckRoot();
        expect(result.output).toContain('__checkroot_fixture_a__.orig');
        expect(result.output).toContain('__checkroot_fixture_b__.rej');
    });

    it('ignores artifacts inside dependency and build directories', () => {
        // node_modules is not ours to police, and scanning it would be slow.
        const nodeModules = join(ROOT, 'node_modules');
        if (!existsSync(nodeModules)) return;
        plant('node_modules/__checkroot_fixture__.orig');
        expect(runCheckRoot().status).toBe(0);
    });

    it('fails when an unlisted file appears at the repo root', () => {
        plant('__checkroot_fixture_root__.tmp');
        const result = runCheckRoot();
        expect(result.status).not.toBe(0);
        expect(result.output).toMatch(/Unexpected root file/);
        expect(result.output).toContain('__checkroot_fixture_root__.tmp');
    });

    it('fails when an unlisted directory appears at the repo root', () => {
        plantDir('__checkroot_fixture_dir__');
        const result = runCheckRoot();
        expect(result.status).not.toBe(0);
        expect(result.output).toMatch(/Unexpected root directory/);
        expect(result.output).toContain('__checkroot_fixture_dir__');
    });

    it('does not flag unlisted files or directories nested below the root', () => {
        plant('src/__checkroot_fixture_nested__.tmp');
        plantDir('src/__checkroot_fixture_nested_dir__');
        expect(runCheckRoot().status).toBe(0);
    });

    it('does not flag gitignored root entries (e.g. an npm package-lock.json or *.log)', () => {
        // `*.log` is in .gitignore — it can never be committed, so it is not clutter.
        plant('__checkroot_fixture_ignored__.log');
        const result = runCheckRoot();
        expect(result.output).not.toContain('__checkroot_fixture_ignored__.log');
        expect(result.status).toBe(0);
    });
});
