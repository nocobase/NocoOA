import { trialContentLocaleMiddleware } from './providers/trial-data-localization/middleware.js';
import { requestPerformanceMiddleware } from './providers/request-performance/index.js';
import {
  RequestSqlProvider,
  requestSqlMiddleware,
} from './providers/request-performance/sql.js';
import { permissionAuditMiddleware } from './providers/audit/permission-sets.js';
import type { Application } from '@nocobase/app-server/application';
import { DatabaseProvider } from '@nocobase/app-server/database';
import { I18nProvider, i18nHttpMiddleware } from '@nocobase/app-server/i18n';
import { CachingProvider } from '@nocobase/app-server/caching';
import { DriveProvider } from '@nocobase/app-server/drive';
import { IdGeneratorProvider } from '@nocobase/app-server/id-generator';
import {
  LoggingProvider,
  requestLoggingMiddleware,
} from '@nocobase/app-server/logging';
import { QueueServiceProvider } from '@nocobase/app-server/queue';
import { SecretsProvider } from '@nocobase/app-server/secrets';
import { JobExecutorServiceProvider } from '@nocobase/app-server/jobs';
import {
  SessionProvider,
  sessionHttpMiddleware,
} from '@nocobase/app-server/session';
import { healthCheckApiRoutes } from '@nocobase/app-server/router';
import {
  createAppFromRuntime,
  type AppRuntimeContext,
} from '@nocobase/app-server/runtime';
import { spaRootRoutes } from '@nocobase/app-server/spa';

export function createApp(runtime: AppRuntimeContext): Application {
  const app = createAppFromRuntime(runtime);

  app.addServiceProvider(DatabaseProvider);
  app.addServiceProvider(RequestSqlProvider);
  app.addServiceProvider(I18nProvider);
  app.addServiceProvider(LoggingProvider);
  app.addServiceProvider(CachingProvider);
  app.addServiceProvider(IdGeneratorProvider);
  app.addServiceProvider(SecretsProvider);
  app.addServiceProvider(SessionProvider);
  app.addServiceProvider(DriveProvider);
  app.addServiceProvider(QueueServiceProvider, {
    nodeEnv: runtime.env.NODE_ENV,
  });
  app.addServiceProvider(JobExecutorServiceProvider, {
    nodeEnv: runtime.env.NODE_ENV,
  });
  app.addHttpMiddleware(requestLoggingMiddleware);
  app.addHttpMiddleware(requestSqlMiddleware);
  app.addHttpMiddleware(sessionHttpMiddleware);
  app.addHttpMiddleware(i18nHttpMiddleware);
  app.addHttpMiddleware(trialContentLocaleMiddleware);
  // Provider registration starts after middleware is frozen; capture actors here for transactional permission auditing.
  app.addHttpMiddleware(permissionAuditMiddleware);
  // The authorization plugin repeatedly inspects physical schema through a public API.
  // Request-scoped schema sharing avoids repeated PG catalog queries without caching grants.
  app.addHttpMiddleware(requestPerformanceMiddleware);
  app.addRoutes(healthCheckApiRoutes);
  app.addRuntimeContributions(runtime);
  app.addRoutes(spaRootRoutes);

  return app;
}
