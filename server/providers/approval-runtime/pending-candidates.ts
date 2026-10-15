import type { Application } from '@nocobase/app-server/application';
import { databaseManagerToken, type RepositoryPolicy } from '@nocobase/db';
import { processOwners } from '../process-management/owners.js';
import { approvalDirectoryServiceToken } from '../approval-directory/contract.js';
import { approvalQueryToken } from './statistics-contract.js';
import {
  approvalQuerySources,
  cachedApprovalRelations,
} from './query-service.js';
import { withCandidateDirectory } from './candidate-directory.js';

/** Raw current direct/delegate task references are a superset, never permission.
 * Undefined retains owner-specific administrative/field-denial semantics. */
export async function pendingCandidateRecordIds(
  app: Application,
  kind: string,
  actorId: string,
  policy: RepositoryPolicy,
): Promise<readonly string[] | undefined> {
  // Certificates also expose administrative appoint/reassign as pending work.
  // Those identities cannot be discovered from this actor's assigned tasks.
  if (kind === 'oa.certificateRequest') return undefined;
  // Retain the owning reader's existing required-field refusal even when all
  // indexed candidates are absent. Full read grants can safely skip empty sets.
  const owner = processOwners.find((entry) => entry.kind === kind);
  if (!owner) return undefined;
  if (policy.read !== true) {
    if (policy.read === false || !Array.isArray(policy.read.fields))
      return undefined;
    const grantedFields = policy.read.fields;
    const collection = await app.container
      .resolve(databaseManagerToken)
      .collections()
      .get(owner.collection);
    if (
      !collection?.fields ||
      collection.fields.some((field) => !grantedFields.includes(field.name))
    )
      return undefined;
  }
  const sdk = await owner.sdk(app);
  if (policy.read !== true) {
    // Scoped authorization may already have queried indexed involvement. Reuse
    // its assignment/delegation superset; owners reject historical/closed work.
    // Otherwise retain the old path instead of adding 26 empty transactions.
    const related = cachedApprovalRelations(sdk.approvals, actorId);
    if (!related) return undefined;
    return [
      ...new Set(
        (await related)
          .filter((record) =>
            record.relations.some(
              (relation) => relation === 'assignee' || relation === 'delegate',
            ),
          )
          .map((record) => record.recordId),
      ),
    ];
  }
  const query = app.container.resolve(approvalQueryToken);
  const directory = await app.container
    .resolve(approvalDirectoryServiceToken)
    .candidateSnapshot(actorId);
  const ids = new Set<string>();
  await withCandidateDirectory(directory, () =>
    sdk.read(async () => {
      for (const source of approvalQuerySources(sdk.approvals)) {
        for (let offset = 0; ; offset += 1000) {
          const page = await query.taskCandidates(source.business, actorId, {
            limit: 1000,
            offset,
          });
          for (const task of page) ids.add(task.recordId);
          if (page.length < 1000) break;
        }
      }
    }),
  );
  return [...ids];
}
