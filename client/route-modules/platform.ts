import {
  defineAppRoutes,
  type AppClientRouteContribution,
} from '@nocobase/app-client/plugins';
import { BookText, CalendarDays, History, Scale } from 'lucide-react';

/**
 * Routes of the `platform` OA module: work calendar, dictionaries, approval rules under 流程配置
 * (`oa-configuration`), the audit log under 系统 (`oa-system`). Each page checks its own settings item, which the
 * platform provider registers and its endpoints check.
 */
const settingsRoutes: AppClientRouteContribution = defineAppRoutes([
  {
    auth: 'required',
    parent: 'oa-configuration',
    name: 'platform-work-calendar',
    path: '/work-calendar',
    authz: {
      resource: { type: 'settings', id: 'oa.platform.calendar' },
      action: 'read',
    },
    navigation: {
      title: 'platform.navigation.calendar',
      icon: CalendarDays,
      order: 10,
    },
    componentLoader: () => import('../pages/platform/work-calendar/index.js'),
    children: [
      {
        // /work-calendar/days/new: add a day (static segment before :date)
        name: 'platform-work-calendar-day-new',
        path: 'days/new',
        componentLoader: () =>
          import('../pages/platform/work-calendar/day-dialog.js'),
      },
      {
        // /work-calendar/days/2026-10-01: edit a day
        name: 'platform-work-calendar-day-edit',
        path: 'days/:date',
        componentLoader: () =>
          import('../pages/platform/work-calendar/day-dialog.js'),
      },
      {
        name: 'platform-work-calendar-import',
        path: 'import',
        componentLoader: () =>
          import('../pages/platform/work-calendar/import-dialog.js'),
      },
    ],
  },
  {
    auth: 'required',
    parent: 'oa-configuration',
    name: 'platform-dictionaries',
    path: '/dictionaries',
    authz: {
      resource: { type: 'settings', id: 'oa.platform.dictionaries' },
      action: 'read',
    },
    navigation: {
      title: 'platform.navigation.dictionaries',
      icon: BookText,
      order: 20,
    },
    componentLoader: () => import('../pages/platform/dictionaries/index.js'),
    children: [
      {
        name: 'platform-dictionaries-new',
        path: 'new',
        componentLoader: () =>
          import('../pages/platform/dictionaries/entry-dialog.js'),
      },
      {
        name: 'platform-dictionaries-edit',
        path: 'edit/:entryId',
        componentLoader: () =>
          import('../pages/platform/dictionaries/entry-dialog.js'),
      },
    ],
  },
  {
    auth: 'required',
    parent: 'oa-configuration',
    name: 'platform-approval-rules',
    path: '/approval-rules',
    authz: {
      resource: { type: 'settings', id: 'oa.platform.rules' },
      action: 'read',
    },
    navigation: {
      title: 'platform.navigation.rules',
      icon: Scale,
      order: 30,
    },
    componentLoader: () => import('../pages/platform/approval-rules/index.js'),
    children: [
      {
        // Legacy edit URLs redirect to the owning process node.
        name: 'platform-approval-rules-edit',
        path: 'edit/:key',
        componentLoader: () =>
          import('../pages/platform/approval-rules/node-redirect.js'),
      },
      {
        // /approval-rules/spend.vp: the version history drawer
        name: 'platform-approval-rules-history',
        path: ':key',
        componentLoader: () =>
          import('../pages/platform/approval-rules/history-drawer.js'),
        children: [
          {
            // Legacy history edit URL also opens the owning process node.
            name: 'platform-approval-rules-history-edit',
            path: 'edit',
            componentLoader: () =>
              import('../pages/platform/approval-rules/node-redirect.js'),
          },
        ],
      },
    ],
  },
  {
    auth: 'required',
    parent: 'oa-system',
    name: 'platform-audit-logs',
    path: '/audit-logs',
    // No seed grants this item: only root sees the audit log until an administrator grants it (02 §9).
    authz: {
      resource: { type: 'settings', id: 'oa.platform.auditLogs' },
      action: 'read',
    },
    navigation: {
      title: 'platform.navigation.auditLogs',
      icon: History,
      order: 60,
    },
    componentLoader: () => import('../pages/platform/audit-logs/index.js'),
    children: [
      {
        name: 'platform-audit-logs-detail',
        path: ':auditLogId',
        componentLoader: () => import('../pages/platform/audit-logs/detail.js'),
      },
    ],
  },
]);

const platformRoutes: readonly AppClientRouteContribution[] = [settingsRoutes];

export default platformRoutes;
