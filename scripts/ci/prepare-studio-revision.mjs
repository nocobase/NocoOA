import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

assert(
  /^[a-f0-9]{40}$/.test(process.env.STUDIO_SOURCE_SHA ?? ''),
  'Expected a full commit hash.',
);
mkdirSync('public', { recursive: true });
writeFileSync(
  'public/studio-revision.json',
  JSON.stringify({ sha: process.env.STUDIO_SOURCE_SHA }),
);
