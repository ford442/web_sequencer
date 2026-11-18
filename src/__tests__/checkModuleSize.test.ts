/**
 * Regression test for the `check:module-size` gate.
 *
 * Runs the real script in a child process: once against the clean tree, and
 * with an oversized file planted under src/ (removed again in `afterEach`,
 * including on assertion failure) — undocumented, mentioned only in prose of a
 * fixture budget doc, and listed as a row of that doc's exception table with a
 * recorded size that is equal, smaller (it grew) or larger (it shrank).
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

function plantOversizedFile(relativePath: string, length = 701): void {
    const full = join(ROOT, relativePath);
    const lines = Array.from({ length }, (_, i) => `// line ${i}`).join('\n');
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

    it('exempts a file listed as a row of the "Modules over budget" table at its recorded size', () => {
        const doc = writeBudgetDoc(withRow(`| 701 | \`${FIXTURE}\` | test fixture |`));
        plantOversizedFile(FIXTURE);
        const result = runCheckModuleSize(['--budget-doc', doc]);
        expect(result.status).toBe(0);
        expect(result.output).toContain('check-module-size: OK');
    });

    it('fails when a listed file grows past its recorded size', () => {
        const doc = writeBudgetDoc(withRow(`| 701 | \`${FIXTURE}\` | test fixture |`));
        plantOversizedFile(FIXTURE, 705);
        const result = runCheckModuleSize(['--budget-doc', doc]);
        expect(result.status).not.toBe(0);
        expect(result.output).toContain('grew past the size recorded');
        expect(result.output).toMatch(/701 ->\s+705\s+src\/__checkmodulesize_fixture__\.ts/);
    });

    it('fails when a listed file shrank but its row was not lowered', () => {
        const doc = writeBudgetDoc(withRow(`| 800 | \`${FIXTURE}\` | test fixture |`));
        plantOversizedFile(FIXTURE, 750);
        const result = runCheckModuleSize(['--budget-doc', doc]);
        expect(result.status).not.toBe(0);
        expect(result.output).toContain('lock in the gain');
    });

    it('--update lowers a shrunk row and drops a row back within budget, then passes', () => {
        const SECOND = 'src/__checkmodulesize_fixture_small__.ts';
        const doc = writeBudgetDoc(
            withRow(`| 800 | \`${FIXTURE}\` | test fixture |\n| 720 | \`${SECOND}\` | small fixture |`),
        );
        plantOversizedFile(FIXTURE, 750);
        plantOversizedFile(SECOND, 650);
        const updated = runCheckModuleSize(['--budget-doc', doc, '--update']);
        expect(updated.status).toBe(0);
        const text = readFileSync(doc, 'utf8');
        expect(text).toContain(`| 750 | \`${FIXTURE}\` | test fixture |`);
        expect(text).not.toContain(SECOND);
        expect(runCheckModuleSize(['--budget-doc', doc]).status).toBe(0);
    });

    it('--update refuses to raise a recorded size', () => {
        const doc = writeBudgetDoc(withRow(`| 701 | \`${FIXTURE}\` | test fixture |`));
        const before = readFileSync(doc, 'utf8');
        plantOversizedFile(FIXTURE, 710);
        const result = runCheckModuleSize(['--budget-doc', doc, '--update']);
        expect(result.status).not.toBe(0);
        expect(result.output).toContain('refusing to update');
        expect(readFileSync(doc, 'utf8')).toBe(before);
    });

    it('--update never adds a row for an unlisted file', () => {
        const doc = writeBudgetDoc(readFileSync(BUDGET_DOC, 'utf8'));
        plantOversizedFile(FIXTURE);
        const result = runCheckModuleSize(['--budget-doc', doc, '--update']);
        expect(result.status).not.toBe(0);
        expect(readFileSync(doc, 'utf8')).not.toContain(FIXTURE);
    });

    it('records every listed row with a line count that matches the tree', () => {
        // The clean-tree pass above already proves no row is stale; this pins
        // that the table is not empty, so the ratchet has something to hold.
        const real = readFileSync(BUDGET_DOC, 'utf8');
        const section = real.slice(real.indexOf('## Modules over budget'));
        const rows = section.split('\n').filter((line) => /^\|\s*\d+\s*\|\s*`src\//.test(line));
        expect(rows.length).toBeGreaterThan(0);
    });
});

/** The real budget doc with `rows` inserted as the first rows of the exception table. */
function withRow(rows: string): string {
    const real = readFileSync(BUDGET_DOC, 'utf8');
    const separator = real.indexOf('\n|---', real.indexOf('## Modules over budget'));
    expect(separator).toBeGreaterThan(-1);
    const rowAt = real.indexOf('\n', separator + 1);
    return `${real.slice(0, rowAt)}\n${rows}${real.slice(rowAt)}`;
}
