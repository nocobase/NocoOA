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
  } catch (error) {
    // Upload responses may contain tickets; expose only a validated error code.
    let code = 'PROCESS_ERROR';
    for (const output of [error.stdout, error.stderr]) {
      try {
        const candidate = JSON.parse(output).error?.code;
        if (
          typeof candidate === 'string' &&
          /^[A-Z0-9_]{1,80}$/.test(candidate)
        )
          code = candidate;
      } catch {
        /* No structured error. */
      }
    }
    throw new Error(
      `Studio ${args[0]} failed (${code}); inspect the deployment in Studio.`,
    );
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
  server,
  readJson = async (url) => {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
      cache: 'no-store',
    });
    assert(response.ok, 'Preview endpoint is not ready.');
    return response.json();
  },
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
  const url = new URL(`/${appId}/`, server);
  const deadline = now() + timeout;
  while (now() < deadline) {
    try {
      const revision = await readJson(new URL('studio-revision.json', url));
      const health = await readJson(new URL('api/healthz', url));
      if (
        revision.sha === sha &&
        health.ok === true &&
        health.app?.name === appId
      )
        return {
          status: 'succeeded',
          appId,
          releaseId: uploaded.release.id,
          deploymentId,
        };
    } catch {
      // A new App returns 404/503 while Studio starts it; retry within the bounded window.
    }
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
      server: process.env.NB_STUDIO_URL,
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
