import type { ApprovalService } from '@nocobase/app-plugin-approval/server';
import type { DatabaseConnection } from '@nocobase/db';
import type { LifecycleRuntime } from '@nocobase/lifecycle';
import type { ApprovalStatisticsChanges } from './statistics-contract.js';
import {
  appLifecycleTransaction,
  withAppLifecycleTransaction,
} from './repository-store.js';

/** A leave outcome may edit delegations for every business. Enter the common
 * boundary before SDK record locks, including direct SDK and clock/effect calls. */
export function installDelegationWriteBoundary(
  runtime: LifecycleRuntime,
  approvals: ApprovalService,
  changes: ApprovalStatisticsChanges,
): () => void {
  const within = <T>(
    work: () => Promise<T>,
    transaction?: unknown,
  ): Promise<T> =>
    appLifecycleTransaction()
      ? work()
      : changes.change(
          { kinds: 'all', userIds: [], reason: 'delegationOwnerWrite' },
          (connection) => withAppLifecycleTransaction(connection, work),
          transaction as DatabaseConnection | undefined,
        );
  const fire = runtime.fire.bind(runtime);
  const create = runtime.create.bind(runtime);
  const runEffect = runtime.runEffect.bind(runtime);
  const perform = approvals.perform.bind(approvals);
  const sweepReport = approvals.sweepReport.bind(approvals);
  runtime.fire = (name, id, transition, options) =>
    appLifecycleTransaction()
      ? fire(name, id, transition, options)
      : within(
          () =>
            fire(name, id, transition, {
              ...options,
              transaction: appLifecycleTransaction(),
            }),
          options.transaction,
        );
  runtime.create = (name, values, options) =>
    appLifecycleTransaction()
      ? create(name, values, options)
      : within(
          () =>
            create(name, values, {
              ...options,
              transaction: appLifecycleTransaction(),
            }),
          options.transaction,
        );
  runtime.runEffect = (...args) => within(() => runEffect(...args));
  approvals.perform = (...args) => within(() => perform(...args));
  approvals.sweepReport = (...args) => within(() => sweepReport(...args));
  return () => {
    runtime.fire = fire;
    runtime.create = create;
    runtime.runEffect = runEffect;
    approvals.perform = perform;
    approvals.sweepReport = sweepReport;
  };
}
