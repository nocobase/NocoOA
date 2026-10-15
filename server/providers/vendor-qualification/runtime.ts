import { createAppApprovalService } from '../approval-runtime/query-service.js';
import { createAppLifecycleStore } from '../approval-runtime/repository-store.js';
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
  qualificationGraph,
  type QualificationGraphHost,
  type QualificationServices,
} from './graph.js';
/** Public store adapter supplies a fresh synchronous directory inside each SDK transaction. */
export function createQualificationRuntime(
  db: DatabaseManager,
  directory: ApprovalDirectoryService,
  host: QualificationGraphHost,
  dispatcher?: EffectDispatcher,
) {
  const snapshots = new WeakMap<object, QualificationServices>();
  const writes = new AsyncLocalStorage<RepositoryPolicy>();
  const reads = new AsyncLocalStorage<QualificationServices>();
  const base = createAppLifecycleStore(db, {
    collections: {
      transitions: 'oaLifecycleTransitions',
      effectRuns: 'oaLifecycleEffectRuns',
    },
  });
  const normalize = (record: LifecycleRecord) => {
    const quoteCents = Number(record.quoteCents);
    if (!Number.isSafeInteger(quoteCents) || quoteCents < 0)
      throw new Error('Stored quotation must be safe integer cents.');
    return { ...record, quoteCents };
  };
  function wrap(store: LifecycleStore): LifecycleStore {
    return new Proxy(store, {
      get(target, key) {
        const policy = writes.getStore();
        if (key === 'findRecord')
          return async (...args: Parameters<LifecycleStore['findRecord']>) => {
            const record = await target.findRecord(...args);
            return record && args[0] === 'vendorQualifications'
              ? normalize(record)
              : record;
          };
        if (!policy && key === 'createRecord')
          return async (
            ...args: Parameters<LifecycleStore['createRecord']>
          ) => {
            const record = await target.createRecord(...args);
            return args[0] === 'vendorQualifications'
              ? normalize(record)
              : record;
          };
        if (policy && key === 'createRecord')
          return async (
            collection: string,
            values: Readonly<Record<string, unknown>>,
          ) => {
            if (collection !== 'vendorQualifications')
              return target.createRecord(collection, values);
            const connection = target.transactionHandle as DatabaseConnection;
            const result = await connection
              .repository(collection)
              .withPolicy(policy)
              .createOne({ values: values as RepositoryRecord });
            if (typeof result.record.id !== 'string')
              throw new Error(
                'The creation grant must expose the qualification identity.',
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
            if (collection !== 'vendorQualifications')
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
            target.transaction(async (tx) => {
              const connection = tx.transactionHandle as DatabaseConnection;
              snapshots.set(connection, {
                connection,
                directory: await directory.snapshot(connection),
              });
              return work(wrap(tx));
            }, options);
        const value: unknown = Reflect.get(target, key);
        const bound: unknown =
          typeof value === 'function' ? value.bind(target) : value;
        return bound;
      },
    });
  }
  const source = (handle: unknown): QualificationServices => {
    const snapshot =
      handle && typeof handle === 'object'
        ? snapshots.get(handle)
        : reads.getStore();
    if (!snapshot)
      throw new Error(
        'Qualification SDK calls require a trusted service context.',
      );
    return snapshot;
  };
  const runtime = new LifecycleRuntime({ store: wrap(base), dispatcher });
  const definition = qualificationGraph(host);
  runtime.register(definition, { services: source });
  const approvals = createAppApprovalService(
    runtime,
    [definition.approval as unknown as Approval<never>],
    source,
  );
  return {
    runtime,
    approvals,
    definition,
    write<T>(policy: RepositoryPolicy, work: () => Promise<T>): Promise<T> {
      return writes.run(policy, work);
    },
    async read<T>(
      work: () => Promise<T>,
      connection?: DatabaseConnection,
    ): Promise<T> {
      return reads.run(
        { directory: await directory.snapshot(connection) },
        work,
      );
    },
  };
}
