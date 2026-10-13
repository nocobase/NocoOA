import { attachmentSelectionFilters } from '../attachment-selection.js';
import { Hono } from 'hono';
import { z } from 'zod';
import { bodyLimit } from 'hono/body-limit';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
import {
  defineFileRepositoryApiRoutes,
  FILE_COLUMNS,
} from '@nocobase/app-plugin-file/server';
import { databaseManagerToken } from '@nocobase/db';
import type { Application } from '@nocobase/app-server/application';
import {
  ApiError,
  apiErrorHandler,
  apiValidator,
  type AppRouteContribution,
} from '@nocobase/app-server/router';
import {
  onboardingServiceToken,
  OnboardingError,
} from '../../providers/onboarding/index.js';
interface Principal {
  id: string;
  actorId: string;
  version: number;
  upload: boolean;
  ids?: string[];
  taskId: string;
}
const principals = new WeakMap<object, Principal>();
const limit = 20 * 1024 * 1024;
const generated = defineFileRepositoryApiRoutes<Principal>({
  principal: (c) => principals.get(c)!,
  repositories: [
    {
      name: 'onboardingAttachments',
      collection: 'onboardingFiles',
      disk: 'local',
      accessPath: '/uploads/onboarding',
      accessMode: 'stream',
      policy: (p) => ({
        read: {
          scope: (f) =>
            f.and([
              f.string('onboardingId').eq(p.id),
              f.string('taskId').eq(p.taskId),
              ...attachmentSelectionFilters(f, p.ids),
            ]),
          fields: FILE_COLUMNS.filter((k) => k !== 'disk' && k !== 'key'),
        },
        create: p.upload
          ? {
              scope: { onboardingId: p.id, ownerId: p.actorId },
              defaults: {
                onboardingId: p.id,
                ownerId: p.actorId,
                uploadVersion: p.version,
                taskId: p.taskId,
              },
            }
          : false,
        update: false,
        delete: false,
      }),
      actions: {
        findMany: { maxLimit: 10 },
        findOne: {},
        uploadOne: { maxSize: limit + 65536 },
      },
    },
  ],
});
const routes: readonly AppRouteContribution<Application>[] = generated.map(
  (contribution) => ({
    scope: contribution.scope,
    createRouter: async (app) => {
      const c = app.container,
        db = c.resolve(databaseManagerToken),
        service = c.resolve(onboardingServiceToken),
        r = new Hono<AuthEnv & AuthorizationEnv>();
      const path =
        contribution.scope === 'api'
          ? '/onboardingAttachments/*'
          : '/uploads/onboarding/*';
      r.onError((e, ctx) =>
        apiErrorHandler(
          e instanceof OnboardingError
            ? new ApiError({
                domain: 'onboarding',
                reason: e.code,
                message: e.code,
                status:
                  e.code === 'ONBOARDING_SOURCE_INVALID'
                    ? 'INVALID_ARGUMENT'
                    : 'PERMISSION_DENIED',
              })
            : e,
          ctx,
        ),
      );
      r.use(
        path,
        c.resolve(authenticationToken).required(),
        c.resolve(authorizationToken).middleware(),
      );
      if (contribution.scope === 'api')
        r.use(
          path,
          apiValidator(
            'header',
            z.object({
              'x-onboarding-id': z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
              'x-onboarding-task-id': z.string().min(1).max(200),
            }),
          ),
        );
      r.use(path, async (ctx, next) => {
        ctx.header('Cache-Control', 'private, no-store');
        const actorId = ctx.get('auth')!.user.id,
          upload =
            contribution.scope === 'api' && ctx.req.path.endsWith('/uploadOne');
        let id = ctx.req.header('x-onboarding-id'),
          fileId: string | undefined;
        if (contribution.scope === 'root') {
          fileId = ctx.req.path.split('/').at(-1)?.split('.')[0];
          const file = fileId
            ? await db
                .repository<{ id: string; onboardingId: string }>(
                  'onboardingFiles',
                )
                .findOne({ filter: { id: fileId } })
            : undefined;
          id = file?.onboardingId;
        }
        if (!id || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
          throw new OnboardingError('ONBOARDING_FORBIDDEN');
        const decision = await ctx.get('authz').authorize({
            resource: { type: 'composite', id: 'oa.onboarding' },
            action: 'view',
          }),
          p =
            decision.effect === 'deny'
              ? undefined
              : decision.conditions?.database?.onboardings;
        if (!p) throw new OnboardingError('ONBOARDING_FORBIDDEN');
        const taskDecision = await ctx.get('authz').authorize({
          resource: { type: 'composite', id: 'oa.onboarding' },
          action: 'view',
        });
        const taskPolicy =
          taskDecision.effect === 'deny'
            ? undefined
            : taskDecision.conditions?.database?.onboardingTasks;
        if (!taskPolicy) throw new OnboardingError('ONBOARDING_FORBIDDEN');
        const detail = await service.detail(id, db.connection(), p, taskPolicy);
        let taskId = ctx.req.header('x-onboarding-task-id');
        if (fileId) {
          const file = await db
            .repository<{ id: string; taskId: string }>('onboardingFiles')
            .findOne({ filter: { id: fileId } });
          taskId = file?.taskId;
        }
        const task = detail.tasks.find((t) => t.id === taskId);
        if (
          !task ||
          !('facts' in task) ||
          !('version' in task) ||
          ['finance', 'recovery:finance'].includes(task.kind)
        )
          throw new OnboardingError('ONBOARDING_FORBIDDEN');
        const mutable =
          detail.record.status === 'handling' ||
          (detail.record.status === 'cancelled' &&
            task.kind.startsWith('recovery:'));
        if (upload) {
          const decision = await ctx.get('authz').authorize({
            resource: { type: 'composite', id: 'oa.onboarding' },
            action: 'complete',
          });
          const completePolicy =
            decision.effect === 'deny'
              ? undefined
              : decision.conditions?.database?.onboardingTasks;
          if (!completePolicy || !mutable)
            throw new OnboardingError('ONBOARDING_FORBIDDEN');
          await service.authorizeAttachment(task.id, actorId, db.connection());
          if (
            !(
              await db
                .repository('onboardingTasks')
                .withPolicy(completePolicy)
                .validateMutation({
                  operation: 'updateOne',
                  filter: { id: task.id },
                  values: { facts: {} },
                })
            ).valid
          )
            throw new OnboardingError('ONBOARDING_FORBIDDEN');
        }
        const mine =
          mutable && task.status === 'claimed' && task.assigneeId === actorId
            ? await db
                .repository<{
                  id: string;
                  taskId: string;
                  ownerId: string;
                  uploadVersion: number;
                }>('onboardingFiles')
                .findMany({
                  filter: {
                    taskId: task.id,
                    ownerId: actorId,
                    uploadVersion: task.version,
                  },
                  select: (s) => s.fields('id'),
                })
            : [];
        const frozen = task.facts?.attachmentIds
          ? (JSON.parse(task.facts.attachmentIds) as string[])
          : [];
        const ids = [...new Set([...frozen, ...mine.map((f) => f.id)])];
        if (fileId && !ids.includes(fileId))
          throw new OnboardingError('ONBOARDING_FORBIDDEN');
        principals.set(ctx, {
          id,
          actorId,
          version: task.version,
          taskId: task.id,
          upload,
          ids,
        });
        ctx.header('Cache-Control', 'private, no-store');
        await next();
        // Public File uploads return the stored record; restrict the response just like metadata reads.
        if (
          contribution.scope === 'api' &&
          ctx.res.headers.get('content-type')?.includes('application/json')
        ) {
          const clean = (value: unknown): unknown =>
            Array.isArray(value)
              ? value.map(clean)
              : value && typeof value === 'object'
                ? Object.fromEntries(
                    Object.entries(value)
                      .filter(([key]) => key !== 'disk' && key !== 'key')
                      .map(([key, item]) => [key, clean(item)]),
                  )
                : value;
          const body: unknown = await ctx.res.clone().json();
          ctx.res = new Response(JSON.stringify(clean(body)), {
            status: ctx.res.status,
            headers: ctx.res.headers,
          });
        }
      });
      if (contribution.scope === 'api') {
        r.use(
          '/onboardingAttachments/uploadOne',
          bodyLimit({
            maxSize: limit + 65536,
            onError: () => {
              throw new OnboardingError('ONBOARDING_SOURCE_INVALID');
            },
          }),
        );
        r.use('/onboardingAttachments/uploadOne', async (ctx, next) => {
          const form = await ctx.req.raw.clone().formData(),
            files = form.getAll('file');
          if (files.length !== 1 || !(files[0] instanceof File))
            throw new OnboardingError('ONBOARDING_SOURCE_INVALID');
          const file = files[0];
          if (file.size <= 0 || file.size > limit)
            throw new OnboardingError('ONBOARDING_SOURCE_INVALID');
          const bytes = new Uint8Array(await file.slice(0, 1024).arrayBuffer()),
            ext = file.name.split('.').at(-1)?.toLowerCase();
          const valid =
            ext === 'pdf'
              ? file.type === 'application/pdf' &&
                new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-'
              : ext === 'png'
                ? file.type === 'image/png' &&
                  [137, 80, 78, 71, 13, 10, 26, 10].every(
                    (v, i) => bytes[i] === v,
                  )
                : ['jpg', 'jpeg'].includes(ext ?? '')
                  ? file.type === 'image/jpeg' &&
                    bytes[0] === 255 &&
                    bytes[1] === 216 &&
                    bytes[2] === 255
                  : ext === 'txt'
                    ? file.type === 'text/plain' && !bytes.includes(0)
                    : false;
          if (!valid) throw new OnboardingError('ONBOARDING_SOURCE_INVALID');
          await next();
        });
      }
      const generatedRouter = await contribution.createRouter(app);
      r.route('/', generatedRouter);
      const mount = new Hono();
      mount.route('/', r);
      return mount;
    },
  }),
);
export default routes;
