/**
 * Regression test for the `check:module-size` gate.
 *
 * Runs the real script in a child process: once against the clean tree, and
 * once with an oversized, undocumented file planted under src/ (removed again
 * in `finally`, including on assertion failure).
 */

import { describe, expect, it, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const SCRIPT = join(ROOT, 'scripts', 'check-module-size.mjs');

interface RunResult {
    status: number;
    output: string;
}

function runCheckModuleSize(): RunResult {
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

function plantOversizedFile(relativePath: string): void {
    const full = join(ROOT, relativePath);
    const lines = Array.from({ length: 701 }, (_, i) => `// line ${i}`).join('\n');
    writeFileSync(full, `${lines}\n`);
    PLANTED.push(full);
}

afterEach(() => {
    while (PLANTED.length > 0) {
        const full = PLANTED.pop()!;
        if (existsSync(full)) rmSync(full);
    }
});

describe('check:module-size gate', () => {
    it('passes on the current tree', () => {
        const result = runCheckModuleSize();
        expect(result.status).toBe(0);
        expect(result.output).toContain('check-module-size: OK');
    });

    it('fails when a new, undocumented file exceeds the 700-line budget', () => {
        plantOversizedFile('src/__checkmodulesize_fixture__.ts');
        const result = runCheckModuleSize();
        expect(result.status).not.toBe(0);
        expect(result.output).toContain('__checkmodulesize_fixture__.ts');
    });

    it('does not fail the historical inventory already listed in the budget doc', () => {
        // src/hooks/useAppState.tsx is over budget today but is recorded in
        // docs/refactoring/module-size-budget.md, so it must not appear as a
        // fresh violation.
        const result = runCheckModuleSize();
        expect(result.output).not.toContain('useAppState.tsx');
    });
});
