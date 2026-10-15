import type { DatabaseConnection } from '@nocobase/db';
import type { ApprovalQuery } from '@nocobase/app-plugin-approval/server';
import { createServiceToken } from '@nocobase/service-provider';

export interface ApprovalStatisticsChange {
  /** Application approval kinds, not collection names or plugin table identifiers. */
  kinds: 'all' | readonly string[];
  /** Include both previous and new principals/delegates/owners. */
  userIds: readonly string[];
  reason: string;
}

export interface ApprovalStatisticsChanges {
  /** Acquire source gates before business locks, then recompute after final writes.
   * An existing transaction must be passed before taking conflicting business locks. */
  change<T>(
    change: ApprovalStatisticsChange,
    work: (connection: DatabaseConnection) => Promise<T>,
    connection?: DatabaseConnection,
  ): Promise<T>;
  recompute(
    change: ApprovalStatisticsChange,
    connection?: DatabaseConnection,
  ): Promise<void>;
  /** Replace this dependency's future boundaries atomically with its business write. */
  replaceBoundaries(
    key: string,
    change: ApprovalStatisticsChange,
    at: readonly string[],
    connection: DatabaseConnection,
  ): Promise<void>;
  /** Dispatch only persisted time changes; never scan/rebuild statistics rows. */
  processDue(options?: {
    limit?: number;
    signal?: AbortSignal;
  }): Promise<number>;
}

export const approvalStatisticsChangesToken =
  createServiceToken<ApprovalStatisticsChanges>(
    'oa/approval-statistics-changes',
  );

/** Server-side SDK access; callers still own business authorization. */
export const approvalQueryToken =
  createServiceToken<ApprovalQuery>('oa/approval-query');
