import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import {
  installRequestRecordAccess,
  measureRequestScopes,
  withRequestRecordAccess,
} from './record-access.js';
import type { Application } from '@nocobase/app-server/application';
import { loggingToken } from '@nocobase/app-server/logging';
import { defineHttpMiddleware } from '@nocobase/app-server/router';
import { databaseManagerToken } from '@nocobase/db';
import { approvalDirectoryServiceToken } from '../approval-directory/contract.js';
import { installRequestSchemaReads, withRequestSchemaReads } from './schema.js';
import { withApprovalQueryReads } from '../approval-runtime/query-service.js';
import { withBusinessReads } from './business-reads.js';
import { withRequestUserSummaries } from './user-summaries.js';

/** Registered before route freezing, like the application's audit context. */
export const requestPerformanceMiddleware = defineHttpMiddleware<Application>({
  name: 'oa/request-performance',
  register: (router, app) => {
    installRequestSchemaReads(
      app.container.resolve(databaseManagerToken).connection().collections,
    );
    if (app.container.has(authorizationToken))
      installRequestRecordAccess(
        app.container.resolve(authorizationToken).recordAccess,
      );
    const logger = app.container
      .resolve(loggingToken)
      .getLogger('oa-performance');
    router.use('*', async (context, next) => {
      const start = performance.now();
      const { timings } = await measureRequestScopes(() =>
        withRequestSchemaReads(() =>
          context.req.method === 'GET'
            ? withRequestUserSummaries(() =>
                withBusinessReads(() =>
                  withApprovalQueryReads(() =>
                    withRequestRecordAccess(() =>
                      app.container.has(approvalDirectoryServiceToken)
                        ? app.container
                            .resolve(approvalDirectoryServiceToken)
                            .withReadSnapshot(next)
                        : next(),
                    ),
                  ),
                ),
              )
            : next(),
        ),
      );
      const elapsed = performance.now() - start;
      if (elapsed > 500)
        logger.warn(
          {
            method: context.req.method,
            path: context.req.path,
            status: context.res.status,
            durationMs: Math.round(elapsed),
            scopes: [...timings].map(([scope, value]) => ({ scope, ...value })),
          },
          'Request exceeded 500ms',
        );
      // Separate downstream server execution from browser queueing and transport time.
      const scopes = [...timings]
        .sort((a, b) => b[1].ms - a[1].ms)
        .slice(0, 5)
        .map(
          ([key, value], index) =>
            `scope${index};dur=${value.ms.toFixed(1)};desc="${key.replace(/[^a-zA-Z0-9._-]/g, '')} (${value.count})"`,
        );
      context.header(
        'Server-Timing',
        [`app;dur=${elapsed.toFixed(1)}`, ...scopes].join(', '),
      );
    });
  },
});
