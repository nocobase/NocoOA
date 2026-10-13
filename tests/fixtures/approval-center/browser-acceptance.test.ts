// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { it, expect } from 'vitest';
import { expect as browserExpect, type Page } from '@playwright/test';
import { startIsolatedBrowserApp } from '../browser/harness.js';
import { createEmployee } from '../../logic/employees/helpers.js';
import { databaseManagerToken } from '@nocobase/db';
import { organizationServiceToken } from '../../../server/providers/org/index.js';
import { recruitmentServiceToken } from '../../../server/providers/recruitment/service.js';
import { sealRequestServiceToken } from '../../../server/providers/seals/contract.js';
import { vehicleRequestServiceToken } from '../../../server/providers/vehicles/index.js';
import { salaryGradeServiceToken } from '../../../server/providers/job-grades/contract.js';
import { headcountServiceToken } from '../../../server/providers/headcounts/contract.js';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { write } from '../../logic/platform/helpers.js';
import {
  dictionaryServiceToken,
  calendarServiceToken,
} from '../../../server/providers/platform/index.js';
const full = { read: true, create: true, update: true, delete: false };
it.runIf(process.env.OA_CENTER_BROWSER === '1')(
  'isolated center real roles handle three pending sources with current view revocation and source recovery',
  async () => {
    const h = await startIsolatedBrowserApp({
      name: 'approval-center',
      apiPort: 14169,
      vitePort: 15169,
    });
    try {
      const c = h.testApp.application.container,
        db = c.resolve(databaseManagerToken),
        org = c.resolve(organizationServiceToken);
      const owner = await createEmployee(h.testApp, 'Center browser owner');
      const ctx = { actorId: owner.userId },
        department = await org.createDepartment(
          { title: 'Center browser department', managerId: owner.userId },
          ctx,
        ),
        position = await org.createPosition(
          { code: randomUUID(), title: 'Center browser engineer' },
          ctx,
        ),
        grade = await org.createGrade(
          { code: randomUUID(), title: 'Center browser grade', rank: 1 },
          ctx,
        );
      const command = () => ({
        ...ctx,
        requestKey: randomUUID(),
        reason: 'Center browser synthetic setup',
      });
      const year = Number(
        c.resolve(calendarServiceToken).localDate(new Date()).slice(0, 4),
      );
      const account = await db.transaction(async (tx) => {
        const hc = c.resolve(headcountServiceToken),
          initial = await hc.create(
            {
              ...command(),
              departmentId: department.id,
              positionId: position.id,
              year,
              limit: 2,
            },
            tx,
          );
        return hc.reconcile(
          {
            ...command(),
            accountId: initial.id,
            expectedVersion: initial.version,
            employeeIds: [],
          },
          tx,
        );
      });
      const salary = c.resolve(salaryGradeServiceToken),
        current = await db.transaction((tx) => salary.current(tx));
      await db.transaction((tx) =>
        salary.publish(
          {
            ...command(),
            expectedVersion: current.version,
            bands: [
              { gradeId: grade.id, minimumCents: 10000, maximumCents: 20000 },
            ],
          },
          tx,
        ),
      );
      const recruitment = await c.resolve(recruitmentServiceToken).create(
        {
          departmentId: department.id,
          positionId: position.id,
          gradeId: grade.id,
          quantity: 1,
          kind: 'additional',
          replacementEmployeeIds: [],
          accountId: account.id,
          year,
          minimumCents: 12000,
          maximumCents: 18000,
          expectedStartDate: `${year}-12-01`,
          jobDescription: 'Synthetic center job',
          reason: 'Synthetic demand',
        },
        command(),
        full,
        full,
      );
      await org.addMember(
        { departmentId: department.id, userId: owner.userId, primary: true },
        ctx,
      );
      const seal = await c.resolve(sealRequestServiceToken).create(
        owner.userId,
        {
          contractId: null,
          fileIds: [],
          sealType: 'official',
          copies: 1,
          external: false,
          returnDueAt: null,
          purpose: 'Synthetic center seal',
          contact: '',
        },
        randomUUID(),
        { requests: full, view: full },
      );
      const vehicle = await c.resolve(vehicleRequestServiceToken).create(
        {
          purpose: 'Synthetic center trip',
          destination: 'Synthetic office',
          startAt: '2027-01-06T01:00:00Z',
          endAt: '2027-01-06T02:00:00Z',
          passengers: 1,
          needsDriver: false,
        },
        owner.userId,
      );
      const page = await h.pageFor(await owner.session());
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      for (const [kind, route, id] of [
        ['oa.recruitment', 'recruitment', recruitment.id],
        ['oa.sealRequest', 'seal', seal.id],
        ['oa.vehicleRequest', 'vehicle', String(vehicle.record.id)],
      ] as const) {
        const source = `${h.origin}${h.basePath}/approvals/mine?kind=${kind}#source`;
        await page.goto(source);
        const draftLink = page
          .locator(`a[href*="/mine/${route}/${id}"]`)
          .first();
        await browserExpect(draftLink).toBeVisible({ timeout: 30000 });
        await draftLink.click();
        await browserExpect(page).toHaveURL(
          new RegExp(`/approvals/mine/${route}/${id}\\?kind=${kind}#source`),
        );
        await browserExpect(page.getByRole('dialog')).toBeVisible();
        await page.screenshot({
          path: `${h.screenshotsDir}/${route}-detail.png`,
          fullPage: true,
        });
        await page.locator('[data-slot="dialog-close"]').last().click();
        await browserExpect(page).toHaveURL(source);
        await browserExpect(page.getByRole('dialog')).toHaveCount(0);
      }
      const head = await createEmployee(h.testApp, 'Center real head');
      const hrbp = await createEmployee(h.testApp, 'Center real HRBP');
      const director = await createEmployee(h.testApp, 'Center real director');
      const keeper = await createEmployee(h.testApp, 'Center real keeper');
      const dispatcher = await createEmployee(
        h.testApp,
        'Center real dispatcher',
      );
      for (const [role, person] of [
        ['hrbp', hrbp],
        ['hrDirector', director],
        ['sealKeeper', keeper],
        ['admin', dispatcher],
      ] as const)
        await org.addDutyRoleMember(role, person.userId, ctx);
      const ownerSession = await owner.session();
      const submitted = await ownerSession.fetch(
        `/recruitmentRequests/${recruitment.id}/transitions`,
        write('POST', {
          version: recruitment.lifecycleVersion,
          transition: 'submit',
          reason: 'Center submit',
          requestKey: randomUUID(),
        }),
      );
      expect(submitted.status).toBe(200);
      await org.updateDepartment(
        department.id,
        { managerId: head.userId },
        ctx,
      );
      const sealService = c.resolve(sealRequestServiceToken);
      const upload = await sealService.upload(
        owner.userId,
        seal.id,
        new File(['%PDF-1.4 synthetic center'], 'center.pdf', {
          type: 'application/pdf',
        }),
        randomUUID(),
        full,
      );
      const edited = await sealService.change(
        seal.id,
        owner.userId,
        'edit',
        {
          contractId: null,
          fileIds: [upload.id],
          sealType: 'official',
          copies: 1,
          external: false,
          returnDueAt: null,
          purpose: 'Synthetic center seal',
          contact: '',
        },
        randomUUID(),
        seal.lifecycleVersion,
        { requests: full, view: full },
      );
      await sealService.change(
        seal.id,
        owner.userId,
        'submit',
        {},
        randomUUID(),
        edited.lifecycleVersion,
        { requests: full, view: full },
      );
      const vehicleService = c.resolve(vehicleRequestServiceToken);
      const vehicleId = String(vehicle.record.id);
      const vehicleType = (
        await c.resolve(dictionaryServiceToken).list('vehicleType')
      )[0]!.code;
      const car = await db.transaction((tx) =>
        vehicleService.vehicles.create(
          {
            plateNumber: randomUUID(),
            name: 'Center actual car',
            vehicleType,
            capacity: 4,
            status: 'active',
            actorId: dispatcher.userId,
            reason: 'Synthetic center garage',
          },
          tx,
        ),
      );
      await vehicleService.transition(
        vehicleId,
        'submit',
        owner.userId,
        Number(vehicle.record.lifecycleVersion),
        randomUUID(),
      );
      const stranger = await createEmployee(
        h.testApp,
        'Center unrelated employee',
      );
      const strangerSession = await stranger.session();
      for (const kind of [
        'oa.recruitment',
        'oa.sealRequest',
        'oa.vehicleRequest',
      ]) {
        const response = await strangerSession.fetch(
          `/approvalCenter?kind=${kind}&view=pending`,
        );
        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result.data).toEqual([]);
        expect(result.meta.total).toBe(0);
      }
      const reviewers = await Promise.all(
        [hrbp, head, keeper, dispatcher].map(async (person) =>
          h.pageFor(await person.session()),
        ),
      );
      for (const reviewer of reviewers) {
        reviewer.setDefaultTimeout(30000);
        reviewer.on('pageerror', (error) => errors.push(error.message));
      }
      const [hrPage, headPage, keeperPage, dispatchPage] = reviewers;
      const base = `${h.origin}${h.basePath}`;
      async function openTodo(
        p: Page,
        kind: string,
        route: string,
        id: string,
      ) {
        const source = `${base}/approvals/todo?kind=${kind}#source`;
        await p.goto(source);
        const link = p.locator(`a[href*="/todo/${route}/${id}"]`).first();
        await browserExpect(link).toBeVisible({ timeout: 60000 });
        await link.click();
        await browserExpect(p).toHaveURL(
          `${base}/approvals/todo/${route}/${id}?kind=${kind}#source`,
        );
        await browserExpect(p.getByRole('dialog')).toBeVisible();
        await p.reload();
        await browserExpect(p.getByRole('dialog')).toBeVisible();
        return source;
      }
      async function confirm(p: Page, label: string, endpoint: string) {
        await p
          .getByRole('button', { name: label, exact: true })
          .last()
          .click();
        const response = p.waitForResponse(
          (r) => r.request().method() === 'POST' && r.url().endsWith(endpoint),
        );
        await p
          .getByRole('alertdialog')
          .getByRole('button', { name: label, exact: true })
          .click();
        expect((await response).status()).toBe(200);
      }
      async function viewBoundary(
        p: Page,
        keys: string[],
        resource: string,
        kind: string,
        route: string,
        id: string,
      ) {
        const sets = c.resolve(authorizationToken).permissionSets;
        const originals = await Promise.all(
          keys.map(async (key) => (await sets.get(key))!),
        );
        for (const initial of originals)
          await sets.update(initial.key, {
            ...initial,
            grants: initial.grants.map((g) =>
              g.resource.type === 'composite' && g.resource.id === resource
                ? {
                    ...g,
                    actions: g.actions.filter((a) => a.action !== 'view'),
                  }
                : g,
            ),
          });
        try {
          await p.reload();
          await browserExpect(
            p.getByText('Access denied', { exact: true }).first(),
          ).toBeVisible();
          const denied = await p.evaluate(
            async ({ basePath, kind }) =>
              (
                await fetch(
                  `${basePath}/api/approvalCenter?kind=${kind}&view=pending`,
                )
              ).status,
            { basePath: h.basePath, kind },
          );
          expect(denied).toBe(403);
          for (const view of ['mine', 'pending', 'done', 'copied']) {
            const status = await p.evaluate(
              async ({ basePath, kind, view }) =>
                (
                  await fetch(
                    `${basePath}/api/approvalCenter?kind=${kind}&view=${view}`,
                  )
                ).status,
              { basePath: h.basePath, kind, view },
            );
            expect(status).toBe(403);
          }
        } finally {
          for (const initial of originals)
            await sets.update(initial.key, initial);
        }
        await p.reload();
        await browserExpect(p.getByRole('dialog')).toBeVisible();
        await browserExpect(p).toHaveURL(
          `${base}/approvals/todo/${route}/${id}?kind=${kind}#source`,
        );
      }
      // Public SDK offers create genuine copy tasks; the applicant already has ordinary view.
      for (const [service, kind, id, actor] of [
        [
          c.resolve(recruitmentServiceToken),
          'oa.recruitment',
          recruitment.id,
          hrbp,
        ],
        [sealService, 'oa.sealRequest', seal.id, head],
      ] as const) {
        const offers = await service.approvals.runActionsFor(kind, id, {
          id: actor.userId,
        });
        const offer = offers.find((o) =>
          o.actions.some((a) => a.name === 'cc'),
        )!;
        expect(offer).toBeDefined();
        const run = (await service.approvals.runViewsFor(kind, id)).find(
          (v) => v.run.id === offer.run.id,
        )!;
        const input = {
          action: 'cc',
          target: { runId: offer.run.id },
          contentHash: run.run.contentHash,
          requestId: randomUUID(),
          input: { to: [owner.userId] },
        };
        if (kind === 'oa.recruitment')
          await c.resolve(recruitmentServiceToken).action(
            id,
            input,
            {
              actorId: actor.userId,
              requestKey: randomUUID(),
              reason: 'Synthetic genuine copy',
            },
            full,
          );
        else
          await sealService.perform(id, actor.userId, input, {
            requests: full,
            view: full,
          });
      }
      const recruitmentSource = await openTodo(
        hrPage,
        'oa.recruitment',
        'recruitment',
        recruitment.id,
      );
      await viewBoundary(
        hrPage,
        ['oa-recruitment-employee', 'oa-recruitment-hrbp'],
        'oa.recruitment',
        'oa.recruitment',
        'recruitment',
        recruitment.id,
      );
      await hrPage.locator('a[href*="/action/approve/"]').first().click();
      await hrPage
        .locator('#recruitment-reason')
        .fill('Center real HRBP approval');
      await confirm(
        hrPage,
        'Approve',
        `/recruitmentRequests/${recruitment.id}/actions`,
      );
      await hrPage.locator('[data-slot="dialog-close"]').last().click();
      await browserExpect(hrPage).toHaveURL(recruitmentSource);
      await browserExpect(
        hrPage.locator(`a[href*="/todo/recruitment/${recruitment.id}"]`),
      ).toHaveCount(0);
      async function sealAction(label: string) {
        await keeperPage
          .getByRole('button', { name: label, exact: true })
          .click();
        const response = keeperPage.waitForResponse(
          (r) =>
            r.request().method() === 'POST' &&
            r.url().endsWith(`/sealRequests/${seal.id}/actions`),
        );
        await keeperPage
          .getByRole('dialog')
          .last()
          .getByRole('button', { name: 'Confirm action', exact: true })
          .click();
        expect((await response).status()).toBe(200);
      }
      await openTodo(headPage, 'oa.sealRequest', 'seal', seal.id);
      await headPage
        .getByRole('button', { name: 'Approve', exact: true })
        .click();
      const sealApprove = headPage.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          r.url().endsWith(`/sealRequests/${seal.id}/actions`),
      );
      await headPage
        .getByRole('dialog')
        .last()
        .getByRole('button', { name: 'Confirm action', exact: true })
        .click();
      expect((await sealApprove).status()).toBe(200);
      await headPage.locator('[data-slot="dialog-close"]').last().click();
      const sealSource = await openTodo(
        keeperPage,
        'oa.sealRequest',
        'seal',
        seal.id,
      );
      await viewBoundary(
        keeperPage,
        ['oa-seals-employee', 'oa-seals-keeper'],
        'oa.sealRequests',
        'oa.sealRequest',
        'seal',
        seal.id,
      );
      await sealAction('Claim');
      await keeperPage.locator('[data-slot="dialog-close"]').last().click();
      await browserExpect(keeperPage).toHaveURL(sealSource);
      await openTodo(headPage, 'oa.vehicleRequest', 'vehicle', vehicleId);
      await headPage
        .getByRole('button', { name: 'Approve', exact: true })
        .click();
      const vehicleApprove = headPage.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          r.url().endsWith(`/vehicleRequests/${vehicleId}/actions`),
      );
      await headPage
        .getByRole('dialog')
        .last()
        .getByRole('button', { name: 'Confirm', exact: true })
        .click();
      expect((await vehicleApprove).status()).toBe(200);
      await headPage.locator('[data-slot="dialog-close"]').last().click();
      const dispatchSource = await openTodo(
        dispatchPage,
        'oa.vehicleRequest',
        'vehicle',
        vehicleId,
      );
      await viewBoundary(
        dispatchPage,
        ['oa-vehicles-employee'],
        'oa.vehicleRequests',
        'oa.vehicleRequest',
        'vehicle',
        vehicleId,
      );
      for (const label of ['Claim dispatch task', 'Dispatch']) {
        await dispatchPage
          .getByRole('button', { name: label, exact: true })
          .click();
        await browserExpect(
          dispatchPage.locator('#vehicle-action-form'),
        ).toBeVisible();
        if (label === 'Dispatch') {
          await dispatchPage.locator('#vehicle-action-vehicleId').click();
          await dispatchPage
            .getByRole('option', {
              name: `${car.name} · ${car.plateNumber}`,
              exact: true,
            })
            .click();
        }
        const response = dispatchPage.waitForResponse(
          (r) =>
            r.request().method() === 'POST' &&
            r.url().endsWith(`/vehicleRequests/${vehicleId}/actions`),
        );
        await dispatchPage
          .getByRole('dialog')
          .last()
          .getByRole('button', { name: 'Confirm', exact: true })
          .click();
        expect((await response).status()).toBe(200);
        await browserExpect(
          dispatchPage.locator('#vehicle-action-form'),
        ).toHaveCount(0);
      }
      await dispatchPage.locator('[data-slot="dialog-close"]').last().click();
      await browserExpect(dispatchPage).toHaveURL(dispatchSource);
      await browserExpect(
        dispatchPage.locator(`a[href*="/todo/vehicle/${vehicleId}"]`),
      ).toHaveCount(0);
      for (const [p, kind, route, id] of [
        [hrPage, 'oa.recruitment', 'recruitment', recruitment.id],
        [headPage, 'oa.sealRequest', 'seal', seal.id],
        [dispatchPage, 'oa.vehicleRequest', 'vehicle', vehicleId],
      ] as const) {
        await p.goto(`${base}/approvals/done?kind=${kind}#source`);
        await browserExpect(
          p.locator(`a[href*="/done/${route}/${id}"]`).first(),
        ).toBeVisible();
        await p.screenshot({
          path: `${h.screenshotsDir}/${route}-done-real-role.png`,
          fullPage: true,
        });
      }
      for (const person of [owner, head, dispatcher]) {
        const session = await person.session();
        const copied = await (
          await session.fetch(
            '/approvalCenter?kind=oa.vehicleRequest&view=copied',
          )
        ).json();
        expect(copied.data).toEqual([]);
        expect(copied.meta.total).toBe(0);
      }
      // Whole-source aggregation happens before pagination, including real copied tasks.
      for (const [kind, id] of [
        ['oa.recruitment', recruitment.id],
        ['oa.sealRequest', seal.id],
      ] as const) {
        const copied = await (
          await ownerSession.fetch(`/approvalCenter?kind=${kind}&view=copied`)
        ).json();
        expect(copied.data.map((r: { id: string }) => r.id)).toEqual([id]);
      }
      const pages = await Promise.all(
        [1, 2, 3].map(async (page) => {
          const response = await ownerSession.fetch(
            `/approvalCenter?view=mine&pageSize=1&page=${page}&search=Center%20browser%20owner`,
          );
          expect(response.status).toBe(200);
          const result = await response.json();
          expect(result.meta.total).toBe(3);
          expect(result.data).toHaveLength(1);
          expect(result.meta.counts.inProgress).toBe(3);
          return `${result.data[0].kind}:${result.data[0].id}`;
        }),
      );
      expect(new Set(pages).size).toBe(3);
      for (const [kind, route, id] of [
        ['oa.recruitment', 'recruitment', recruitment.id],
        ['oa.sealRequest', 'seal', seal.id],
        ['oa.vehicleRequest', 'vehicle', vehicleId],
      ] as const) {
        for (const tab of ['mine', 'copied', 'todo', 'done']) {
          const source = `${base}/approvals/${tab}?kind=${kind}#four-tabs`;
          await page.goto(source);
          await browserExpect(page.getByRole('table')).toBeVisible();
          const link = page
            .locator(`a[href*="/${tab}/${route}/${id}"]`)
            .first();
          const expected =
            tab === 'mine' ||
            (tab === 'copied' && route !== 'vehicle') ||
            (tab === 'todo' && route === 'vehicle');
          if (expected) {
            await browserExpect(link).toBeVisible();
            await link.click();
            await browserExpect(page.getByRole('dialog')).toBeVisible();
            await page.locator('[data-slot="dialog-close"]').last().click();
            await browserExpect(page).toHaveURL(source);
          } else await browserExpect(link).toHaveCount(0);
        }
      }
      for (const locale of ['en-US', 'zh-CN'])
        for (const theme of ['light', 'dark'])
          for (const preset of ['default', 'compact']) {
            const mobile = await h.pageFor(ownerSession, {
              locale,
              viewport: { width: 375, height: 812 },
            });
            mobile.on('pageerror', (error) => errors.push(error.message));
            await mobile.addInitScript(
              ({ theme, preset }) => {
                localStorage.setItem('nocobase:main:theme:color-scheme', theme);
                localStorage.setItem('nocobase:main:theme:preset', preset);
              },
              { theme, preset },
            );
            for (const tab of ['mine', 'copied', 'todo', 'done']) {
              await mobile.goto(
                `${base}/approvals/${tab}?kind=oa.recruitment#matrix`,
              );
              await browserExpect(mobile.getByRole('table')).toBeVisible();
              expect(
                await mobile.evaluate(
                  () => document.documentElement.scrollWidth <= innerWidth,
                ),
              ).toBe(true);
              await mobile.screenshot({
                path: `${h.screenshotsDir}/${tab}-${locale}-${theme}-${preset}-375.png`,
                fullPage: true,
              });
            }
            await mobile.context().close();
          }
      await page.goto(
        `${base}/approvals/mine?kind=oa.recruitment#keyboard-source`,
      );
      await browserExpect(page.getByRole('table')).toBeVisible();
      await page.getByRole('tab', { name: 'Done', exact: true }).focus();
      await page.keyboard.press('Enter');
      await browserExpect(page).toHaveURL(
        `${base}/approvals/done?kind=oa.recruitment#keyboard-source`,
      );
      await page.goto(`${base}/approvals/mine?kind=oa.recruitment`);
      const search = page.getByRole('textbox', {
        name: 'Search by reference, title or initiator',
        exact: true,
      });
      await search.focus();
      await page.keyboard.type('Center owner');
      await browserExpect(search).toHaveValue('Center owner');
      await expect
        .poll(() => new URL(page.url()).searchParams.get('q'))
        .toBe('Center owner');
      await search.press('Home');
      await page.keyboard.type('real ');
      await browserExpect(search).toHaveValue('real Center owner');
      await search.fill('');
      await expect
        .poll(() => new URL(page.url()).searchParams.get('q'))
        .toBeNull();
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.imeSetComposition', {
        text: 'zhong',
        selectionStart: 0,
        selectionEnd: 5,
      });
      await page.waitForTimeout(400);
      expect(new URL(page.url()).searchParams.get('q')).toBeNull();
      await cdp.send('Input.insertText', { text: '中心' });
      await expect
        .poll(() => new URL(page.url()).searchParams.get('q'))
        .toBe('中心');
      await browserExpect(search).toHaveValue('中心');
      await page
        .getByRole('button', { name: 'Clear filters', exact: true })
        .first()
        .click();
      await browserExpect(search).toBeFocused();
      const pattern = '**/api/approvalCenter?*';
      for (const status of [401, 403, 404, 500]) {
        await page.route(pattern, (route) =>
          route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Synthetic acceptance failure' }),
          }),
        );
        await page.reload();
        await browserExpect(page.getByRole('alert')).toBeVisible();
        await browserExpect(
          page.getByRole('button', { name: 'Retry', exact: true }),
        ).toHaveCount(status === 500 ? 1 : 0);
        if (status === 401)
          await browserExpect(
            page.getByRole('button', { name: 'Sign in again', exact: true }),
          ).toBeVisible();
        if (status !== 500)
          await browserExpect(page.getByRole('table')).toHaveCount(0);
        await page.unroute(pattern);
        if (status === 500)
          await page
            .getByRole('button', { name: 'Retry', exact: true })
            .click();
        else await page.reload();
        await browserExpect(page.getByRole('table')).toBeVisible();
      }
      await page.route(pattern, (route) => route.abort());
      await page.reload();
      await browserExpect(
        page.getByRole('button', { name: 'Retry', exact: true }),
      ).toBeVisible();
      await page.unroute(pattern);
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await browserExpect(page.getByRole('table')).toBeVisible();
      console.info(
        'CENTER_SIXTH_ACCEPTANCE',
        JSON.stringify({
          genuineCopied: ['recruitment', 'seal'],
          vehicleCopied: 'negative-only',
          aggregationPages: 3,
          mobileScreenshots: 32,
        }),
      );
      expect(errors).toEqual([]);
    } finally {
      await h.close();
    }
  },
  360000,
);
