import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { ServiceProvider } from '@nocobase/service-provider';
import type { Application } from '@nocobase/app-server/application';
import { loggingToken } from '@nocobase/app-server/logging';
import { defineHttpMiddleware } from '@nocobase/app-server/router';
import { databaseManagerToken } from '@nocobase/db';

const requests = new AsyncLocalStorage<{
  connection: object;
  count: number;
  active: boolean;
  profile?: Map<string, number>;
  distinct?: Map<string, Set<string>>;
}>();
const scopes = new AsyncLocalStorage<string>();

export function withRequestSqlScope<T>(name: string, work: () => Promise<T>) {
  return scopes.run(name, work);
}

/** Count executions, including transaction control. Opt-in profiles retain only
 * identifiers and counts; statements, bindings and fingerprints never leave the request. */
export function installRequestSqlCounter(
  client: {
    on(
      event: 'query',
      listener: (query: { sql?: string; bindings?: unknown }) => void,
    ): unknown;
    removeListener(
      event: 'query',
      listener: (query: { sql?: string; bindings?: unknown }) => void,
    ): unknown;
  },
  connection: object,
) {
  const count = (query: { sql?: string; bindings?: unknown }) => {
    const request = requests.getStore();
    if (!request?.active || request.connection !== connection) return;
    request.count++;
    if (request.profile) {
      // Retain identifiers only, never SQL text, literals or bindings.
      const sql = query?.sql ?? '';
      const identifiers = sql.replace(
        /'(?:''|[^'])*'|\/\*[\s\S]*?\*\/|--[^\n]*/g,
        ' ',
      );
      const operation =
        sql.match(/^\s*([a-z]+)/i)?.[1]?.toLowerCase() ?? 'unknown';
      const tables = [
        ...identifiers.matchAll(
          /\b(?:from|join|into|update)\s+((?:"?[a-zA-Z_][a-zA-Z_0-9]*"?\.)?"?[a-zA-Z_][a-zA-Z_0-9]*"?)/gi,
        ),
      ].map((match) => match[1].replaceAll('"', ''));
      const key = JSON.stringify([
        scopes.getStore() ?? 'request',
        operation,
        [...new Set(tables)].sort(),
      ]);
      request.profile.set(key, (request.profile.get(key) ?? 0) + 1);
      const seen = request.distinct!.get(key) ?? new Set<string>();
      seen.add(
        createHash('sha256')
          .update(sql)
          .update(JSON.stringify(query?.bindings ?? []))
          .digest('hex'),
      );
      request.distinct!.set(key, seen);
    }
  };
  client.on('query', count);
  return () => client.removeListener('query', count);
}

export async function measureRequestSql<T>(
  connection: object,
  work: () => Promise<T>,
  report: (
    count: number,
    profile?: Map<string, number>,
    distinct?: Map<string, number>,
  ) => void,
  profile = false,
) {
  const request = {
    connection,
    count: 0,
    active: true,
    profile: profile ? new Map<string, number>() : undefined,
    distinct: profile ? new Map<string, Set<string>>() : undefined,
  };
  try {
    return await requests.run(request, work);
  } finally {
    request.active = false;
    report(
      request.count,
      request.profile,
      request.distinct
        ? new Map(
            [...request.distinct].map(([key, values]) => [key, values.size]),
          )
        : undefined,
    );
  }
}

export class RequestSqlProvider extends ServiceProvider<Application> {
  readonly name = 'oa/request-sql';
  private dispose?: () => unknown;
  override async start() {
    const connection = this.app.container
      .resolve(databaseManagerToken)
      .connection();
    this.dispose = installRequestSqlCounter(
      await connection.client(),
      connection,
    );
  }
  override async shutdown() {
    this.dispose?.();
    this.dispose = undefined;
  }
}

/** Before session middleware, so authentication SQL is included as well. */
export const requestSqlMiddleware = defineHttpMiddleware<Application>({
  name: 'oa/request-sql',
  register: (router, app) => {
    const connection = app.container.resolve(databaseManagerToken).connection();
    const logger = app.container
      .resolve(loggingToken)
      .getLogger('oa-performance');
    router.use('*', async (context, next) => {
      const start = performance.now();
      await measureRequestSql(
        connection,
        next,
        (sqlCount, profile, distinct) => {
          if (profile) {
            const entries = [...profile];
            for (let offset = 0; offset < entries.length; offset += 25)
              logger.info(
                {
                  sqlCount,
                  profileOffset: offset,
                  sqlProfile: entries
                    .slice(offset, offset + 25)
                    .map(([key, count]) => ({
                      key: JSON.parse(key) as [string, string, string[]],
                      count,
                      distinct: distinct?.get(key),
                    })),
                },
                'Approval center SQL profile',
              );
          }
          context.header(
            'Server-Timing',
            [
              context.res.headers.get('Server-Timing'),
              `sql;desc="${sqlCount} statements"`,
            ]
              .filter(Boolean)
              .join(', '),
          );
          const durationMs = Math.round(performance.now() - start);
          if (durationMs > 500)
            logger.warn(
              {
                method: context.req.method,
                path: context.req.path,
                status: context.res.status,
                durationMs,
                sqlCount,
              },
              'Slow request SQL summary',
            );
        },
        context.req.path === '/api/approvalCenter' &&
          context.req.query('sqlProfile') === 'true',
      );
    });
  },
});
