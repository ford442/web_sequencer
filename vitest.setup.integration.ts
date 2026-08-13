/**
 * Integration test setup — artifact preflight and local fixture fetch allowlist.
 */

import './vitest.setup.ts';
import { beforeAll } from 'vitest';
import { allowFetch } from './vitest.setup.unit';
import { requireRepoArtifacts } from './src/test/helpers/requireRepoArtifacts';

beforeAll(() => {
  requireRepoArtifacts();
  // Allow fetch to local fixture origins only (static assets under public/).
  allowFetch(/^https?:\/\/127\.0\.0\.1/);
  allowFetch(/^https?:\/\/localhost/);
  allowFetch(/^file:\/\//);
});
