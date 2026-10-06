/**
 * Regression test for the `check:module-size` gate.
 *
 * Runs the real script in a child process: once against the clean tree, and
 * with an oversized file planted under src/ (removed again in `afterEach`,
 * including on assertion failure) — undocumented, mentioned only in prose of a
 * fixture budget doc, and listed as a row of that doc's exception table.
 */

import { describe, expect, it, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const SCRIPT = join(ROOT, 'scripts', 'check-module-size.mjs');
const BUDGET_DOC = join(ROOT, 'docs', 'refactoring', 'module-size-budget.md');

interface RunResult {
    status: number;
    output: string;
}

function runCheckModuleSize(args: string[] = []): RunResult {
    try {
        const output = execFileSync('node', [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });
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

const TEMP_DIRS: string[] = [];

/** Writes a budget doc outside the repo and returns its path. */
function writeBudgetDoc(markdown: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'check-module-size-'));
    TEMP_DIRS.push(dir);
    const doc = join(dir, 'module-size-budget.md');
    writeFileSync(doc, markdown);
    return doc;
}

const FIXTURE = 'src/__checkmodulesize_fixture__.ts';

afterEach(() => {
    while (PLANTED.length > 0) {
        const full = PLANTED.pop()!;
        if (existsSync(full)) rmSync(full);
    }
    while (TEMP_DIRS.length > 0) {
        rmSync(TEMP_DIRS.pop()!, { recursive: true, force: true });
    }
});

describe('check:module-size gate', () => {
    it('passes on the current tree', () => {
        const result = runCheckModuleSize();
        expect(result.status).toBe(0);
        expect(result.output).toContain('check-module-size: OK');
    });

    it('fails when a new, undocumented file exceeds the 700-line budget', () => {
        plantOversizedFile(FIXTURE);
        const result = runCheckModuleSize();
        expect(result.status).not.toBe(0);
        expect(result.output).toContain('__checkmodulesize_fixture__.ts');
    });

    // #1303: the budget doc said "`src/types.ts` is resolved" in prose, and the
    // old substring match treated that as an exemption — so the 749-line
    // resurrected monolith sailed through the gate.
    it('does not exempt a file that is only mentioned in prose', () => {
        const doc = writeBudgetDoc(
            [
                readFileSync(BUDGET_DOC, 'utf8'),
                '',
                `\`${FIXTURE}\` is **resolved**: it is now a small barrel.`,
                '',
                '## Other notes',
                '',
                '| Lines | Module | Status |',
                '|-------|--------|--------|',
                `| 701 | \`${FIXTURE}\` | a table outside "Modules over budget" does not count |`,
            ].join('\n'),
        );
        plantOversizedFile(FIXTURE);
        const result = runCheckModuleSize(['--budget-doc', doc]);
        expect(result.status).not.toBe(0);
        expect(result.output).toContain('1 file(s) exceed');
        expect(result.output).toContain('__checkmodulesize_fixture__.ts');
    });

    it('exempts a file listed as a row of the "Modules over budget" table', () => {
        const real = readFileSync(BUDGET_DOC, 'utf8');
        const separator = real.indexOf('\n|---', real.indexOf('## Modules over budget'));
        expect(separator).toBeGreaterThan(-1);
        const rowAt = real.indexOf('\n', separator + 1);
        const doc = writeBudgetDoc(
            `${real.slice(0, rowAt)}\n| 701 | \`${FIXTURE}\` | test fixture |${real.slice(rowAt)}`,
        );
        plantOversizedFile(FIXTURE);
        const result = runCheckModuleSize(['--budget-doc', doc]);
        expect(result.status).toBe(0);
        expect(result.output).toContain('check-module-size: OK');
    });

    it('does not fail the historical inventory already listed in the budget doc', () => {
        // src/hooks/useAppState.tsx is over budget today but is recorded in
        // docs/refactoring/module-size-budget.md, so it must not appear as a
        // fresh violation.
        const result = runCheckModuleSize();
        expect(result.output).not.toContain('useAppState.tsx');
    });
});
