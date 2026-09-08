/**
 * Regression test for the pnpm/action-setup vs packageManager collision gate.
 *
 * Runs the real script against temp fixtures so the live tree is never mutated.
 */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const SCRIPT = join(ROOT, 'scripts', 'check-pnpm-action-setup.mjs');

interface RunResult {
  status: number;
  output: string;
}

function runCheck(fixtureRoot: string): RunResult {
  try {
    const output = execFileSync('node', [SCRIPT, '--root', fixtureRoot], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    };
  }
}

function writeFixture(opts: { packageManager?: string; pinVersion?: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), 'check-pnpm-action-setup-'));
  const pkg: Record<string, string> = { name: 'fixture' };
  if (opts.packageManager) pkg.packageManager = opts.packageManager;
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);

  const workflows = join(dir, '.github', 'workflows');
  mkdirSync(workflows, { recursive: true });
  const versionBlock = opts.pinVersion
    ? `        with:\n          version: 9\n`
    : '';
  writeFileSync(
    join(workflows, 'ci.yml'),
    `jobs:\n  build:\n    steps:\n      - uses: pnpm/action-setup@v4\n${versionBlock}      - uses: actions/setup-node@v4\n`,
  );
  return dir;
}

describe('check-pnpm-action-setup collision gate', () => {
  it('fails when packageManager and a workflow version pin are both present', () => {
    const fixture = writeFixture({ packageManager: 'pnpm@12.3.4', pinVersion: true });
    const result = runCheck(fixture);
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/collision/i);
    expect(result.output).toContain('.github/workflows/ci.yml');
  });

  it('passes when workflows pin version but package.json has no packageManager', () => {
    const fixture = writeFixture({ pinVersion: true });
    const result = runCheck(fixture);
    expect(result.status).toBe(0);
    expect(result.output).toContain('OK');
  });

  it('passes when packageManager is set and workflows do not pin version', () => {
    const fixture = writeFixture({ packageManager: 'pnpm@12.3.4', pinVersion: false });
    const result = runCheck(fixture);
    expect(result.status).toBe(0);
    expect(result.output).toContain('OK');
  });
});
