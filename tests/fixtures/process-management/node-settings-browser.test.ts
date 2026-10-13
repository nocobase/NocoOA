// @vitest-environment node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { it } from 'vitest';
import { expect } from '@playwright/test';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import { databaseManagerToken } from '@nocobase/db';
import { startIsolatedBrowserApp } from '../browser/harness.js';
import { createEmployee } from '../../logic/employees/helpers.js';
import { json } from '../../logic/org/helpers.js';
import { leaveServiceToken } from '../../../server/providers/leave/index.js';

it.runIf(process.env.OA_BROWSER_ACCEPTANCE === '1')(
  'edits existing settings from process nodes in a compact dialog',
  async () => {
    const h = await startIsolatedBrowserApp({
      name: 'process-node-settings',
      apiPort: 14263,
      vitePort: 15263,
    });
    const directory = path.resolve('storage/ui-workflow/process-node-settings');
    const evidence = {
      checks: [] as string[],
      errors: [] as string[],
      screenshots: [] as string[],
    };
    await mkdir(path.join(directory, 'screenshots'), { recursive: true });
    try {
      const admin = await signIn(h.testApp, DEFAULT_ADMIN_CREDENTIALS);
      const page = await h.pageFor(admin, { locale: 'en-US' });
      page.setDefaultTimeout(20000);
      page.on('pageerror', (e) => evidence.errors.push(e.message));
      const base = `${h.origin}${h.basePath}`;
      await page.goto(`${base}/`);
      await expect(page.getByRole('main')).toBeVisible({ timeout: 60000 });
      const baseline = [...evidence.errors];
      evidence.errors.length = 0;
      const applicant = await createEmployee(
        h.testApp,
        'Node parameter applicant',
      );
      const reviewer = await createEmployee(
        h.testApp,
        'Node parameter reviewer',
      );
      const db = h.testApp.application.container.resolve(databaseManagerToken);
      await db.repository('employees').updateMany({
        filter: { userId: applicant.userId },
        values: { managerId: reviewer.employeeId },
      });
      const session = await applicant.session();
      const response = await session.fetch(
        '/leaveRequests',
        json({
          leaveType: 'personal',
          startDate: '2026-11-02',
          endDate: '2026-11-02',
          startHalf: 'am',
          endHalf: 'pm',
          reason: 'Synthetic node settings acceptance',
          attachments: [],
          handoverUserId: null,
          enableDelegation: false,
        }),
      );
      expect(response.status).toBe(200);
      const record = (await response.json()).data.record;
      await h.testApp.application.container
        .resolve(leaveServiceToken)
        .transition(
          record.id,
          'submit',
          applicant.userId,
          Number(record.lifecycleVersion),
          randomUUID(),
        );
      const frozen = await db
        .repository('leaveRequests')
        .findOne({ filter: { id: record.id } });
      const before = JSON.stringify(frozen?.ruleSnapshot);
      await page.goto(
        `${base}/processManagement/definitions/oa.leave?search=keep#diagram`,
      );
      const nodeButton = page.getByRole('button', {
        name: 'Edit parameters for Manager',
        exact: true,
      });
      await expect(nodeButton).toBeVisible({ timeout: 60000 });
      const configurableNode = page.locator(
        '.react-flow__node[data-id="manager"] > div',
      );
      const ordinaryNode = page.locator(
        '.react-flow__node[data-id="draft"] > div',
      );
      await expect(configurableNode).toHaveCSS('cursor', 'pointer');
      await expect(ordinaryNode).toHaveCSS('cursor', 'default');
      const borderBefore = await configurableNode.evaluate(
        (el) => getComputedStyle(el).borderColor,
      );
      await configurableNode.hover();
      await expect
        .poll(() =>
          configurableNode.evaluate((el) => getComputedStyle(el).borderColor),
        )
        .not.toBe(borderBefore);
      evidence.checks.push(
        'Only configurable nodes use pointer cursor and hover highlight',
      );
      await nodeButton.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', {
        name: 'Edit parameters for Manager',
        exact: true,
      });
      await expect(dialog).toBeVisible();
      const input = dialog.getByLabel(/New value/).filter({ visible: true });
      await expect(input).toHaveValue('3');
      await input.clear();
      await input.pressSequentially('4.5');
      await dialog.getByRole('combobox', { name: 'Parameter' }).click();
      await page
        .getByRole('option', { name: 'Leave needing HR', exact: true })
        .click();
      await dialog.getByRole('combobox', { name: 'Parameter' }).click();
      await page
        .getByRole('option', {
          name: 'Leave needing the department head',
          exact: true,
        })
        .click();
      await expect(input).toHaveValue('4.5');
      await page.screenshot({
        path: path.join(directory, 'screenshots/leave-node-en.png'),
        fullPage: true,
      });
      evidence.screenshots.push('leave-node-en.png');
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(new URL(page.url()).search).toBe('?search=keep');
      expect(new URL(page.url()).hash).toBe('#diagram');
      await expect(nodeButton).toBeFocused();
      await nodeButton.click();
      await expect(
        page
          .getByRole('dialog', {
            name: 'Edit parameters for Manager',
            exact: true,
          })
          .getByLabel(/New value/),
      ).toHaveValue('4.5');
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Cancel' })
        .click();
      const after = await db
        .repository('leaveRequests')
        .findOne({ filter: { id: record.id } });
      expect(JSON.stringify(after?.ruleSnapshot)).toBe(before);
      evidence.checks.push(
        'Keyboard node entry, draft preservation between topics, real PostgreSQL rule save, fresh reopening, query/hash/focus return, submitted request snapshot unchanged',
      );
      await page.goto(`${base}/approval-rules`);
      await expect(
        page.getByRole('heading', {
          name: 'Rule overview and history',
          exact: true,
        }),
      ).toBeVisible();
      await page.screenshot({
        path: path.join(directory, 'screenshots/rule-overview-en.png'),
        fullPage: true,
      });
      evidence.screenshots.push('rule-overview-en.png');
      await page.locator('a[href*="rule=spend.gm"]').first().click();
      await expect(
        page.getByRole('dialog').getByRole('combobox', { name: 'Parameter' }),
      ).toContainText('General manager threshold');
      await page.goto(`${base}/approval-rules/edit/spend.gm`);
      await expect(
        page.getByRole('dialog').getByRole('combobox', { name: 'Parameter' }),
      ).toContainText('General manager threshold');
      await page.goto(`${base}/vendorQualificationConfiguration`);
      await expect(page).toHaveURL(
        /processManagement\/definitions\/oa.vendorQualification$/,
      );
      evidence.checks.push(
        'Rule overview opens the selected node parameter; legacy vendor configuration redirects to its process',
      );
      await page.goto(
        `${base}/processManagement/definitions/oa.reimbursement/nodes/finance/settings`,
      );
      await expect(
        page.getByRole('dialog').getByText(/Shared setting/),
      ).toContainText('Purchase');
      evidence.checks.push('Shared threshold affected flows displayed');
      await page.goto(
        `${base}/processManagement/definitions/oa.vendorQualification/nodes/committee_v1/settings`,
      );
      await expect(
        page.getByRole('dialog').getByText(/Selected node: version 1/),
      ).toBeVisible();
      await expect(
        page.getByRole('dialog').getByText(/restart/i),
      ).toBeVisible();
      await page.screenshot({
        path: path.join(directory, 'screenshots/committee-node-en.png'),
        fullPage: true,
      });
      evidence.screenshots.push('committee-node-en.png');
      evidence.checks.push(
        'Committee current/active/latest version and restart requirement visible',
      );
      const narrow = await h.pageFor(admin, {
        locale: 'zh-CN',
        viewport: { width: 375, height: 812 },
        colorScheme: 'dark',
      });
      narrow.on('pageerror', (e) => evidence.errors.push(e.message));
      await narrow.goto(
        `${base}/processManagement/definitions/oa.leave/nodes/manager/settings`,
      );
      const small = narrow.getByRole('dialog');
      await expect(small.getByLabel(/新值/)).toHaveValue('4.5', {
        timeout: 60000,
      });
      const note = small.getByLabel(/备注/);
      await note.focus();
      const cdp = await narrow.context().newCDPSession(narrow);
      await cdp.send('Input.imeSetComposition', {
        text: 'canshu',
        selectionStart: 6,
        selectionEnd: 6,
      });
      await cdp.send('Input.insertText', { text: '参数调整' });
      await expect(note).toHaveValue('参数调整');
      const save = small.getByRole('button', { name: '保存', exact: true });
      await expect(save).toBeInViewport();
      const box = await small.boundingBox();
      expect(box!.width).toBeLessThanOrEqual(375);
      expect(box!.height).toBeLessThanOrEqual(812);
      await narrow.screenshot({
        path: path.join(directory, 'screenshots/leave-node-zh-dark-375.png'),
        fullPage: true,
      });
      evidence.screenshots.push('leave-node-zh-dark-375.png');
      evidence.checks.push(
        'Chinese dark 375px compact dialog, footer reachable, real IME composition',
      );
      expect(
        evidence.errors.filter(
          (error) =>
            !baseline.includes(error) &&
            !error.startsWith('Encountered a script tag'),
        ),
      ).toEqual([]);
    } finally {
      await writeFile(
        path.join(directory, 'browser-evidence.json'),
        JSON.stringify(evidence, null, 2),
      );
      await h.close();
    }
  },
  180000,
);
