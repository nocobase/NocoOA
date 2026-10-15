import { AsyncLocalStorage } from 'node:async_hooks';
import type { UserAdministrationService } from '@nocobase/app-plugin-authentication';

type Summary = { id: string; name: string };
type Pending = {
  resolve(value: Summary | undefined): void;
  reject(error: unknown): void;
};
type Batch = {
  reads: Map<string, Promise<Summary | undefined>>;
  pending: Map<string, Pending>;
};
const requests = new AsyncLocalStorage<{
  active: boolean;
  users: Map<UserAdministrationService, Batch>;
}>();

/** Display summaries only. Authentication, qualification and writes use fresh users APIs. */
export async function withRequestUserSummaries<T>(
  work: () => Promise<T>,
): Promise<T> {
  const request = {
    active: true,
    users: new Map<UserAdministrationService, Batch>(),
  };
  try {
    return await requests.run(request, work);
  } finally {
    request.active = false;
  }
}

export async function requestUserSummary(
  users: UserAdministrationService,
  id: string,
): Promise<Summary | undefined> {
  const request = requests.getStore();
  if (!request?.active) {
    const user = await users.get(id);
    return user ? { id: user.id, name: user.name } : undefined;
  }
  let batch = request.users.get(users);
  if (!batch)
    request.users.set(
      users,
      (batch = { reads: new Map(), pending: new Map() }),
    );
  let read = batch.reads.get(id);
  if (!read) {
    const current = batch;
    read = new Promise<Summary | undefined>((resolve, reject) => {
      const schedule = current.pending.size === 0;
      current.pending.set(id, { resolve, reject });
      if (schedule)
        queueMicrotask(() => {
          void flush(users, current);
        });
    });
    current.reads.set(id, read);
  }
  const result = await read;
  return result ? { ...result } : undefined;
}

async function flush(users: UserAdministrationService, batch: Batch) {
  const entries = [...batch.pending];
  batch.pending.clear();
  try {
    const summaries = new Map<string, Summary>();
    if (entries.length === 1) {
      const user = await users.get(entries[0][0]);
      if (user) summaries.set(user.id, { id: user.id, name: user.name });
    } else {
      // The public Users list has a maximum page size of 100.
      for (let offset = 0; offset < entries.length; offset += 100) {
        const page = await users.list({
          userIds: entries.slice(offset, offset + 100).map(([id]) => id),
          kind: 'all',
          page: 1,
          pageSize: 100,
        });
        for (const user of page.items)
          summaries.set(user.id, { id: user.id, name: user.name });
      }
    }
    for (const [id, pending] of entries) pending.resolve(summaries.get(id));
  } catch (error) {
    for (const [id, pending] of entries) {
      batch.reads.delete(id);
      pending.reject(error);
    }
  }
}
