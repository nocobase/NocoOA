// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { databaseManagerToken } from '@nocobase/db';
import { startIsolatedBrowserApp } from '../browser/harness.js';
import { createEmployee } from '../../logic/employees/helpers.js';
import { organizationServiceToken } from '../../../server/providers/org/index.js';
import { headcountServiceToken } from '../../../server/providers/headcounts/contract.js';
import { salaryGradeServiceToken } from '../../../server/providers/job-grades/contract.js';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { calendarServiceToken } from '../../../server/providers/platform/index.js';
it.runIf(process.env.OA_BROWSER_ACCEPTANCE === '1')(
  'recruitment real-role browser acceptance on isolated main App',
  async () => {
    const h = await startIsolatedBrowserApp({
      name: 'recruitment',
      apiPort: 14139,
      vitePort: 15139,
    });
    try {
      const c = h.testApp.application.container,
        db = c.resolve(databaseManagerToken),
        org = c.resolve(organizationServiceToken);
      const head = await createEmployee(h.testApp, 'Recruitment Browser Head'),
        hrbp = await createEmployee(h.testApp, 'Recruitment Browser HRBP'),
        director = await createEmployee(
          h.testApp,
          'Recruitment Browser Director',
        ),
        gm = await createEmployee(h.testApp, 'Recruitment Browser GM');
      const ctx = { actorId: head.userId };
      for (const [code, person] of [
        ['hrbp', hrbp],
        ['hrDirector', director],
        ['gm', gm],
      ] as const)
        await org.addDutyRoleMember(code, person.userId, ctx);
      const dept = await org.createDepartment(
          { title: 'Browser Hiring Department', managerId: head.userId },
          ctx,
        ),
        position = await org.createPosition(
          { code: randomUUID(), title: 'Browser Engineer' },
          ctx,
        ),
        grade = await org.createGrade(
          { code: randomUUID(), title: 'Browser Associate', rank: 1 },
          ctx,
        );
      const year = Number(
        c.resolve(calendarServiceToken).localDate(new Date()).slice(0, 4),
      );
      const command = () => ({
        ...ctx,
        requestKey: randomUUID(),
        reason: 'Isolated browser setup',
      });
      await db.transaction(async (tx) => {
        const initial = await c.resolve(headcountServiceToken).create(
          {
            ...command(),
            departmentId: dept.id,
            positionId: position.id,
            year,
            limit: 10,
          },
          tx,
        );
        return c.resolve(headcountServiceToken).reconcile(
          {
            ...command(),
            accountId: initial.id,
            expectedVersion: initial.version,
            employeeIds: [],
          },
          tx,
        );
      });
      const current = await db.transaction((tx) =>
        c.resolve(salaryGradeServiceToken).current(tx),
      );
      await db.transaction((tx) =>
        c.resolve(salaryGradeServiceToken).publish(
          {
            ...command(),
            expectedVersion: current.version,
            bands: [
              ...(current.revision?.bands ?? []),
              { gradeId: grade.id, minimumCents: 10000, maximumCents: 20000 },
            ],
          },
          tx,
        ),
      );
      const session = await head.session(),
        page = await h.pageFor(session);
      const base = `${h.origin}${h.basePath}`;
      page.setDefaultTimeout(20000);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${base}/recruitment-requests`);
      await page
        .getByRole('heading', { name: 'Recruitment requests', exact: true })
        .waitFor({ timeout: 60000 });
      await page.route('**/api/recruitmentRequests/createOptions', (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { message: 'Synthetic availability failure' },
          }),
        }),
      );
      await page
        .getByRole('button', { name: 'New recruitment request', exact: true })
        .click();
      await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
      await page.unroute('**/api/recruitmentRequests/createOptions');
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await page
        .locator('#recruitment-jobDescription')
        .fill('Browser synthetic engineer demand');
      await page.locator('#recruitment-quantity').fill('2');
      for (const [label, text] of [
        ['Position', 'Browser Engineer'],
        ['Grade', 'Browser Associate'],
        [
          'Annual headcount',
          `Browser Hiring Department / Browser Engineer / ${year}`,
        ],
      ]) {
        await page.getByRole('combobox', { name: label, exact: false }).click();
        await page.getByRole('option', { name: text, exact: true }).click();
      }
      await page.locator('#recruitment-minimumCents').fill('120.00');
      await page.locator('#recruitment-maximumCents').fill('180.00');
      await page
        .locator('#recruitment-expectedStartDate')
        .fill(`${year}-12-01`);
      await page
        .locator('#recruitment-reason')
        .fill('Synthetic acceptance demand');
      await page
        .locator('#recruitment-command-reason')
        .fill('Create synthetic draft');
      await page.screenshot({
        path: `${h.screenshotsDir}/create-desktop.png`,
        fullPage: true,
      });
      const createResponse = page.waitForResponse(
        (r) =>
          r.url().endsWith('/api/recruitmentRequests') &&
          r.request().method() === 'POST',
      );
      await page
        .getByRole('button', { name: 'Save recruitment request', exact: true })
        .click();
      const created = await createResponse;
      expect(created.status()).toBe(200);
      const id = (await created.json()).data.record.id;
      const detailResponse = await session.fetch(`/recruitmentRequests/${id}`);
      expect(detailResponse.status).toBe(200);
      expect((await detailResponse.json()).data.canSubmit).toBe(true);
      const otherDetail = await (
        await director.session()
      ).fetch(`/recruitmentRequests/${id}`);
      expect(otherDetail.status).toBe(200);
      expect((await otherDetail.json()).data.canSubmit).toBe(false);
      await org.updateDepartment(dept.id, { managerId: gm.userId }, ctx);
      expect(
        (await (await session.fetch(`/recruitmentRequests/${id}`)).json()).data
          .canSubmit,
      ).toBe(false);
      await org.updateDepartment(dept.id, { managerId: head.userId }, ctx);
      await page.goto(`${base}/recruitment-requests/${id}/edit`);
      await page
        .locator('#recruitment-jobDescription')
        .fill('Unsaved navigation protection');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('alertdialog').waitFor();
      await page
        .getByRole('button', { name: 'Discard changes', exact: true })
        .click();
      await page.goto(`${base}/recruitment-requests/${id}/edit`);
      await page
        .locator('#recruitment-jobDescription')
        .fill('Edited browser synthetic demand');
      await page
        .locator('#recruitment-command-reason')
        .fill('Edit synthetic draft');
      const editResponse = page.waitForResponse(
        (r) =>
          r.url().endsWith(`/api/recruitmentRequests/${id}`) &&
          r.request().method() === 'PATCH',
      );
      await page
        .getByRole('button', { name: 'Save recruitment request', exact: true })
        .click();
      expect((await editResponse).status()).toBe(200);
      await page.goto(`${base}/recruitment-requests/${id}`);
      await page.locator('a[href$="/action/submit"]').click();
      await page.locator('#recruitment-reason').fill('Submit synthetic draft');
      const submitResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith(`/recruitmentRequests/${id}/transitions`),
      );
      await page
        .getByRole('button', { name: 'Submit', exact: true })
        .last()
        .click();
      expect((await submitResponse).status()).toBe(200);
      await page
        .getByText('HRBP', { exact: true })
        .first()
        .waitFor({ timeout: 20000 });
      const reviewer = await h.pageFor(await hrbp.session());
      await reviewer.goto(`${base}/recruitment-requests/${id}`);
      await reviewer
        .locator('a[href$="/review-edit"]')
        .waitFor({ timeout: 60000 });
      await reviewer.locator('a[href$="/review-edit"]').click();
      await reviewer.locator('#recruitment-quantity').fill('3');
      await reviewer
        .locator('#recruitment-command-reason')
        .fill('Reviewer amendment');
      const reviewResponse = reviewer.waitForResponse(
        (r) =>
          r.url().endsWith(`/api/recruitmentRequests/${id}/reviewEdit`) &&
          r.request().method() === 'POST',
      );
      await reviewer
        .getByRole('button', { name: 'Save recruitment request', exact: true })
        .click();
      expect((await reviewResponse).status()).toBe(200);
      await reviewer.goto(`${base}/recruitment-requests/${id}`);
      await reviewer.locator('a[href*="/action/approve/"]').first().click();
      await reviewer.locator('#recruitment-reason').fill('HRBP approves');
      await reviewer
        .getByRole('button', { name: 'Approve', exact: true })
        .last()
        .click();
      await reviewer
        .getByRole('alertdialog')
        .getByRole('button', { name: 'Approve', exact: true })
        .click();
      const restricted = await h.pageFor(await director.session());
      await restricted.goto(`${base}/recruitment-requests/${id}/review-edit`);
      await restricted
        .locator('#recruitment-quantity')
        .waitFor({ timeout: 60000 });
      expect(
        await restricted.locator('#recruitment-jobDescription').count(),
      ).toBe(0);
      expect(
        await restricted.getByLabel('Grade', { exact: false }).count(),
      ).toBe(1);
      await restricted.screenshot({
        path: `${h.screenshotsDir}/director-restricted.png`,
        fullPage: true,
      });
      await restricted
        .getByRole('button', { name: 'Cancel', exact: true })
        .click();
      await org.removeDutyRoleMember('hrDirector', director.userId, ctx);
      const permissionSets = c.resolve(authorizationToken).permissionSets;
      const employeeDefaults = await permissionSets.get(
        'oa-recruitment-employee',
      );
      if (!employeeDefaults)
        throw new Error('Main recruitment defaults missing');
      await permissionSets.update(employeeDefaults.key, {
        ...employeeDefaults,
        grants: [],
      });
      await restricted.reload();
      await restricted
        .getByText('Access denied', { exact: true })
        .waitFor({ timeout: 20000 });
      expect(
        await restricted.getByText('180.00', { exact: true }).count(),
      ).toBe(0);
      await permissionSets.update(employeeDefaults.key, employeeDefaults);
      for (const locale of ['en-US', 'zh-CN'])
        for (const mode of ['light', 'dark'])
          for (const preset of ['default', 'compact']) {
            const mobile = await h.pageFor(session, {
              locale,
              viewport: { width: 375, height: 812 },
            });
            await mobile.addInitScript(
              ({ color, preset }) => {
                localStorage.setItem('nocobase:main:theme:color-scheme', color);
                localStorage.setItem('nocobase:main:theme:preset', preset);
              },
              { color: mode, preset },
            );
            await mobile.goto(`${base}/recruitment-requests/${id}`);
            await mobile.getByRole('dialog').waitFor({ timeout: 60000 });
            await mobile
              .getByText(
                locale === 'en-US'
                  ? 'Edited browser synthetic demand'
                  : 'Edited browser synthetic demand',
                { exact: true },
              )
              .waitFor();
            expect(
              await mobile.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
            ).toBe(true);
            await mobile.screenshot({
              path: `${h.screenshotsDir}/mobile-${locale}-${mode}-${preset}.png`,
              fullPage: true,
            });
            await mobile.context().close();
          }
      await page.goto(`${base}/recruitment-requests`);
      const search = page.getByRole('textbox', {
        name: 'Search job description or reason',
        exact: true,
      });
      await search.waitFor();
      await search.focus();
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.imeSetComposition', {
        text: 'Edited browser',
        selectionStart: 0,
        selectionEnd: 14,
      });
      expect(new URL(page.url()).searchParams.get('q')).toBeNull();
      const filterResponse = page.waitForResponse(
        (response) =>
          response.url().includes('/api/recruitmentRequests?') &&
          new URL(response.url()).searchParams.get('q') === 'Edited browser',
      );
      await cdp.send('Input.insertText', { text: 'Edited browser' });
      expect((await filterResponse).status()).toBe(200);
      await expect
        .poll(() => new URL(page.url()).searchParams.get('q'))
        .toBe('Edited browser');
      await page
        .getByRole('link', { name: 'Browser Engineer', exact: true })
        .waitFor();
      await page.screenshot({
        path: `${h.screenshotsDir}/ime-filtered-list.png`,
        fullPage: true,
      });
      expect(errors).toEqual([]);
      console.info(
        'RECRUITMENT_BROWSER_ACCEPTANCE',
        JSON.stringify({
          create: 200,
          edit: 200,
          reviewEdit: 200,
          realRoles: ['head', 'hrbp', 'hrDirector'],
          mobile: 8,
          screenshots: h.screenshotsDir,
        }),
      );
    } finally {
      await h.close();
    }
  },
  240000,
);
