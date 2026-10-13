// @vitest-environment node
import { it, expect } from 'vitest';
import { expect as browserExpect } from '@playwright/test';
import { startIsolatedBrowserApp } from '../browser/harness.js';
import { prepareNonApprovalCenter } from '../../logic/approval-center/nonapproval-helpers.js';
it.runIf(process.env.OA_NONAPPROVAL_CENTER_BROWSER === '1')(
  'actual main browser unifies ordinary tasks and personal receipts with safe owner routing',
  async () => {
    const h = await startIsolatedBrowserApp({
      name: 'nonapproval-center',
      apiPort: 14179,
      vitePort: 15179,
    });
    try {
      const f = await prepareNonApprovalCenter(h.testApp);
      const page = await h.pageFor(await f.reader.session());
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const base = `${h.origin}${h.basePath}`;
      for (const [kind, title] of [
        ['oa.workItem', 'Center ordinary duty'],
        ['oa.announcementReceipt', 'Center personal receipt'],
      ]) {
        const source = `${base}/approvals/todo?kind=${kind}#source`;
        await page.goto(source);
        await browserExpect(
          page.getByRole('link', { name: title, exact: true }),
        ).toBeVisible({ timeout: 30000 });
        await page.getByRole('link', { name: title, exact: true }).click();
        await browserExpect(page.getByRole('dialog')).toBeVisible();
        await page
          .getByRole('dialog')
          .locator('[data-slot="dialog-close"]')
          .last()
          .click();
        await browserExpect(page).toHaveURL(source);
      }
      await page.goto(`${base}/#home-source`);
      for (const [title, ownerPath] of [
        ['Center ordinary duty', 'workItem'],
        ['Center personal receipt', 'announcement'],
      ]) {
        const target = page
          .locator(`a[href*="/${ownerPath}/"]`)
          .filter({ hasText: title });
        await browserExpect(target).toBeVisible({ timeout: 30000 });
        // A human moves to the next link before clicking. Playwright's click waits
        // for pointer actionability before that move, while BaseUI safePolygon
        // releases its temporary hover bridge on the actual mousemove.
        const rect = await target.boundingBox();
        expect(rect).not.toBeNull();
        await page.mouse.move(
          rect!.x + rect!.width / 2,
          rect!.y + rect!.height / 2,
        );
        await browserExpect
          .poll(() =>
            page.evaluate(() => getComputedStyle(document.body).pointerEvents),
          )
          .toBe('auto');
        await target.click();
        await browserExpect(page.getByRole('dialog')).toBeVisible();
        await page
          .getByRole('dialog')
          .locator('[data-slot="dialog-close"]')
          .last()
          .click();
        await browserExpect(page).toHaveURL(`${base}#home-source`);
        await browserExpect(page.getByRole('dialog')).toHaveCount(0);
      }
      for (const locale of ['en-US', 'zh-CN'])
        for (const theme of ['light', 'dark'])
          for (const preset of ['default', 'compact']) {
            const mobile = await h.pageFor(await f.reader.session(), {
              locale,
              viewport: { width: 375, height: 812 },
            });
            mobile.on('pageerror', (e) => errors.push(e.message));
            await mobile.addInitScript(
              ({ theme, preset }) => {
                localStorage.setItem('nocobase:main:theme:color-scheme', theme);
                localStorage.setItem('nocobase:main:theme:preset', preset);
              },
              { theme, preset },
            );
            await mobile.goto(
              `${base}/approvals/todo?orderBy=dueAt&direction=asc#matrix`,
            );
            await browserExpect(
              mobile.getByRole('link', {
                name: 'Center ordinary duty',
                exact: true,
              }),
            ).toBeVisible({ timeout: 30000 });
            await browserExpect(
              mobile.getByRole('link', {
                name: 'Center personal receipt',
                exact: true,
              }),
            ).toBeVisible();
            expect(
              await mobile.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
            ).toBe(true);
            await mobile.screenshot({
              path: `${h.screenshotsDir}/todo-${locale}-${theme}-${preset}-375.png`,
              fullPage: true,
            });
            await mobile.context().close();
          }
      await page.goto(`${base}/approvals/todo?kind=oa.workItem#source`);
      await page
        .getByRole('link', { name: 'Center ordinary duty', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Submit result', exact: true })
        .click();
      await page
        .getByRole('textbox', { name: 'Result', exact: true })
        .fill('Actual browser completion');
      await page
        .getByRole('button', { name: 'Submit result', exact: true })
        .click();
      await browserExpect(page).toHaveURL(
        `${base}/approvals/todo/workItem/${f.item.id}?kind=oa.workItem#source`,
      );
      await page
        .getByRole('dialog')
        .locator('[data-slot="dialog-close"]')
        .last()
        .click();
      await browserExpect(
        page.getByRole('link', { name: 'Center ordinary duty', exact: true }),
      ).toHaveCount(0);
      await page.goto(
        `${base}/approvals/todo?kind=oa.announcementReceipt#source`,
      );
      await page
        .getByRole('link', { name: 'Center personal receipt', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Confirm receipt', exact: true })
        .click();
      await browserExpect(page).toHaveURL(
        `${base}/approvals/todo/announcement/${f.published.id}/actions/confirm?kind=oa.announcementReceipt#source`,
      );
      const actionDialog = page.getByRole('dialog', {
        name: 'Confirm receipt',
        exact: true,
      });
      const submitted = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith(`/announcements/${f.published.id}/confirm`),
      );
      await actionDialog
        .getByRole('button', { name: 'Confirm receipt', exact: true })
        .click();
      expect((await submitted).status()).toBe(200);
      await browserExpect(page).toHaveURL(
        `${base}/approvals/todo/announcement/${f.published.id}?kind=oa.announcementReceipt#source`,
      );
      await page
        .getByRole('dialog')
        .locator('[data-slot="dialog-close"]')
        .last()
        .click();
      await browserExpect(
        page.getByRole('link', {
          name: 'Center personal receipt',
          exact: true,
        }),
      ).toHaveCount(0);
      await page.screenshot({
        path: `${h.screenshotsDir}/completed.png`,
        fullPage: true,
      });
      expect(errors).toEqual([]);
    } finally {
      await h.close();
    }
  },
  240000,
);
