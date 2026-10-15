import type { ApprovalDirectory } from '@nocobase/app-plugin-approval/server';
import type { DatabaseConnection } from '@nocobase/db';
import {
  createServiceToken,
  type ServiceToken,
} from '@nocobase/service-provider';

export const DELEGATION_SETTINGS = 'oa.approvalDelegations';
export type DelegationScope = 'all' | string[];
export interface ApprovalDelegation {
  id: string;
  principalId: string;
  delegateId: string;
  scope: DelegationScope;
  from: string;
  to: string;
  source: 'manual' | 'leave';
  sourceApplication: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface DelegationInput {
  principalId: string;
  delegateId: string;
  scope: DelegationScope;
  from: string;
  to: string;
}
export interface DelegationWriteContext {
  actorId: string | null;
  connection?: DatabaseConnection;
}
export interface OaApprovalDirectory extends ApprovalDirectory {
  headOf(userId: string): string | undefined;
  executiveOf(userId: string): string | undefined;
  roleMembers(role: string): readonly string[];
  uniqueRoleMember(role: string): string | undefined;
}
export interface ApprovalDirectoryService {
  /** Fresh, bounded employee/account and organisation duty-role checks for form options.
   * Does not resolve reporting chains, delegations or protected approval.admin assignments. */
  eligibility(
    userIds: readonly string[],
    roles: readonly string[],
    connection?: DatabaseConnection,
  ): Promise<Pick<OaApprovalDirectory, 'isActive' | 'hasRole'>>;
  /** Fresh synchronous directory; acquire within the lifecycle transaction before planning or answering. */
  snapshot(connection?: DatabaseConnection): Promise<OaApprovalDirectory>;
  /** Only for public taskCandidates reads: active people and one-hop delegation.
   * Qualification/assignment methods reject use outside that bounded contract. */
  candidateSnapshot(actorId: string): Promise<OaApprovalDirectory>;
  /** Share a fresh directory only inside a read operation; explicit transactional snapshots remain independent. */
  withReadSnapshot<T>(read: () => Promise<T>): Promise<T>;
  list(connection?: DatabaseConnection): Promise<ApprovalDelegation[]>;
  createManualDelegation(
    input: DelegationInput,
    context: DelegationWriteContext,
  ): Promise<ApprovalDelegation>;
  updateManualDelegation(
    id: string,
    input: DelegationInput,
    context: DelegationWriteContext,
  ): Promise<ApprovalDelegation>;
  disableManualDelegation(
    id: string,
    context: DelegationWriteContext,
  ): Promise<ApprovalDelegation>;
  createLeaveDelegation(
    input: DelegationInput & { sourceApplication: string },
    context: DelegationWriteContext & { connection: DatabaseConnection },
  ): Promise<ApprovalDelegation>;
  disableLeaveDelegations(
    sourceApplication: string,
    context: DelegationWriteContext & { connection: DatabaseConnection },
  ): Promise<void>;
}
export const approvalDirectoryServiceToken: ServiceToken<ApprovalDirectoryService> =
  createServiceToken<ApprovalDirectoryService>('oa/approval-directory-service');
