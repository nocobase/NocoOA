import { AsyncLocalStorage } from 'node:async_hooks';
import {
  ApprovalQuery,
  ApprovalService,
  type ApprovalInvolvement,
  type ApprovalRelations,
  type ApprovalTaskReference,
} from '@nocobase/app-plugin-approval/server';

type Input = ConstructorParameters<typeof ApprovalService>;
const inputs = new WeakMap<ApprovalService, Input>();
const queries = new WeakMap<ApprovalService, ApprovalQuery>();
const serviceIdentity = Symbol('oa/approval-service-identity');
function canonicalService(service: ApprovalService): ApprovalService {
  return (
    (Reflect.get(service, serviceIdentity) as ApprovalService | undefined) ??
    service
  );
}
const reads = new AsyncLocalStorage<
  Map<ApprovalService, Map<string, Promise<readonly ApprovalRelations[]>>>
>();
const taskReads = new AsyncLocalStorage<
  Map<ApprovalService, Map<string, Promise<readonly ApprovalTaskReference[]>>>
>();

/** Batches personal relation reads only inside a GET request. Mutation paths use
 * the SDK's fresh transactional checks; no decisions survive the request. */
export function withApprovalQueryReads<T>(work: () => Promise<T>) {
  return reads.run(new Map(), () => taskReads.run(new Map(), work));
}

/** Reuse indexed relations already sampled by this GET's record authorization.
 * Never open a second candidate transaction solely for a small scoped source. */
export function cachedApprovalRelations(
  service: ApprovalService,
  actorId: string,
) {
  return reads.getStore()?.get(canonicalService(service))?.get(actorId);
}

export function createAppApprovalService(...input: Input): ApprovalService {
  const service = new ApprovalService(...input);
  // Application owner proxies forward non-function members. Keep their public
  // SDK facade while registering the exact underlying observer owner once.
  Object.defineProperty(service, serviceIdentity, { value: service });
  inputs.set(service, input);
  const original = service.involvementOf.bind(service);
  service.involvementOf = async (lifecycle, recordId, person) => {
    const context = reads.getStore();
    const query = queries.get(service);
    if (!context || !query || input[1].length !== 1)
      return original(lifecycle, recordId, person);
    let cache = context.get(service);
    if (!cache)
      context.set(
        service,
        (cache = new Map<string, Promise<readonly ApprovalRelations[]>>()),
      );
    let pending = cache.get(person);
    if (!pending) {
      pending = query.involvement(input[1][0].name, person);
      cache.set(person, pending);
      void pending.catch(() => cache.delete(person));
    }
    const relations =
      (await pending).find(
        (row) =>
          row.lifecycle === lifecycle && row.recordId === String(recordId),
      )?.relations ?? [];
    const result = new Set<ApprovalInvolvement>();
    for (const relation of relations) {
      if (
        relation === 'applicant' ||
        relation === 'assignee' ||
        relation === 'copied' ||
        relation === 'delegate'
      )
        result.add(relation);
    }
    // The batch API also includes run comments and administrative actors. Keep
    // the SDK's narrower task-delegation meaning for this compatibility method.
    if (relations.includes('actor'))
      return original(lifecycle, recordId, person);
    return (
      ['applicant', 'assignee', 'delegate', 'copied'] as ApprovalInvolvement[]
    ).filter((relation) => result.has(relation));
  };
  return service;
}

async function personalTasks(
  service: ApprovalService,
  actorId: string,
  relation: 'acted' | 'assigned' = 'acted',
) {
  const context = taskReads.getStore(),
    query = queries.get(service),
    input = inputs.get(service);
  if (!context || !query || !input) return undefined;
  let cache = context.get(service);
  if (!cache)
    context.set(
      service,
      (cache = new Map<string, Promise<readonly ApprovalTaskReference[]>>()),
    );
  const key = `${relation}:${actorId}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = (async () => {
      const result: ApprovalTaskReference[] = [];
      for (const approval of input[1]) {
        for (let offset = 0; ; offset += 1000) {
          const page = await query.taskRelations(approval.name, actorId, {
            relation,
            limit: 1000,
            offset,
          });
          result.push(...page);
          if (page.length < 1000) break;
        }
      }
      return result;
    })();
    cache.set(key, pending);
    void pending.catch(() => cache.delete(key));
  }
  return pending;
}

/** A direct-assignment superset only; owners still check role and task status. */
export async function hasApprovalAssignment(
  service: ApprovalService,
  lifecycle: string,
  recordId: string,
  actorId: string,
) {
  const tasks = await personalTasks(service, actorId, 'assigned');
  return (
    tasks === undefined ||
    tasks.some(
      (task) => task.lifecycle === lifecycle && task.recordId === recordId,
    )
  );
}

/** Candidate filtering is only a superset; the owner still asks actionsFor. */
export async function hasApprovalCandidate(
  service: ApprovalService,
  lifecycle: string,
  recordId: string | undefined,
  actorId: string,
) {
  if (recordId === undefined) return true;
  if (!reads.getStore() || !queries.get(service)) return true;
  const input = inputs.get(service);
  if (input) {
    try {
      const services =
        typeof input[2] === 'function'
          ? (input[2] as (handle: unknown) => object)(undefined)
          : input[2];
      if (
        input[1].some((approval) =>
          approval.options
            .directory(services as never)
            .hasRole(actorId, 'approval.admin'),
        )
      )
        return true;
    } catch {
      // An owner requiring a transaction-only context keeps its original scan.
      return true;
    }
  }
  // Historical assignments are deliberately retained as a superset. There is
  // no paged-candidate truncation; actionsFor rejects closed or ineligible work.
  return (await service.involvementOf(lifecycle, recordId, actorId)).some(
    (relation) => relation === 'assignee' || relation === 'delegate',
  );
}

export async function hasApprovalTaskActor(
  service: ApprovalService,
  lifecycle: string,
  recordId: string,
  actorId: string,
) {
  const tasks = await personalTasks(service, actorId);
  if (tasks)
    return tasks.some(
      (task) => task.lifecycle === lifecycle && task.recordId === recordId,
    );
  return (await service.tasksFor(lifecycle, recordId)).some(
    (task) => task.actorId === actorId,
  );
}

/** Called after owner startup, once per installed service; sources are explicit. */
export async function initializeApprovalQuery(
  service: ApprovalService,
  sharedQuery?: ApprovalQuery,
) {
  service = canonicalService(service);
  const input = inputs.get(service);
  if (!input || queries.get(service)) return;
  const query = sharedQuery ?? new ApprovalQuery();
  for (const approval of input[1]) {
    query.register({
      business: approval.name,
      approval,
      runtime: input[0],
      services: input[2],
      definitionVersion: approval.options.version ?? 1,
      pendingActions: [
        'approve',
        'reject',
        'return',
        'claim',
        'complete',
        'unable',
        'provideMaterial',
        'registerUsage',
      ],
      handledActions: [
        'approve',
        'reject',
        'return',
        'complete',
        'unable',
        'registerUsage',
      ],
    });
  }
  try {
    if (!sharedQuery) await query.initialize();
    queries.set(service, query);
  } catch (error) {
    if (!sharedQuery) query.dispose();
    throw error;
  }
  return () => {
    queries.delete(service);
    if (!sharedQuery) query.dispose();
  };
}

/** Explicit bindings captured when the owner constructs its public SDK. */
export function approvalQuerySources(service: ApprovalService) {
  const input = inputs.get(canonicalService(service));
  if (!input)
    throw new Error('Approval owner did not use the application SDK factory.');
  return input[1].map((approval) => ({
    business: approval.name,
    kind: approval.kind,
    runtime: input[0],
  }));
}
