// @vitest-environment node
import { createAppAuthorization } from '@nocobase/app-plugin-authorization/server';
import type { DatabaseConnection } from '@nocobase/db';
import { describe, expect, test, vi } from 'vitest';
import {
  requestBusinessRead,
  requestConnectionRead,
  withBusinessReads,
} from '../../server/providers/request-performance/business-reads.js';
import {
  installRequestSchemaReads,
  withRequestSchemaReads,
} from '../../server/providers/request-performance/schema.js';
import {
  installRequestRecordAccess,
  measureRequestScopes,
  withRequestRecordAccess,
} from '../../server/providers/request-performance/record-access.js';

describe('request-local read deduplication', () => {
  test('explicit root reads share facts while transaction reads and later requests remain fresh', async () => {
    const root = {},
      transaction = {};
    let value = 1;
    const load = vi.fn(async () => ({ value }));
    await withBusinessReads(async () => {
      const first = await requestConnectionRead(root, root, 'tree', load);
      first.value = 99;
      value = 2;
      expect(await requestConnectionRead(root, root, 'tree', load)).toEqual({
        value: 1,
      });
      expect(
        await requestConnectionRead(root, transaction, 'tree', load),
      ).toEqual({ value: 2 });
      value = 3;
      expect(
        await requestConnectionRead(root, transaction, 'tree', load),
      ).toEqual({ value: 3 });
    });
    expect(
      await withBusinessReads(() =>
        requestConnectionRead(root, root, 'tree', load),
      ),
    ).toEqual({ value: 3 });
    expect(load).toHaveBeenCalledTimes(4);
  });
  test('business graphs are isolated by request and owner, cloned, and failures can retry', async () => {
    const owner = {},
      other = {};
    const load = vi.fn(async () => new Map([['node', { active: true }]]));
    await withBusinessReads(async () => {
      const first = await requestBusinessRead(owner, 'tree', load);
      first.get('node')!.active = false;
      expect(
        (await requestBusinessRead(owner, 'tree', load)).get('node')?.active,
      ).toBe(true);
      await requestBusinessRead(other, 'tree', load);
      expect(load).toHaveBeenCalledTimes(2);
    });
    await withBusinessReads(() => requestBusinessRead(owner, 'tree', load));
    await requestBusinessRead(owner, 'tree', load);
    expect(load).toHaveBeenCalledTimes(4);
    await withBusinessReads(async () => {
      await expect(
        requestBusinessRead(owner, 'tree', async () => {
          throw new Error('unavailable');
        }),
      ).rejects.toThrow('unavailable');
      await requestBusinessRead(owner, 'tree', load);
      expect(load).toHaveBeenCalledTimes(5);
    });
  });
  test('scope timings count actual resolutions and isolate concurrent requests', async () => {
    const registry = createAppAuthorization({}).recordAccess;
    registry.resolve = vi.fn().mockResolvedValue(false);
    const restore = installRequestRecordAccess(registry);
    const context = {
      principal: { type: 'user' as const, id: 'private-actor' },
      collection: 'records',
      action: 'view',
      params: { secret: 'private-parameter' },
    };
    const work = () =>
      withRequestRecordAccess(async () => {
        await Promise.all([
          registry.resolve('oa.test', context),
          registry.resolve('oa.test', context),
        ]);
      });
    const [first, second] = await Promise.all([
      measureRequestScopes(work),
      measureRequestScopes(work),
    ]);
    expect(first.timings.get('oa.test')?.count).toBe(1);
    expect(second.timings.get('oa.test')?.count).toBe(1);
    expect(first.timings.get('oa.test')?.ms).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify([...first.timings])).not.toContain('private');
    restore();
  });
  test('shares schema reads, isolates requests and retries failure/invalidation', async () => {
    const getPhysical = vi
      .fn<DatabaseConnection['collections']['getPhysical']>()
      .mockResolvedValue(undefined);
    const collections = { getPhysical, invalidate: vi.fn() };
    const restore = installRequestSchemaReads(collections);
    await withRequestSchemaReads(async () => {
      await Promise.all([
        collections.getPhysical('employees'),
        collections.getPhysical('employees'),
      ]);
      expect(getPhysical).toHaveBeenCalledTimes(1);
      collections.invalidate();
      await collections.getPhysical('employees');
      expect(getPhysical).toHaveBeenCalledTimes(2);
    });
    await withRequestSchemaReads(() => collections.getPhysical('employees'));
    await collections.getPhysical('employees');
    await collections.getPhysical('employees');
    expect(getPhysical).toHaveBeenCalledTimes(5);
    getPhysical.mockRejectedValueOnce(new Error('inspection failed'));
    await withRequestSchemaReads(async () => {
      await expect(collections.getPhysical('employees')).rejects.toThrow(
        'inspection failed',
      );
      await collections.getPhysical('employees');
    });
    expect(getPhysical).toHaveBeenCalledTimes(7);
    restore();
    expect(collections.getPhysical).toBe(getPhysical);
  });

  test('shares only in-flight schema inspection between concurrent requests', async () => {
    const getPhysical = vi
      .fn<DatabaseConnection['collections']['getPhysical']>()
      .mockResolvedValue(undefined);
    const collections = { getPhysical, invalidate: vi.fn() };
    installRequestSchemaReads(collections);
    await Promise.all([
      withRequestSchemaReads(() => collections.getPhysical('employees')),
      withRequestSchemaReads(() => collections.getPhysical('employees')),
    ]);
    expect(getPhysical).toHaveBeenCalledTimes(1);
    await withRequestSchemaReads(() => collections.getPhysical('employees'));
    expect(getPhysical).toHaveBeenCalledTimes(2);
  });

  test('copies physical schemas and separates registry/name reads', async () => {
    const schema: NonNullable<
      Awaited<ReturnType<DatabaseConnection['collections']['getPhysical']>>
    > = {
      tableName: 'employees',
      schema: 'public',
      kind: 'table',
      columns: [],
      uniqueConstraints: [],
      indexes: [],
      foreignKeys: [],
      checkConstraints: [],
      inspection: {
        aspects: {
          columns: 'complete',
          primaryKey: 'complete',
          uniqueConstraints: 'complete',
          indexes: 'complete',
          foreignKeys: 'complete',
          checkConstraints: 'complete',
          comments: 'complete',
          viewDefinition: 'complete',
        },
        warnings: [],
      },
    };
    const getPhysical = vi
      .fn<DatabaseConnection['collections']['getPhysical']>()
      .mockResolvedValue(schema);
    const first = { getPhysical, invalidate: vi.fn() };
    const second = { getPhysical, invalidate: vi.fn() };
    installRequestSchemaReads(first);
    installRequestSchemaReads(second);
    await withRequestSchemaReads(async () => {
      const a = await first.getPhysical('employees');
      const b = await first.getPhysical('employees');
      expect(a).toEqual(b);
      expect(a).not.toBe(b);
      expect(a?.inspection).not.toBe(b?.inspection);
      await first.getPhysical('departments');
      await second.getPhysical('employees');
    });
    expect(getPhysical).toHaveBeenCalledTimes(3);
  });

  test('isolates scope actors, operations, parameters, registries and requests', async () => {
    const registry = createAppAuthorization({}).recordAccess;
    const other = createAppAuthorization({}).recordAccess;
    const resolve = vi.fn(async () => ({ values: ['one'] }));
    const otherResolve = vi.fn(async () => false);
    registry.define({
      key: 'oa.test',
      collections: ['employees', 'departments'],
      resolve,
    });
    other.define({
      key: 'oa.test',
      collections: ['employees', 'departments'],
      resolve: otherResolve,
    });
    const restore = installRequestRecordAccess(registry);
    installRequestRecordAccess(other);
    const context = {
      principal: { type: 'user', id: 'a' },
      collection: 'employees',
      action: 'read',
      params: { stage: 'pending' },
    };
    await withRequestRecordAccess(async () => {
      const values = await Promise.all([
        registry.resolve('oa.test', context),
        registry.resolve('oa.test', context),
      ]);
      expect(resolve).toHaveBeenCalledTimes(1);
      expect(values[0]).toEqual(values[1]);
      expect(values[0]).not.toBe(values[1]);
      await registry.resolve('oa.test', {
        ...context,
        principal: { type: 'user', id: 'b' },
      });
      await registry.resolve('oa.test', { ...context, action: 'update' });
      await registry.resolve('oa.test', {
        ...context,
        params: { stage: 'draft' },
      });
      await registry.resolve('oa.test', {
        ...context,
        collection: 'departments',
      });
      await other.resolve('oa.test', context);
      expect(resolve).toHaveBeenCalledTimes(5);
      expect(otherResolve).toHaveBeenCalledTimes(1);
    });
    await Promise.all([
      withRequestRecordAccess(() => registry.resolve('oa.test', context)),
      withRequestRecordAccess(() => registry.resolve('oa.test', context)),
    ]);
    await registry.resolve('oa.test', context);
    expect(resolve).toHaveBeenCalledTimes(8);
    resolve.mockRejectedValueOnce(new Error('scope failed'));
    await withRequestRecordAccess(async () => {
      await expect(registry.resolve('oa.test', context)).rejects.toThrow(
        'scope failed',
      );
      await registry.resolve('oa.test', context);
    });
    expect(resolve).toHaveBeenCalledTimes(10);
    await withRequestRecordAccess(async () => {
      await registry.resolve('oa.test', { ...context, params: new Date(0) });
      await registry.resolve('oa.test', { ...context, params: new Date(0) });
    });
    expect(resolve).toHaveBeenCalledTimes(12);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await withRequestRecordAccess(async () => {
      await registry.resolve('oa.test', { ...context, params: cyclic });
      await registry.resolve('oa.test', { ...context, params: cyclic });
    });
    expect(resolve).toHaveBeenCalledTimes(14);
    restore();
  });
});
