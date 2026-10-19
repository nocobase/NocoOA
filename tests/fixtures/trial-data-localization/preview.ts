/** Run with `pnpm exec tsx tests/fixtures/trial-data-localization/preview.ts`.
 * Owns disposable PostgreSQL/storage and keeps the preview alive until SIGINT/SIGTERM. No business database is used.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';
import { signIn } from '@nocobase/app-plugin-authentication/testing';
import { startIsolatedBrowserApp } from '../browser/harness.js';
import { generateTrialData } from '../../../cli/commands/lib/trial-data/index.js';
import { defaultTrialPasswords } from '../../../cli/commands/lib/trial-data/passwords.js';
import { trialEmail } from '../../../cli/commands/lib/trial-data/accounts.js';

const host = await startIsolatedBrowserApp({
  name: 'bilingual-trial',
  apiPort: 14681,
  vitePort: 14682,
});
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await host.close();
};
process.once('SIGINT', () => {
  void close();
});
process.once('SIGTERM', () => {
  void close();
});
try {
  const result = await generateTrialData(host.testApp.application, (message) =>
    process.stdout.write(`${message}\n`),
  );
  await writeFile(
    path.resolve(
      'storage/ui-workflow/bilingual-trial-isolated-browser/result.json',
    ),
    JSON.stringify(
      {
        accounts: result.accounts,
        scenarios: result.scenarios,
        failures: result.failures,
        excluded: result.excluded,
        accessFile: result.accessFile,
        url: `${host.origin}${host.basePath}/`,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  const session = await signIn(host.testApp, {
    email: trialEmail('system'),
    password: defaultTrialPasswords().system,
  });
  const checks: unknown[] = [];
  const pages = [
    { route: 'departments', zh: '示例·研发部', en: 'Demo · Engineering' },
    {
      route: `approvals/mine/training/${result.scenarios.find((row) => row.key === 'training-review')?.id ?? ''}`,
      screenshot: 'training',
      zh: '示例·项目管理培训',
      en: 'Demo · Project management training',
    },
    {
      route: 'knowledge',
      zh: 'oa-trial-v1·试用操作指南',
      en: 'oa-trial-v1 · Trial guide',
    },
    {
      route: 'announcements',
      zh: 'oa-trial-v1·OA试用通知（需回执）',
      en: 'oa-trial-v1 · OA trial notice',
    },
    {
      route: 'meeting-rooms?tab=rooms',
      screenshot: 'meeting-rooms',
      zh: '示例·董事会议室',
      en: 'Demo · Boardroom',
    },
  ];
  for (const locale of ['zh-CN', 'en-US']) {
    const page = await host.pageFor(session, { locale });
    for (const item of pages) {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${host.origin}${host.basePath}/${item.route}`);
      try {
        await expect(
          page
            .getByText(locale === 'zh-CN' ? item.zh : item.en, { exact: false })
            .first(),
        ).toBeVisible({ timeout: 45000 });
        await page.screenshot({
          path: path.join(
            host.screenshotsDir,
            `${'screenshot' in item ? item.screenshot : item.route}-${locale}.png`,
          ),
          fullPage: true,
        });
        checks.push({ locale, route: item.route, passed: true, errors });
      } catch (error) {
        await page.screenshot({
          path: path.join(
            host.screenshotsDir,
            `${'screenshot' in item ? item.screenshot : item.route}-${locale}-failed.png`,
          ),
          fullPage: true,
        });
        checks.push({
          locale,
          route: item.route,
          passed: false,
          error:
            error instanceof Error ? error.message : 'Browser assertion failed',
          errors,
        });
      }
    }
    await page.context().close();
  }
  await writeFile(
    path.join(host.screenshotsDir, 'checks.json'),
    JSON.stringify(checks, null, 2),
  );
  process.stdout.write(
    `PREVIEW_READY ${JSON.stringify({ url: `${host.origin}${host.basePath}/`, accessFile: result.accessFile, failures: result.failures, checks })}\n`,
  );
  if (process.argv.includes('--check-only')) await close();
} catch (error) {
  await close();
  throw error;
}
