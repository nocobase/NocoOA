// @vitest-environment node
import path from 'node:path';
import { it, expect } from 'vitest';
import { expect as browserExpect } from '@playwright/test';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { startIsolatedBrowserApp } from './harness.js';
import { createEmployee } from '../../logic/employees/helpers.js';

it.runIf(process.env.OA_PAGE_PATROL_VISUAL === '1')(
  'checks representative pages after actual theme initialization and CSS transitions settle',
  async () => {
    const h = await startIsolatedBrowserApp({
      name: 'page-patrol-visual-2026-10-14',
      apiPort: 14172,
      vitePort: 15172,
    });
    const errors: string[] = [];
    try {
      const actor = await createEmployee(
        h.testApp,
        'Visual patrol synthetic administrator',
      );
      await h.testApp.application.container
        .resolve(authorizationToken)
        .permissionSets.assign({
          permissionSet:
            h.testApp.application.config.get<string>(
              'authorization.permissionSets.rootSet',
            ) ?? 'root',
          subject: { type: 'user', id: actor.userId },
        });
      const session = await actor.session();
      for (const locale of ['en-US', 'zh-CN'])
        for (const mode of ['light', 'dark'])
          for (const preset of ['default', 'compact'])
            for (const width of [1440, 375]) {
              const page = await h.pageFor(session, {
                locale,
                viewport: { width, height: 900 },
                colorScheme: mode as 'light' | 'dark',
              });
              page.on('pageerror', (error) => errors.push(error.message));
              await page.addInitScript(
                ({ base, mode, preset }) => {
                  const scope =
                    encodeURIComponent(base.replace(/^\/+|\/+$/gu, '')) ||
                    '%2F';
                  localStorage.setItem(
                    `nocobase:${scope}:theme:color-scheme`,
                    mode,
                  );
                  localStorage.setItem(
                    `nocobase:${scope}:theme:preset`,
                    preset,
                  );
                },
                { base: h.basePath, mode, preset },
              );
              for (const route of [
                '/reports',
                '/default-access',
                '/permission-sets',
                '/paymentRequests',
                '/recruitment-requests',
                '/work-items',
              ]) {
                await page.goto(`${h.origin}${h.basePath}${route}`, {
                  waitUntil: 'domcontentloaded',
                });
                await browserExpect(page.getByRole('main').first()).toBeVisible(
                  { timeout: 60000 },
                );
                await page.waitForLoadState('networkidle');
                // Color/background transitions are real UI behavior; screenshots taken
                // immediately after changing classes misrepresent the finished theme.
                await page.waitForTimeout(400);
                expect(
                  await page.evaluate(
                    () => document.documentElement.scrollWidth,
                  ),
                ).toBeLessThanOrEqual(width + 1);
                expect(
                  await page.evaluate(() =>
                    document.documentElement.classList.contains('dark'),
                  ),
                ).toBe(mode === 'dark');
                expect(
                  await page.evaluate(
                    () => document.documentElement.dataset.theme,
                  ),
                ).toBe(preset);
                expect(await page.getByRole('main').count()).toBe(1);
                await page.screenshot({
                  path: path.join(
                    h.screenshotsDir,
                    `${route.slice(1)}-${locale}-${mode}-${preset}-${width}.png`,
                  ),
                  fullPage: true,
                });
              }
              await page.context().close();
            }
      const guest = await h.browser.newPage();
      guest.on('pageerror', (error) => errors.push(error.message));
      for (const route of [
        '/login',
        '/register',
        '/forgot-password',
        '/reset-password',
        '/device',
      ]) {
        await guest.goto(`${h.origin}${h.basePath}${route}`, {
          waitUntil: 'domcontentloaded',
        });
        await pageSettled();
        await guest.screenshot({
          path: path.join(h.screenshotsDir, `public-${route.slice(1)}.png`),
          fullPage: true,
        });
        expect(await guest.locator('body').innerText()).not.toBe('');
      }
      async function pageSettled() {
        await guest.waitForLoadState('networkidle');
      }
      expect(errors).toEqual([]);
    } finally {
      await h.close();
    }
  },
  600000,
);
