import type { Context, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Application } from '@nocobase/app-server/application';
import { defineHttpMiddleware } from '@nocobase/app-server/router';
import { translateTrialPayload } from './transform.js';
import { trialContentLocalizationToken } from './index.js';

const limitRequestBody: MiddlewareHandler<Record<never, never>> = bodyLimit({
  maxSize: 8 * 1024 * 1024,
});

/** Browser display opt-in. Integrations and the trial generator retain the canonical API contract. */
export const trialContentLocaleMiddleware = defineHttpMiddleware<Application>({
  name: 'oa/trial-content-locale',
  register(router, app) {
    router.use('*', async (context, next) => {
      const locale = context.req.header('x-oa-trial-content-locale');
      if (locale !== 'en-US' && locale !== 'zh-CN') return next();
      // Never intercept auth, streaming, OpenAPI, files or framework/plugin protocols.
      if (
        !/\/api\//u.test(context.req.path) ||
        /\/api\/(?:auth(?:\/|$)|swagger(?:\/|$)|i18n(?:\/|$)|files(?:\/|$))/u.test(
          context.req.path,
        )
      )
        return next();
      const service = app.container.resolve(trialContentLocalizationToken);
      const pairs = await service.pairs();
      // Unchanged translated form values map back to their original demo text before normal validation.
      // Edited, unknown values are preserved verbatim. This is a demo display adapter, not a translation editor.
      if (
        ['POST', 'PUT', 'PATCH'].includes(context.req.method) &&
        context.req.header('content-type')?.includes('application/json')
      ) {
        await limitRequestBody(
          context as Context<Record<never, never>, '*'>,
          async () => {},
        );
        if (context.finalized) return;
        const originalText = await context.req.text();
        let text = originalText;
        try {
          const body: unknown = JSON.parse(originalText);
          text = JSON.stringify(
            translateTrialPayload(
              body,
              new Map(pairs.map(([zh, en]) => [en, zh])),
            ),
          );
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          // Leave malformed JSON to the endpoint's normal validation and error response.
        }
        // Hono parses JSON from cached text; keep the raw request and cache in agreement.
        const headers = new Headers(context.req.raw.headers);
        headers.set(
          'content-length',
          String(new TextEncoder().encode(text).byteLength),
        );
        context.req.raw = new Request(context.req.raw, { body: text, headers });
        context.req.bodyCache = {};
      }
      await next();
      if (
        context.res.status < 200 ||
        context.res.status >= 300 ||
        !context.res.headers.get('content-type')?.includes('application/json')
      )
        return;
      if (locale === 'en-US' && pairs.length) {
        const payload: unknown = await context.res.json();
        const headers = new Headers(context.res.headers);
        headers.delete('content-length');
        headers.delete('etag');
        context.res = new Response(
          JSON.stringify(translateTrialPayload(payload, new Map(pairs))),
          { status: context.res.status, headers },
        );
      }
      context.header('Content-Language', locale);
      context.header('Cache-Control', 'private, no-store');
      context.header(
        'Vary',
        [
          ...new Set([
            ...(context.res.headers.get('vary') ?? '')
              .split(',')
              .filter(Boolean),
            'x-oa-trial-content-locale',
          ]),
        ].join(', '),
      );
    });
  },
});
