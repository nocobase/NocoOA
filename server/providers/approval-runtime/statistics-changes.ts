import type { DatabaseConnection, DatabaseManager } from '@nocobase/db';
import type { ApprovalQuery } from '@nocobase/app-plugin-approval/server';
import type { LifecycleRuntime } from '@nocobase/lifecycle';
import type {
  ApprovalStatisticsChange,
  ApprovalStatisticsChanges,
} from './statistics-contract.js';
import { withAppLifecycleTransaction } from './repository-store.js';

const BOUNDARIES = 'oaApprovalStatisticsBoundaries';
interface Source {
  business: string;
  kind: string;
  runtime: LifecycleRuntime;
}
interface Boundary {
  id: string;
  dependencyKey: string;
  kinds: 'all' | string[];
  userIds: string[];
  reason: string;
  dueAt: string | Date;
}
const identity = (row: Boundary) =>
  JSON.stringify([
    row.id,
    row.kinds,
    row.userIds,
    row.reason,
    new Date(row.dueAt).toISOString(),
  ]);

/** Common synchronous path for host dependency writes and persisted time events. */
export class ApprovalStatisticsChangeService implements ApprovalStatisticsChanges {
  private readonly sources = new Map<string, Source>();
  private ready = false;

  constructor(
    private readonly database: DatabaseManager,
    private readonly query: ApprovalQuery,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  register(source: Source): void {
    if (this.ready || this.sources.has(source.business))
      throw new Error(
        'Approval statistics source registration is duplicate or late.',
      );
    this.sources.set(source.business, source);
  }

  activate(): void {
    this.ready = true;
  }

  deactivate(): void {
    this.ready = false;
    this.sources.clear();
  }

  private selected(change: ApprovalStatisticsChange): Source[] {
    if (!this.ready)
      throw new Error('Approval statistics changes are not initialized.');
    if (!change.reason.trim() || change.reason.length > 128)
      throw new Error('A bounded statistics change reason is required.');
    if (change.userIds.some((id) => !id.trim()))
      throw new Error('Statistics changes require nonempty user identities.');
    const kinds = change.kinds;
    if (kinds !== 'all')
      for (const kind of kinds)
        if (![...this.sources.values()].some((source) => source.kind === kind))
          throw new Error(
            `Approval statistics kind is not registered: ${kind}`,
          );
    return [...this.sources.values()]
      .filter((source) => kinds === 'all' || kinds.includes(source.kind))
      .sort((a, b) =>
        a.business < b.business ? -1 : a.business > b.business ? 1 : 0,
      );
  }

  async change<T>(
    change: ApprovalStatisticsChange,
    work: (connection: DatabaseConnection) => Promise<T>,
    connection?: DatabaseConnection,
  ): Promise<T> {
    const sources = this.selected(change);
    const users = [...new Set(change.userIds)].sort();
    const enter = async (
      index: number,
      current: DatabaseConnection,
    ): Promise<T> => {
      if (index < sources.length) {
        const source = sources[index];
        return withAppLifecycleTransaction(current, () =>
          source.runtime.transaction((tx) =>
            this.query.transactionIn(source.business, tx, () =>
              enter(index + 1, tx.handle as DatabaseConnection),
            ),
          ),
        );
      }
      const result = await work(current);
      // Re-enter each owner after the final write so its directory and guards see
      // the new facts, rather than the snapshot captured while acquiring gates.
      for (const source of sources)
        await withAppLifecycleTransaction(current, () =>
          source.runtime.transaction(async (tx) => {
            for (const userId of users)
              await this.query.recomputeInTransaction(
                source.business,
                userId,
                tx,
              );
          }),
        );
      return result;
    };
    const run = (current: DatabaseConnection) => enter(0, current);
    // A savepoint also protects callers that catch a failure in an owned transaction.
    return connection
      ? connection.transaction(run)
      : this.database.transaction(run);
  }

  async recompute(
    change: ApprovalStatisticsChange,
    connection?: DatabaseConnection,
  ): Promise<void> {
    await this.change(change, async () => undefined, connection);
  }

  async replaceBoundaries(
    key: string,
    change: ApprovalStatisticsChange,
    at: readonly string[],
    connection: DatabaseConnection,
  ): Promise<void> {
    this.selected(change);
    if (!key.trim() || key.length > 128)
      throw new Error('A bounded statistics dependency key is required.');
    const instants = [
      ...new Set(at.map((value) => new Date(value).toISOString())),
    ].sort();
    const repository = connection.repository(BOUNDARIES);
    await repository.deleteMany({ filter: { dependencyKey: key } });
    for (const [index, instant] of instants.entries())
      if (Date.parse(instant) > this.clock().getTime())
        await repository.createOne({
          values: {
            id: `${key}:${index}`,
            dependencyKey: key,
            kinds:
              change.kinds === 'all'
                ? 'all'
                : [...new Set(change.kinds)].sort(),
            userIds: [...new Set(change.userIds)].sort(),
            reason: change.reason,
            dueAt: new Date(instant),
          },
        });
  }

  async processDue({
    limit = 100,
    signal,
  }: { limit?: number; signal?: AbortSignal } = {}): Promise<number> {
    if (!this.ready) return 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new Error('Time change batch size must be between 1 and 1000.');
    const rows = await this.database.repository(BOUNDARIES).findMany({
      filter: (f) => f.date('dueAt').notAfter(this.clock()),
      sort: (s) => [s.field('dueAt').asc(), s.field('id').asc()],
      limit,
    });
    let processed = 0;
    for (const value of rows) {
      signal?.throwIfAborted();
      const candidate = value as unknown as Boundary;
      processed += await this.change(candidate, async (connection) => {
        const repository = connection.repository(BOUNDARIES);
        const current = await repository.findOne({
          filter: { id: candidate.id },
        });
        // Source gates serialize consumers and dependency edits. A queued old
        // identity must not consume a replacement with another scope or deadline.
        if (
          !current ||
          identity(current as unknown as Boundary) !== identity(candidate)
        )
          return 0;
        await repository.deleteOne({ filter: { id: candidate.id } });
        return 1;
      });
    }
    return processed;
  }
}
