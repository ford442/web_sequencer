import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

/**
 * A private `vite preview` of dist/ that a spec can start and then KILL.
 *
 * Offline specs need the network to be genuinely gone. `context.setOffline(true)`
 * is not enough: it does not reliably reach fetch() calls issued from a service
 * worker's own thread, so a worker that is broken offline can still pass because
 * it quietly reaches the live server (#1659: that is how the original skipped
 * test misled three CI attempts). Stopping the server this page was loaded from
 * is unambiguous.
 *
 * COOP/COEP come from vite.config.ts `preview.headers`, exactly as for the
 * shared webServer on :5173.
 */
export interface EphemeralPreview {
  /** `http://127.0.0.1:<port>` (no trailing slash). */
  url: string;
  /** Kills the server and resolves once its port refuses connections. */
  stop: () => Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

async function answers(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    await res.arrayBuffer();
    return res.ok;
  } catch {
    return false;
  }
}

export async function startEphemeralPreview(fixedPort?: number): Promise<EphemeralPreview> {
  const port = fixedPort ?? (await freePort());
  const url = `http://127.0.0.1:${port}`;
  const viteBin = path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
  // Own process group, so the kill takes any helper the CLI forks with it.
  const child: ChildProcess = spawn(
    process.execPath,
    [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: process.cwd(), stdio: 'ignore', detached: true },
  );
  const killGroup = () => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  };
  process.once('exit', killGroup);

  const deadline = Date.now() + 60_000;
  while (!(await answers(`${url}/`))) {
    if (Date.now() > deadline || child.exitCode !== null) {
      killGroup();
      throw new Error(`ephemeral vite preview did not start on ${url} (is dist/ built? run pnpm run build:web)`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  return {
    url,
    stop: async () => {
      killGroup();
      const gone = Date.now() + 10_000;
      while (await answers(`${url}/`)) {
        if (Date.now() > gone) throw new Error(`ephemeral preview on ${url} still answers after SIGKILL`);
        await new Promise((r) => setTimeout(r, 100));
      }
    },
  };
}
