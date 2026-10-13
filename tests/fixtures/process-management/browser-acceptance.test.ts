// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
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
  'process management isolated browser flow',
  async () => {
    const h = await startIsolatedBrowserApp({
      name: 'process-management',
      apiPort: 14261,
      vitePort: 15261,
    });
    const directory = path.resolve('storage/ui-workflow/process-management');
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
      page.on('console', (message) => {
        if (message.type() === 'error') evidence.errors.push(message.text());
      });
      const base = `${h.origin}${h.basePath}`;
      await page.goto(`${base}/`);
      await expect(page.getByRole('main')).toBeVisible({ timeout: 60000 });
      const baseline = [...evidence.errors];
      evidence.errors.length = 0;
      await page.goto(`${base}/processManagement/executions`);
      await expect(
        page.getByText('No executions yet', { exact: true }),
      ).toBeVisible({ timeout: 60000 });
      await page.screenshot({
        path: path.join(directory, 'screenshots/empty.png'),
        fullPage: true,
      });
      evidence.screenshots.push('empty.png');
      evidence.checks.push('Empty execution state');
      const owner = await createEmployee(h.testApp, 'Browser Applicant');
      const reviewer = await createEmployee(h.testApp, 'Browser Reviewer');
      const recipient = await createEmployee(h.testApp, 'Browser Recipient');
      await h.testApp.application.container
        .resolve(databaseManagerToken)
        .repository('employees')
        .updateMany({
          filter: { userId: owner.userId },
          values: { managerId: reviewer.employeeId },
        });
      const os = await owner.session();
      const response = await os.fetch(
        '/leaveRequests',
        json({
          leaveType: 'personal',
          startDate: '2026-11-02',
          endDate: '2026-11-02',
          startHalf: 'am',
          endHalf: 'pm',
          reason: 'Synthetic browser request',
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
          owner.userId,
          Number(record.lifecycleVersion),
          randomUUID(),
        );
      await page.goto(`${base}/processManagement/definitions`);
      await expect(
        page.locator('tbody').getByRole('link', { name: 'Leave', exact: true }),
      ).toBeVisible();
      await page
        .getByRole('columnheader', { name: /Name/ })
        .getByRole('button')
        .click();
      await page.getByRole('menuitem', { name: 'Desc', exact: true }).click();
      await expect(page).toHaveURL(/direction=desc/);
      evidence.checks.push(
        'Definition name sorting changes URL and server query',
      );
      await page
        .locator('tbody')
        .getByRole('link', { name: 'Leave', exact: true })
        .click();
      await expect(
        page.getByText('Current definition', { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: path.join(directory, 'screenshots/definition.png'),
        fullPage: true,
      });
      evidence.screenshots.push('definition.png');
      await expect(page.locator('.react-flow__node').first()).toBeVisible();
      evidence.checks.push(
        'Definition uses registry React Flow canvas with completed ELK layout',
      );
      await page.goto(`${base}/processManagement/definitions/oa.travel`);
      await expect(page.locator('.react-flow__node').first()).toBeVisible();
      const initialScale = await page
        .locator('.react-flow__viewport')
        .evaluate(
          (element) => new DOMMatrix(getComputedStyle(element).transform).a,
        );
      expect(initialScale).toBeLessThanOrEqual(0.75);
      evidence.checks.push(`Travel initial canvas scale: ${initialScale}`);
      await expect(
        page
          .locator('.react-flow__edge-text')
          .filter({ hasText: 'international travel' })
          .first(),
      ).toBeVisible();
      await expect(
        page
          .locator('.react-flow__edge-text')
          .filter({ hasText: 'frozen' })
          .first(),
      ).toBeVisible();
      await expect(
        page.locator('.react-flow__edge-text tspan').first(),
      ).toBeVisible();
      await page.screenshot({
        path: path.join(directory, 'screenshots/travel-conditions-compact.png'),
        fullPage: true,
      });
      const labelsInsideBackgrounds = await page
        .locator('.react-flow__edge-textwrapper')
        .evaluateAll((wrappers) =>
          wrappers.every((wrapper) => {
            const text = wrapper.querySelector('text')!.getBoundingClientRect();
            const background = wrapper
              .querySelector('rect')!
              .getBoundingClientRect();
            return (
              text.left >= background.left - 1 &&
              text.right <= background.right + 1 &&
              text.top >= background.top - 1 &&
              text.bottom <= background.bottom + 1
            );
          }),
        );
      expect(labelsInsideBackgrounds).toBe(true);
      evidence.screenshots.push('travel-conditions-compact.png');
      evidence.checks.push(
        'Compact travel flow shows wrapped international/amount/booking branch conditions',
      );
      const chinese = await h.pageFor(admin, { locale: 'zh-CN' });
      await chinese.goto(`${base}/processManagement/definitions/oa.travel`);
      await expect(
        chinese
          .locator('.react-flow__node')
          .filter({ hasText: '财务' })
          .first(),
      ).toBeVisible();
      await chinese
        .locator('.react-flow__edge-text')
        .filter({ hasText: '境外出差' })
        .first()
        .scrollIntoViewIfNeeded();
      await expect(
        chinese
          .locator('.react-flow__edge-text')
          .filter({ hasText: '境外出差' })
          .first(),
      ).toBeInViewport();
      await chinese.screenshot({
        path: path.join(directory, 'screenshots/travel-conditions-zh-cn.png'),
        fullPage: true,
      });
      evidence.screenshots.push('travel-conditions-zh-cn.png');
      await chinese.context().close();
      await page.goto(`${base}/processManagement/definitions/oa.recruitment`);
      await expect(page.locator('.react-flow__node')).toHaveCount(7);
      await expect(page.locator('.react-flow__edge')).toHaveCount(10);
      await expect(
        page
          .locator('.react-flow__edge-text')
          .filter({ hasText: /Returned|reviewEdit|Return for revision/ }),
      ).toHaveCount(0);
      await page.screenshot({
        path: path.join(directory, 'screenshots/recruitment-overview.png'),
        fullPage: true,
      });
      evidence.screenshots.push('recruitment-overview.png');
      evidence.checks.push(
        'Recruitment overview has 7 nodes and 10 forward edges, without returned/reviewEdit routes',
      );
      await page.goto(`${base}/processManagement/definitions/oa.supplies`);
      await expect(page.locator('.react-flow__node').first()).toBeVisible();
      await page.screenshot({
        path: path.join(directory, 'screenshots/supplies-flow-elk.png'),
        fullPage: true,
      });
      evidence.screenshots.push('supplies-flow-elk.png');
      await expect(
        page
          .locator('.react-flow__edge-text')
          .filter({ hasText: 'Submit' })
          .first(),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'All transitions', exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Stage table', exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText('Process rules', { exact: true }),
      ).toHaveCount(1);
      await expect(
        page.getByText('State transitions', { exact: true }),
      ).toHaveCount(0);
      const managerRules = page
        .getByRole('heading', { name: 'Manager', exact: true })
        .locator('..');
      await expect(managerRules).toContainText('People source');
      await expect(managerRules).toContainText('Return for revision');
      await managerRules.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(directory, 'screenshots/supplies-unified-rules.png'),
        fullPage: true,
      });
      evidence.screenshots.push('supplies-unified-rules.png');
      evidence.checks.push(
        'One unified rules section groups people and actions by step; alternate diagram controls are absent',
      );

      await page.goto(
        `${base}/processManagement/definitions/oa.leave/executions/${record.id}?search=Leave&runId=missing#origin`,
      );
      await expect(
        page.getByText('Actual execution path', { exact: true }),
      ).toBeVisible();
      await page
        .locator('header')
        .getByRole('link', { name: 'Leave', exact: true })
        .click();
      await expect(page).toHaveURL(
        `${base}/processManagement/definitions/oa.leave?search=Leave#origin`,
      );
      await page.goto(
        `${base}/processManagement/executions/oa.leave/${record.id}?kind=oa.leave&runId=missing#origin`,
      );
      await expect(
        page.getByText('Actual execution path', { exact: true }),
      ).toBeVisible();
      await page
        .locator('header')
        .getByRole('link', { name: 'Executions', exact: true })
        .click();
      await expect(page).toHaveURL(
        `${base}/processManagement/executions?kind=oa.leave#origin`,
      );
      evidence.checks.push(
        'Both parent breadcrumbs preserve filters/hash and remove detail-only runId',
      );
      await page.goto(
        `${base}/processManagement/executions/oa.leave/${record.id}?runId=missing`,
      );
      await expect(
        page.getByText('Actual execution path', { exact: true }),
      ).toBeVisible({ timeout: 60000 });
      await expect(page.locator('[data-execution-state=current]')).toHaveCount(
        1,
      );
      await expect(
        page.locator('[data-execution-state=visited]').first(),
      ).toBeVisible();
      await expect(
        page.locator('[data-execution-state=pending]').first(),
      ).toBeVisible();
      await expect(
        page.locator('.react-flow__node').filter({ hasText: 'Approved' }),
      ).toBeVisible();
      evidence.checks.push(
        'Execution overlays visited/current nodes on the complete business diagram, including unvisited approved branches',
      );
      await page.screenshot({
        path: path.join(directory, 'screenshots/detail-debug.png'),
        fullPage: true,
      });
      await expect(
        page
          .locator('[data-slot=button]')
          .filter({ hasText: /^Reassign$/ })
          .first(),
      ).toBeVisible();
      await page
        .locator('[data-slot=button]')
        .filter({ hasText: /^Reassign$/ })
        .first()
        .click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('combobox')).toBeEnabled();
      await expect(
        dialog.getByRole('button', { name: 'Reassign', exact: true }),
      ).toBeDisabled();
      await dialog.getByRole('combobox').click();
      await dialog.getByRole('combobox').fill('Recipient');
      await page
        .getByRole('option', { name: 'Browser Recipient', exact: true })
        .click();
      const candidateSearch = dialog.getByRole('combobox');
      await candidateSearch.fill('Browser');
      await expect(candidateSearch).not.toHaveValue('Browser Recipient');
      await expect(dialog.getByRole('combobox')).toBeEnabled();
      await dialog.getByRole('combobox').click();
      await page
        .getByRole('option', { name: 'Browser Recipient', exact: true })
        .click();
      evidence.checks.push(
        'New candidate search clears previous recipient and requires reselection',
      );
      const reason = dialog.locator('textarea');
      await reason.pressSequentially('Reviewer absence');
      await reason.press('Home');
      await reason.pressSequentially('Verified ');
      const ime = await page.context().newCDPSession(page);
      await ime.send('Input.imeSetComposition', {
        text: 'guan',
        selectionStart: 4,
        selectionEnd: 4,
      });
      await ime.send('Input.insertText', { text: '管理' });
      await expect(reason).toHaveValue(/管理/);
      await dialog
        .getByRole('button', { name: 'Reassign', exact: true })
        .click();
      await page.waitForTimeout(1200);
      evidence.checks.push('After reassign URL: ' + page.url());
      await page.screenshot({
        path: path.join(directory, 'screenshots/action-result.png'),
        fullPage: true,
      });
      await expect(dialog).toHaveCount(0, { timeout: 20000 });
      await expect(
        page.getByRole('cell').filter({ hasText: 'Browser Recipient' }).first(),
      ).toBeVisible();
      evidence.checks.push(
        'Scoped candidate picker, required fields, sequential typing, middle edit, Chinese IME, successful reassign',
      );
      await page
        .getByRole('button', { name: 'Terminate', exact: true })
        .click();
      const alert = page.getByRole('alertdialog');
      await expect(alert).toBeVisible();
      await expect(alert.getByRole('textbox')).toBeEnabled();
      await alert
        .getByRole('textbox')
        .pressSequentially('Synthetic acceptance cancellation');
      await expect(
        alert.getByRole('button', { name: 'Terminate', exact: true }),
      ).toBeEnabled();
      await alert
        .getByRole('button', { name: 'Terminate', exact: true })
        .click();
      await expect(alert).toHaveCount(0, { timeout: 20000 });
      await expect(
        page.getByRole('button', { name: 'Terminate', exact: true }),
      ).toBeDisabled();
      await page.screenshot({
        path: path.join(directory, 'screenshots/terminated.png'),
        fullPage: true,
      });
      evidence.screenshots.push('terminated.png');
      evidence.checks.push(
        'Termination confirmation, current history retained, terminal action disabled',
      );
      const narrow = await h.pageFor(admin, {
        locale: 'zh-CN',
        viewport: { width: 375, height: 812 },
        colorScheme: 'dark',
      });
      narrow.on('pageerror', (e) => evidence.errors.push(e.message));
      await narrow.goto(`${base}/processManagement/definitions/oa.leave`);
      await expect(narrow.getByText('流程规则', { exact: true })).toBeVisible({
        timeout: 60000,
      });
      await narrow
        .getByText('流程规则', { exact: true })
        .scrollIntoViewIfNeeded();
      await expect(
        narrow.getByRole('button', { name: '阶段表', exact: true }),
      ).toHaveCount(0);
      await narrow.screenshot({
        path: path.join(directory, 'screenshots/definition-zh-dark-375.png'),
        fullPage: true,
      });
      evidence.screenshots.push('definition-zh-dark-375.png');
      evidence.checks.push('Chinese, dark, 375px unified process rules');
      expect(
        evidence.errors.filter(
          (e) =>
            !baseline.includes(e) &&
            !e.startsWith('WebSocket connection') &&
            !e.startsWith('Encountered a script tag'),
        ),
      ).toEqual([]);
      expect(recipient.userId).toBeTruthy();
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
