import { AsyncLocalStorage } from 'node:async_hooks';
import type { AppAuthorization } from '@nocobase/app-plugin-authorization/server';
import { withRequestSqlScope } from './sql.js';

type Registry = AppAuthorization['recordAccess'];
const reads = new AsyncLocalStorage<
  Map<Registry, Map<string, Promise<unknown>>>
>();
const measurements = new AsyncLocalStorage<
  Map<string, { count: number; ms: number }>
>();

/** Aggregates timings only: never retains actors, parameters, rows or decisions. */
export async function measureRequestScopes<T>(read: () => Promise<T>) {
  const timings = new Map<string, { count: number; ms: number }>();
  const result = await measurements.run(timings, read);
  return { result, timings };
}

/** Fixed operation names only; never include record or user identifiers. */
export async function measureRequestRead<T>(
  name: string,
  read: () => Promise<T>,
) {
  const start = performance.now();
  try {
    return await withRequestSqlScope(name, read);
  } finally {
    const timings = measurements.getStore();
    if (timings) {
      const entry = timings.get(name) ?? { count: 0, ms: 0 };
      entry.count++;
      entry.ms += performance.now() - start;
      timings.set(name, entry);
    }
  }
}

/** Only read requests may reuse an application data-scope resolution. */
export function withRequestRecordAccess<T>(read: () => Promise<T>): Promise<T> {
  return reads.run(new Map(), read);
}

export function installRequestRecordAccess(registry: Registry): () => void {
  const original = registry.resolve.bind(registry);
  registry.resolve = async (key, context) => {
    const scope = reads.getStore();
    if (!scope || !key.startsWith('oa.'))
      return original.call(registry, key, context);
    // Scope parameters are JSON values in the authorization contract. Include
    // the full context: an actor, collection or operation must never reuse another's scope.
    if (!isJson(context.params) && context.params !== undefined)
      return original.call(registry, key, context);
    const cacheKey = JSON.stringify([
      key,
      context.principal,
      context.collection,
      context.action,
      context.params === undefined ? ['undefined'] : ['json', context.params],
    ]);
    let cache = scope.get(registry);
    if (!cache) {
      cache = new Map();
      scope.set(registry, cache);
    }
    let pending = cache.get(cacheKey);
    if (!pending) {
      const start = performance.now();
      pending = original.call(registry, key, context).finally(() => {
        const timings = measurements.getStore();
        if (!timings) return;
        const entry = timings.get(key) ?? { count: 0, ms: 0 };
        entry.count++;
        entry.ms += performance.now() - start;
        timings.set(key, entry);
      });
      cache.set(cacheKey, pending);
      const current = pending;
      void pending.catch(() => {
        if (cache.get(cacheKey) === current) cache.delete(cacheKey);
      });
    }
    return structuredClone(await pending);
  };
  return () => {
    registry.resolve = original;
  };
}

function isJson(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || value === null || seen.has(value))
    return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((entry) => isJson(entry, seen));
  return (
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.getOwnPropertySymbols(value).length === 0 &&
    Object.values(value).every((entry) => isJson(entry, seen))
  );
}
