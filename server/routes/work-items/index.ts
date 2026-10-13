import { Hono, type Context } from 'hono';
import {
  authenticationToken,
  userAdministrationServiceToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import { databaseManagerToken } from '@nocobase/db';
import {
  ApiError,
  apiErrorHandler,
  apiErrorResponses,
  apiValidator,
  dataResponse,
  listResponse,
  defineApiRoutes,
  describeRoute,
} from '@nocobase/app-server/router';
import { i18nToken } from '@nocobase/app-server/i18n';
import { getRequestLocale } from '@nocobase/i18n/server';
import {
  workItemServiceToken,
  WorkItemError,
  WORK_ITEM_ACTIONS,
  type WorkItem,
} from '../../providers/work-items/index.js';
import * as S from './schemas.js';
import attachments from './attachments.js';
import { actionMutation } from './action-mutation.js';
import { calendarServiceToken } from '../../providers/platform/index.js';
import {
  organizationServiceToken,
  ORG_SETTINGS,
} from '../../providers/org/index.js';
type Env = AuthEnv & AuthorizationEnv;
export default [
  defineApiRoutes<Application>((app) => {
    const c = app.container,
      db = c.resolve(databaseManagerToken),
      service = c.resolve(workItemServiceToken),
      r = new Hono<Env>();
    r.use(
      '*',
      c.resolve(authenticationToken).required(),
      c.resolve(authorizationToken).middleware(),
    );
    r.onError(async (e, ctx) => {
      if (!(e instanceof WorkItemError)) return apiErrorHandler(e, ctx);
      const i18n = c.resolve(i18nToken),
        locale = getRequestLocale(ctx) ?? i18n.getDefaultLocale();
      await i18n.ensureLocaleLoaded(locale);
      return apiErrorHandler(
        new ApiError({
          domain: 'workItems',
          reason: e.code,
          ...(e.field
            ? { fieldViolations: [{ field: e.field, description: e.code }] }
            : {}),
          message: e.code,
          status:
            e.code === 'ACCESS_DENIED'
              ? 'PERMISSION_DENIED'
              : e.code === 'NOT_FOUND'
                ? 'NOT_FOUND'
                : e.code.includes('CONFLICT')
                  ? 'ABORTED'
                  : 'FAILED_PRECONDITION',
          localizedMessage: {
            locale,
            message: i18n.getFixedT(
              'nb3-oa',
              locale,
            )(`workItems.errors.${e.code}`),
          },
        }),
        ctx,
      );
    });
    const actor = (ctx: Context<Env>) => ctx.get('auth')!.user.id;
    async function policy(ctx: Context<Env>, action: string) {
      const decision = await ctx.get('authz').authorize({
          resource: { type: 'composite', id: 'oa.workItems' },
          action,
        }),
        p =
          decision.effect === 'deny'
            ? undefined
            : decision.conditions?.database?.workItems;
      if (!p) throw new WorkItemError('ACCESS_DENIED');
      return p;
    }
    async function authorizedActions(
      w: WorkItem,
      ctx: Context<Env>,
      qualified: readonly (typeof WORK_ITEM_ACTIONS)[number][],
    ) {
      const actions: (typeof WORK_ITEM_ACTIONS)[number][] = [];
      for (const action of qualified)
        try {
          const p = await policy(ctx, action);
          if (
            (
              await db
                .repository('workItems')
                .withPolicy(p)
                .validateMutation({
                  operation: 'updateOne',
                  filter: { id: w.id },
                  values: actionMutation(w, action, actor(ctx)),
                })
            ).valid
          )
            actions.push(action);
        } catch {
          /* Current action scope and full mutation field policy intersect business eligibility. */
        }
      return actions;
    }
    const gate =
      (action: string) =>
      async (ctx: Context<Env>, next: () => Promise<void>) => {
        await policy(ctx, action);
        await next();
      };
    async function dto(w: WorkItem, ctx: Context<Env>) {
      const ids = [
          ...new Set(
            [
              w.creatorUserId,
              w.confirmationOwnerUserId,
              w.targetUserId,
              w.assigneeUserId,
            ].filter((id): id is string => !!id),
          ),
        ],
        users = await c
          .resolve(userAdministrationServiceToken)
          .list({ userIds: ids, pageSize: 100, kind: 'all' }),
        names = new Map(users.items.map((u) => [u.id, u.name])),
        user = (id: string | null) =>
          id ? { id, name: names.get(id) ?? id } : null,
        qualified = await service.actions(w, actor(ctx), db.connection()),
        actions = await authorizedActions(w, ctx, qualified);
      let canEdit = false;
      if (w.creatorUserId === actor(ctx) && w.status === 'draft')
        try {
          const p = await policy(ctx, 'edit');
          canEdit = (
            await db
              .repository('workItems')
              .withPolicy(p)
              .validateMutation({
                operation: 'updateOne',
                filter: { id: w.id },
                values: {
                  title: w.title,
                  description: w.description,
                  targetUserId: w.targetUserId,
                  dutyRoleCode: w.dutyRoleCode,
                  dueAt: w.dueAt,
                  requiresConfirmation: w.requiresConfirmation,
                  confirmationOwnerUserId: w.confirmationOwnerUserId,
                  attachments: [...w.attachments],
                  status: 'draft',
                  version: w.version + 1,
                  statusChangedAt: new Date(),
                },
              })
          ).valid;
        } catch {
          /* Independent edit permission is never inferred from creator identity. */
        }
      let canHandoverConfirmation = false;
      try {
        canHandoverConfirmation = await service.canHandoverConfirmation(
          w.id,
          actor(ctx),
          db.connection(),
          {
            view: await policy(ctx, 'view'),
            handover: await policy(ctx, 'handoverConfirmation'),
          },
        );
      } catch (error) {
        if (!(error instanceof WorkItemError) || error.code !== 'ACCESS_DENIED')
          throw error;
      }
      const role = w.dutyRoleCode
        ? await c.resolve(organizationServiceToken).getDutyRole(w.dutyRoleCode)
        : null;
      return S.WorkItem.parse({
        ...w,
        canEdit,
        canHandoverConfirmation,
        dutyRole: role ? { code: role.code, title: role.title } : null,
        creator: user(w.creatorUserId),
        confirmationOwner: user(w.confirmationOwnerUserId),
        target: user(w.targetUserId),
        assignee: user(w.assigneeUserId),
        actions,
        overdue:
          !['completed', 'cancelled'].includes(w.status) &&
          new Date(w.dueAt) < new Date(),
        dueAt: new Date(w.dueAt).toISOString(),
        completedAt: w.completedAt
          ? new Date(w.completedAt).toISOString()
          : null,
      });
    }
    const doc = (
      id: string,
      summary: string,
      schema: typeof S.WorkItem | typeof S.Pending,
      list = false,
    ) =>
      describeRoute({
        tags: ['Work items'],
        operationId: id,
        summary,
        responses: {
          '200': list ? listResponse(schema, S.Meta) : dataResponse(schema),
          ...apiErrorResponses,
        },
      });
    r.get(
      '/context',
      describeRoute({
        tags: ['Work items'],
        operationId: 'getWorkItemContext',
        summary:
          'Read company time zone and independently authorized duty role choices',
        responses: { 200: dataResponse(S.Context), ...apiErrorResponses },
      }),
      async (ctx) => {
        await policy(ctx, 'view');
        const grant = await ctx.get('authz').authorize({
          resource: { type: 'settings', id: ORG_SETTINGS.dutyRoles },
          action: 'read',
        });
        return ctx.json({
          data: {
            timeZone: c.resolve(calendarServiceToken).timeZone(),
            dutyRoles:
              grant.effect === 'deny'
                ? null
                : (await c.resolve(organizationServiceToken).listDutyRoles())
                    .filter((role) => role.active)
                    .map((role) => ({ code: role.code, title: role.title })),
          },
        });
      },
    );
    r.get(
      '/pending',
      doc(
        'pendingWorkItems',
        'Read own current work item candidates and confirmations',
        S.Pending,
      ),
      async (ctx) => {
        const result = await service.pending(
          actor(ctx),
          db.connection(),
          await policy(ctx, 'view'),
        );
        const items = [];
        for (const item of result.items) {
          const w = await service.get(
            item.sourceId,
            actor(ctx),
            db.connection(),
            await policy(ctx, 'view'),
          );
          const actions = w
            ? await authorizedActions(w, ctx, item.actions)
            : [];
          if (actions.length)
            items.push({ ...item, actions, dueAt: item.dueAt.toISOString() });
        }
        return ctx.json({ data: { items, count: items.length } });
      },
    );
    r.get(
      '/',
      doc(
        'listWorkItems',
        'List currently readable ordinary tasks',
        S.WorkItem,
        true,
      ),
      gate('view'),
      apiValidator('query', S.List),
      async (ctx) => {
        const q = ctx.req.valid('query'),
          p = await policy(ctx, 'view'),
          rows = await db
            .repository<WorkItem>('workItems')
            .withPolicy(p)
            .findMany({ sort: (s) => s.field('dueAt').asc() }),
          visible = [];
        for (const row of rows) {
          const w = await service.get(row.id!, actor(ctx), db.connection(), p);
          if (!w) continue;
          if (q.status && w.status !== q.status) continue;
          if (
            q.q &&
            !`${w.title} ${w.description}`
              .toLocaleLowerCase()
              .includes(q.q.toLocaleLowerCase())
          )
            continue;
          if (q.mode === 'created' && w.creatorUserId !== actor(ctx)) continue;
          if (
            q.mode === 'assigned' &&
            w.assigneeUserId !== actor(ctx) &&
            w.targetUserId !== actor(ctx)
          )
            continue;
          const data = await dto(w, ctx);
          if (q.overdue !== 'all' && data.overdue !== (q.overdue === 'true'))
            continue;
          if (
            q.mode === 'pool' &&
            !(w.status === 'open' && data.actions.includes('claim'))
          )
            continue;
          if (
            q.mode === 'pending' &&
            !data.actions.some((action) =>
              (w.status === 'blocked'
                ? ['resume', 'reassign']
                : ['claim', 'complete', 'confirm']
              ).includes(action),
            )
          )
            continue;
          visible.push(data);
        }
        visible.sort((a, b) => {
          const left =
            q.sort === 'dueAt'
              ? a.dueAt
              : q.sort === 'title'
                ? a.title
                : a.status;
          const right =
            q.sort === 'dueAt'
              ? b.dueAt
              : q.sort === 'title'
                ? b.title
                : b.status;
          return (
            (q.direction === 'asc' ? 1 : -1) * left.localeCompare(right) ||
            a.id.localeCompare(b.id)
          );
        });
        return ctx.json({
          data: visible.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
          meta: { page: q.page, pageSize: q.pageSize, total: visible.length },
        });
      },
    );
    r.get(
      '/:id',
      doc('getWorkItem', 'Read task with safe current actions', S.WorkItem),
      gate('view'),
      apiValidator('param', S.Params),
      async (ctx) => {
        const w = await service.get(
          ctx.req.valid('param').id,
          actor(ctx),
          db.connection(),
          await policy(ctx, 'view'),
        );
        if (!w) throw new WorkItemError('NOT_FOUND');
        return ctx.json({ data: await dto(w, ctx) });
      },
    );
    r.post(
      '/',
      doc('createWorkItem', 'Create own ordinary task draft', S.WorkItem),
      gate('create'),
      apiValidator('json', S.Draft),
      async (ctx) => {
        const p = await policy(ctx, 'create'),
          w = await db.transaction((tx) =>
            service.save(
              { ...ctx.req.valid('json'), actorId: actor(ctx) },
              tx,
              p,
            ),
          );
        return ctx.json({ data: await dto(w, ctx) });
      },
    );
    r.patch(
      '/:id',
      doc(
        'editWorkItem',
        'Edit own draft using optimistic version',
        S.WorkItem,
      ),
      gate('edit'),
      apiValidator('param', S.Params),
      apiValidator('json', S.Draft),
      async (ctx) => {
        const p = await policy(ctx, 'edit'),
          w = await db.transaction((tx) =>
            service.save(
              {
                ...ctx.req.valid('json'),
                id: ctx.req.valid('param').id,
                actorId: actor(ctx),
              },
              tx,
              p,
            ),
          );
        return ctx.json({ data: await dto(w, ctx) });
      },
    );
    r.post(
      '/:id/handoverConfirmation',
      doc(
        'handoverWorkItemConfirmation',
        'Transfer actual confirmation responsibility with current maintenance and ordinary view policies',
        S.WorkItem,
      ),
      gate('handoverConfirmation'),
      apiValidator('param', S.Params),
      apiValidator('json', S.Handover),
      async (ctx) => {
        const policies = {
          view: await policy(ctx, 'view'),
          handover: await policy(ctx, 'handoverConfirmation'),
        };
        const w = await db.transaction((tx) =>
          service.handoverConfirmation(
            {
              ...ctx.req.valid('json'),
              id: ctx.req.valid('param').id,
              actorId: actor(ctx),
            },
            tx,
            policies,
          ),
        );
        return ctx.json({ data: await dto(w, ctx) });
      },
    );
    for (const action of WORK_ITEM_ACTIONS)
      r.post(
        `/:id/${action}`,
        doc(
          `workItem${action}`,
          'Perform authorized ordinary work item transition',
          S.WorkItem,
        ),
        gate(action),
        apiValidator('param', S.Params),
        apiValidator('json', S.Action),
        async (ctx) => {
          const p = await policy(ctx, action),
            w = await db.transaction((tx) =>
              service.act(
                {
                  ...ctx.req.valid('json'),
                  id: ctx.req.valid('param').id,
                  actorId: actor(ctx),
                  action,
                },
                tx,
                p,
              ),
            );
          return ctx.json({ data: await dto(w, ctx) });
        },
      );
    const mount = new Hono();
    mount.route('/workItems', r);
    return mount;
  }),
  ...attachments,
];
