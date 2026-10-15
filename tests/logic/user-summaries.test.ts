// @vitest-environment node
import { expect, test, vi } from 'vitest';
import type {
  UserAdministrationService,
  AdministratedUser,
} from '@nocobase/app-plugin-authentication';
import {
  requestUserSummary,
  withRequestUserSummaries,
} from '../../server/providers/request-performance/user-summaries.js';

function fixture(size = 3) {
  const records = new Map(
    Array.from({ length: size }, (_, i) => [
      String(i),
      { id: String(i), name: `Person ${i}` } as AdministratedUser,
    ]),
  );
  const get = vi.fn<UserAdministrationService['get']>(async (id) =>
    records.get(id),
  );
  const list = vi.fn<UserAdministrationService['list']>(async (input) => {
    const items = (input?.userIds ?? []).flatMap((id) =>
      records.get(id) ? [records.get(id)!] : [],
    );
    return {
      items,
      total: items.length,
      page: 1,
      pageSize: input?.pageSize ?? 100,
    };
  });
  const users = { get, list } as unknown as UserAdministrationService;
  return { users, get, list, records };
}

test('batches display identities and deduplicates IDs without leaking mutated summaries', async () => {
  const f = fixture();
  await withRequestUserSummaries(async () => {
    const rows = await Promise.all(
      ['0', '1', '0', 'missing'].map((id) => requestUserSummary(f.users, id)),
    );
    expect(f.list).toHaveBeenCalledTimes(1);
    expect(f.list.mock.calls[0][0]).toMatchObject({
      userIds: ['0', '1', 'missing'],
      kind: 'all',
    });
    expect(rows[3]).toBeUndefined();
    rows[0]!.name = 'changed';
    expect((await requestUserSummary(f.users, '0'))?.name).toBe('Person 0');
    expect(await requestUserSummary(f.users, 'missing')).toBeUndefined();
  });
  expect(f.get).not.toHaveBeenCalled();
  await requestUserSummary(f.users, '0');
  expect(f.get).toHaveBeenCalledTimes(1);
});

test('chunks at the public API limit and isolates simultaneous requests and service instances', async () => {
  const a = fixture(205),
    b = fixture();
  await Promise.all([
    withRequestUserSummaries(() =>
      Promise.all(
        [...a.records.keys()].map((id) => requestUserSummary(a.users, id)),
      ),
    ),
    withRequestUserSummaries(() => requestUserSummary(a.users, '0')),
    withRequestUserSummaries(() => requestUserSummary(b.users, '0')),
  ]);
  expect(a.list.mock.calls.map(([input]) => input?.userIds?.length)).toEqual([
    100, 100, 5,
  ]);
  expect(a.get).toHaveBeenCalledTimes(1);
  expect(b.get).toHaveBeenCalledTimes(1);
});

test('failed batches can retry and new requests refresh renamed accounts', async () => {
  const f = fixture();
  f.list.mockRejectedValueOnce(new Error('unavailable'));
  await withRequestUserSummaries(async () => {
    const failed = await Promise.allSettled(
      ['0', '1'].map((id) => requestUserSummary(f.users, id)),
    );
    expect(failed.every((result) => result.status === 'rejected')).toBe(true);
    expect((await requestUserSummary(f.users, '0'))?.name).toBe('Person 0');
  });
  f.records.set('0', { ...f.records.get('0')!, name: 'Renamed' });
  expect(
    (await withRequestUserSummaries(() => requestUserSummary(f.users, '0')))
      ?.name,
  ).toBe('Renamed');
});
