import { trialContentLocalizationToken } from '../../../../server/providers/trial-data-localization/index.js';
import {
  defaultTrialPasswords,
  resetTrialPasswords,
  type TrialPasswords,
} from './passwords.js';
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  open,
  unlink,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Application } from '@nocobase/app-server/application';
import { populateHeadcountSamples } from './headcounts.js';
import { bootstrap } from './bootstrap.js';
import { databaseManagerToken } from '@nocobase/db';
import { organizationServiceToken } from '../../../../server/providers/org/index.js';
import type { TrialRole } from './accounts.js';
import { trialAccounts, trialEmail, trialUsername } from './accounts.js';
import { trialSession } from './http.js';
import { scenarios, trialWorkflowNames } from './scenarios.js';
import {
  populateScenario,
  setLegacyDutyReplacements,
  type TrialSessions,
  type ScenarioResult,
} from './engine.js';
import { calendarServiceToken } from '../../../../server/providers/platform/index.js';
import { collaboration } from './collaboration.js';
import { followUps } from './follow-ups.js';

export const trialPlan = {
  dataset: 'oa-trial-v1',
  accounts: trialAccounts.map((p) => ({
    username: trialUsername(p.key),
    email: trialEmail(p.key),
    name: p.name,
    duties: p.duties,
  })),
  workflows: trialWorkflowNames,
  resources: [
    '组织／岗位／职级／薪级',
    '职责池',
    '假期余额',
    '年度预算',
    '对口会计',
    '编制',
    '供应商',
    '资产',
    '车辆／司机',
    '印章',
    '会议室／预定',
    '个人日程',
    '考勤',
    '公告／回执',
    '知识库',
    '协同任务',
  ],
  excluded: ['访客／临时门禁：主应用尚未注册，不能生成可用流程'],
};
interface Manifest {
  scenarios: Record<string, ScenarioResult>;
  date?: string;
  legacyDutyReplacements?: Record<string, TrialRole>;
}
export interface TrialDataResult {
  accessFile: string;
  accounts: number;
  scenarios: ScenarioResult[];
  failures: { key: string; reason: string }[];
  excluded: readonly string[];
  headcounts?: Awaited<ReturnType<typeof populateHeadcountSamples>>;
}

export async function generateTrialData(
  app: Application,
  progress: (message: string) => void = () => {},
  options: {
    replaceLegacyTrialDuties?: boolean;
    resetPasswords?: boolean;
    headcountsOnly?: boolean;
  } = {},
): Promise<TrialDataResult> {
  const database = app.config.get('database.connections.main') as Record<
    string,
    unknown
  >;
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        database?.dialect,
        database?.host,
        database?.port,
        database?.database,
        database?.schema,
        database?.filename,
      ]),
    )
    .digest('hex')
    .slice(0, 16);
  const directory = app.paths.storage(`trial-data/${fingerprint}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const accessFile = `${directory}/access.json`;
  const manifestFile = `${directory}/manifest.json`;
  const lockPath = `${directory}/running.lock`;
  const lock = await open(lockPath, 'wx', 0o600).catch(() => {
    throw new Error(
      `Trial generation already running, or an interrupted run left ${lockPath}. Confirm the process has stopped before removing this lock.`,
    );
  });
  try {
    await lock.writeFile(String(process.pid));
    const password = defaultTrialPasswords();
    let access: {
      password?: string;
      accounts: {
        username: string;
        email: string;
        name: string;
        duties: readonly string[];
        password?: string;
        note?: string;
      }[];
    };
    try {
      access = JSON.parse(await readFile(accessFile, 'utf8'));
      if (!options.resetPasswords) {
        for (const role of Object.keys(password) as (keyof TrialPasswords)[]) {
          const stored =
            access.accounts.find((p) => p.username === trialUsername(role))
              ?.password ?? access.password;
          if (!stored && role !== 'newhire')
            throw new Error(`Missing stored trial password for ${role}.`);
          if (stored) password[role] = stored;
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (options.headcountsOnly)
        throw new Error(
          'Existing trial access file is required for headcounts-only.',
          { cause: error },
        );
      access = {
        accounts: trialAccounts.map((p) => ({
          username: trialUsername(p.key),
          email: trialEmail(p.key),
          name: p.name,
          duties: p.duties,
          password: password[p.key],
        })),
      };
      await writeFile(accessFile, JSON.stringify(access, null, 2), {
        mode: 0o600,
        flag: 'wx',
      });
    }
    let manifest: Manifest = { scenarios: {} };
    try {
      manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as Manifest;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (options.headcountsOnly && !manifest.date)
      throw new Error(
        'Existing trial manifest is required for headcounts-only.',
      );
    const save = async () => {
      await writeFile(
        `${manifestFile}.tmp`,
        JSON.stringify(manifest, null, 2),
        { mode: 0o600 },
      );
      await rename(`${manifestFile}.tmp`, manifestFile);
    };
    if (options.headcountsOnly) {
      const headcounts = await populateHeadcountSamples(app);
      return {
        accessFile,
        accounts: trialAccounts.length,
        scenarios: Object.values(manifest.scenarios),
        failures: [],
        excluded: trialPlan.excluded,
        headcounts,
      };
    }
    progress(
      'Initializing fictional identities, roles and business resources.',
    );
    manifest.date ??= app.container
      .resolve(calendarServiceToken)
      .localDate(new Date());
    await save();
    if (options.replaceLegacyTrialDuties) {
      const db = app.container.resolve(databaseManagerToken);
      const org = app.container.resolve(organizationServiceToken);
      const oldUsers = await db.repository('user').findMany();
      const legacyIds = new Set(
        oldUsers
          .filter(
            (u) =>
              typeof u.email === 'string' &&
              /^oa\.test\d{3}@example\.test$/.test(u.email),
          )
          .map((u) => String(u.id)),
      );
      manifest.legacyDutyReplacements ??= {};
      for (const person of trialAccounts)
        for (const duty of person.duties)
          for (const id of await org.listDutyRoleMembers(duty, db.connection()))
            if (legacyIds.has(id))
              manifest.legacyDutyReplacements[id] ??= person.key;
      await save();
    }
    const facts = await bootstrap(
      app,
      password,
      manifest.date,
      options.replaceLegacyTrialDuties,
    );
    await app.container
      .resolve(trialContentLocalizationToken)
      .initialize(facts.users.system);
    if (options.resetPasswords) {
      await resetTrialPasswords(app, facts.users.system, password);
      delete access.password;
      for (const person of access.accounts) {
        const role = (Object.keys(password) as (keyof TrialPasswords)[]).find(
          (key) => trialUsername(key) === person.username,
        );
        if (role) person.password = password[role];
      }
      await writeFile(`${accessFile}.tmp`, JSON.stringify(access, null, 2), {
        mode: 0o600,
      });
      await rename(`${accessFile}.tmp`, accessFile);
    }
    const headcounts = await populateHeadcountSamples(app);
    const sessions = {} as TrialSessions;
    for (const person of trialAccounts)
      sessions[person.key] = await trialSession(
        app,
        person.key,
        password[person.key],
      );
    if (options.replaceLegacyTrialDuties)
      setLegacyDutyReplacements(
        sessions,
        manifest.legacyDutyReplacements ?? {},
      );
    // Use the application's actual API document before exercising its business endpoints.
    await sessions.system.request('/swagger');
    const failures: TrialDataResult['failures'] = [];
    try {
      for (const row of await collaboration(app, facts))
        manifest.scenarios[row.key] = row;
      await save();
    } catch (error) {
      failures.push({
        key: 'collaboration',
        reason:
          error instanceof Error
            ? error.message
            : 'Collaboration setup failed.',
      });
    }
    for (const scenario of scenarios(facts)) {
      progress(`Preparing ${scenario.key} (${scenario.title}).`);
      try {
        manifest.scenarios[scenario.key] = await populateScenario(
          app,
          sessions,
          facts,
          scenario,
          manifest.scenarios[scenario.key],
        );
        await save();
      } catch (error) {
        failures.push({
          key: scenario.key,
          reason:
            error instanceof Error ? error.message : 'Trial scenario failed.',
        });
      }
    }
    progress(
      'Preparing linked cancellations, contract versions and onboarding tasks.',
    );
    await followUps(
      app,
      sessions,
      facts,
      password,
      manifest.scenarios,
      async (row) => {
        manifest.scenarios[row.key] = row;
        await save();
      },
      (key, error) =>
        failures.push({
          key,
          reason:
            error instanceof Error
              ? error.message
              : 'Linked trial scenario failed.',
        }),
    );
    if (manifest.scenarios.onboarding) {
      const access = JSON.parse(await readFile(accessFile, 'utf8')) as {
        accounts: {
          username: string;
          email: string;
          name: string;
          duties: readonly string[];
          password?: string;
          note?: string;
        }[];
      };
      if (
        !access.accounts.some((entry) => entry.username === 'trial.newhire')
      ) {
        access.accounts.push({
          username: 'trial.newhire',
          email: 'newhire@oa-trial.example.test',
          name: '示例·待入职员工',
          password: password.newhire,
          duties: [],
          note: '入职流程创建时禁用；必须完成真实入职办理后才能登录。',
        });
        await writeFile(accessFile, JSON.stringify(access, null, 2), {
          mode: 0o600,
        });
      }
    }
    return {
      accessFile,
      headcounts,
      accounts: trialAccounts.length,
      scenarios: Object.values(manifest.scenarios),
      failures,
      excluded: trialPlan.excluded,
    };
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
