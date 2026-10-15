import { AsyncLocalStorage } from 'node:async_hooks';
import type { OaApprovalDirectory } from '../approval-directory/contract.js';

const directories = new AsyncLocalStorage<OaApprovalDirectory>();

/** Only public indexed task-candidate reads may share this GET's directory.
 * Owner record reads, guard checks and mutations remain outside this scope. */
export function withCandidateDirectory<T>(
  directory: OaApprovalDirectory,
  read: () => Promise<T>,
) {
  return directories.run(directory, read);
}

export function candidateDirectory(): OaApprovalDirectory | undefined {
  return directories.getStore();
}
