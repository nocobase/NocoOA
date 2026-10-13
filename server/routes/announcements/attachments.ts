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
  announcementServiceToken,
  AnnouncementError,
} from '../../providers/announcements/index.js';
interface Principal {
  id: string;
  actorId: string;
  version: number;
  upload: boolean;
  ids?: string[];
}
const principals = new WeakMap<object, Principal>();
const limit = 20 * 1024 * 1024;
const generated = defineFileRepositoryApiRoutes<Principal>({
  principal: (c) => principals.get(c)!,
  repositories: [
    {
      name: 'announcementAttachments',
      collection: 'announcementFiles',
      disk: 'local',
      accessPath: '/uploads/announcements',
      accessMode: 'stream',
      policy: (p) => ({
        read: {
          scope: (f) =>
            f.and([
              f.string('announcementId').eq(p.id),
              ...attachmentSelectionFilters(f, p.ids),
            ]),
          fields: FILE_COLUMNS.filter((k) => k !== 'disk' && k !== 'key'),
        },
        create: p.upload
          ? {
              scope: { announcementId: p.id, ownerId: p.actorId },
              defaults: {
                announcementId: p.id,
                ownerId: p.actorId,
                uploadVersion: p.version,
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
        service = c.resolve(announcementServiceToken),
        r = new Hono<AuthEnv & AuthorizationEnv>();
      const path =
        contribution.scope === 'api'
          ? '/announcementAttachments/*'
          : '/uploads/announcements/*';
      r.onError((e, ctx) =>
        apiErrorHandler(
          e instanceof AnnouncementError
            ? new ApiError({
                domain: 'announcements',
                reason: e.code,
                message: e.code,
                status:
                  e.code === 'INVALID_ATTACHMENT'
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
              'x-announcement-id': z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
            }),
          ),
        );
      r.use(path, async (ctx, next) => {
        const actorId = ctx.get('auth')!.user.id,
          upload =
            contribution.scope === 'api' && ctx.req.path.endsWith('/uploadOne');
        let id = ctx.req.header('x-announcement-id'),
          fileId: string | undefined;
        if (contribution.scope === 'root') {
          fileId = ctx.req.path.split('/').at(-1)?.split('.')[0];
          const file = fileId
            ? await db
                .repository<{ id: string; announcementId: string }>(
                  'announcementFiles',
                )
                .findOne({ filter: { id: fileId } })
            : undefined;
          id = file?.announcementId;
        }
        if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id))
          throw new AnnouncementError('ACCESS_DENIED');
        const decision = await ctx.get('authz').authorize({
            resource: { type: 'composite', id: 'oa.announcements' },
            action: 'view',
          }),
          p =
            decision.effect === 'deny'
              ? undefined
              : decision.conditions?.database?.announcements;
        if (!p) throw new AnnouncementError('ACCESS_DENIED');
        const a = await service.get(id, actorId, db.connection(), p);
        if (!a) throw new AnnouncementError('ACCESS_DENIED');
        if (upload) {
          if (a.publisherUserId !== actorId || a.status !== 'draft')
            throw new AnnouncementError('ACCESS_DENIED');
          const edit = await ctx.get('authz').authorize({
              resource: { type: 'composite', id: 'oa.announcements' },
              action: 'edit',
            }),
            ep =
              edit.effect === 'deny'
                ? undefined
                : edit.conditions?.database?.announcements;
          if (
            !ep ||
            !(
              await db
                .repository('announcements')
                .withPolicy(ep)
                .validateMutation({
                  operation: 'updateOne',
                  filter: { id },
                  values: { attachments: a.attachments },
                })
            ).valid
          )
            throw new AnnouncementError('ACCESS_DENIED');
        }
        const ids =
          a.status === 'draft' && a.publisherUserId === actorId
            ? undefined
            : a.attachments;
        if (fileId && ids && !ids.includes(fileId))
          throw new AnnouncementError('ACCESS_DENIED');
        principals.set(ctx, { id, actorId, version: a.version, upload, ids });
        ctx.header('Cache-Control', 'private, no-store');
        await next();
      });
      if (contribution.scope === 'api') {
        r.use(
          '/announcementAttachments/uploadOne',
          bodyLimit({
            maxSize: limit + 65536,
            onError: () => {
              throw new AnnouncementError('INVALID_ATTACHMENT');
            },
          }),
        );
        r.use('/announcementAttachments/uploadOne', async (ctx, next) => {
          const form = await ctx.req.raw.clone().formData(),
            files = form.getAll('file');
          if (files.length !== 1 || !(files[0] instanceof File))
            throw new AnnouncementError('INVALID_ATTACHMENT');
          const file = files[0];
          if (file.size <= 0 || file.size > limit)
            throw new AnnouncementError('INVALID_ATTACHMENT');
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
          if (!valid) throw new AnnouncementError('INVALID_ATTACHMENT');
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
