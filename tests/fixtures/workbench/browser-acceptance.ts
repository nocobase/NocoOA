import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { vi } from 'vitest';
import { databaseManagerToken } from '@nocobase/db';
import { createEmployee } from '../../logic/employees/helpers.js';
import { startIsolatedBrowserApp } from '../browser/harness.js';
import { organizationServiceToken } from '../../../server/providers/org/index.js';
import { calendarServiceToken } from '../../../server/providers/platform/index.js';
import { leaveBalanceServiceToken } from '../../../server/providers/leave-balances/index.js';
import { meetingRoomServiceToken } from '../../../server/providers/meeting-rooms/index.js';
import { announcementServiceToken } from '../../../server/providers/announcements/index.js';
export async function runWorkbenchBrowser() {
  const h = await startIsolatedBrowserApp({
    name: 'workbench',
    apiPort: 14131,
    vitePort: 14132,
  });
  const checks: string[] = [],
    errors: string[] = [],
    screenshots: string[] = [];
  try {
    const c = h.testApp.application.container,
      db = c.resolve(databaseManagerToken),
      calendar = c.resolve(calendarServiceToken);
    // Keep a same-day upcoming meeting regardless of the hour this fixture runs.
    // Mock Date only; timers and browser/network I/O remain real.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(
      calendar.resolveLocalDateTime(calendar.localDate(new Date()), '12:00'),
    );
    const employee = await createEmployee(
        h.testApp,
        'Workbench browser employee',
      ),
      admin = await createEmployee(h.testApp, 'Workbench browser admin');
    await c
      .resolve(organizationServiceToken)
      .addDutyRoleMember('admin', admin.userId, { actorId: admin.userId });
    await db.transaction((tx) =>
      c.resolve(leaveBalanceServiceToken).grant(
        {
          employeeId: employee.employeeId,
          leaveType: 'annual',
          units: 7,
          requestKey: randomUUID(),
          reference: 'browser-synthetic',
          actorId: admin.userId,
        },
        tx,
      ),
    );
    const meeting = c.resolve(meetingRoomServiceToken);
    const room = await db.transaction((tx) =>
      meeting.saveRoom(
        {
          actorId: admin.userId,
          requestId: randomUUID(),
          name: 'Workbench browser room',
          location: null,
          facilities: null,
          capacity: 5,
          active: true,
          requiresAdminConfirmation: false,
          reason: 'Synthetic acceptance',
        },
        tx,
      ),
    );
    const [booking] = await db.transaction((tx) =>
      meeting.create(
        {
          actorId: employee.userId,
          requestId: randomUUID(),
          roomId: room.id,
          title: 'Browser current meeting',
          attendeeUserIds: [],
          date: calendar.localDate(new Date()),
          startTime: '23:00',
          endTime: '23:30',
        },
        tx,
      ),
    );
    const notices = c.resolve(announcementServiceToken);
    const notice = await db.transaction((tx) =>
      notices.save(
        {
          actorId: admin.userId,
          requestId: randomUUID(),
          title: 'Browser confirmation notice',
          body: 'Synthetic public confirmation',
          audience: { all: true, departmentIds: [], dutyRoleCodes: [] },
          requiresConfirmation: true,
          pinned: false,
          attachments: [],
          validFrom: new Date(Date.now() - 60000).toISOString(),
          validUntil: new Date(Date.now() + 86400000).toISOString(),
        },
        tx,
      ),
    );
    await db.transaction((tx) =>
      notices.act(
        {
          actorId: admin.userId,
          requestId: randomUUID(),
          id: notice.id,
          expectedVersion: notice.version,
          action: 'publish',
        },
        tx,
      ),
    );
    const page = await h.pageFor(await employee.session());
    await page.addInitScript(() => {
      const pref = JSON.parse(
        localStorage.getItem('workbench-browser-prefs') ?? '{}',
      );
      if (pref.locale) {
        localStorage.setItem('nocobase.locale', pref.locale);
        localStorage.setItem('i18nextLng', pref.locale);
        localStorage.setItem('nocobase:main:theme:color-scheme', pref.theme);
        localStorage.setItem('nocobase:main:theme:preset', pref.preset);
      }
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${h.origin}${h.basePath}/`);
    await expect(
      page.getByRole('heading', { name: 'My leave balances' }),
    ).toBeVisible();
    await expect(
      page.getByText('Available: 3.5 days · Held: 0 days'),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Browser current meeting' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Browser confirmation notice' }),
    ).toBeVisible();
    checks.push(
      'Main home real synthetic employee loads all three authorized public sources',
    );
    for (const [locale, theme, preset, width] of [
      ['en-US', 'light', 'compact', 1365],
      ['zh-CN', 'dark', 'comfortable', 375],
    ] as const) {
      await page.evaluate(
        ({ locale, theme, preset }) => {
          localStorage.setItem(
            'workbench-browser-prefs',
            JSON.stringify({ locale, theme, preset }),
          );
          localStorage.setItem('nocobase.locale', locale);
          localStorage.setItem('i18nextLng', locale);
          localStorage.setItem('nocobase:main:theme:color-scheme', theme);
          localStorage.setItem('nocobase:main:theme:preset', preset);
        },
        { locale, theme, preset },
      );
      await page.setViewportSize({ width, height: 1000 });
      await page.reload();
      await expect(
        page.getByRole('heading', {
          name: locale === 'zh-CN' ? '我的假期余额' : 'My leave balances',
        }),
      ).toBeVisible();
      await expect(
        page.getByRole('link', { name: 'Browser current meeting' }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      const file = path.join(
        h.screenshotsDir,
        `${locale}-${theme}-${preset}-${width}.png`,
      );
      await page.screenshot({ path: file, fullPage: true });
      screenshots.push(file);
    }
    checks.push(
      'English/light/compact desktop and Chinese/dark/comfortable 375px render without horizontal overflow',
    );
    await page.getByRole('link', { name: 'Browser current meeting' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/meeting-rooms/booking/${booking.id}`),
    );
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.goto(`${h.origin}${h.basePath}/`);
    await page
      .locator(`a[href="${h.basePath}/announcements/${notice.id}"]`)
      .click();
    await expect(page).toHaveURL(new RegExp(`/announcements/${notice.id}`));
    await expect(page.getByRole('dialog')).toBeVisible();
    checks.push(
      'Meeting and announcement links open actual owner detail drawers',
    );
    expect(errors).toEqual([]);
    await writeFile(
      path.join(h.screenshotsDir, 'evidence.json'),
      JSON.stringify(
        {
          checks,
          errors,
          screenshots,
          scope:
            'Disposable PostgreSQL full main App and synthetic role employee; not production acceptance',
        },
        null,
        2,
      ),
    );
    return checks;
  } finally {
    vi.useRealTimers();
    await h.close();
  }
}
