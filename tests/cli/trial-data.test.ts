// @vitest-environment node
import { bindAppCommand, runAppCommand } from '@nocobase/app-testing/cli';
import { expect, it } from 'vitest';
import TrialData from '../../cli/commands/trial-data.ts';

it('previews trial coverage without creating an application or opening the database', async () => {
  const Bound = bindAppCommand(TrialData, {
    rootDir: process.cwd(),
    id: 'app:trial-data',
    loadRuntime: async () => {
      throw new Error('Preview must not load the runtime.');
    },
    createApp: () => {
      throw new Error('Preview must not create the application.');
    },
  });
  const run = await runAppCommand(Bound, ['--dry-run', '--json']);
  expect(run.error).toBeUndefined();
  expect(run.exitCode ?? 0).toBe(0);
  expect(run.json()).toMatchObject({
    ok: true,
    status: 'success-noop',
    result: { dataset: 'oa-trial-v1' },
  });
  expect(run.stdout).not.toContain('password');
});

it.each(['en-US', 'zh-CN'])(
  'previews all trial metadata in %s without starting the application',
  async (locale) => {
    const Bound = bindAppCommand(TrialData, {
      rootDir: process.cwd(),
      id: 'app:trial-data',
      loadRuntime: async () => {
        throw new Error('Must not start a preview runtime.');
      },
      createApp: () => {
        throw new Error('Must not create a preview application.');
      },
    });
    const run = await runAppCommand(Bound, [
      '--dry-run',
      '--locale',
      locale,
      '--json',
    ]);
    expect(run.exitCode ?? 0).toBe(0);
    const result = run.json() as {
      result: {
        accounts: { name: string }[];
        workflows: string[];
        resources: string[];
        excluded: string[];
      };
    };
    const strings = [
      ...result.result.accounts.map((account) => account.name),
      ...result.result.workflows,
      ...result.result.resources,
      ...result.result.excluded,
    ];
    for (const value of strings) {
      if (locale === 'en-US') expect(value).not.toMatch(/\p{Script=Han}/u);
      else expect(value).toMatch(/\p{Script=Han}/u);
    }
  },
);
