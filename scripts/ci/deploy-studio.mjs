import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const execute = promisify(execFile);
async function studio(args) {
  let stdout;
  try {
    ({ stdout } = await execute('nb-studio', [...args, '--json'], {
      timeout: 180000,
      maxBuffer: 4 * 1024 * 1024,
    }));
  } catch {
    // Upload responses may contain tickets; do not expose raw child-process errors.
    throw new Error('Studio command failed; inspect the deployment in Studio.');
  }
  let response;
  try {
    response = JSON.parse(stdout);
  } catch {
    throw new Error('Studio returned invalid JSON.');
  }
  assert(response.ok === true, 'Studio command did not succeed.');
  return response.result.data;
}

export async function deployAndWait({
  appId,
  sha,
  cli = studio,
  wait = sleep,
  now = Date.now,
  timeout = 600000,
}) {
  const uploaded = await cli([
    'deploy',
    '--app',
    appId,
    '--sha',
    sha,
    '--file',
    'storage/exports/dist.tar.gz',
  ]);
  assert.equal(uploaded.superseded, false, 'Build was superseded.');
  assert.equal(
    uploaded.release?.sourceCommit,
    sha,
    'Uploaded source commit mismatch.',
  );
  assert.equal(uploaded.release?.appId, appId, 'Uploaded App mismatch.');
  const outcome = uploaded.deployed;
  assert.equal(outcome?.appId, appId, 'Deployment App mismatch.');
  assert.equal(
    outcome.releaseId,
    uploaded.release.id,
    'Deployment release mismatch.',
  );
  if (outcome.request) {
    assert.equal(outcome.request.status, 'pending');
    return { status: 'pending', appId, releaseId: uploaded.release.id };
  }
  const deploymentId = outcome.deployment?.id;
  assert(deploymentId, 'Studio returned no deployment ID.');
  const deadline = now() + timeout;
  while (now() < deadline) {
    const deployment = await cli(['deploy', 'get', appId, deploymentId]);
    assert.equal(deployment.appId, appId, 'Wrong deployment App.');
    assert.equal(
      deployment.releaseId,
      uploaded.release.id,
      'Wrong deployed release.',
    );
    if (deployment.status === 'succeeded') {
      const current = await cli(['app', 'get', appId]);
      assert.equal(
        current.app?.currentDeploymentId,
        deploymentId,
        'Deployment is not current.',
      );
      assert.equal(current.runtime?.state, 'running', 'App is not running.');
      return {
        status: 'succeeded',
        appId,
        releaseId: uploaded.release.id,
        deploymentId,
      };
    }
    assert(
      ['queued', 'deploying'].includes(deployment.status),
      `Studio deployment ${deploymentId} ended with status ${deployment.status}; inspect Studio logs.`,
    );
    await wait(10000);
  }
  throw new Error(
    `Studio deployment ${deploymentId} timed out; inspect Studio before retrying.`,
  );
}

async function main() {
  try {
    const result = await deployAndWait({
      appId: process.env.APP_ID,
      sha: process.env.STUDIO_SOURCE_SHA,
    });
    const summary =
      result.status === 'pending'
        ? `Studio approval pending for ${result.appId}; the release is not deployed.\n`
        : `Studio deployment succeeded for ${result.appId}; deployment ${result.deploymentId}.\n`;
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
