import { AsyncLocalStorage } from 'node:async_hooks';

/** A supplied root connection is still a request read; transactions stay fresh. */
export function requestConnectionRead<T>(
  root: object,
  connection: object,
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  return connection === root ? requestBusinessRead(root, key, work) : work();
}

const reads = new AsyncLocalStorage<
  Map<object, Map<string, Promise<unknown>>>
>();

/** Only immutable read facts in one GET; explicit transactions bypass callers. */
export function withBusinessReads<T>(work: () => Promise<T>) {
  return reads.run(new Map(), work);
}

export async function requestBusinessRead<T>(
  owner: object,
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  const context = reads.getStore();
  if (!context) return work();
  let cache = context.get(owner);
  if (!cache) context.set(owner, (cache = new Map<string, Promise<unknown>>()));
  let pending = cache.get(key);
  if (!pending) {
    pending = work();
    cache.set(key, pending);
    void pending.catch(() => cache.delete(key));
  }
  return structuredClone(await pending) as T;
}
