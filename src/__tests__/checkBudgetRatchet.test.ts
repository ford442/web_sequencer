/**
 * scripts/check-budget-ratchet.mjs: a dist-budget.json row may only be raised
 * in a PR that changes nothing but dist-budget.json (+ docs/). The pure
 * functions are covered directly; the CLI is run against throwaway git repos
 * (no network: `origin/main` is a local ref).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { checkBudgetRatchet, diffBudgets, numericLeaves } from '../../scripts/check-budget-ratchet.mjs';

const SCRIPT = resolve(__dirname, '../../scripts/check-budget-ratchet.mjs');

const baseBudget = {
    _comment: 'c',
    _procedure: 'p',
    entryChunkMaxBytes: 1000,
    assetsDirMaxBytes: 4000,
    assetsDirExcludeExtensions: ['.wasm'],
    compressed: { _comment: 'cc', assetsDirMaxBytes: 2000, entryChunkMaxBytes: 300 },
    native: { _comment: 'nc', 'hyphon_native.wasm': 500 },
};
interface BudgetShape {
    [key: string]: unknown;
    entryChunkMaxBytes: number;
    assetsDirMaxBytes: number;
    assetsDirExcludeExtensions: string[];
    compressed: Record<string, string | number>;
    native: Record<string, string | number>;
}
const clone = () => JSON.parse(JSON.stringify(baseBudget)) as BudgetShape;

describe('numericLeaves', () => {
    it('flattens to dotted paths, skipping _keys and arrays', () => {
        expect([...numericLeaves(baseBudget)]).toEqual([
            ['entryChunkMaxBytes', 1000],
            ['assetsDirMaxBytes', 4000],
            ['compressed.assetsDirMaxBytes', 2000],
            ['compressed.entryChunkMaxBytes', 300],
            ['native.hyphon_native.wasm', 500],
        ]);
    });
});

describe('checkBudgetRatchet', () => {
    it('fails a raise alongside a source change, naming row, old, new and the rule', () => {
        const head = clone();
        head.entryChunkMaxBytes = 1100;
        const { ok, failures } = checkBudgetRatchet({ base: baseBudget, head, changedPaths: ['dist-budget.json', 'src/x.ts'] });
        expect(ok).toBe(false);
        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain('entryChunkMaxBytes');
        expect(failures[0]).toContain('1,000 -> 1,100');
        expect(failures[0]).toContain('src/x.ts');
        expect(failures[0]).toContain('nothing but dist-budget.json');
    });

    it('passes a raise on its own, and with docs/', () => {
        const head = clone();
        head.entryChunkMaxBytes = 1100;
        expect(checkBudgetRatchet({ base: baseBudget, head, changedPaths: ['dist-budget.json'] }).ok).toBe(true);
        expect(
            checkBudgetRatchet({ base: baseBudget, head, changedPaths: ['dist-budget.json', 'docs/PERFORMANCE_BUDGET.md'] }).ok,
        ).toBe(true);
    });

    it('passes a lower alongside a source change', () => {
        const head = clone();
        head.assetsDirMaxBytes = 3000;
        expect(checkBudgetRatchet({ base: baseBudget, head, changedPaths: ['dist-budget.json', 'src/x.ts'] }).ok).toBe(true);
    });

    it('detects raises under compressed.* and native.*', () => {
        const head = clone();
        head.compressed.assetsDirMaxBytes = 2100;
        head.native['hyphon_native.wasm'] = 600;
        const { failures } = checkBudgetRatchet({ base: baseBudget, head, changedPaths: ['src/x.ts'] });
        expect(failures).toHaveLength(2);
        expect(failures.join('\n')).toContain('compressed.assetsDirMaxBytes raised 2,000 -> 2,100');
        expect(failures.join('\n')).toContain('native.hyphon_native.wasm raised 500 -> 600');
    });

    it('treats the root and compressed assetsDirMaxBytes as distinct rows', () => {
        const head = clone();
        head.assetsDirMaxBytes = 3000; // lowered
        head.compressed.assetsDirMaxBytes = 2500; // raised
        const { raised, lowered } = diffBudgets(baseBudget, head);
        expect(raised.map((r) => r.key)).toEqual(['compressed.assetsDirMaxBytes']);
        expect(lowered.map((r) => r.key)).toEqual(['assetsDirMaxBytes']);
        expect(checkBudgetRatchet({ base: baseBudget, head, changedPaths: ['src/x.ts'] }).ok).toBe(false);
    });

    it('ignores _comment, _procedure and assetsDirExcludeExtensions edits', () => {
        const head = clone();
        head._comment = 'changed';
        head._procedure = 'changed';
        head.compressed._comment = 'changed';
        head.assetsDirExcludeExtensions = ['.wasm', '.map'];
        const diff = diffBudgets(baseBudget, head);
        expect(diff).toEqual({ raised: [], lowered: [], added: [], removed: [] });
        expect(checkBudgetRatchet({ base: baseBudget, head, changedPaths: ['src/x.ts'] }).ok).toBe(true);
    });

    it('passes an added numeric row, fails a removed one next to a source change', () => {
        const added = clone();
        added.native['new.wasm'] = 99;
        expect(checkBudgetRatchet({ base: baseBudget, head: added, changedPaths: ['src/x.ts'] }).ok).toBe(true);

        const removed = clone();
        delete removed.native['hyphon_native.wasm'];
        const res = checkBudgetRatchet({ base: baseBudget, head: removed, changedPaths: ['src/x.ts'] });
        expect(res.ok).toBe(false);
        expect(res.failures[0]).toContain('native.hyphon_native.wasm removed (was 500)');
        expect(checkBudgetRatchet({ base: baseBudget, head: removed, changedPaths: ['dist-budget.json'] }).ok).toBe(true);
    });

    it('catches a row turned into a non-number as a removal', () => {
        const head = clone();
        head.entryChunkMaxBytes = '9999999' as unknown as number;
        expect(checkBudgetRatchet({ base: baseBudget, head, changedPaths: ['src/x.ts'] }).ok).toBe(false);
    });

    it('passes when the base has no budget file (everything is an addition)', () => {
        expect(checkBudgetRatchet({ base: null, head: baseBudget, changedPaths: ['src/x.ts'] }).ok).toBe(true);
        expect(checkBudgetRatchet({ base: {}, head: baseBudget, changedPaths: ['src/x.ts'] }).ok).toBe(true);
    });

    it('does not mistake a path that merely starts like an allowed one for docs', () => {
        const head = clone();
        head.entryChunkMaxBytes = 1100;
        expect(checkBudgetRatchet({ base: baseBudget, head, changedPaths: ['docs-extra/x.md'] }).ok).toBe(false);
        expect(checkBudgetRatchet({ base: baseBudget, head, changedPaths: ['dist-budget.json.bak'] }).ok).toBe(false);
    });
});

describe('CLI (throwaway git repos)', () => {
    const dirs: string[] = [];
    afterEach(() => {
        for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    });

    function git(cwd: string, ...args: string[]) {
        const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
        if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
        return r.stdout;
    }
    function write(cwd: string, rel: string, content: string) {
        mkdirSync(dirname(join(cwd, rel)), { recursive: true });
        writeFileSync(join(cwd, rel), content);
    }
    /** main has the budget; `origin/main` is a local ref at that commit; HEAD is a feature branch. */
    function makeRepo() {
        const cwd = mkdtempSync(join(tmpdir(), 'budget-ratchet-'));
        dirs.push(cwd);
        git(cwd, 'init', '-q', '-b', 'main');
        git(cwd, 'config', 'user.email', 't@example.com');
        git(cwd, 'config', 'user.name', 't');
        git(cwd, 'config', 'commit.gpgsign', 'false');
        write(cwd, 'dist-budget.json', JSON.stringify(baseBudget, null, 2));
        write(cwd, 'src/x.ts', 'export const x = 1\n');
        git(cwd, 'add', '-A');
        git(cwd, 'commit', '-q', '-m', 'base');
        git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
        git(cwd, 'checkout', '-q', '-b', 'feature');
        return cwd;
    }
    function commit(cwd: string, edits: Record<string, string>) {
        for (const [rel, content] of Object.entries(edits)) write(cwd, rel, content);
        git(cwd, 'add', '-A');
        git(cwd, 'commit', '-q', '-m', 'change');
    }
    const raised = JSON.stringify({ ...baseBudget, entryChunkMaxBytes: 1100 }, null, 2);
    const lowered = JSON.stringify({ ...baseBudget, entryChunkMaxBytes: 900 }, null, 2);

    function run(cwd: string, env: Record<string, string> = {}) {
        const clean = { ...process.env } as Record<string, string | undefined>;
        delete clean.GITHUB_EVENT_NAME;
        delete clean.GITHUB_BASE_REF;
        const r = spawnSync('node', [SCRIPT], { cwd, encoding: 'utf8', env: { ...clean, ...env } });
        return { status: r.status, out: r.stdout, err: r.stderr };
    }
    const PR = { GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main' };

    it('fails a raise bundled with a source change and names the row', () => {
        const cwd = makeRepo();
        commit(cwd, { 'dist-budget.json': raised, 'src/x.ts': 'export const x = 2\n' });
        const r = run(cwd, PR);
        expect(r.status).toBe(1);
        expect(r.err).toContain('entryChunkMaxBytes raised 1,000 -> 1,100');
        expect(r.err).toContain('src/x.ts');
    });

    it('fails when the raise and the source change are in separate commits of the same PR', () => {
        const cwd = makeRepo();
        commit(cwd, { 'dist-budget.json': raised });
        commit(cwd, { 'src/x.ts': 'export const x = 2\n' });
        expect(run(cwd, PR).status).toBe(1);
    });

    it('passes a raise on its own, and with docs/', () => {
        const cwd = makeRepo();
        commit(cwd, { 'dist-budget.json': raised, 'docs/PERFORMANCE_BUDGET.md': '# x\n' });
        const r = run(cwd, PR);
        expect(r.status).toBe(0);
        expect(r.out).toContain('raised  entryChunkMaxBytes 1,000 -> 1,100');
    });

    it('passes a lower alongside a source change', () => {
        const cwd = makeRepo();
        commit(cwd, { 'dist-budget.json': lowered, 'src/x.ts': 'export const x = 2\n' });
        expect(run(cwd, PR).status).toBe(0);
    });

    it('sees a source file renamed into docs/ (renames are not collapsed)', () => {
        const cwd = makeRepo();
        mkdirSync(join(cwd, 'docs'));
        git(cwd, 'mv', 'src/x.ts', 'docs/x.ts');
        commit(cwd, { 'dist-budget.json': raised });
        expect(run(cwd, PR).status).toBe(1);
    });

    it('fails closed on a pull_request when the base ref is missing', () => {
        const cwd = makeRepo();
        git(cwd, 'update-ref', '-d', 'refs/remotes/origin/main');
        const r = run(cwd, PR);
        expect(r.status).toBe(1);
        expect(r.err).toContain('cannot resolve the PR base');
    });

    it('skips loudly, exit 0, off a pull_request with no base ref', () => {
        const cwd = makeRepo();
        git(cwd, 'update-ref', '-d', 'refs/remotes/origin/main');
        const r = run(cwd);
        expect(r.status).toBe(0);
        expect(r.out).toContain('skipped');
    });

    it('fails closed when HEAD has an unreadable budget', () => {
        const cwd = makeRepo();
        commit(cwd, { 'dist-budget.json': '{ not json' });
        expect(run(cwd, PR).status).toBe(1);
    });
});
