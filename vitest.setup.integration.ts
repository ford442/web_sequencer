/**
 * Integration test setup — artifact preflight and local fixture fetch allowlist.
 */

import './vitest.setup.ts';
import { beforeAll } from 'vitest';
import { allowFetch } from './vitest.setup.unit';
import { requireRepoArtifacts } from './src/test/helpers/requireRepoArtifacts';

// Fail closed: binary-dependent handshake tests in hyphonNativeImports.test.ts
// must not skip when this tier runs. Set before test files are imported.
process.env.HYPHON_REQUIRE_NATIVE ??= '1';

beforeAll(() => {
  requireRepoArtifacts();
  // Allow fetch to local fixture origins only (static assets under public/).
  allowFetch(/^https?:\/\/127\.0\.0\.1/);
  allowFetch(/^https?:\/\/localhost/);
  allowFetch(/^file:\/\//);
});
