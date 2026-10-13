// @vitest-environment node
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { it } from 'vitest';
import { expect } from '@playwright/test';
import { databaseManagerToken } from '@nocobase/db';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { grantToUser } from '../../logic/employees/helpers.js';
import { createUser } from '../../logic/platform/helpers.js';
import { startIsolatedBrowserApp } from '../browser/harness.js';
it.runIf(process.env.OA_BROWSER_ACCEPTANCE === '1')(
  'R03 monthly leave report isolated browser bilingual narrow theme acceptance',
  async () => {
    const h = await startIsolatedBrowserApp({
      name: 'leave-monthly-reports',
      apiPort: 14147,
      vitePort: 15147,
    });
    try {
      const reader = await createUser(
        h.testApp,
        'Monthly report browser reader',
      );
      const db = h.testApp.application.container.resolve(databaseManagerToken);
      const authz = h.testApp.application.container.resolve(authorizationToken);
      await db.repository('leaveRequests').createOne({
        values: {
          id: randomUUID(),
          applicantId: reader.user.id,
          createdById: reader.user.id,
          number: null,
          leaveType: 'annual',
          startDate: '2026-01-31',
          endDate: '2026-02-03',
          startHalf: 'am',
          endHalf: 'pm',
          days: '2.50',
          reason: 'private fixture',
          attachments: [],
          handoverUserId: null,
          enableDelegation: false,
          ruleSnapshot: {},
          hrRecipients: [],
          managerApproverId: null,
          requiresHr: false,
          status: 'approved',
          statusChangedAt: new Date(),
          lifecycleVersion: 0,
          createdAt: new Date(),
        },
      });
      const other = await createUser(h.testApp, 'Monthly browser other');
      const source = (await db.repository('leaveRequests').findMany({}))[0];
      await db.repository('leaveRequests').createOne({
        values: {
          ...source,
          id: randomUUID(),
          applicantId: other.user.id,
          createdById: other.user.id,
          days: 9,
        },
      });
      const key = `monthly-browser-${randomUUID()}`;
      await grantToUser(
        h.testApp,
        key,
        [
          {
            resource: { type: 'composite', id: 'oa.leave' },
            actions: [
              {
                action: 'view',
                policy: {
                  type: 'composite',
                  scopes: { leaveRequests: 'allRecords' },
                },
              },
            ],
          },
        ],
        reader.user.id,
      );
      for (const locale of ['en-US', 'zh-CN'])
        for (const theme of ['light', 'dark'])
          for (const preset of ['default', 'compact']) {
            const en = locale === 'en-US';
            const p = await h.pageFor(reader, {
              locale,
              viewport: { width: 375, height: 812 },
            });
            const pageErrors: string[] = [];
            p.on('pageerror', (error) => pageErrors.push(error.message));
            await p.addInitScript(
              ({ color, preset }) => {
                localStorage.setItem('nocobase:main:theme:color-scheme', color);
                localStorage.setItem('nocobase:main:theme:preset', preset);
              },
              { color: theme, preset },
            );
            await p.goto(`${h.origin}${h.basePath}/reports`);
            await p
              .getByRole('tab', {
                name: en ? 'Monthly leave requests' : '请假月汇总',
                exact: true,
              })
              .click();
            await p
              .getByLabel(en ? 'Year' : '年度', { exact: true })
              .fill('2026');
            if (theme === 'light' && preset === 'default') {
              const year = p.getByLabel(en ? 'Year' : '年度', { exact: true });
              await year.focus();
              await p.keyboard.press('ControlOrMeta+A');
              await p.keyboard.type('2026');
              await expect(year).toHaveValue('2026');
              await p.keyboard.press('Tab');
              await expect(
                p.getByLabel(
                  en
                    ? 'Start month (1–12, optional)'
                    : '开始月份（1–12，可留空）',
                  { exact: true },
                ),
              ).toBeFocused();
              for (const status of [500, 403, 412, 401]) {
                const pattern = '**/api/reports/leave-monthly?*';
                await p.route(pattern, (route) =>
                  route.fulfill({
                    status,
                    contentType: 'application/json',
                    body: JSON.stringify({
                      error: {
                        code: 'SYNTHETIC_FAILURE',
                        message: 'private synthetic fault',
                      },
                    }),
                  }),
                );
                await p
                  .getByRole('button', {
                    name: en ? 'Refresh' : '刷新',
                    exact: true,
                  })
                  .click();
                await expect(p.locator('tbody tr')).toHaveCount(0);
                if (status === 500)
                  await expect(
                    p.getByRole('button', {
                      name: en ? 'Retry' : '重试',
                      exact: true,
                    }),
                  ).toBeVisible();
                if (status === 403) {
                  await expect(
                    p.getByText(
                      en
                        ? 'You do not have access to the current leave request source. Contact an administrator to check source permissions.'
                        : '无权读取当前请假来源，请联系管理员核对来源权限。',
                      { exact: true },
                    ),
                  ).toBeVisible();
                  await expect(
                    p.getByRole('button', {
                      name: en ? 'Export Excel' : '导出 Excel',
                      exact: true,
                    }),
                  ).toHaveCount(0);
                }
                if (status === 412)
                  await expect(
                    p.getByText(
                      en
                        ? 'This range exceeds 10,000 authorized approved requests. Select a month or another year, then try again.'
                        : '该范围获权的已批准申请超过 10,000 条。请选择单个月份或其他年度后重试。',
                      { exact: true },
                    ),
                  ).toBeVisible();
                if (status === 401)
                  await expect(
                    p.getByRole('button', {
                      name: en ? 'Sign in again' : '重新登录',
                      exact: true,
                    }),
                  ).toBeVisible();
                await expect(
                  p.getByText('private synthetic fault', { exact: true }),
                ).toHaveCount(0);
                await p.screenshot({
                  path: path.join(
                    h.screenshotsDir,
                    `${locale}-${status}-375.png`,
                  ),
                  fullPage: true,
                });
                await p.unroute(pattern);
                await p
                  .getByRole('button', {
                    name:
                      status === 500
                        ? en
                          ? 'Retry'
                          : '重试'
                        : en
                          ? 'Refresh'
                          : '刷新',
                    exact: true,
                  })
                  .click();
                await expect(p.locator('tbody tr')).toHaveCount(1);
              }
            }
            expect(pageErrors).toEqual([]);
            await p
              .getByLabel(
                en
                  ? 'Start month (1–12, optional)'
                  : '开始月份（1–12，可留空）',
                { exact: true },
              )
              .fill('1');
            await expect(
              p.getByText(en ? 'Annual leave' : '年假', { exact: true }),
            ).toBeVisible();
            await expect(p.locator('tbody tr')).toHaveCount(1);
            expect(
              await p.evaluate(() => {
                const list = document.querySelector('[data-slot="tabs-list"]')!,
                  card = document.querySelector(
                    '[role="tabpanel"] [data-slot="card"]',
                  )!;
                return (
                  list.getBoundingClientRect().bottom <
                  card.getBoundingClientRect().top
                );
              }),
            ).toBe(true);
            await expect(
              p.getByText(
                en ? 'Approved original requested days' : '批准原申请天数',
                { exact: true },
              ),
            ).toBeVisible();
            const download = p.waitForEvent('download');
            await p
              .getByRole('button', {
                name: en ? 'Export Excel' : '导出 Excel',
                exact: true,
              })
              .click();
            expect((await download).suggestedFilename()).toBe(
              'leave-monthly.xlsx',
            );
            expect(
              await p.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
            ).toBe(true);
            await p.screenshot({
              path: path.join(
                h.screenshotsDir,
                `${locale}-${theme}${preset === 'default' ? '' : '-compact'}-375.png`,
              ),
              fullPage: true,
            });
            await p
              .getByLabel(
                en
                  ? 'Start month (1–12, optional)'
                  : '开始月份（1–12，可留空）',
                { exact: true },
              )
              .fill('2');
            await expect(p.locator('[data-slot="empty"]')).toBeVisible();
            await p.screenshot({
              path: path.join(
                h.screenshotsDir,
                `${locale}-${theme}${preset === 'default' ? '' : '-compact'}-empty-375.png`,
              ),
              fullPage: true,
            });
            await p
              .getByRole('button', {
                name: en ? 'Clear filters' : '清除筛选',
                exact: true,
              })
              .last()
              .click();
            await p
              .getByLabel(en ? 'Year' : '年度', { exact: true })
              .fill('2026');
            await p
              .getByLabel(
                en
                  ? 'Start month (1–12, optional)'
                  : '开始月份（1–12，可留空）',
                { exact: true },
              )
              .fill('1');
            await expect(p.locator('tbody tr')).toHaveCount(1);
            if (en && theme === 'light' && preset === 'default') {
              await expect(p.locator('tbody tr td').nth(3)).toHaveText('2');
              const set = await authz.permissionSets.get(key);
              if (!set) throw new Error('Missing browser grant');
              await authz.permissionSets.update(key, { ...set, grants: [] });
              await p
                .getByRole('button', { name: 'Refresh', exact: true })
                .click();
              await expect(p.locator('tbody tr td').nth(3)).toHaveText('1');
              await expect(p.locator('tbody tr td').nth(4)).toHaveText('2.5');
            }
            await p
              .getByLabel(
                en
                  ? 'Start month (1–12, optional)'
                  : '开始月份（1–12，可留空）',
                { exact: true },
              )
              .fill('13');
            await expect(p.locator('tbody tr')).toHaveCount(0);
            await expect(
              p.getByRole('button', {
                name: en ? 'Export Excel' : '导出 Excel',
                exact: true,
              }),
            ).toBeDisabled();
            await p.context().close();
          }
    } catch (error) {
      for (const context of h.browser.contexts()) {
        for (const page of context.pages()) {
          console.log(
            'Monthly report failure state',
            page.url(),
            (await page.locator('body').innerText()).slice(-6000),
          );
          await page.screenshot({
            path: path.join(h.screenshotsDir, 'failure.png'),
            fullPage: true,
          });
        }
      }
      throw error;
    } finally {
      await h.close();
    }
  },
  240000,
);
