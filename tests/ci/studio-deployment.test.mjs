import assert from 'node:assert/strict';
import test from 'node:test';
import { deployAndWait } from '../../scripts/ci/deploy-studio.mjs';

const appId = 'nocooa-pr-1';
const sha = 'a'.repeat(40);
const release = { id: 'release-1', appId, sourceCommit: sha };
const uploaded = {
  superseded: false,
  release,
  deployed: {
    appId,
    releaseId: release.id,
    deployment: { id: 'deployment-1' },
  },
};
const defaults = {
  appId,
  sha,
  server: 'https://studio.example/main',
  cli: async () => uploaded,
};
const health = { ok: true, app: { name: appId } };

test('waits for the exact published commit and a healthy App without management read permissions', async () => {
  let checks = 0;
  let waits = 0;
  const result = await deployAndWait({
    ...defaults,
    readJson: async (url) =>
      url.pathname.endsWith('studio-revision.json')
        ? { sha: checks++ === 0 ? 'old' : sha }
        : health,
    wait: async () => waits++,
  });
  assert.equal(result.status, 'succeeded');
  assert.equal(waits, 1);
});

test('an accepted upload with failing startup times out and fails CI', async () => {
  let time = 0;
  await assert.rejects(
    deployAndWait({
      ...defaults,
      readJson: async () => {
        throw new Error('HTTP 503');
      },
      now: () => time,
      wait: async () => {
        time += 10000;
      },
      timeout: 10000,
    }),
    /timed out/,
  );
});

test('pending approval does not claim the release is running', async () => {
  const pending = {
    ...uploaded,
    deployed: { appId, releaseId: release.id, request: { status: 'pending' } },
  };
  const result = await deployAndWait({ ...defaults, cli: async () => pending });
  assert.equal(result.status, 'pending');
});

test('a healthy older release never satisfies the new deployment check', async () => {
  let time = 0;
  await assert.rejects(
    deployAndWait({
      ...defaults,
      readJson: async (url) =>
        url.pathname.endsWith('studio-revision.json') ? { sha: 'old' } : health,
      now: () => time,
      wait: async () => {
        time += 10000;
      },
      timeout: 10000,
    }),
    /timed out/,
  );
});

test('rejects upload results naming another App', async () => {
  await assert.rejects(
    deployAndWait({
      ...defaults,
      cli: async () => ({
        ...uploaded,
        release: { ...release, appId: 'other' },
      }),
    }),
    /App mismatch/,
  );
});
