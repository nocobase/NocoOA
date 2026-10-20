/** Check a running isolated preview. Credentials are read only from its private synthetic-account file. */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect, request } from '@playwright/test';

const directory = path.resolve(
  'storage/ui-workflow/bilingual-trial-isolated-browser',
);
const preview = JSON.parse(
  await readFile(path.join(directory, 'result.json'), 'utf8'),
) as {
  url: string;
  accessFile: string;
  scenarios: { key: string; id: string }[];
};
preview.url = process.env.OA_PREVIEW_URL ?? preview.url;

const access = JSON.parse(await readFile(preview.accessFile, 'utf8')) as {
  accounts: { username: string; email: string; password: string }[];
};
const account = access.accounts.find(
  (item) => item.username === 'trial.system',
)!;
const api = await request.newContext({
  baseURL: preview.url,
  extraHTTPHeaders: { origin: new URL(preview.url).origin },
});
const login = await api.post(`${preview.url}api/auth/sign-in/email`, {
  data: { email: account.email, password: account.password },
});
expect(login.status()).toBe(200);
const storage = await api.storageState();
const browser = await chromium.launch({ headless: true });
const checks: unknown[] = [];
const pages = [
  {
    key: 'departments',
    route: 'departments',
    zh: '示例·研发部',
    en: 'Demo · Engineering',
  },
  {
    key: 'training',
    route: `approvals/mine/training/${preview.scenarios.find((item) => item.key === 'training-review')!.id}`,
    zh: '示例·项目管理培训',
    en: 'Demo · Project management training',
  },
  {
    key: 'knowledge',
    route: 'knowledge',
    zh: 'oa-trial-v1·试用操作指南',
    en: 'oa-trial-v1 · Trial guide',
  },
  {
    key: 'announcements',
    route: 'announcements',
    zh: 'oa-trial-v1·OA试用通知（需回执）',
    en: 'oa-trial-v1 · OA trial notice',
  },
  {
    key: 'meeting-rooms',
    route: 'meeting-rooms?tab=rooms',
    zh: '示例·董事会议室',
    en: 'Demo · Boardroom',
  },
];
try {
  for (const locale of ['zh-CN', 'en-US']) {
    const context = await browser.newContext({
      storageState: storage,
      locale,
      viewport: { width: 1440, height: 1000 },
    });
    await context.addInitScript(
      (language) => localStorage.setItem('nocobase.locale', language),
      locale,
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const item of pages) {
      await page.goto(new URL(item.route, preview.url).href);
      await expect(
        page
          .getByText(locale === 'zh-CN' ? item.zh : item.en, { exact: false })
          .first(),
      ).toBeVisible({ timeout: 45000 });
      await page.screenshot({
        path: path.join(directory, 'screenshots', `${item.key}-${locale}.png`),
        fullPage: true,
      });
      checks.push({ locale, page: item.key, passed: true });
    }
    expect(errors).toEqual([]);
    if (locale === 'en-US') {
      await page.goto(new URL('departments', preview.url).href);
      await expect(
        page.getByText('Demo · Engineering', { exact: true }).first(),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Open account menu' }).click();
      await page.getByText('Language', { exact: true }).hover();
      await page
        .getByRole('menuitemradio', { name: '中文', exact: true })
        .click();
      await expect(
        page.getByText('示例·研发部', { exact: true }).first(),
      ).toBeVisible({ timeout: 15000 });
      checks.push({
        page: 'departments',
        action: 'switch English to Chinese without a manual refresh',
        passed: true,
      });
    }
    await context.close();
  }
} finally {
  await writeFile(
    path.join(directory, 'screenshots', 'acceptance-checks.json'),
    JSON.stringify(checks, null, 2),
  );
  await api.dispose();
  await browser.close();
}
process.stdout.write(JSON.stringify({ passed: checks.length, checks }) + '\n');
