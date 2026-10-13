// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { it } from 'vitest';
import { expect, type Page } from '@playwright/test';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { PermissionGrant } from '@nocobase/authorization/core';
import { databaseManagerToken } from '@nocobase/db';
import { budgetServiceToken } from '../../../server/providers/budgets/index.js';
import { organizationServiceToken } from '../../../server/providers/org/index.js';
import { createUser } from '../../logic/platform/helpers.js';
import { grantToUser } from '../../logic/employees/helpers.js';
import { startIsolatedBrowserApp } from '../browser/harness.js';

it.runIf(process.env.OA_BROWSER_ACCEPTANCE === '1')(
  'Q07–Q09 real-role reports browser acceptance',
  async () => {
    const h = await startIsolatedBrowserApp({
      name: 'reports',
      apiPort: 14145,
      vitePort: 15145,
    });
    const checks: string[] = [],
      screenshots: string[] = [];
    try {
      const c = h.testApp.application.container,
        db = c.resolve(databaseManagerToken),
        authz = c.resolve(authorizationToken),
        reader = await createUser(h.testApp, 'A5 report reader'),
        outsider = await createUser(h.testApp, 'A5 report outsider'),
        department = await c
          .resolve(organizationServiceToken)
          .createDepartment(
            { title: 'A5 Finance', managerId: reader.user.id },
            { actorId: reader.user.id },
          );

      await db.transaction((tx) =>
        c.resolve(budgetServiceToken).allocate(
          {
            departmentId: department.id,
            subject: 'travel',
            year: 2026,
            deltaCents: 12345,
            actorId: reader.user.id,
            reason: 'A5 report fixture',
            reference: 'report-test',
            requestKey: randomUUID(),
          },
          tx,
        ),
      );
      const position = await c
        .resolve(organizationServiceToken)
        .createPosition(
          { code: 'A5-ENG', title: 'A5 Engineer' },
          { actorId: reader.user.id },
        );
      await c
        .resolve(organizationServiceToken)
        .createPosition(
          { code: 'A5-OTHER', title: 'A5 Other' },
          { actorId: reader.user.id },
        );
      const accountId = randomUUID();
      await db.repository('headcountAccounts').createOne({
        values: {
          id: accountId,
          departmentId: department.id,
          positionId: position.id,
          year: 2026,
          limit: 4,
          initialized: true,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      const contractId = randomUUID(),
        now = new Date();
      await db.repository('contracts').createOne({
        values: {
          id: contractId,
          number: 'A5-OTHER-001',
          requestId: contractId,
          applicantId: outsider.user.id,
          departmentId: department.id,
          status: 'active',
          version: 1,
          lockVersion: 0,
          amountCents: 50000,
          facts: {
            contractType: 'purchase',
            counterparty: { kind: 'customer', name: 'A5 customer' },
            startsOn: '2026-01-01',
            endsOn: '2026-12-31',
            paymentTerms: 'Net 30',
            standardTemplate: true,
            textVersionId: randomUUID(),
            attachments: [],
          },
          createdAt: now,
          updatedAt: now,
        },
      });
      await db.repository('contractVersions').createOne({
        values: {
          id: randomUUID(),
          contractId,
          version: 1,
          requestId: contractId,
          facts: {
            contractType: 'purchase',
            counterparty: { kind: 'customer', name: 'A5 customer' },
            startsOn: '2026-01-01',
            endsOn: '2026-12-31',
            paymentTerms: 'Net 30',
            standardTemplate: true,
            textVersionId: randomUUID(),
            attachments: [],
          },
          amountCents: 50000,
          status: 'active',
          actorId: outsider.user.id,
          reason: 'Synthetic report version',
          at: now,
        },
      });
      await db.repository('contractRequests').createOne({
        values: {
          id: contractId,
          creatorId: outsider.user.id,
          applicantId: outsider.user.id,
          departmentId: department.id,
          number: null,
          operation: 'new',
          contractId,
          baseVersion: 0,
          contractType: 'purchase',
          counterparty: { kind: 'customer', name: 'A5 customer' },
          amountCents: 50000,
          startsOn: '2026-01-01',
          endsOn: '2026-12-31',
          paymentTerms: 'Net 30',
          standardTemplate: true,
          textVersionId: null,
          attachments: [],
          reason: 'Synthetic report fixture',
          ruleSnapshot: {},
          nonStandard: null,
          status: 'approved',
          lifecycleVersion: 0,
          statusChangedAt: now,
          createdAt: now,
          submittedAt: now,
        },
      });
      const key = `a5-report-${randomUUID()}`;
      const grants: PermissionGrant[] = [
        authz.settings.grant('oa.budgets', ['read']),
        {
          resource: { type: 'composite', id: 'oa.contract' },
          actions: [
            {
              action: 'view',
              policy: {
                type: 'composite',
                scopes: { contractRequests: 'allRecords' },
              },
            },
            {
              action: 'ledger',
              policy: {
                type: 'composite',
                scopes: {
                  contracts: 'allRecords',
                  contractVersions: 'allRecords',
                },
              },
            },
          ],
        },
        {
          resource: { type: 'composite', id: 'oa.headcounts' },
          actions: [
            {
              action: 'view',
              policy: {
                type: 'composite',
                scopes: { headcountAccounts: 'allRecords' },
              },
            },
          ],
        },
      ];
      await grantToUser(h.testApp, key, grants, reader.user.id);

      const session = reader;
      const page = await h.pageFor(session);
      page.setDefaultTimeout(30000);
      const base = `${h.origin}${h.basePath}/reports`;
      const datasets = [
        ['budget-balances', 'Budget balances', '预算余额'],
        ['contract-ledger', 'Contract ledger', '合同台账'],
        ['headcount-balances', 'Headcount balances', '编制余额'],
      ];
      async function data(p: Page, suffix: string) {
        return p.evaluate(async (url) => {
          const r = await fetch(url);
          return {
            status: r.status,
            body: r.headers.get('content-type')?.includes('json')
              ? await r.json()
              : null,
          };
        }, `${h.basePath}/api/reports/${suffix}`);
      }
      for (const [dataset, title] of datasets) {
        await page.goto(base);
        await page.getByRole('tab', { name: title, exact: true }).click();
        await expect(page.locator('tbody tr')).toHaveCount(1);
        const response = await data(page, dataset);
        expect(response.status).toBe(200);
        expect(JSON.stringify(response.body)).not.toContain('facts');
        expect(JSON.stringify(response.body)).not.toContain('applicantId');
        const download = page.waitForEvent('download');
        await page
          .getByRole('button', { name: 'Export Excel', exact: true })
          .click();
        const file = await (await download).path();
        expect(file).toBeTruthy();
        const book = new ExcelJS.Workbook();
        await book.xlsx.readFile(file!);
        expect(book.worksheets[0].rowCount).toBe(response.body.data.length + 1);
        expect(book.worksheets[0].columnCount).toBe(
          dataset === 'headcount-balances'
            ? 13
            : dataset === 'contract-ledger'
              ? 13
              : 7,
        );
        checks.push(
          `${dataset}: real browser lists current projection and downloads matching whitelisted Excel`,
        );
        let fail = true;
        await page.route(`**/api/reports/${dataset}?*`, async (r) => {
          if (fail) {
            fail = false;
            await r.fulfill({
              status: 500,
              contentType: 'application/json',
              body: JSON.stringify({
                error: { code: 'INTERNAL_ERROR', message: 'Synthetic failure' },
              }),
            });
          } else await r.continue();
        });
        await page
          .getByRole('button', { name: 'Refresh', exact: true })
          .click();
        await expect(
          page.getByRole('button', { name: 'Retry', exact: true }),
        ).toBeVisible();
        await expect(
          page.locator('tbody tr:has(td:not([colspan]))'),
        ).toHaveCount(0);
        await page.getByRole('button', { name: 'Retry', exact: true }).click();
        await expect(page.locator('tbody tr')).toHaveCount(1);
        await page.unroute(`**/api/reports/${dataset}?*`);
        checks.push(
          `${dataset}: refresh 500 clears stale rows and Retry restores current data`,
        );
      }
      await page.goto(base);
      await page
        .getByRole('tab', { name: 'Contract ledger', exact: true })
        .click();
      await expect(
        page.getByRole('columnheader', { name: 'Expiry state', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('cell', { name: 'Unpaid', exact: true }),
      ).toBeVisible();
      await page.getByLabel('Ends on or before').click();
      await page.locator('select').nth(0).selectOption('11');
      await page.locator('select').nth(1).selectOption('2026');
      await page.getByRole('button', { name: /December 30th.*2026/ }).click();
      await expect(
        page.locator('tbody tr[data-slot="table-row"]:has(td:not([colspan]))'),
      ).toHaveCount(0);
      const expiredFilter = await data(
        page,
        'contract-ledger?endsBefore=2026-12-30',
      );
      expect(expiredFilter.body.meta.total).toBe(0);
      const filteredDownload = page.waitForEvent('download');
      await page
        .getByRole('button', { name: 'Export Excel', exact: true })
        .click();
      const filteredBook = new ExcelJS.Workbook();
      await filteredBook.xlsx.readFile(
        (await (await filteredDownload).path())!,
      );
      expect(filteredBook.worksheets[0].rowCount).toBe(1);
      const cutoff = page.getByLabel('Ends on or before');
      await cutoff.focus();
      await cutoff.press('Enter');
      const lastDay = page.getByRole('button', { name: /December 31st.*2026/ });
      await lastDay.focus();
      await lastDay.press('Enter');
      await expect(page.locator('select')).toHaveCount(0);
      await expect(cutoff).toBeFocused();
      await cutoff.press('Enter');
      await expect(page.locator('select')).toHaveCount(2);
      await page.keyboard.press('Escape');
      await expect(page.locator('select')).toHaveCount(0);
      await expect(cutoff).toBeFocused();
      checks.push(
        'date cutoff keyboard Enter opens/picks a day; Escape closes with focus returned to trigger',
      );
      await expect(page.locator('tbody tr')).toHaveCount(1);
      checks.push(
        'immutable expiry and verified unpaid progress render; date-filtered Excel matches authorized empty rows',
      );
      await db.repository('headcountAccounts').updateOne({
        filter: { id: accountId },
        values: { initialized: false },
      });
      await page
        .getByRole('tab', { name: 'Headcount balances', exact: true })
        .click();
      await expect(
        page.getByRole('cell', { name: 'Uninitialized', exact: true }),
      ).toHaveCount(2);
      await page.getByLabel('Department', { exact: true }).fill('A5 Finance');
      await page.getByRole('option', { name: /A5 Finance/ }).click();
      await page.getByLabel('Position', { exact: true }).fill('A5 Engineer');
      const selectedResponse = page.waitForResponse(
        (r) =>
          r.url().includes('/api/reports/headcount-balances?') &&
          r.url().includes('positionId='),
      );
      await page
        .getByRole('option', { name: 'A5 Engineer (A5-ENG)', exact: true })
        .click();
      const selectedRequest = await selectedResponse;
      const selectedUrl = new URL(selectedRequest.url());
      expect(selectedUrl.searchParams.get('positionId')).toBe(position.id);
      expect(selectedUrl.searchParams.get('departmentId')).toBe(department.id);
      await expect(page.locator('tbody tr')).toHaveCount(1);
      const capacityExcelResponse = page.waitForResponse((r) =>
        r.url().includes('/api/reports/headcount-balances.xlsx'),
      );
      const capacityDownload = page.waitForEvent('download');
      await page
        .getByRole('button', { name: 'Export Excel', exact: true })
        .click();
      const capacityBook = new ExcelJS.Workbook();
      await capacityBook.xlsx.readFile(
        (await (await capacityDownload).path())!,
      );
      const excelUrl = new URL((await capacityExcelResponse).url());
      expect(excelUrl.searchParams.get('positionId')).toBe(position.id);
      expect(excelUrl.searchParams.get('departmentId')).toBe(department.id);
      expect(capacityBook.worksheets[0].getCell('L2').value).toBeNull();
      expect(capacityBook.worksheets[0].getCell('M2').value).toBe(
        'uninitialized',
      );
      await page.getByLabel('Position', { exact: true }).fill('A5 Other');
      await page
        .getByRole('option', { name: 'A5 Other (A5-OTHER)', exact: true })
        .click();
      await expect(page.locator('tbody tr:has(td:not([colspan]))')).toHaveCount(
        0,
      );
      await db.repository('headcountAccounts').updateOne({
        filter: { id: accountId },
        values: { initialized: true },
      });
      checks.push(
        'uninitialized capacity displays unavailable state; position-filtered Excel retains raw capacity arithmetic and explicit unavailable state',
      );
      for (const locale of ['en-US', 'zh-CN'])
        for (const theme of ['light', 'dark'])
          for (const preset of ['compact', 'default']) {
            const p = await h.pageFor(session, {
              locale,
              viewport: { width: 375, height: 812 },
            });
            await p.addInitScript(
              ({ theme, preset }) => {
                localStorage.setItem('nocobase:main:theme:color-scheme', theme);
                localStorage.setItem('nocobase:main:theme:preset', preset);
              },
              { theme, preset },
            );
            await p.goto(base);
            for (const [dataset, en, zh] of datasets) {
              await p
                .getByRole('tab', {
                  name: locale === 'zh-CN' ? zh : en,
                  exact: true,
                })
                .click();
              await expect(p.locator('tbody tr')).toHaveCount(1);
              await expect(p.locator('html')).toHaveClass(new RegExp(theme));
              await expect(p.locator('html')).toHaveAttribute(
                'data-theme',
                preset,
              );
              expect(
                await p.evaluate(
                  () =>
                    document.documentElement.scrollWidth <=
                    window.innerWidth + 1,
                ),
              ).toBe(true);
              const target = path.join(
                h.screenshotsDir,
                `${dataset}-${locale}-${theme}-${preset}.png`,
              );
              await p.screenshot({ path: target, fullPage: true });
              screenshots.push(target);
            }
            await p.context().close();
          }
      checks.push(
        'all three datasets: 375px both languages, light/dark and compact/default, no document overflow',
      );
      const stranger = await h.pageFor(outsider);
      await stranger.goto(base);
      expect((await data(stranger, 'budget-balances')).status).toBe(403);
      expect((await data(stranger, 'headcount-balances')).status).toBe(403);
      await stranger
        .getByRole('tab', { name: 'Contract ledger', exact: true })
        .click();
      await expect(stranger.locator('tbody tr')).toHaveCount(1);
      expect((await data(stranger, 'contract-ledger')).body.data[0].id).toBe(
        contractId,
      );
      checks.push(
        'default outsider: budget/headcount denied; contract owner only sees own ledger',
      );
      await stranger.context().close();
      const foreignDepartment = await c
        .resolve(organizationServiceToken)
        .createDepartment(
          { title: 'Foreign capacity' },
          { actorId: reader.user.id },
        );
      const foreignAccountId = randomUUID();
      await db.repository('headcountAccounts').createOne({
        values: {
          id: foreignAccountId,
          departmentId: foreignDepartment.id,
          positionId: randomUUID(),
          year: 2026,
          limit: 9,
          initialized: false,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      const originalSet = await authz.permissionSets.get(key);
      if (!originalSet) throw new Error('Missing report grant');
      await authz.permissionSets.update(key, {
        ...originalSet,
        grants: [
          {
            resource: { type: 'composite', id: 'oa.headcounts' },
            actions: [
              {
                action: 'view',
                policy: {
                  type: 'composite',
                  scopes: {
                    headcountAccounts: 'oa.headcounts.headedDepartments',
                  },
                },
              },
            ],
          },
        ],
      });
      await page.goto(base);
      await page
        .getByRole('tab', { name: 'Headcount balances', exact: true })
        .click();
      await expect(page.locator('tbody tr')).toHaveCount(1);
      const scoped = await data(page, 'headcount-balances');
      expect(scoped.body.data.map((r: { id: string }) => r.id)).toEqual([
        accountId,
      ]);
      const scopedDownload = page.waitForEvent('download');
      await page
        .getByRole('button', { name: 'Export Excel', exact: true })
        .click();
      const scopedBook = new ExcelJS.Workbook();
      await scopedBook.xlsx.readFile((await (await scopedDownload).path())!);
      expect(scopedBook.worksheets[0].rowCount).toBe(2);
      expect(scopedBook.worksheets[0].getCell('A2').value).toBe(department.id);
      checks.push(
        'actual headed-department permission filters foreign headcount in browser list and Excel',
      );
      await authz.permissionSets.update(key, originalSet);
      const set = await authz.permissionSets.get(key);
      if (!set) throw new Error('Missing report grant');
      await authz.permissionSets.update(key, { ...set, grants: [] });
      expect(
        (await data(page, 'headcount-balances')).body.data.map(
          (r: { id: string }) => r.id,
        ),
      ).toEqual([accountId]);
      checks.push(
        'revoking direct grant preserves independent seeded department-head source',
      );
      await c
        .resolve(organizationServiceToken)
        .updateDepartment(
          department.id,
          { managerId: null },
          { actorId: reader.user.id },
        );

      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await expect(
        page.getByText(
          'You do not have permission to read this report source.',
          { exact: true },
        ),
      ).toBeVisible();
      await expect(page.locator('tbody tr:has(td:not([colspan]))')).toHaveCount(
        0,
      );
      await expect(
        page.getByRole('button', { name: 'Export Excel', exact: true }),
      ).toBeDisabled();
      checks.push(
        'actual revocation while headcount rows are displayed: Refresh removes cached rows and disables Excel',
      );

      for (const [dataset, title] of datasets) {
        await page.goto(base);
        await page.getByRole('tab', { name: title, exact: true }).click();
        const r = await data(page, dataset);
        if (dataset === 'contract-ledger') {
          expect(r.status).toBe(200);
          expect(r.body.data).toEqual([]);
          await expect(
            page.getByText('No matching records.', { exact: true }),
          ).toBeVisible();
        } else {
          expect(r.status).toBe(403);
          await expect(
            page.getByText(
              'You do not have permission to read this report source.',
              { exact: true },
            ),
          ).toBeVisible();
          expect((await data(page, `${dataset}.xlsx`)).status).toBe(403);
        }
        await expect(
          page.locator('tbody tr:has(td:not([colspan]))'),
        ).toHaveCount(0);
      }
      checks.push(
        'actual permission-set revocation denies budget/headcount list and Excel; contract scope shrinks to empty',
      );
      await authz.permissionSets.update(key, set);
      await page.goto(base);
      await expect(page.locator('tbody tr')).toHaveCount(1);
      checks.push(
        'grant restoration restores report without changing source data',
      );
    } finally {
      await writeFile(
        path.join(h.screenshotsDir, 'reports-evidence.json'),
        JSON.stringify({ checks, screenshots }, null, 2),
      );
      await h.close();
    }
  },
  240000,
);
