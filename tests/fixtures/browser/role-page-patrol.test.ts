// @vitest-environment node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { it, expect } from 'vitest';
import { expect as browserExpect } from '@playwright/test';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { startIsolatedBrowserApp } from './harness.js';
import { createEmployee } from '../../logic/employees/helpers.js';
import { organizationServiceToken } from '../../../server/providers/org/index.js';
// @ts-expect-error The executable inventory is shared with the standalone Node audit.
import { pagePatrolInventory } from './page-patrol-inventory.mjs';

it.runIf(process.env.OA_PAGE_PATROL === '1')(
  'inventories registered entry pages with actual duty roles and exercises visible read-only controls',
  async () => {
    const h = await startIsolatedBrowserApp({
      name: 'role-page-patrol-2026-10-13',
      apiPort: 14171,
      vitePort: 15171,
    });
    const inventory = await pagePatrolInventory();
    const directory = path.resolve(
      'storage/ui-workflow/role-page-patrol-2026-10-13',
    );
    await mkdir(directory, { recursive: true });
    const entries: unknown[] = [];
    const defects: unknown[] = [];
    const publicRoutes = new Set([
      '/login',
      '/register',
      '/forgot-password',
      '/reset-password',
      '/device',
    ]);
    const requestedRoutes = process.env.OA_PAGE_PATROL_ROUTES?.split(',');
    const roots: string[] = inventory.routes.filter(
      (route: string) =>
        !publicRoutes.has(route) &&
        (!requestedRoutes || requestedRoutes.includes(route)),
    );
    const roles = [
      'system',
      'employee',
      'hr',
      'finance',
      'cashier',
      'admin',
      'legal',
      'purchasing',
    ].filter(
      (role) =>
        !process.env.OA_PAGE_PATROL_ROLES ||
        process.env.OA_PAGE_PATROL_ROLES.split(',').includes(role),
    );
    const evidenceName = requestedRoutes
      ? 'runtime-targeted-inventory.json'
      : 'runtime-inventory.json';
    try {
      const organization = h.testApp.application.container.resolve(
        organizationServiceToken,
      );
      for (const role of roles) {
        const actor = await createEmployee(
          h.testApp,
          `Patrol synthetic ${role}`,
        );
        if (role === 'system') {
          await h.testApp.application.container
            .resolve(authorizationToken)
            .permissionSets.assign({
              permissionSet:
                h.testApp.application.config.get<string>(
                  'authorization.permissionSets.rootSet',
                ) ?? 'root',
              subject: { type: 'user', id: actor.userId },
            });
        } else if (role !== 'employee') {
          await organization.addDutyRoleMember(role, actor.userId, {
            actorId: actor.userId,
          });
        }
        const page = await h.pageFor(await actor.session(), {
          locale: 'zh-CN',
        });
        page.setDefaultTimeout(12000);
        let current = '/';
        const errors: { route: string; message: string }[] = [];
        const requests: { route: string; status: number; url: string }[] = [];
        page.on('pageerror', (error) =>
          errors.push({ route: current, message: error.message }),
        );
        page.on('response', (response) => {
          if (response.url().includes('/api/') && response.status() >= 400)
            requests.push({
              route: current,
              status: response.status(),
              url: new URL(response.url()).pathname,
            });
        });
        // This sweep opens forms, but all writes belong to dedicated role-flow acceptance tests.
        await page.route('**/api/**', async (route) => {
          const request = route.request();
          if (
            !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) &&
            !/\/(?:auth\/|authorization\/(?:snapshot|inspect|inspectBatch|check))/u.test(
              request.url(),
            )
          ) {
            // Permission inspection and list queries are POST reads in some plugins.
            if (/inspect|snapshot|options|query|check/iu.test(request.url()))
              await route.continue();
            else await route.abort('blockedbyclient');
          } else await route.continue();
        });
        for (const route of roots) {
          current = route;
          const startErrors = errors.length;
          const startRequests = requests.length;
          try {
            await page.setViewportSize({ width: 1440, height: 900 });
            await page.goto(`${h.origin}${h.basePath}${route}`, {
              waitUntil: 'domcontentloaded',
            });
            await browserExpect(page.getByRole('main').first()).toBeVisible({
              timeout: 60000,
            });
            // Wait until lazy routes and their actual data have settled, excluding Vite's HMR channel.
            await page
              .waitForLoadState('networkidle', { timeout: 20000 })
              .catch(() => undefined);
            const main = page.getByRole('main').first();
            const text = await main.innerText();
            const denied = /无权|没有权限|访问受限|无法访问/u.test(text);
            const loadFailure = /无法加载页面|加载失败|发生错误/u.test(text);
            const controls = await main
              .locator(
                'button, a[href], input, [role="tab"], [role="combobox"]',
              )
              .evaluateAll((elements) =>
                elements
                  .filter((element) => element.getClientRects().length > 0)
                  .map((element) => ({
                    tag: element.tagName,
                    slot: element.getAttribute('data-slot'),
                    role: element.getAttribute('role'),
                    label:
                      element.getAttribute('aria-label') ??
                      element.textContent?.trim().slice(0, 80),
                    href: element.getAttribute('href'),
                    disabled: element.hasAttribute('disabled'),
                  })),
              );
            const entryDialogs = await page.getByRole('dialog').count();
            if (entryDialogs) {
              // Legacy configuration redirects intentionally open a definition
              // drawer. Its backdrop blocks the parent tabs until it is closed.
              await page.keyboard.press('Escape');
              await browserExpect(page.getByRole('dialog')).toHaveCount(0);
              await page.waitForLoadState('networkidle');
            }
            const tabChecks: string[] = [];
            if (!denied && !loadFailure) {
              const tabCount = await main.getByRole('tab').count();
              for (let index = 0; index < Math.min(tabCount, 12); index++) {
                const tab = main.getByRole('tab').nth(index);
                if ((await tab.isVisible()) && (await tab.isEnabled())) {
                  const label = await tab.innerText();
                  await page.mouse.move(0, 0);
                  await tab.click();
                  await page
                    .waitForLoadState('networkidle', { timeout: 12000 })
                    .catch(() => undefined);
                  tabChecks.push(label);
                }
              }
              // Visible creation links must lead to a real form; no submit is performed.
              const creationLinks = controls
                .filter(
                  (control: { href?: string; label?: string }) =>
                    control.href?.startsWith(h.basePath + '/') &&
                    /新建|新增|发起|预约/u.test(control.label ?? ''),
                )
                .slice(0, 5);
              for (const control of creationLinks) {
                await page.goto(`${h.origin}${control.href}`, {
                  waitUntil: 'domcontentloaded',
                });
                await page
                  .waitForLoadState('networkidle', { timeout: 12000 })
                  .catch(() => undefined);
                const opened = await page
                  .locator(
                    'main input, main textarea, [role="dialog"] input, [role="dialog"] textarea, [role="dialog"] [role="combobox"]',
                  )
                  .count();
                // A modal makes the underlying main landmark aria-hidden; read its
                // DOM text directly while the form is open rather than timing out.
                const content = await page.locator('body').innerText();
                if (
                  !opened &&
                  !/无权|没有权限|访问受限|不可用|无法访问/u.test(content)
                )
                  defects.push({
                    role,
                    route,
                    interaction: control.label,
                    target: control.href,
                    issue:
                      'Creation link has no form controls or permission explanation',
                  });
                await page.keyboard.press('Escape');
                await page.goto(`${h.origin}${h.basePath}${route}`, {
                  waitUntil: 'domcontentloaded',
                });
                await page
                  .waitForLoadState('networkidle', { timeout: 12000 })
                  .catch(() => undefined);
              }
            }
            const layouts: unknown[] = [];
            for (const width of role === 'system' ? [1440, 375] : [1440]) {
              await page.setViewportSize({ width, height: 900 });
              await page.evaluate((dark) => {
                document.documentElement.classList.remove('light', 'dark');
                document.documentElement.classList.add(dark ? 'dark' : 'light');
                document.documentElement.style.colorScheme = dark
                  ? 'dark'
                  : 'light';
              }, width === 375);
              await page.waitForTimeout(400);
              const dimensions = await page.evaluate(() => ({
                width: innerWidth,
                scrollWidth: document.documentElement.scrollWidth,
              }));
              layouts.push(dimensions);
              if (dimensions.scrollWidth > width + 1)
                defects.push({
                  role,
                  route,
                  issue: 'Document horizontal overflow',
                  ...dimensions,
                });
              if (
                role === 'system' ||
                route === '/' ||
                route === '/approvals/pending'
              )
                await page.screenshot({
                  path: path.join(
                    h.screenshotsDir,
                    `${role}-${width}-${route.replace(/\W/gu, '_') || 'home'}.png`,
                  ),
                  fullPage: true,
                });
            }
            const pageErrors = errors.slice(startErrors);
            defects.push(
              ...pageErrors.map((error) => ({
                role,
                ...error,
                issue: 'Unhandled browser exception',
              })),
            );
            entries.push({
              role,
              route,
              finalPath: new URL(page.url()).pathname,
              denied,
              loadFailure,
              controls,
              tabs: tabChecks,
              entryDialogs,
              layouts,
              pageErrors,
              failedRequests: requests.slice(startRequests),
            });
          } catch (error) {
            defects.push({
              role,
              route,
              issue: 'Sweep failed',
              message: String(error).slice(0, 800),
            });
            entries.push({ role, route, failed: true });
          }
          await writeFile(
            path.join(directory, evidenceName),
            JSON.stringify({ entries, defects }, null, 2),
          );
        }
        await page.context().close();
      }
    } finally {
      await writeFile(
        path.join(directory, 'source-inventory.json'),
        JSON.stringify(inventory, null, 2),
      );
      await h.close();
    }
    console.log(
      JSON.stringify({ entries: entries.length, defects: defects.length }),
    );
    expect(roots.length).toBeGreaterThan(0);
    expect(roles.length).toBeGreaterThan(0);
    expect(entries.length).toBe(roots.length * roles.length);
    expect(defects).toEqual([]);
  },
  3600000,
);
