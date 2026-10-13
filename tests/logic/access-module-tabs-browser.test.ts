// @vitest-environment node
import path from 'node:path';
import { it, expect } from 'vitest';
import { expect as browserExpect } from '@playwright/test';
import { startIsolatedBrowserApp } from '../fixtures/browser/harness.js';
import { createEmployee, grantToUser } from './employees/helpers.js';

it.skipIf(process.env.OA_BROWSER_ACCEPTANCE !== '1')(
  'groups role and user permissions into usable module tabs on desktop and mobile',
  async () => {
    const app = await startIsolatedBrowserApp({
      name: 'permission-module-tabs',
      apiPort: 14163,
      vitePort: 15163,
    });
    try {
      const actor = await createEmployee(app.testApp, 'Module tabs reviewer');
      await grantToUser(
        app.testApp,
        'module-tabs-reviewer',
        [
          {
            resource: { type: 'settings', id: 'authorization.permission-sets' },
            actions: [{ action: 'read' }, { action: 'update' }],
          },
          {
            resource: { type: 'settings', id: 'authorization.inspector' },
            actions: [{ action: 'inspect' }],
          },
          {
            resource: { type: 'page', id: 'oa.workbench' },
            actions: [{ action: 'access' }],
          },
          {
            resource: { type: 'page', id: 'oa.employees' },
            actions: [{ action: 'access' }],
          },
        ],
        actor.userId,
      );
      const page = await app.pageFor(await actor.session(), {
        locale: 'zh-CN',
      });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(
          `${app.origin}${app.basePath}/access/roles/user/${actor.userId}/permissions`,
        );
        const list = page.getByRole('tablist', { name: '业务模块' }).first();
        await browserExpect(list).toBeVisible({ timeout: 30000 });
        const tabs = list.getByRole('tab');
        expect(await tabs.count()).toBeGreaterThan(1);
        await tabs.last().click();
        await browserExpect(tabs.last()).toHaveAttribute(
          'aria-selected',
          'true',
        );
        await page.reload();
        await browserExpect(
          page
            .getByRole('tablist', { name: '业务模块' })
            .first()
            .getByRole('tab')
            .last(),
        ).toHaveAttribute('aria-selected', 'true');
        await tabs.first().focus();
        await page.keyboard.press('ArrowRight');
        await browserExpect(tabs.nth(1)).toBeFocused();
        for (const dark of [false, true]) {
          await page.evaluate(
            (value) => document.documentElement.classList.toggle('dark', value),
            dark,
          );
          await page.screenshot({
            path: path.join(
              app.screenshotsDir,
              `${width}-${dark ? 'dark' : 'light'}.png`,
            ),
            fullPage: true,
          });
        }
      }
      for (const locale of ['zh-CN', 'en-US']) {
        const personPage = await app.pageFor(await actor.session(), { locale });
        personPage.on('pageerror', (error) => errors.push(error.message));
        for (const width of [1440, 375]) {
          await personPage.setViewportSize({ width, height: 900 });
          await personPage.goto(
            `${app.origin}${app.basePath}/access/people/${actor.userId}/sources`,
          );
          const userTabs = personPage
            .getByRole('tablist', {
              name: locale === 'zh-CN' ? '业务模块' : 'Business modules',
            })
            .getByRole('tab');
          await browserExpect(userTabs.first()).toBeVisible({ timeout: 30000 });
          await userTabs.last().click();
          await browserExpect(userTabs.last()).toHaveAttribute(
            'aria-selected',
            'true',
          );
          await personPage.reload();
          await browserExpect(userTabs.last()).toHaveAttribute(
            'aria-selected',
            'true',
          );
          await userTabs.first().click();
          await browserExpect(userTabs.first()).toHaveAttribute(
            'aria-selected',
            'true',
          );
          for (const dark of [false, true]) {
            await personPage.evaluate(
              (value) =>
                document.documentElement.classList.toggle('dark', value),
              dark,
            );
            await personPage.screenshot({
              path: path.join(
                app.screenshotsDir,
                `user-${locale}-${width}-${dark ? 'dark' : 'light'}.png`,
              ),
              fullPage: true,
            });
          }
        }
        await personPage.context().close();
      }
      await page.goto(
        `${app.origin}${app.basePath}/access/roles/user/${actor.userId}/permissions/module-tabs-reviewer/edit`,
      );
      const switches = page.getByRole('switch');
      await browserExpect(switches.first()).toBeVisible({ timeout: 30000 });
      let leavePrompts = 0;
      page.on('dialog', async (dialog) => {
        leavePrompts++;
        await dialog.dismiss();
      });
      await switches.first().click();
      const editTabs = page
        .getByRole('tablist', { name: '业务模块' })
        .last()
        .getByRole('tab');
      await editTabs.last().click();
      await browserExpect(editTabs.last()).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(leavePrompts).toBe(0);
      await browserExpect(
        page.getByRole('button', { name: '保存', exact: true }),
      ).toBeEnabled();
      expect(errors).toEqual([]);
    } finally {
      await app.close();
    }
  },
  120000,
);
