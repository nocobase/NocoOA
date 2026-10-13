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
const state = (status) => ({ appId, releaseId: release.id, status });

test('waits through deploying and verifies the current running deployment', async () => {
  const responses = [
    uploaded,
    state('deploying'),
    state('succeeded'),
    {
      app: { currentDeploymentId: 'deployment-1' },
      runtime: { state: 'running' },
    },
  ];
  let waits = 0;
  const result = await deployAndWait({
    appId,
    sha,
    cli: async () => responses.shift(),
    wait: async () => waits++,
  });
  assert.equal(result.status, 'succeeded');
  assert.equal(waits, 1);
});

test('an accepted upload followed by startup failure fails CI', async () => {
  const responses = [uploaded, state('failed')];
  await assert.rejects(
    deployAndWait({ appId, sha, cli: async () => responses.shift() }),
    /ended with status failed/,
  );
});

test('a protected environment reports pending approval without claiming deployment', async () => {
  const pending = {
    ...uploaded,
    deployed: { appId, releaseId: release.id, request: { status: 'pending' } },
  };
  const result = await deployAndWait({ appId, sha, cli: async () => pending });
  assert.equal(result.status, 'pending');
  assert.equal(result.deploymentId, undefined);
});

test('rejects a deployment that is no longer the current running release', async () => {
  const responses = [
    uploaded,
    state('succeeded'),
    {
      app: { currentDeploymentId: 'different' },
      runtime: { state: 'running' },
    },
  ];
  await assert.rejects(
    deployAndWait({ appId, sha, cli: async () => responses.shift() }),
    /not current/,
  );
});

test('times out an indefinitely queued deployment', async () => {
  let time = 0;
  let calls = 0;
  await assert.rejects(
    deployAndWait({
      appId,
      sha,
      cli: async () => (calls++ === 0 ? uploaded : state('queued')),
      now: () => time,
      wait: async () => {
        time += 10000;
      },
      timeout: 10000,
    }),
    /timed out/,
  );
});
