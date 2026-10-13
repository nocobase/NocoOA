// @vitest-environment node
import path from 'node:path';
import { expect, it } from 'vitest';
import { expect as browserExpect } from '@playwright/test';
import { startIsolatedBrowserApp } from '../../fixtures/browser/harness.js';
import { createEmployee, grantToUser } from '../employees/helpers.js';
import { organizationServiceToken } from '../../../server/providers/org/index.js';

it.skipIf(process.env.OA_BROWSER_ACCEPTANCE !== '1')(
  'renders consistent form drawers and guards dirty close at desktop and mobile widths',
  async () => {
    const app = await startIsolatedBrowserApp({
      name: 'form-drawer-consistency',
      apiPort: 14159,
      vitePort: 15159,
    });
    try {
      const actor = await createEmployee(app.testApp, 'Drawer browser HR');
      const org = app.testApp.application.container.resolve(
        organizationServiceToken,
      );
      for (const role of ['hr', 'admin'])
        await org.addDutyRoleMember(role, actor.userId, {
          actorId: actor.userId,
        });
      await grantToUser(
        app.testApp,
        'drawer-node-configuration',
        [
          {
            resource: { type: 'page', id: 'oa.processManagement' },
            actions: [{ action: 'access' }],
          },
          {
            resource: { type: 'settings', id: 'oa.platform.rules' },
            actions: [{ action: 'read' }, { action: 'update' }],
          },
          {
            resource: { type: 'composite', id: 'oa.processManagement.leave' },
            actions: [
              {
                action: 'definitionRead',
                policy: {
                  type: 'composite',
                  scopes: { leaveRequests: 'allRecords' },
                },
              },
            ],
          },
        ],
        actor.userId,
      );
      const session = await actor.session();
      const page = await app.pageFor(session);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: 900 });
        for (const route of [
          '/work-items/new?mode=created#filters',
          '/approvals/mine/newLeave',
          '/certificates/new',
        ]) {
          await page.goto(`${app.origin}${app.basePath}${route}`, {
            waitUntil: 'domcontentloaded',
          });
          const drawer = page
            .locator(
              '[data-slot="route-overlay-content"][data-presentation="drawer"]',
            )
            .last();
          await browserExpect(drawer).toBeVisible({ timeout: 90000 });
          await browserExpect(
            drawer.locator('[data-slot="route-overlay-footer"] button').first(),
          ).toBeVisible({ timeout: 30000 });
          await browserExpect
            .poll(async () => {
              const box = await drawer.boundingBox();
              return box ? box.x + box.width : Infinity;
            })
            .toBeLessThanOrEqual(width + 1);
          const bounds = await drawer.boundingBox();
          expect(bounds!.x).toBeGreaterThanOrEqual(0);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
          expect(
            await drawer.evaluate((e) => e.scrollWidth > e.clientWidth),
          ).toBe(false);
          await page.screenshot({
            path: path.join(
              app.screenshotsDir,
              `${width}-${route.split('?')[0].replaceAll('/', '_')}.png`,
            ),
          });
        }
      }
      await page.goto(
        `${app.origin}${app.basePath}/work-items/new?mode=created#filters`,
        { waitUntil: 'domcontentloaded' },
      );
      await page.locator('#task-title').fill('Unsaved drawer task');
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await browserExpect(page.getByRole('alertdialog')).toBeVisible();
      await browserExpect(page.locator('#task-title')).toHaveValue(
        'Unsaved drawer task',
      );
      await page
        .getByRole('button', { name: 'Continue editing', exact: true })
        .click();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page
        .getByRole('button', { name: 'Discard and leave', exact: true })
        .click();
      await browserExpect(page).toHaveURL(
        `${app.origin}${app.basePath}/work-items?mode=created#filters`,
      );
      await page.goto(
        `${app.origin}${app.basePath}/processManagement/definitions/oa.leave/nodes/manager/settings`,
        { waitUntil: 'domcontentloaded' },
      );
      const configurationDialog = page
        .locator('[data-slot="route-overlay-content"]')
        .last();
      await browserExpect(configurationDialog).toBeVisible({ timeout: 90000 });
      await browserExpect(configurationDialog).toHaveAttribute(
        'data-presentation',
        'dialog',
      );
      await browserExpect(
        configurationDialog.getByLabel(/New value/),
      ).toBeVisible();
      await page.screenshot({
        path: path.join(app.screenshotsDir, 'node-settings-dialog-375.png'),
      });
      expect(errors).toEqual([]);
    } finally {
      await app.close();
    }
  },
  240000,
);
