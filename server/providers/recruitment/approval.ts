import {
  approvalState,
  defineApproval,
  stagesFor,
  approve,
  reject,
  returnTo,
  commentAction,
  appointAction,
  reassignAction,
  defineApprovalAction,
  allActivePeople,
  readAction,
  ccAction,
  type ApprovalDirectory,
  type ApprovalCalendar,
  type TaskRow,
} from '@nocobase/app-plugin-approval/server';
import type { LifecycleRecord, JsonObject } from '@nocobase/lifecycle';
import type { DatabaseConnection } from '@nocobase/db';
import type { createOaApprovalOperations } from '../approval-directory/operations.js';
import type { RecruitmentSubmissionSnapshot } from './submission.js';

export const RECRUITMENT_LIFECYCLE = 'oa.recruitment';
export interface RecruitmentRecord extends LifecycleRecord {
  id: string;
  applicantId: string;
  departmentId: string;
  positionId: string;
  gradeId: string;
  quantity: number;
  kind: 'additional' | 'replacement';
  replacementEmployeeIds: string[];
  accountId: string;
  year: number;
  expectedStartDate: string;
  jobDescription: string;
  reason: string;
  privateSalaryRevisionId: string;
  snapshot: RecruitmentSubmissionSnapshot | null;
  status: string;
  lifecycleVersion: number;
}
export interface RecruitmentApprovalServices {
  directory: ApprovalDirectory;
  connection: DatabaseConnection;
  prepared?: RecruitmentSubmissionSnapshot;
  /** An explicit return to an earlier reviewer asks for a fresh decision. */
  reuseOpinions?: boolean;
}
interface RecruitmentTypes {
  record: RecruitmentRecord;
  state:
    | 'draft'
    | 'revision'
    | 'head'
    | 'hrbp'
    | 'hrDirector'
    | 'executive'
    | 'gm'
    | 'approved'
    | 'rejected'
    | 'withdrawn'
    | 'terminated';
  services: RecruitmentApprovalServices;
}
/** Application persistence and policies are supplied by its transaction-aware host, never SDK internals. */
export interface RecruitmentApprovalHooks {
  calendar(): ApprovalCalendar;
  operations?: ReturnType<typeof createOaApprovalOperations>;
  preparation?: 'host';
  notify?(
    task: TaskRow,
    reason: string,
    services: RecruitmentApprovalServices,
  ): Promise<void>;
  result?(input: {
    recordId: string;
    applicantId: string;
    state: string;
    transitionId: string;
  }): Promise<void>;
  prepare(
    record: RecruitmentRecord,
    actorId: string,
    now: Date,
    tx: DatabaseConnection,
  ): Promise<RecruitmentSubmissionSnapshot>;
  authorizeCreate(
    values: Readonly<Record<string, unknown>>,
    actorId: string,
    tx: DatabaseConnection,
  ): Promise<boolean>;
  authorizeEdit(
    record: RecruitmentRecord,
    actorId: string,
    tx: DatabaseConnection,
  ): Promise<boolean>;
  validateHrBp(
    record: RecruitmentRecord,
    tx: DatabaseConnection,
  ): Promise<void>;
  publish(
    record: RecruitmentRecord,
    actorId: string,
    tx: DatabaseConnection,
  ): Promise<void>;
  release(
    record: RecruitmentRecord,
    actorId: string,
    tx: DatabaseConnection,
  ): Promise<void>;
}
/** Salary revision ids, never amounts or raw salary band, participate in freeze/hash and approval history. */
export function createRecruitmentApproval(hooks: RecruitmentApprovalHooks) {
  const stages = stagesFor<RecruitmentTypes>();
  const settings = {
    actions: [
      ...(hooks.operations ?? []),
      ccAction,
      approve(),
      reject({ reason: 'required' }),
      returnTo({ reason: 'required' }),
      commentAction,
      appointAction,
      defineApprovalAction({
        ...reassignAction,
        async people(context, query) {
          const page = await allActivePeople().search(context, query);
          return {
            ...page,
            people: page.people.filter(
              (person) =>
                context.eligible(person, { replacing: true, via: 'reassign' })
                  .ok,
            ),
          };
        },
      }),
      readAction,
    ],
    onEmpty: 'hold' as const,
    remindAfterHours: 24,
    dueAfterHours: 48,
    onDue: 'escalate' as const,
    reuse: ({ services }: { services: RecruitmentApprovalServices }) =>
      services.reuseOpinions !== false,
  };
  const fields = [
    'departmentId',
    'positionId',
    'gradeId',
    'quantity',
    'kind',
    'replacementEmployeeIds',
    'accountId',
    'year',
    'expectedStartDate',
    'jobDescription',
    'reason',
    'privateSalaryRevisionId',
  ];
  const owner = ({
    record,
    actor,
  }: {
    record: RecruitmentRecord;
    actor: { id: string };
  }) => record.applicantId === actor.id;
  const review = ['head', 'hrbp', 'hrDirector', 'executive', 'gm'] as const;
  return defineApproval<RecruitmentTypes>({
    name: RECRUITMENT_LIFECYCLE,
    collection: 'recruitmentRequests',
    initial: 'draft',
    // Decision policies and outcome graph stay compatible with existing version-1 runs.
    // The SDK's structural signature fences opinion reuse from the old stage declarations.
    version: 1,
    applicant: (record) => record.applicantId,
    directory: (services) => services.directory,
    calendar: () => hooks.calendar(),
    freeze: [...fields, 'snapshot'],
    adminRole: 'approval.admin',
    afterEnd: [readAction],
    notify: ({ task, reason, services }) =>
      hooks.notify?.(task, reason, services),
    onEnter: Object.fromEntries(
      ['approved', 'rejected', 'revision', 'withdrawn', 'terminated'].map(
        (state) => [
          state,
          [
            {
              name: `recruitment.notify.${state}`,
              retry: { attempts: 5, backoffMs: 1000 },
              run: ({
                record,
                idempotencyKey,
              }: {
                record: RecruitmentRecord;
                idempotencyKey: string;
              }) =>
                hooks.result?.({
                  recordId: record.id,
                  applicantId: record.applicantId,
                  state,
                  transitionId: idempotencyKey,
                }),
            },
          ],
        ],
      ),
    ),
    states: [
      'draft',
      'revision',
      approvalState(
        'head',
        stages.single({
          ...settings,
          covers: [...fields, 'snapshot'],
          assignee: ({ record }) => record.snapshot?.headId ?? undefined,
        }),
      ),
      approvalState(
        'hrbp',
        stages.any({
          ...settings,
          covers: [...fields, 'snapshot'],
          assignees: ({ record }) => record.snapshot?.hrbpIds ?? [],
        }),
      ),
      approvalState(
        'hrDirector',
        stages.single({
          ...settings,
          covers: ['gradeId', 'quantity', 'privateSalaryRevisionId'],
          assignee: ({ record }) => record.snapshot?.hrDirectorId ?? undefined,
        }),
      ),
      approvalState(
        'executive',
        stages.single({
          ...settings,
          covers: ['quantity', 'privateSalaryRevisionId'],
          assignee: ({ record }) => record.snapshot?.executiveId ?? undefined,
        }),
      ),
      approvalState(
        'gm',
        stages.single({
          ...settings,
          covers: ['quantity', 'privateSalaryRevisionId'],
          assignee: ({ record }) => record.snapshot?.gmId ?? undefined,
        }),
      ),
      ...(['approved', 'rejected', 'withdrawn', 'terminated'] as const).map(
        (name) => ({ name, final: true }),
      ),
    ],
    create: {
      guard: ({ values, actor, services }) =>
        values.applicantId === actor.id &&
        hooks.authorizeCreate(values, actor.id, services.connection),
    },
    transitions: {
      edit: {
        from: ['draft', 'revision'],
        to: ['draft', 'revision'],
        route: ({ record }) => record.status as 'draft' | 'revision',
        accept: fields,
        guard: async (context) =>
          owner(context) &&
          (await hooks.authorizeEdit(
            context.record,
            context.actor.id,
            context.services.connection,
          )),
      },
      submit: {
        from: ['draft', 'revision'],
        to: ['head', 'hrbp'],
        guard: async (context) => {
          if (!owner(context)) return false;
          if (hooks.preparation === 'host')
            return (
              Boolean(context.services.prepared) &&
              hooks.authorizeEdit(
                context.record,
                context.actor.id,
                context.services.connection,
              )
            );
          context.services.prepared = await hooks.prepare(
            context.record,
            context.actor.id,
            context.now,
            context.services.connection,
          );
          return true;
        },
        set: ({ services, record }) => ({
          snapshot: services.prepared!,
          privateSalaryRevisionId:
            services.prepared?.privateSalaryRevisionId ??
            record.privateSalaryRevisionId,
        }),
        route: ({ services }) =>
          services.prepared?.headRequired ? 'head' : 'hrbp',
      },
      headApproved: { from: 'head', to: 'hrbp', approvalOutcome: 'approved' },
      hrbpApproved: {
        from: 'hrbp',
        to: 'hrDirector',
        approvalOutcome: 'approved',
        guard: async ({ record, services }) => {
          await hooks.validateHrBp(record, services.connection);
          return true;
        },
      },
      hrDirectorApproved: {
        from: 'hrDirector',
        to: ['executive', 'gm', 'approved'],
        approvalOutcome: 'approved',
        route: ({ record }) =>
          record.snapshot?.executiveRequired
            ? 'executive'
            : record.snapshot?.gmRequired
              ? 'gm'
              : 'approved',
        onTransition: async ({ record, actor, to, tx }) => {
          if (to === 'approved')
            await hooks.publish(
              record,
              actor.id,
              tx.handle as DatabaseConnection,
            );
        },
      },
      executiveApproved: {
        from: 'executive',
        to: ['gm', 'approved'],
        approvalOutcome: 'approved',
        route: ({ record }) =>
          record.snapshot?.gmRequired ? 'gm' : 'approved',
        onTransition: async ({ record, actor, to, tx }) => {
          if (to === 'approved')
            await hooks.publish(
              record,
              actor.id,
              tx.handle as DatabaseConnection,
            );
        },
      },
      gmApproved: {
        from: 'gm',
        to: 'approved',
        approvalOutcome: 'approved',
        onTransition: ({ record, actor, tx }) =>
          hooks.publish(record, actor.id, tx.handle as DatabaseConnection),
      },
      rejected: {
        from: [...review],
        to: 'rejected',
        approvalOutcome: 'rejected',
        onTransition: ({ record, actor, tx }) =>
          hooks.release(record, actor.id, tx.handle as DatabaseConnection),
      },
      ...Object.fromEntries(
        review.map((stage, index) => [
          `${stage}Returned`,
          {
            from: stage,
            to: ['revision', ...review.slice(0, index)],
            approvalOutcome: 'returned' as const,
          },
        ]),
      ),
      reviewEdit: {
        from: [...review],
        to: ['head', 'hrbp'],
        accept: fields,
        guard: ({ services }) => Boolean(services.prepared),
        set: ({ services }) => ({
          snapshot: services.prepared!,
          privateSalaryRevisionId: services.prepared!.privateSalaryRevisionId!,
        }),
        route: ({ services }) =>
          services.prepared!.headRequired ? 'head' : 'hrbp',
      },
      withdraw: {
        from: ['draft', 'revision', ...review],
        to: 'withdrawn',
        guard: owner,
        onTransition: ({ record, actor, tx }) =>
          hooks.release(record, actor.id, tx.handle as DatabaseConnection),
      },
      terminate: {
        from: ['draft', 'revision', ...review],
        to: 'terminated',
        guard: ({ actor, services, input }) =>
          services.directory.hasRole(actor.id, 'approval.admin') &&
          typeof input.reason === 'string' &&
          !!input.reason.trim(),
        accept: [],
        onTransition: ({ record, actor, tx }) =>
          hooks.release(record, actor.id, tx.handle as DatabaseConnection),
      },
    },
  });
}
// JsonObject is kept at the host boundary; the strongly typed nested snapshot is JSON-safe.
export function recruitmentSnapshotJson(
  snapshot: RecruitmentSubmissionSnapshot,
): JsonObject {
  return { ...snapshot };
}
