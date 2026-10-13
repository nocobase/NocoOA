import { writeFile } from 'node:fs/promises';
// @vitest-environment node
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { it } from 'vitest';
import { expect } from '@playwright/test';
import { databaseManagerToken } from '@nocobase/db';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import ExcelJS from 'exceljs';
import { createUser } from '../../logic/platform/helpers.js';
import { grantToUser } from '../../logic/employees/helpers.js';
import { startIsolatedBrowserApp } from '../browser/harness.js';
import en from '../../../client/locales/modules/reports-expense.en-US.js';
import zh from '../../../client/locales/modules/reports-expense.zh-CN.js';
it.runIf(process.env.OA_BROWSER_ACCEPTANCE === '1')(
  'V03 settled expense report isolated actual API/browser acceptance',
  async () => {
    const h = await startIsolatedBrowserApp({
      name: 'expense-summary-reports',
      apiPort: 14167,
      vitePort: 15167,
    });
    try {
      const reader = await createUser(h.testApp, 'Expense browser reader');
      const other = await createUser(h.testApp, 'Expense browser other');
      const db = h.testApp.application.container.resolve(databaseManagerToken);
      const authz = h.testApp.application.container.resolve(authorizationToken);
      for (const applicantId of [reader.user.id, other.user.id]) {
        const id = randomUUID(),
          paymentId = randomUUID();
        await db.repository('reimbursementRequests').createOne({
          values: {
            id,
            applicantId,
            createdById: applicantId,
            reason: 'private fixture',
            authorizationId: null,
            loanId: null,
            offsetCents: 7,
            overrunReason: '',
            lines: [
              {
                id: randomUUID(),
                category: 'other',
                date: '2026-01-31',
                amountCents: 17,
                invoiceNumber: 'private invoice',
                attachmentIds: [],
                standardExceptionReason: '',
              },
            ],
            totalCents: 17,
            financeLineFacts: {},
            status: 'paid',
            paymentId,
            statusChangedAt: new Date(),
            lifecycleVersion: 1,
            createdAt: new Date(),
          },
        });
        await db.repository('reimbursementPayments').createOne({
          values: {
            id: paymentId,
            requestId: id,
            actorId: applicantId,
            grossCents: 17,
            offsetCents: 7,
            netCents: 10,
            voucherNumber: 'private voucher',
            forced: false,
            reason: null,
            at: new Date(),
          },
        });
      }
      const key = `expense-browser-${randomUUID()}`;
      await grantToUser(
        h.testApp,
        key,
        [
          {
            resource: { type: 'composite', id: 'oa.reimbursement' },
            actions: [
              {
                action: 'view',
                policy: {
                  type: 'composite',
                  scopes: { reimbursementRequests: 'allRecords' },
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
            const english = locale === 'en-US',
              copy = english ? en.reportsExpense : zh.reportsExpense;
            const p = await h.pageFor(reader, {
              locale,
              viewport: { width: 375, height: 812 },
            });
            const errors: string[] = [];
            const consoleUnexpected: string[] = [];
            const resourceConsole: string[] = [];
            const failedRequests: { path: string; error: string | null }[] = [];
            const sourceFailures: {
              path: string;
              status: number;
              injected: boolean;
            }[] = [];
            let injecting = false;
            p.on('console', (message) => {
              if (message.type() === 'error') {
                if (message.text().includes('Failed to load resource'))
                  resourceConsole.push(message.text());
                else consoleUnexpected.push(message.text());
              }
            });
            p.on('requestfailed', (request) =>
              failedRequests.push({
                path: new URL(request.url()).pathname,
                error: request.failure()?.errorText ?? null,
              }),
            );
            p.on('response', (response) => {
              if (
                new URL(response.url()).pathname.includes(
                  '/api/reports/expense-summary',
                ) &&
                response.status() >= 400
              )
                sourceFailures.push({
                  path: new URL(response.url()).pathname,
                  status: response.status(),
                  injected: injecting,
                });
            });
            p.on('pageerror', (error) => errors.push(error.message));
            await p.addInitScript(
              ({ theme, preset }) => {
                localStorage.setItem('nocobase:main:theme:color-scheme', theme);
                localStorage.setItem('nocobase:main:theme:preset', preset);
              },
              { theme, preset },
            );
            await p.goto(`${h.origin}${h.basePath}/`);
            // The first isolated Vite load can still be preparing dependencies.
            await expect(p.locator('h1').first()).toBeVisible({
              timeout: 30_000,
            });
            const baselineConsole = [...consoleUnexpected];
            consoleUnexpected.length = 0;
            const baselineErrors = [...errors];
            errors.length = 0;
            await p.goto(
              `${h.origin}${h.basePath}/reports?expenseYear=2026&expenseMonth=1`,
            );
            await p.getByRole('tab', { name: copy.title, exact: true }).click();
            await expect(p.getByText('other', { exact: true })).toBeVisible();
            await expect(p.locator('tbody tr')).toHaveCount(1);
            await expect(
              p.getByText(copy.description, { exact: true }),
            ).toBeVisible();
            const year = p.getByLabel(english ? 'Year' : '年度', {
              exact: true,
            });
            await year.focus();
            await p.keyboard.press('ControlOrMeta+A');
            await p.keyboard.type('2026');
            await expect(year).toHaveValue('2026');
            await p.keyboard.press('Tab');
            await expect(
              p.getByLabel(copy.month, { exact: true }),
            ).toBeFocused();
            await expect(
              p.getByRole('button', {
                name: english ? 'Export Excel' : '导出 Excel',
                exact: true,
              }),
            ).toBeEnabled();
            expect(
              await p.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
            ).toBe(true);
            await p.screenshot({
              path: path.join(
                h.screenshotsDir,
                `${locale}-${theme}-${preset}-375.png`,
              ),
              fullPage: true,
            });
            const download = p.waitForEvent('download');
            await p
              .getByRole('button', {
                name: english ? 'Export Excel' : '导出 Excel',
                exact: true,
              })
              .click();
            expect((await download).suggestedFilename()).toBe(
              'expense-summary.xlsx',
            );
            if (await p.locator('[data-slot=toast-close]').count())
              await p.locator('[data-slot=toast-close]').first().click();
            const response = await reader.fetch(
              `/reports/expense-summary/export?year=2026&month=1&locale=${locale}`,
            );
            expect(response.status).toBe(200);
            expect(response.headers.get('cache-control')).toBe('no-store');
            const book = new ExcelJS.Workbook();
            await book.xlsx.load(await response.arrayBuffer());
            expect(book.worksheets[0].getRow(1).values.slice(1)).toHaveLength(
              5,
            );
            expect(book.worksheets[0].getCell('E2').value).toBe(
              english && theme === 'light' && preset === 'default' ? 34 : 17,
            );
            await p.getByLabel(copy.month, { exact: true }).fill('2');
            await expect(p.locator('[data-slot="empty"]')).toBeVisible();
            await p.screenshot({
              path: path.join(
                h.screenshotsDir,
                `${locale}-${theme}-${preset}-empty-375.png`,
              ),
              fullPage: true,
            });
            await p
              .getByRole('button', {
                name: english ? 'Clear filters' : '清除筛选',
                exact: true,
              })
              .last()
              .click();
            await year.fill('2026');
            await p.getByLabel(copy.month, { exact: true }).fill('1');
            await expect(p.locator('tbody tr')).toHaveCount(1);
            await expect(
              p.getByRole('button', {
                name: english ? 'Export Excel' : '导出 Excel',
                exact: true,
              }),
            ).toBeEnabled();
            await expect(p).toHaveURL(/expenseMonth=1/);
            if (theme === 'light' && preset === 'default') {
              for (const status of [500, 403, 412, 401]) {
                const pattern = '**/api/reports/expense-summary?*';
                injecting = true;
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
                    name: english ? 'Refresh' : '刷新',
                    exact: true,
                  })
                  .click();
                await expect(p.locator('tbody tr')).toHaveCount(0);
                if (status === 500)
                  await expect(
                    p.getByRole('button', {
                      name: english ? 'Retry' : '重试',
                      exact: true,
                    }),
                  ).toBeVisible();
                if (status === 403)
                  await expect(
                    p.getByText(copy.forbidden, { exact: true }),
                  ).toBeVisible();
                if (status === 412)
                  await expect(
                    p.getByText(copy.precondition, { exact: true }),
                  ).toBeVisible();
                if (status === 401)
                  await expect(
                    p.getByRole('button', {
                      name: english ? 'Sign in again' : '重新登录',
                      exact: true,
                    }),
                  ).toBeVisible();
                if ([401, 403].includes(status))
                  await expect(
                    p.getByRole('button', {
                      name: english ? 'Export Excel' : '导出 Excel',
                      exact: true,
                    }),
                  ).toHaveCount(0);
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
                        ? english
                          ? 'Retry'
                          : '重试'
                        : english
                          ? 'Refresh'
                          : '刷新',
                    exact: true,
                  })
                  .press('Enter');
                await expect(p.locator('tbody tr')).toHaveCount(1);
                injecting = false;
              }
            }
            if (english && theme === 'light' && preset === 'default') {
              await expect(p.locator('tbody tr td').nth(3)).toHaveText('2');
              const set = await authz.permissionSets.get(key);
              if (!set) throw new Error('Missing grant');
              await authz.permissionSets.update(key, { ...set, grants: [] });
              await p
                .getByRole('button', { name: 'Refresh', exact: true })
                .click();
              await expect(p.locator('tbody tr td').nth(3)).toHaveText('1');
              await expect(p.locator('tbody tr td').nth(4)).toHaveText('0.17');
            }
            await p.getByLabel(copy.month, { exact: true }).fill('13');
            await expect(p.locator('tbody tr')).toHaveCount(0);
            await expect(
              p.getByRole('button', {
                name: english ? 'Export Excel' : '导出 Excel',
                exact: true,
              }),
            ).toBeDisabled();
            const isolatedSocketWarnings = consoleUnexpected.filter(
              (message) =>
                message.includes(`ws://127.0.0.1:15167${h.basePath}/ws`) &&
                message.includes('Unexpected response code: 426'),
            );
            const unexpectedFeatureConsole = consoleUnexpected.filter(
              (message) =>
                !baselineConsole.includes(message) &&
                !isolatedSocketWarnings.includes(message),
            );
            expect(unexpectedFeatureConsole).toEqual([]);
            expect(
              sourceFailures.filter((failure) => !failure.injected),
            ).toEqual([]);
            await writeFile(
              path.join(
                h.screenshotsDir,
                `${locale}-${theme}-${preset}-capture-log.json`,
              ),
              JSON.stringify(
                {
                  pageErrors: errors,
                  baselinePageErrors: baselineErrors,
                  consoleUnexpected,
                  baselineConsole,
                  isolatedSocketWarnings,
                  unexpectedFeatureConsole,
                  resourceConsole,
                  failedRequests,
                  sourceFailures,
                },
                null,
                2,
              ),
            );
            expect(errors).toEqual([]);
            expect(baselineErrors).toEqual([]);
            await p.context().close();
          }
    } finally {
      await h.close();
    }
  },
  240000,
);
