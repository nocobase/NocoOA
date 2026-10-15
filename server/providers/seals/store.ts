import { createAppApprovalService } from '../approval-runtime/query-service.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { type Approval } from '@nocobase/app-plugin-approval/server';
import {
  LifecycleRuntime,
  type EffectDispatcher,
  type LifecycleStore,
  type LifecycleRecord,
} from '@nocobase/lifecycle';
import type {
  DatabaseManager,
  DatabaseConnection,
  RepositoryPolicy,
  RepositoryRecord,
} from '@nocobase/db';
import type { ApprovalDirectoryService } from '../approval-directory/contract.js';
import {
  appLifecycleTransaction,
  createAppLifecycleStore,
} from '../approval-runtime/repository-store.js';
import { sealGraph, type SealGraphHost } from './graph.js';
import type { SealTypes } from './graph.js';
type SealServices = SealTypes['services'];
/** Public store adapter supplies a fresh synchronous directory inside each SDK transaction. */
export function createSealRuntime(
  db: DatabaseManager,
  directory: ApprovalDirectoryService,
  host: SealGraphHost,
  dispatcher?: EffectDispatcher,
) {
  const prepare = new AsyncLocalStorage<
    (connection: DatabaseConnection) => Promise<{ resumeEligible: boolean }>
  >();
  const snapshots = new WeakMap<object, SealServices>();
  const transactions = new AsyncLocalStorage<DatabaseConnection>();
  const writes = new AsyncLocalStorage<RepositoryPolicy>();
  const reads = new AsyncLocalStorage<SealServices>();
  const queryDirectory = new AsyncLocalStorage<SealServices['directory']>();
  const base = createAppLifecycleStore(db, {
    collections: {
      transitions: 'oaLifecycleTransitions',
      effectRuns: 'oaLifecycleEffectRuns',
    },
  });
  const normalize = (record: LifecycleRecord) =>
    Object.fromEntries(
      Object.entries(record).map(([k, v]) => [
        k,
        v instanceof Date ? v.toISOString() : v,
      ]),
    ) as LifecycleRecord;
  function wrap(store: LifecycleStore): LifecycleStore {
    return new Proxy(store, {
      get(target, key) {
        const policy = writes.getStore();
        if (key === 'findRecord')
          return async (...args: Parameters<LifecycleStore['findRecord']>) => {
            // Join owner reads so capability checks do not acquire another
            // connection while the caller holds its transaction.
            const connection = transactions.getStore();
            const record =
              connection && !target.transactionHandle
                ? await connection
                    .repository<LifecycleRecord>(args[0])
                    .findOne({ filter: { id: args[1] } })
                : await target.findRecord(...args);
            return record && args[0] === 'sealRequests'
              ? normalize(record)
              : record;
          };
        if (!policy && key === 'createRecord')
          return async (
            ...args: Parameters<LifecycleStore['createRecord']>
          ) => {
            const record = await target.createRecord(...args);
            return args[0] === 'sealRequests' ? normalize(record) : record;
          };
        if (policy && key === 'createRecord')
          return async (
            collection: string,
            values: Readonly<Record<string, unknown>>,
          ) => {
            if (collection !== 'sealRequests')
              return target.createRecord(collection, values);
            const connection = target.transactionHandle as DatabaseConnection;
            const result = await connection
              .repository(collection)
              .withPolicy(policy)
              .createOne({ values: values as RepositoryRecord });
            if (typeof result.record.id !== 'string')
              throw new Error(
                'The creation grant must expose the seal request identity.',
              );
            return normalize(result.record as LifecycleRecord);
          };
        if (policy && key === 'updateRecordIf')
          return async (
            collection: string,
            id: string,
            condition: Parameters<LifecycleStore['updateRecordIf']>[2],
            values: Readonly<Record<string, unknown>>,
          ) => {
            if (collection !== 'sealRequests')
              return target.updateRecordIf(collection, id, condition, values);
            const connection = target.transactionHandle as DatabaseConnection;
            const result = await connection
              .repository(collection)
              .withPolicy(policy)
              .updateMany({
                filter: {
                  id,
                  [condition.stateField]: condition.state,
                  [condition.versionField]: condition.version,
                },
                values: values as RepositoryRecord,
              });
            return result.updatedCount > 0;
          };
        if (key === 'transaction')
          return async <T>(
            work: (s: LifecycleStore) => Promise<T>,
            options?: Parameters<LifecycleStore['transaction']>[1],
          ) =>
            target.transaction(
              async (tx) => {
                const connection = tx.transactionHandle as DatabaseConnection;
                snapshots.set(connection, {
                  connection,
                  directory:
                    queryDirectory.getStore() ??
                    (await directory.snapshot(connection)),
                  ...(await prepare.getStore()?.(
                    connection ?? db.connection(),
                  )),
                });
                return transactions.run(connection, () => work(wrap(tx)));
              },
              {
                ...options,
                within:
                  options?.within ??
                  appLifecycleTransaction() ??
                  transactions.getStore(),
              },
            );
        const value: unknown = Reflect.get(target, key);
        const bound: unknown =
          typeof value === 'function' ? value.bind(target) : value;
        return bound;
      },
    });
  }
  const source = (handle: unknown): SealServices => {
    const snapshot =
      handle && typeof handle === 'object'
        ? snapshots.get(handle)
        : reads.getStore();
    if (!snapshot)
      throw new Error('Seal SDK calls require a trusted service context.');
    return snapshot;
  };
  const runtime = new LifecycleRuntime({ store: wrap(base), dispatcher });
  const definition = sealGraph(host);
  runtime.register(definition, { services: source });
  const approvals = createAppApprovalService(
    runtime,
    [definition.approval as unknown as Approval<never>],
    source,
  );
  // Public workers call runtime.runEffect outside HTTP read facades. Supply a fresh
  // synchronous directory for that public entry; nested writes still reacquire in their transaction.
  const workerRuntime = new Proxy(runtime, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key);
      if (
        ['runEffect', 'recover', 'reclaim'].includes(String(key)) &&
        typeof value === 'function'
      )
        return async (...args: unknown[]) =>
          reads.run(
            {
              directory: await directory.snapshot(),
              connection: db.connection(),
            },
            () => Reflect.apply(value, target, args) as unknown,
          );
      const bound: unknown =
        typeof value === 'function' ? value.bind(target) : value;
      return bound;
    },
  });
  return {
    runtime: workerRuntime,
    preparation<T>(
      load: (
        connection: DatabaseConnection,
      ) => Promise<{ resumeEligible: boolean }>,
      work: () => Promise<T>,
    ): Promise<T> {
      return prepare.run(load, work);
    },
    within<T>(
      connection: DatabaseConnection,
      work: () => Promise<T>,
    ): Promise<T> {
      return transactions.run(connection, work);
    },
    approvals,
    /** Explicit pure read model only; do not wrap actions or worker execution. */
    async query<T>(work: () => Promise<T>): Promise<T> {
      return queryDirectory.run(await directory.snapshot(), () =>
        this.read(work),
      );
    },
    definition,
    write<T>(policy: RepositoryPolicy, work: () => Promise<T>): Promise<T> {
      return writes.run(policy, work);
    },
    async read<T>(
      work: () => Promise<T>,
      connection?: DatabaseConnection,
    ): Promise<T> {
      return reads.run(
        {
          directory: await directory.snapshot(connection),
          ...(await prepare.getStore()?.(connection ?? db.connection())),
          connection: connection ?? db.connection(),
        },
        work,
      );
    },
  };
}
