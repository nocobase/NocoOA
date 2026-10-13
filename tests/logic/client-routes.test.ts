import {
  resolveAppClientContributions,
  type AppClientRegisteredRoute,
  type AppClientRouteComponentLoader,
} from '@nocobase/app-client/plugins';
import { describe, expect, it } from 'vitest';

import applicationRoutes from '../../client/routes.ts';
import {
  buildRouteNavigation,
  routeKey,
} from '../../client/routing/route-navigation.js';

describe('app client routes', () => {
  it('does not expose database exploration or document counter pages', () => {
    const paths = pagePaths(resolveRoutes().routes);
    expect(
      paths.some(
        (path) =>
          path.startsWith('/database-explorer') || path === '/sequences',
      ),
    ).toBe(false);
  });
  it('registers protected process management and covering execution action routes', () => {
    const resolved = resolveRoutes();
    expect(pagePaths(resolved.routes)).toEqual(
      expect.arrayContaining([
        '/processManagement',
        '/processManagement/definitions/:kind',
        '/processManagement/definitions/:kind/nodes/:node/settings',
        '/processManagement/definitions/:kind/executions/:recordId',
        '/processManagement/executions/:kind/:recordId/actions/:actionName/:taskId',
      ]),
    );
    expect(pageAuthorizations(resolved.routes)).toContainEqual({
      name: 'oa-process-management',
      authorizedAs: 'oa.processManagement',
    });
  });
  it('registers transfer actions with and without a task without optional-path syntax', () => {
    expect(pagePaths(resolveRoutes().routes)).toEqual(
      expect.arrayContaining([
        '/personnel-changes/:requestId/action/:operation',
        '/personnel-changes/:requestId/action/:operation/:taskId',
      ]),
    );
  });

  it('keeps the landing page and the authentication pages', () => {
    // The authentication plugin and this application have to agree on these paths: it sends an unknown visitor to
    // /login, sends a signed-in user who opens a guest page back to /, and mails a reset link to /reset-password,
    // while the sign-in form links to /register and /forgot-password. Only their presence is asserted, so a page the
    // application adds is not a defect. Whether these four are guest pages is not checked here either: app-client
    // refuses any route that claims one of those paths without `auth: 'guest'`.
    expect(pagePaths(resolveRoutes().routes)).toEqual(
      expect.arrayContaining([
        '/',
        '/login',
        '/register',
        '/forgot-password',
        '/reset-password',
        // The page `deviceAuthorization()`'s verificationUri names, where a CLI's sign-in is approved.
        '/device',
      ]),
    );
  });

  it('keeps procurement and order actions over their original workbench, approval tab or ledger', () => {
    expect(pagePaths(resolveRoutes().routes)).toEqual(
      expect.arrayContaining([
        '/newPurchase',
        '/purchase/:requestId',
        '/editPurchase/:requestId',
        '/purchase/:requestId/order/:orderId/:orderAction',
        '/approvals/mine/newPurchase',
        '/approvals/todo/purchase/:requestId/action/:actionName/:targetId',
        '/approvals/copied/purchase/:requestId/order/:orderId',
        '/purchaseOrders',
        '/purchaseOrders/order/:orderId/:orderAction',
      ]),
    );
  });

  it('guards Excel attendance imports with the independent ingestion action', () => {
    const resolved = resolveRoutes();
    expect(pagePaths(resolved.routes)).toContain('/attendance-import');
    expect(pageAuthorizations(resolved.routes)).toContainEqual({
      name: 'attendance-import',
      authorizedAs: 'composite:oa.attendanceImport',
    });
    const find = (
      routes: readonly AppClientRegisteredRoute[],
    ): AppClientRegisteredRoute | undefined => {
      for (const route of routes) {
        if (route.name === 'attendance-import') return route;
        const child = find(route.children ?? []);
        if (child) return child;
      }
    };
    expect(find(resolved.routes)?.authz).toEqual({
      resource: { type: 'composite', id: 'oa.attendanceImport' },
      action: 'ingest',
    });
  });

  it('registers certificate and attendance configuration child pages', () => {
    const paths = pagePaths(resolveRoutes().routes);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/personnel-changes',
        '/personnel-changes/new',
        '/personnel-changes/:requestId',
        '/personnel-changes/:requestId/reviewEdit',
        '/certificates',
        '/certificates/new',
        '/certificates/:certificateId',
        '/certificates/:certificateId/edit',
        '/certificates/:certificateId/issue',
        '/attendance-management',
        '/attendance-management/new',
        '/attendance-management/:shiftId/edit',
        '/attendance-management/:shiftId/revisions/:revision',
        '/attendance-management/schedule/edit',
        '/attendance-management/schedule/revisions/:revision',
      ]),
    );
  });

  it('keeps contracts over their originating views and registers print management', () => {
    const paths = pagePaths(resolveRoutes().routes);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/contractRequests',
        '/contractRequests/newContract',
        '/contracts/contractLedger/:contractId',
        '/salaryGradeTables',
        '/salaryGradeTables/publish',
        '/salaryGradeTables/:revisionId',
        '/print-templates',
        '/print-templates/:templateId/upload',
        '/paymentRequests/:requestId/print',
        '/reimbursementRequests/:requestId/print',
        ...['todo', 'done', 'copied', 'mine'].flatMap((tab) => [
          `/approvals/${tab}/leave/:requestId/print`,
          `/approvals/${tab}/payment/:requestId/print`,
          `/approvals/${tab}/reimbursement/:requestId/print`,
        ]),
        '/newContract',
        ...['todo', 'done', 'copied', 'mine'].flatMap((tab) => [
          `/approvals/${tab}/contract/:requestId/rebase`,
          `/approvals/${tab}/contract/:requestId/action/:actionName/:targetId`,
        ]),
      ]),
    );
  });

  it('keeps asset forms and physical handling over every originating view', () => {
    const paths = pagePaths(resolveRoutes().routes);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/assetRequests',
        '/assetRequests/newAssetRequest',
        '/newAssetRequest',
        ...['todo', 'done', 'copied', 'mine'].flatMap((tab) => [
          `/approvals/${tab}/newAssetRequest`,
          `/approvals/${tab}/editAssetRequest/:requestId`,
          `/approvals/${tab}/assetRequest/:requestId/action/:actionName/:targetId`,
          `/approvals/${tab}/assetRequest/:requestId/return`,
        ]),
      ]),
    );
  });

  it('keeps vendor records, accounts and actions over every published originating view', () => {
    const paths = pagePaths(resolveRoutes().routes);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/vendorQualifications',
        '/vendorQualificationConfiguration',
        '/vendorQualifications/new',
        '/vendorQualifications/edit/:requestId',
        '/vendorQualifications/:requestId/paymentAccount',
        '/newVendorQualification',
        '/editVendorQualification/:requestId',
        ...['todo', 'done', 'copied', 'mine'].flatMap((tab) => [
          `/approvals/${tab}/newVendorQualification`,
          `/approvals/${tab}/vendorQualification/:requestId/paymentAccount`,
          `/approvals/${tab}/vendorQualification/:requestId/action/:actionName/:targetId`,
        ]),
      ]),
    );
  });

  it('keeps departure approval and clearance actions over their originating view', () => {
    expect(pagePaths(resolveRoutes().routes)).toEqual(
      expect.arrayContaining([
        '/departureRequests',
        '/departureRequests/new',
        '/departureRequests/:requestId/work/:actionName/:targetId',
        '/newDeparture',
        '/departure/:requestId/work/:actionName/:targetId',
        '/approvals/todo/departure/:requestId/action/:actionName/:targetId',
        '/approvals/todo/departure/:requestId/work/:actionName/:targetId',
        '/approvals/mine/newDeparture',
        '/approvals/copied/editDeparture/:requestId',
      ]),
    );
  });

  it('keeps probation dialogs and task actions over each originating view', () => {
    expect(pagePaths(resolveRoutes().routes)).toEqual(
      expect.arrayContaining([
        '/probationRequests',
        '/probationRequests/new',
        '/probationRequests/edit/:requestId',
        '/probationRequests/:requestId/action/:actionName/:targetId',
        '/newProbation',
        '/probation/:requestId/edit',
        '/approvals/todo/probation/:requestId/action/:actionName/:targetId',
        '/approvals/mine/newProbation',
        '/approvals/copied/editProbation/:requestId',
      ]),
    );
  });
  it('keeps reimbursement overlays on their originating list, workbench or approval tab', () => {
    expect(pagePaths(resolveRoutes().routes)).toEqual(
      expect.arrayContaining([
        '/reimbursementRequests',
        '/reimbursementRequests/new',
        '/reimbursementRequests/:requestId/action/:actionName/:targetId',
        '/reimbursementRequests/:requestId/paymentAccount',
        '/newReimbursement',
        '/reimbursement/:requestId/paymentAccount',
        '/approvals/todo/reimbursement/:requestId/action/:actionName/:targetId',
        '/approvals/mine/newReimbursement',
      ]),
    );
  });

  it('opens expense preapproval over its current workbench or approval tab', () => {
    expect(pagePaths(resolveRoutes().routes)).toEqual(
      expect.arrayContaining([
        '/newExpensePlan',
        '/expensePlan/:requestId',
        '/editExpensePlan/:requestId',
        '/approvals/mine/newExpensePlan',
        '/approvals/mine/expensePlan/:requestId',
        '/approvals/todo/expensePlan/:requestId/action/:actionName/:targetId',
      ]),
    );
  });

  it('loads every page component', async () => {
    const resolved = resolveRoutes();
    const loaders = componentLoadersIn(resolved.routes);
    // The trees above are filtered by loader, so an empty list would make the loop below pass without loading
    // anything at all.
    expect(loaders).not.toHaveLength(0);

    for (const componentLoader of loaders) {
      // The registered loader is already the wrapped one, so awaiting it holds every page to the contract that its
      // module default-exports a component. A page that moved or lost its default export fails here.
      await expect(componentLoader()).resolves.toMatchObject({
        default: expect.any(Function),
      });
    }
  });

  it('pins the page authorization of every signed-in page', () => {
    // A stored page grant records the page's `authz` resource id (`authorizedAs`), not its route `name`: changing an
    // id is a data change that has to migrate the grants that reference it, not a refactor — so changing this list
    // deliberately is the point. A new page that requires sign-in adds an entry here, because a page that checks
    // access is a new grant somebody has to be given.
    const resolved = resolveRoutes();

    // The landing page and the inbox opted out of page authorization, so they are reachable by every signed-in user.
    expect(pageAuthorizations(resolved.routes)).toEqual(
      expect.arrayContaining([
        { name: 'home', authorizedAs: null },
        ...[
          'home-new',
          'home-edit',
          'home-detail',
          'home-detail-edit',
          'home-detail-action',
        ].map((name) => ({ name, authorizedAs: 'oa.approvals' })),
        { name: 'inbox', authorizedAs: null },
        { name: 'oa-leave-balances', authorizedAs: null },
        // 通讯录 (employees module); the seeded `oa-directory` set grants it to every signed-in user.
        { name: 'oa-directory', authorizedAs: 'oa.employees.directory' },
        { name: 'oa-approvals', authorizedAs: 'oa.approvals' },
        ...[
          'oa-salary-grades',
          'oa-salary-grades-publish',
          'oa-salary-grades-revision',
        ].map((name) => ({ name, authorizedAs: 'oa-salary-grades' })),
        { name: 'agents', authorizedAs: 'agents' },
        { name: 'agents-new', authorizedAs: 'agents' },
        { name: 'agents-detail', authorizedAs: 'agents' },
        { name: 'runtimes', authorizedAs: 'runtimes' },
        { name: 'runtimes-connect', authorizedAs: 'runtimes' },
        { name: 'skills', authorizedAs: 'skills' },
        { name: 'skills-new', authorizedAs: 'skills' },
        { name: 'skills-detail', authorizedAs: 'skills' },
        { name: 'usage', authorizedAs: 'usage' },
        ...['todo', 'done', 'copied', 'mine'].flatMap((tab) =>
          [
            '',
            '-new',
            '-edit',
            '-detail',
            '-detail-edit',
            '-detail-action',
          ].map((suffix) => ({
            name: `oa-approvals-${tab}${suffix}`,
            authorizedAs: 'oa.approvals',
          })),
        ),
      ]),
    );
  });

  it('retains administration grants after moving pages into the application', () => {
    const flattened = (
      routes: readonly AppClientRegisteredRoute[],
    ): AppClientRegisteredRoute[] =>
      routes.flatMap((route) => [route, ...flattened(route.children ?? [])]);
    const routes = flattened(resolveRoutes().routes);
    for (const [path, type, id, action] of [
      ['/users', 'page', 'users', 'access'],
      ['/api-keys', 'page', 'api-keys', 'access'],
      ['/permission-sets', 'settings', 'authorization.permission-sets', 'read'],
      [
        '/permission-sets/edit/:permissionSetKey/assignments',
        'settings',
        'authorization.permission-sets',
        'read',
      ],
      ['/default-access', 'settings', 'authorization.default-access', 'read'],
      ['/sharing-rules', 'settings', 'authorization.sharing-rules', 'read'],
      [
        '/restriction-rules',
        'settings',
        'authorization.restriction-rules',
        'read',
      ],
      ['/inspector', 'settings', 'authorization.inspector', 'inspect'],
      ['/schedules', 'settings', 'scheduler.schedules', 'read'],
      ['/leaveBalanceAdministration', 'settings', 'oa.leaveBalances', 'read'],
      [
        '/leaveBalanceAdministration/adjust/:employeeId/:leaveType',
        'settings',
        'oa.leaveBalances',
        'update',
      ],
      ['/schedules/:scheduleId', 'settings', 'scheduler.schedules', 'read'],
      ['/models', 'settings', 'agents.services', 'read'],
      ['/notification-logs', 'page', 'notification.logs', 'access'],
    ]) {
      const route = routes.find(
        (entry) => entry.path === path && entry.componentLoader,
      );
      expect(route?.auth).toBe('required');
      expect(route?.authz).toEqual({ resource: { type, id }, action });
    }
  });

  it('contributes supplies under each owning surface and gives the ledger its independent grant', () => {
    const registered = resolveRoutes().routes;
    expect(pagePaths(registered)).toEqual(
      expect.arrayContaining([
        '/newSupply',
        '/supply/:requestId',
        '/approvals/mine/newSupply',
        '/approvals/mine/supply/:requestId',
        '/supplyLedger',
        '/supplyLedger/entry/:entryId',
      ]),
    );
    expect(pageAuthorizations(registered)).toEqual(
      expect.arrayContaining([
        { name: 'oa-supply-ledger', authorizedAs: 'composite:oa.supplies' },
        {
          name: 'oa-supply-ledger-entry',
          authorizedAs: 'composite:oa.supplies',
        },
      ]),
    );
  });
  it('keeps business navigation at the second level and hides empty domains for employee access', () => {
    const routes = resolveRoutes().routes;
    const menu = buildRouteNavigation(routes, new Set());
    const businessGroups = {
      'oa-office': [
        'oa-approval-delegations',
        'announcements',
        'work-items',
        'oa-knowledge',
      ],
      'oa-organization': [
        'org-departments',
        'org-positions',
        'org-grades',
        'oa-employees',
        'org-duty-roles',
        'oa-recruitment-requests',
        'oa-requisitions',
        'oa-headcounts',
        'onboardings',
        'oa-probation-requests',
        'oa-transfer',
        'oa-departure-requests',
        'oa-directory',
        'oa-leave-balances',
        'oa-leave-balance-administration',
        'oa-certificates',
        'import-data',
      ],
      'oa-finance': [
        'oa-reimbursement-requests',
        'oa-loan-requests',
        'oa-payment-requests',
        'oa-budgets',
        'oa-reports',
        'oa-finance-assignments',
      ],
      'oa-procurement': [
        'oa-vendors',
        'oa-vendor-qualifications',
        'oa-purchase-orders',
        'oa-contract-requests',
        'oa-contract-ledger',
      ],
      'oa-administration': [
        'oa-asset-requests',
        'oa-supply-ledger',
        'oa-meeting-rooms',
        'oa-vehicle-requests',
        'oa-vehicle-garage',
        'oa-seal-instances',
        'oa-seal-requests',
        'oa-seal-ledger',
      ],
    };
    for (const [name, pages] of Object.entries(businessGroups)) {
      const group = menu.find((item) => item.route.name === name);
      expect(group?.children.map((item) => item.route.name)).toEqual(pages);
      // No third-level business menu; forms and record overlays have no navigation.
      expect(group?.children.every((item) => !item.children.length)).toBe(true);
      expect(group?.children.every((item) => item.route.navigation?.icon)).toBe(
        true,
      );
    }
    expect(
      menu
        .find((item) => item.route.name === 'oa-configuration')
        ?.children.map((item) => item.route.name),
    ).not.toContain('oa-seal-instances');
    const visiblePages = new Set([
      'home',
      'oa-approvals',
      'oa-directory',
      'inbox',
      'oa-leave-balances',
    ]);
    const denyOtherPages = (
      nodes: readonly AppClientRegisteredRoute[],
    ): string[] =>
      nodes.flatMap((route) => [
        ...(route.componentLoader && !visiblePages.has(route.name)
          ? [routeKey(route)]
          : []),
        ...denyOtherPages(route.children ?? []),
      ]);
    const employeeMenu = buildRouteNavigation(
      routes,
      new Set(denyOtherPages(routes)),
    );
    expect(employeeMenu.map((item) => item.route.name)).toEqual([
      'home',
      'oa-approvals',
      'inbox',
      'oa-organization',
    ]);
    expect(
      employeeMenu.at(-1)?.children.map((item) => item.route.name),
    ).toEqual(['oa-directory', 'oa-leave-balances']);
    visiblePages.delete('oa-directory');
    const restrictedMenu = buildRouteNavigation(
      routes,
      new Set(denyOtherPages(routes)),
    );
    expect(
      restrictedMenu.at(-1)?.children.map((item) => item.route.name),
    ).toEqual(['oa-leave-balances']);
  });

  it('puts daily pages before administrative groups, with no settings surface', () => {
    const routes = resolveRoutes().routes;
    expect(
      pagePaths(routes).some((path) => /^\/(settings|dev)(\/|$)/.test(path)),
    ).toBe(false);
    const menu = routes
      .filter((route) => route.navigation)
      .sort((a, b) => (a.navigation?.order ?? 0) - (b.navigation?.order ?? 0));
    expect(menu.map((route) => route.name)).toEqual([
      'home',
      'oa-approvals',
      'inbox',
      'oa-office',
      'oa-organization',
      'oa-finance',
      'oa-procurement',
      'oa-administration',
      'oa-configuration',
      'oa-automation',
      'oa-system',
    ]);
  });
});

/** This application's own contribution, registered the way the client runtime registers it. */
function resolveRoutes() {
  return resolveAppClientContributions([
    {
      packageName: '@nocobase/app-template-default',
      routes: applicationRoutes,
      source: 'application',
    },
  ]);
}

/**
 * The paths of the pages a route tree registers. A menu group names no component, so it carries no path of its own
 * and inherits its parent's — filtering on `componentLoader` is what keeps that inherited path out of the list.
 */
function pagePaths(routes: readonly AppClientRegisteredRoute[]): string[] {
  return routes.flatMap((route) => [
    ...(route.componentLoader ? [route.path] : []),
    ...pagePaths(route.children ?? []),
  ]);
}

/** Every page loader in a tree, at any depth. */
function componentLoadersIn(
  routes: readonly AppClientRegisteredRoute[],
): AppClientRouteComponentLoader[] {
  return routes.flatMap((route) => [
    ...(route.componentLoader ? [route.componentLoader] : []),
    ...componentLoadersIn(route.children ?? []),
  ]);
}

/** Page authorization comes directly from the registered tree. */
function pageAuthorizations(
  routes: readonly AppClientRegisteredRoute[],
): { name: string; authorizedAs: string | null }[] {
  return routes.flatMap((route) => [
    ...(route.componentLoader && route.auth === 'required'
      ? [
          {
            name: route.name,
            authorizedAs:
              route.authz === 'skip'
                ? null
                : route.authz === 'unrestricted'
                  ? 'unrestricted'
                  : route.authz.resource.type === 'page'
                    ? route.authz.resource.id
                    : `${route.authz.resource.type}:${route.authz.resource.id}`,
          },
        ]
      : []),
    ...pageAuthorizations(route.children ?? []),
  ]);
}
