import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { requestUserSummary } from '../request-performance/user-summaries.js';
import { hasApprovalCandidate } from '../approval-runtime/query-service.js';
import type {
  DatabaseConnection,
  DatabaseManager,
  RepositoryPolicy,
  RepositoryRecord,
  RepositoryFilter,
} from '@nocobase/db';
import type { JsonObject } from '@nocobase/lifecycle';
import type { EffectDispatcher } from '@nocobase/lifecycle';
import { OPEN, type PerformInput } from '@nocobase/app-plugin-approval/server';
import type { ServerFileRepositoryManager } from '@nocobase/app-plugin-file/server';
import type { NocoBaseDriveManager } from '@nocobase/drive';
import type { UserAdministrationService } from '@nocobase/app-plugin-authentication';
import { lockUserForAdministration } from '@nocobase/app-plugin-authentication';
import type { EmployeeService } from '../employees/contract.js';
import type { EmployeeArchiveService } from '../employees/archive.js';
import type { OrgService } from '../org/contract.js';
import type { AuditService } from '../audit/index.js';
import type { CalendarService, SequenceService } from '../platform/index.js';
import type {
  ApprovalDirectoryService,
  OaApprovalDirectory,
} from '../approval-directory/contract.js';
import type { ApprovalNotificationService } from '../approval-notifications/contract.js';
import { createOaApprovalOperations } from '../approval-directory/operations.js';
import type { TemplatePrintService } from '../template-print/service.js';
import { DOCX_MIME } from '../template-print/renderer.js';
import { unzipSync } from 'fflate';
import {
  CERTIFICATE_KIND,
  type CertificateRequest,
  type CertificateCenterItem,
  type CertificatePreparation,
  type CertificateRenderData,
  type CertificatePrintAccess,
} from './contract.js';
import {
  certificateDigest,
  CERTIFICATE_VIEW_FIELDS,
  certificateFingerprint,
  createCertificatePrintService,
} from './printing.js';
import { createCertificateRuntime } from './store.js';
export interface CertificateAccess extends CertificatePrintAccess {
  requests: RepositoryPolicy;
  template?: RepositoryPolicy;
  templateRevision?: RepositoryPolicy;
  printSource?: RepositoryPolicy;
}
export type CertificateInput = Pick<
  CertificateRequest,
  'certificateType' | 'purpose' | 'copies' | 'deliveryMethod'
>;
export interface Preparation extends CertificatePreparation {
  requestHash: string;
  requestVersion: number;
  runId: string;
  taskId: string;
  safeFacts: Omit<CertificateRenderData, 'income'>;
  fileId: string | null;
  fileHash: string | null;
}
interface Command {
  id: string;
  actorId: string;
  bodyHash: string;
  result: Record<string, unknown> | null;
}
interface Artifact {
  id: string;
  preparationId: string;
  ownerId: string;
  contentHash: string;
  disk: string;
  key: string;
  filename: string;
  mimeType: string;
  ext: string;
  size: number | string;
}
interface Issue {
  id: string;
  requestId: string;
  preparationId: string;
  fileId: string;
  employeeId: string;
  issuedById: string;
  contentHash: string;
  number: string;
  issueDate: string;
  sensitivity: 'ordinary' | 'income';
  confirmedAt: Date | string;
}
export interface CertificateDependencies {
  db: DatabaseManager;
  employees: EmployeeService;
  archive: EmployeeArchiveService;
  org: OrgService;
  users: UserAdministrationService;
  audit: AuditService;
  directory: ApprovalDirectoryService;
  notifications: ApprovalNotificationService;
  calendar: CalendarService;
  sequences: SequenceService;
  templates: TemplatePrintService;
  files: ServerFileRepositoryManager;
  drive: NocoBaseDriveManager;
  dispatcher?: EffectDispatcher;
}
import { CertificateError } from './errors.js';
export { CertificateError } from './errors.js';
function fail(code: string): never {
  throw new CertificateError(code);
}
const fingerprint = certificateFingerprint;
export function createCertificateApplication(d: CertificateDependencies) {
  const context = new AsyncLocalStorage<CertificateAccess>();
  const print = createCertificatePrintService(d);
  async function active(actorId: string, tx: DatabaseConnection) {
    const e = await d.employees.getByUserId(actorId, tx),
      u = await d.users.withConnection(tx).get(actorId);
    if (!e?.active || e.status === 'left' || !u || u.disabledAt)
      fail('CERTIFICATE_EMPLOYEE_REQUIRED');
    return e;
  }
  async function hr(actorId: string, tx: DatabaseConnection) {
    await active(actorId, tx);
    if (!(await d.org.hasDutyRole(actorId, 'hr', tx)))
      fail('CERTIFICATE_HR_REQUIRED');
  }
  async function artifactBytes(file: Artifact) {
    const stream = await d.drive.use(file.disk).getStream(file.key);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk as Uint8Array);
      size += bytes.length;
      if (size > 32 * 1024 * 1024) fail('CERTIFICATE_ARTIFACT_MISSING');
      chunks.push(bytes);
    }
    const result = Buffer.concat(chunks);
    if (certificateDigest(Array.from(result)) !== file.contentHash)
      fail('CERTIFICATE_ARTIFACT_MISSING');
    return result;
  }
  async function read(
    id: string,
    policy: RepositoryPolicy,
    tx: DatabaseConnection,
  ) {
    if (policy.read === false) fail('CERTIFICATE_ACCESS_DENIED');
    const r = await tx
      .repository<CertificateRequest>('certificateRequests')
      .withPolicy(policy)
      .findOne({ filter: { id } });
    if (!r || CERTIFICATE_VIEW_FIELDS.some((f) => !(f in r)))
      fail('CERTIFICATE_ACCESS_DENIED');
    return r as CertificateRequest;
  }
  async function mutation(
    id: string,
    policy: RepositoryPolicy,
    tx: DatabaseConnection,
    values: RepositoryRecord,
  ) {
    if (policy.update === false) fail('CERTIFICATE_ACCESS_DENIED');
    const result = await tx
      .repository('certificateRequests')
      .withPolicy(policy)
      .validateMutation({ operation: 'updateOne', filter: { id }, values });
    if (!result.valid) fail('CERTIFICATE_ACCESS_DENIED');
  }
  async function command(
    actorId: string,
    requestKey: string,
    body: unknown,
    tx: DatabaseConnection,
  ) {
    if (!requestKey || requestKey.length > 128)
      fail('CERTIFICATE_COMMAND_INVALID');
    const id = certificateDigest([actorId, requestKey]),
      bodyHash = certificateDigest(body);
    const previous = await tx
      .repository<Command>('certificateCommands')
      .findOne({ filter: { id } });
    if (previous && previous.bodyHash !== bodyHash)
      fail('CERTIFICATE_COMMAND_CONFLICT');
    return { id, actorId, bodyHash, previous };
  }
  async function receipt(
    c: Awaited<ReturnType<typeof command>>,
    requestId: string,
    result: Record<string, unknown>,
    tx: DatabaseConnection,
  ) {
    await tx.repository('certificateCommands').createOne({
      values: {
        id: c.id,
        actorId: c.actorId,
        bodyHash: c.bodyHash,
        requestId,
        result,
      },
    });
  }
  function validate(input: CertificateInput) {
    if (
      !['employment', 'income', 'other'].includes(input.certificateType) ||
      !input.purpose?.trim() ||
      input.purpose.length > 2000 ||
      !Number.isSafeInteger(input.copies) ||
      input.copies < 1 ||
      input.copies > 100 ||
      !['pickup', 'mail', 'digital'].includes(input.deliveryMethod)
    )
      fail('CERTIFICATE_INVALID');
  }
  async function confirm(
    record: CertificateRequest,
    actorId: string,
    tx: DatabaseConnection,
    now: Date,
  ) {
    await hr(actorId, tx);
    const access = context.getStore();
    if (!access) fail('CERTIFICATE_ACCESS_DENIED');
    if (!access.printSource) fail('CERTIFICATE_TEMPLATE_DENIED');
    await read(record.id, access.printSource, tx);
    const current = await read(record.id, access.view, tx);
    if (current.preparationId !== record.preparationId)
      fail('CERTIFICATE_PREPARATION_STALE');
    await mutation(record.id, access.issue, tx, { issueId: record.issueId });
    const p = await tx
      .repository<Preparation>('certificatePreparations')
      .findOne({
        filter: { id: record.preparationId ?? '', requestId: record.id },
      });
    if (
      !p ||
      p.status !== 'generated' ||
      !p.fileId ||
      !p.fileHash ||
      p.requestHash !== fingerprint(record) ||
      p.requestVersion !== record.lifecycleVersion ||
      p.preparedById !== actorId
    )
      fail('CERTIFICATE_PREPARATION_STALE');
    if (p.sensitivity === 'income')
      await print.source(p.id, actorId, access, 'zh-CN', tx);
    if (!access.template) fail('CERTIFICATE_TEMPLATE_DENIED');
    const revision = await d.templates.revisionSnapshot(
      p.templateId,
      p.revisionId,
      access.template,
      tx,
      access.templateRevision ?? {
        read: false,
        create: false,
        update: false,
        delete: false,
      },
    );
    if (
      String(revision.source) !== 'certificates' ||
      revision.contentHash !== p.templateHash ||
      revision.schemaVersion !== 1
    )
      fail('CERTIFICATE_TEMPLATE_DENIED');
    const artifact = await tx.repository<Artifact>('certificateFiles').findOne({
      filter: { id: p.fileId, preparationId: p.id, contentHash: p.fileHash },
    });
    if (!artifact) fail('CERTIFICATE_ARTIFACT_MISSING');
    await artifactBytes(artifact);
    const issue: Issue = {
      id: randomUUID(),
      requestId: record.id,
      preparationId: p.id,
      fileId: p.fileId,
      employeeId: p.employeeId,
      issuedById: actorId,
      contentHash: p.fileHash,
      number: p.number,
      issueDate: p.issueDate,
      sensitivity: p.sensitivity,
      confirmedAt: now,
    };
    await tx
      .repository<Issue>('certificateIssues')
      .createOne({ values: issue });
    await d.archive.append(
      {
        employeeId: issue.employeeId,
        sourceKind: 'oa.certificate',
        sourceId: issue.id,
        fileId: issue.fileId,
        contentHash: issue.contentHash,
        sensitivity: issue.sensitivity,
        actorId,
      },
      async (connection) => {
        const actual = await connection
          .repository<Issue>('certificateIssues')
          .findOne({ filter: { id: issue.id } });
        return actual
          ? {
              employeeId: actual.employeeId,
              sourceKind: 'oa.certificate',
              sourceId: actual.id,
              fileId: actual.fileId,
              contentHash: actual.contentHash,
              sensitivity: actual.sensitivity,
            }
          : null;
      },
      tx,
    );
    await tx.repository('certificatePreparations').updateOne({
      filter: { id: p.id, status: 'generated' },
      values: { status: 'confirmed' },
    });
    await d.audit.record(
      {
        actorId,
        action: 'certificate.issued',
        targetType: 'certificateIssues',
        targetId: issue.id,
        after: {
          requestId: record.id,
          number: p.number,
          sensitivity: p.sensitivity,
        },
      },
      tx,
    );
    return { issueId: issue.id };
  }
  const engine = createCertificateRuntime(
    d.db,
    d.directory,
    {
      calendar: d.calendar,
      operations: createOaApprovalOperations({
        org: d.org,
        db: d.db,
        calendar: d.calendar,
      }),
      submit: async (record, actorId, tx, now) => {
        await active(actorId, tx);
        validate(record);
        const directory = await d.directory.snapshot(tx);
        if (!directory.headOf(actorId)) fail('CERTIFICATE_HEAD_REQUIRED');
        return { submittedAt: now.toISOString(), preparationId: null };
      },
      validateEdit: async (record) => validate(record),
      confirm,
      audit: async ({ actor, record, from, to, entry, tx, input }) => {
        if (actor.id !== 'system')
          await d.audit.record(
            {
              actorId: actor.id,
              action: `certificate.${entry.transition}`,
              targetType: 'certificateRequests',
              targetId: record.id,
              before: { status: from },
              after: { status: to },
              reason: typeof input.reason === 'string' ? input.reason : null,
            },
            tx.handle as DatabaseConnection,
          );
      },
      notify: (task, reason, directory) =>
        d.notifications.task({
          task,
          reason,
          directory,
          kind: CERTIFICATE_KIND,
        }),
    },
    d.dispatcher,
  );
  async function run<T>(
    access: CertificateAccess,
    work: (tx: DatabaseConnection) => Promise<T>,
  ) {
    return d.db.transaction((tx) =>
      context.run(access, () =>
        engine.within(tx, () => engine.write(access.requests, () => work(tx))),
      ),
    );
  }
  async function lock(
    id: string,
    access: CertificateAccess,
    tx: DatabaseConnection,
  ) {
    await read(id, access.view, tx);
    await mutation(id, access.requests, tx, {
      lifecycleVersion: { increment: 0 },
    });
    await tx
      .repository('certificateRequests')
      .withPolicy(access.requests)
      .updateMany({
        filter: { id },
        values: { lifecycleVersion: { increment: 0 } },
      });
    return read(id, access.view, tx);
  }
  const requests = {
    query<T>(work: () => Promise<T>): Promise<T> {
      return engine.query(work);
    },
    runtime: engine.runtime,
    approvalDefinition: engine.definition
      .approval as unknown as import('@nocobase/app-plugin-approval/server').Approval<never>,
    sweep: () => engine.read(() => engine.approvals.sweep()),
    approvals: new Proxy(engine.approvals, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function'
          ? (...args: unknown[]) =>
              engine.read(
                () => Reflect.apply(value, target, args) as Promise<unknown>,
              )
          : value;
      },
    }),
    async create(
      actorId: string,
      input: CertificateInput,
      requestKey: string,
      access: CertificateAccess,
    ) {
      return run(access, async (tx) => {
        await lockUserForAdministration(tx, actorId);
        const employee = await active(actorId, tx);
        validate(input);
        const department = await d.org.primaryDepartmentOf(actorId, tx);
        if (!department) fail('CERTIFICATE_DEPARTMENT_REQUIRED');
        const c = await command(actorId, requestKey, ['create', input], tx);
        if (c.previous) {
          const old = c.previous.result as unknown as CertificateRequest;
          const checked = await tx
            .repository('certificateRequests')
            .withPolicy(access.requests)
            .validateMutation({
              operation: 'createOne',
              values: old as unknown as RepositoryRecord,
            });
          if (!checked.valid) fail('CERTIFICATE_ACCESS_DENIED');
          return read(old.id, access.view, tx);
        }
        const id = randomUUID();
        await engine.read(
          () =>
            engine.runtime.create(
              CERTIFICATE_KIND,
              {
                id,
                ...input,
                applicantId: actorId,
                createdById: actorId,
                employeeId: employee.id,
                departmentId: department.id,
                createdAt: new Date().toISOString(),
                preparationId: null,
                issueId: null,
                exceptionReason: null,
                administrativeReason: null,
                submittedAt: null,
              },
              { actor: { id: actorId } },
            ),
          tx,
        );
        const record = await read(id, access.view, tx);
        await receipt(c, id, record, tx);
        return record;
      });
    },
    async change(
      id: string,
      actorId: string,
      transition: string,
      input: Record<string, unknown>,
      requestKey: string,
      expectedVersion: number,
      access: CertificateAccess,
    ) {
      return run(access, async (tx) => {
        await active(actorId, tx);
        const current = await lock(id, access, tx);
        if (['terminate', 'forceComplete', 'retry'].includes(transition)) {
          if (!(await d.org.hasDutyRole(actorId, 'admin', tx)))
            fail('CERTIFICATE_ADMIN_REQUIRED');
          if (typeof input.reason !== 'string' || !input.reason.trim())
            fail('CERTIFICATE_INVALID');
        } else if (
          ['edit', 'submit', 'withdraw'].includes(transition) &&
          current.applicantId !== actorId
        ) {
          fail('CERTIFICATE_ACCESS_DENIED');
        }
        const c = await command(
          actorId,
          requestKey,
          ['change', id, transition, input, expectedVersion],
          tx,
        );
        if (c.previous) return read(id, access.view, tx);
        await engine.read(
          () =>
            engine.runtime.fire(CERTIFICATE_KIND, id, transition, {
              actor: { id: actorId },
              manual: true,
              input: input as JsonObject,
              requestId: requestKey,
              expect: { version: expectedVersion },
            }),
          tx,
        );
        const r = await read(id, access.view, tx);
        await receipt(c, id, r, tx);
        return r;
      });
    },
    async perform(
      id: string,
      actorId: string,
      input: Omit<PerformInput, 'actor'>,
      access: CertificateAccess,
    ) {
      return run(access, async (tx) => {
        await active(actorId, tx);
        const r = await lock(id, access, tx);
        const c = await command(
          actorId,
          input.requestId ?? '',
          ['perform', id, input],
          tx,
        );
        if (
          [
            'claim',
            'release',
            'assign',
            'transfer',
            'complete',
            'unable',
          ].includes(input.action) &&
          (r.status === 'issuing' || c.previous?.result?.stage === 'issuing')
        )
          await hr(actorId, tx);
        if (
          ['reassign', 'appoint', 'assign', 'transfer'].includes(
            input.action,
          ) &&
          (r.status === 'issuing' || c.previous?.result?.stage === 'issuing')
        ) {
          const recipient = input.input?.to;
          if (typeof recipient !== 'string' || !recipient)
            fail('CERTIFICATE_INVALID');
          // Even a maintenance qualification override must retain the real HR handling duty.
          await hr(recipient, tx);
        }
        if (input.action === 'complete') {
          if (!access.printSource) fail('CERTIFICATE_TEMPLATE_DENIED');
          await read(id, access.printSource, tx);
          await mutation(id, access.issue, tx, { issueId: r.issueId });
        }
        if (c.previous) {
          if (input.action === 'complete' && r.preparationId) {
            await print.source(r.preparationId, actorId, access, 'zh-CN', tx);
          }
          return c.previous.result;
        }
        return engine.read(async () => {
          const target = input.target;
          const views = await engine.approvals.runViewsFor(
            CERTIFICATE_KIND,
            id,
          );
          if (input.action === 'complete') {
            const preparationId = input.input?.preparationId;
            if (
              typeof preparationId !== 'string' ||
              preparationId !== r.preparationId
            )
              fail('CERTIFICATE_PREPARATION_STALE');
            const preparation = await tx
              .repository<Preparation>('certificatePreparations')
              .findOne({ filter: { id: preparationId, requestId: id } });
            if (
              !preparation ||
              !('taskId' in target) ||
              target.taskId !== preparation.taskId
            )
              fail('CERTIFICATE_TARGET_MISMATCH');
          }
          if (
            !views.some((v) =>
              'runId' in target
                ? v.run.id === target.runId
                : v.tasks.some((t) => t.id === target.taskId),
            )
          )
            fail('CERTIFICATE_TARGET_MISMATCH');
          const result = await engine.approvals.perform({
            ...input,
            actor: { id: actorId },
          });
          if (
            ['reassign', 'appoint', 'assign', 'transfer'].includes(input.action)
          )
            await d.audit.record(
              {
                actorId,
                action: `certificate.${input.action}`,
                targetType: 'certificateRequests',
                targetId: id,
                reason: input.comment,
                after: { recipientId: input.input?.to },
              },
              tx,
            );
          await receipt(c, id, { stage: r.status, performed: result }, tx);
          return { stage: r.status, performed: result };
        }, tx);
      });
    },
    async list(
      policy: RepositoryPolicy,
      input: {
        page: number;
        pageSize: number;
        status?: string;
        q?: string;
        order?: 'asc' | 'desc';
      },
    ) {
      if (policy.read === false) fail('CERTIFICATE_ACCESS_DENIED');
      return d.db.transaction(async (tx) => {
        const repo = tx
          .repository<CertificateRequest>('certificateRequests')
          .withPolicy(policy);
        const filter: RepositoryFilter<CertificateRequest> | undefined =
          input.status || input.q
            ? (f) => {
                const clauses = [];
                if (input.status)
                  clauses.push(f.string('status').eq(input.status));
                if (input.q) clauses.push(f.text('purpose').includes(input.q));
                return f.and(clauses);
              }
            : undefined;
        const items = await repo.findMany({
          filter,
          offset: (input.page - 1) * input.pageSize,
          limit: input.pageSize,
          sort: (s) => [
            input.order === 'asc'
              ? s.field('createdAt').asc()
              : s.field('createdAt').desc(),
            s.field('id').asc(),
          ],
        });
        if (
          items.some((row) =>
            CERTIFICATE_VIEW_FIELDS.some((field) => !(field in row)),
          )
        )
          fail('CERTIFICATE_ACCESS_DENIED');
        const rows = await Promise.all(
          items.map(async (item) => {
            const issue = item.issueId
              ? await tx
                  .repository<Issue>('certificateIssues')
                  .findOne({ filter: { id: item.issueId, requestId: item.id } })
              : undefined;
            return {
              ...(item as CertificateRequest),
              number: issue?.number ?? null,
            };
          }),
        );
        return { items: rows, total: await repo.count({ filter }) };
      });
    },
    async listForCenter(
      actorId: string,
      view: 'mine' | 'pending' | 'done' | 'copied',
      policy: RepositoryPolicy,
    ): Promise<CertificateCenterItem[]> {
      if (policy.read === false) fail('CERTIFICATE_ACCESS_DENIED');
      const load = (queryDirectory?: OaApprovalDirectory) =>
        d.db.transaction((tx) =>
          engine.within(tx, () =>
            engine.read(async () => {
              const rows = await tx
                .repository<CertificateRequest>('certificateRequests')
                .withPolicy(policy)
                .findMany({
                  sort: (s) => [
                    s.field('createdAt').desc(),
                    s.field('id').asc(),
                  ],
                });
              const result: Omit<CertificateCenterItem, 'applicant'>[] = [];
              const directory =
                queryDirectory ?? (await d.directory.snapshot(tx));
              if (!directory.isActive(actorId)) return result;
              for (const partial of rows) {
                if (
                  CERTIFICATE_VIEW_FIELDS.some((field) => !(field in partial))
                )
                  fail('CERTIFICATE_ACCESS_DENIED');
                const row = partial as CertificateRequest;
                if (
                  view === 'pending' &&
                  rows.length > 10 &&
                  !(await hasApprovalCandidate(
                    engine.approvals,
                    CERTIFICATE_KIND,
                    partial.id,
                    actorId,
                  ))
                )
                  continue;
                if (view === 'mine' && row.applicantId !== actorId) continue;
                if (view === 'pending') {
                  const offers = await engine.approvals.actionsFor(
                    CERTIFICATE_KIND,
                    row.id,
                    { id: actorId },
                  );
                  if (
                    !offers.some(
                      (offer) =>
                        OPEN.includes(offer.task.status) &&
                        offer.actions.some((action) => {
                          if (
                            ![
                              'approve',
                              'reject',
                              'return',
                              'claim',
                              'complete',
                              'unable',
                              'assign',
                              'transfer',
                              'reassign',
                              'appoint',
                            ].includes(action.name)
                          )
                            return false;
                          if (row.status !== 'issuing') return true;
                          return (
                            directory.hasRole(actorId, 'hr') ||
                            (['reassign', 'appoint'].includes(action.name) &&
                              directory.hasRole(actorId, 'admin'))
                          );
                        }),
                    )
                  )
                    continue;
                }
                if (view === 'done') {
                  const tasks = await engine.approvals.tasksFor(
                    CERTIFICATE_KIND,
                    row.id,
                  );
                  if (
                    !tasks.some(
                      (task) =>
                        task.actorId === actorId &&
                        ['completed', 'transferred'].includes(task.status),
                    )
                  )
                    continue;
                }
                if (
                  view === 'copied' &&
                  !(
                    await engine.approvals.involvementOf(
                      CERTIFICATE_KIND,
                      row.id,
                      actorId,
                    )
                  ).includes('copied')
                )
                  continue;
                const issue = row.issueId
                  ? await tx.repository<Issue>('certificateIssues').findOne({
                      filter: { id: row.issueId, requestId: row.id },
                    })
                  : undefined;
                result.push({
                  id: row.id,
                  kind: CERTIFICATE_KIND,
                  title: row.purpose.trim().replace(/\s+/g, ' ').slice(0, 240),
                  number: issue?.number ?? null,
                  applicantId: row.applicantId,
                  status: row.status,
                  createdAt: new Date(row.createdAt).toISOString(),
                  startDate: issue?.issueDate ?? null,
                  endDate: null,
                  amount: null,
                  unit: null,
                });
              }
              return result;
            }, tx),
          ),
        );
      // Identity resolution happens after the owner transaction; the Users facade
      // has no caller-connection argument and must not acquire a second SQLite connection.
      // Preserve administrative pending offers while sharing this pure query's
      // directory through the existing owner SDK facade; writes use fresh read().
      const selected =
        view === 'pending' ? await engine.query(load) : await load();
      return Promise.all(
        selected.map(async (row) => ({
          ...row,
          applicant: {
            id: row.applicantId,
            name:
              (await requestUserSummary(d.users, row.applicantId))?.name ??
              row.applicantId,
          },
        })),
      );
    },
    async capabilities(
      id: string,
      actorId: string,
      policies: {
        view: RepositoryPolicy;
        edit?: RepositoryPolicy;
        operate?: RepositoryPolicy;
        issue?: RepositoryPolicy;
        income?: RepositoryPolicy;
        printSource?: RepositoryPolicy;
        template?: RepositoryPolicy;
        templateRevision?: RepositoryPolicy;
      },
    ) {
      return d.db.transaction((tx) =>
        engine.within(tx, () =>
          engine.read(async () => {
            const record = await read(id, policies.view, tx);
            const directory = await d.directory.snapshot(tx);
            const isActive = directory.isActive(actorId),
              isHr = isActive && directory.hasRole(actorId, 'hr');
            const permits = async (
              policy: RepositoryPolicy | undefined,
              values: {
                lifecycleVersion?: { increment: number };
                preparationId?: string | null;
              },
            ) =>
              !!policy &&
              (
                await tx
                  .repository('certificateRequests')
                  .withPolicy(policy)
                  .validateMutation({
                    operation: 'updateOne',
                    filter: { id },
                    values,
                  })
              ).valid;
            const operate =
              isActive &&
              (await permits(policies.operate, {
                lifecycleVersion: { increment: 0 },
              }));
            const edit =
              isActive &&
              (await permits(policies.edit, {
                lifecycleVersion: { increment: 0 },
              }));
            const issue =
              isHr &&
              !!policies.template &&
              !!policies.templateRevision &&
              !!policies.printSource &&
              !!(await tx
                .repository('certificateRequests')
                .withPolicy(policies.printSource)
                .findOne({ filter: { id } })) &&
              (await permits(policies.issue, {
                preparationId: record.preparationId,
              }));
            const runViews = await engine.approvals.runViewsFor(
              CERTIFICATE_KIND,
              id,
            );
            const offers = operate
              ? await engine.approvals.actionsFor(CERTIFICATE_KIND, id, {
                  id: actorId,
                })
              : [];
            const taskActions = offers
              .map((offer) => ({
                taskId: offer.task.id,
                runId: offer.task.runId,
                contentHash:
                  runViews.find((view) => view.run.id === offer.task.runId)?.run
                    .contentHash ?? '',
                actions: offer.actions
                  .filter(
                    (action) =>
                      !(
                        record.status === 'issuing' &&
                        [
                          'claim',
                          'release',
                          'assign',
                          'transfer',
                          'complete',
                          'unable',
                        ].includes(action.name)
                      ) || isHr,
                  )
                  .filter((action) => action.name !== 'complete' || issue)
                  .map((action) => ({
                    name: action.name,
                    options: action.options,
                    primary: action.primary,
                    tone: action.tone,
                  })),
              }))
              .filter((offer) => offer.actions.length);
            const transitions: string[] = [];
            for (const transition of [
              'edit',
              'submit',
              'withdraw',
              'terminate',
              'forceComplete',
              'retry',
            ]) {
              if (
                !(transition === 'edit' || transition === 'submit'
                  ? edit
                  : operate)
              )
                continue;
              if (
                ['edit', 'submit', 'withdraw'].includes(transition) &&
                record.applicantId !== actorId
              )
                continue;
              if (
                ['terminate', 'forceComplete', 'retry'].includes(transition) &&
                !directory.hasRole(actorId, 'admin')
              )
                continue;
              if (
                (
                  await engine.runtime.can(
                    CERTIFICATE_KIND,
                    id,
                    transition,
                    { id: actorId },
                    {
                      input: { reason: 'Capability check' },
                    },
                  )
                ).allowed
              )
                transitions.push(transition);
            }
            const preparation = record.preparationId
              ? await tx
                  .repository<Preparation>('certificatePreparations')
                  .findOne({ filter: { id: record.preparationId } })
              : undefined;
            const issued = record.issueId
              ? await tx
                  .repository<Issue>('certificateIssues')
                  .findOne({ filter: { id: record.issueId } })
              : undefined;
            let incomeReadable = false;
            if (isHr && policies.income && policies.income.read !== false) {
              const fields =
                policies.income.read === true
                  ? true
                  : policies.income.read.fields;
              incomeReadable =
                fields === true ||
                (Array.isArray(fields) &&
                  ['id', 'monthlyCents', 'currency'].every((field) =>
                    fields.includes(field),
                  ));
              if (preparation) {
                const privateRow = await tx
                  .repository('certificatePreparationPrivate')
                  .withPolicy(policies.income)
                  .findOne({ filter: { id: preparation.id } });
                incomeReadable =
                  !!privateRow &&
                  ['monthlyCents', 'currency'].every(
                    (field) => field in privateRow,
                  );
              }
            }
            const claimed = runViews
              .flatMap((view) => view.tasks)
              .some(
                (task) =>
                  task.status === 'claimed' && task.assigneeId === actorId,
              );
            return {
              taskActions,
              transitions,
              canIssue:
                issue &&
                claimed &&
                record.status === 'issuing' &&
                (record.certificateType !== 'income' || incomeReadable),
              canDownload:
                !!issued && (issued.sensitivity !== 'income' || incomeReadable),
              preparation:
                preparation && preparation.preparedById === actorId
                  ? {
                      id: preparation.id,
                      number: preparation.number,
                      issueDate: preparation.issueDate,
                      status: preparation.status,
                      templateId: preparation.templateId,
                      revisionId: preparation.revisionId,
                    }
                  : null,
              issue: issued
                ? {
                    id: issued.id,
                    number: issued.number,
                    issueDate: issued.issueDate,
                  }
                : null,
            };
          }, tx),
        ),
      );
    },
    async detail(id: string, actorId: string, policy: RepositoryPolicy) {
      return d.db.transaction((tx) =>
        engine.within(tx, () =>
          engine.read(
            async () => ({
              record: await read(id, policy, tx),
              tasks: (await engine.approvals.tasksOf(actorId)).filter(
                (t) => t.recordId === id,
              ),
              runs: await engine.approvals.runsFor(CERTIFICATE_KIND, id),
              actions: await engine.approvals.actionsOf(CERTIFICATE_KIND, id),
            }),
            tx,
          ),
        ),
      );
    },
    async prepare(
      id: string,
      actorId: string,
      input: {
        templateId: string;
        revisionId: string;
        issueDate: string;
        monthlyCents?: number;
        requestKey: string;
      },
      access: CertificateAccess,
    ) {
      return run(access, async (tx) => {
        await hr(actorId, tx);
        if (!access.printSource) fail('CERTIFICATE_TEMPLATE_DENIED');
        await read(id, access.printSource, tx);
        const r = await lock(id, access, tx);
        await mutation(id, access.issue, tx, {
          preparationId: r.preparationId,
        });
        const c = await command(
          actorId,
          input.requestKey,
          ['prepare', id, input],
          tx,
        );
        if (c.previous) {
          if (typeof c.previous.result?.id !== 'string')
            fail('CERTIFICATE_COMMAND_CONFLICT');
          const p = await tx
            .repository<Preparation>('certificatePreparations')
            .findOne({ filter: { id: c.previous.result.id } });
          if (!p) fail('CERTIFICATE_PREPARATION_MISSING');
          if (r.preparationId !== p.id || p.requestHash !== fingerprint(r))
            fail('CERTIFICATE_PREPARATION_STALE');
          if (!access.template || !access.templateRevision)
            fail('CERTIFICATE_TEMPLATE_DENIED');
          const revision = await d.templates.revisionSnapshot(
            p.templateId,
            p.revisionId,
            access.template,
            tx,
            access.templateRevision,
          );
          if (
            revision.contentHash !== p.templateHash ||
            String(revision.source) !== 'certificates'
          )
            fail('CERTIFICATE_TEMPLATE_DENIED');
          if (p.sensitivity === 'income') {
            if (!access.income || access.income.create === false)
              fail('CERTIFICATE_INCOME_DENIED');
            const granted = await tx
              .repository('certificatePreparationPrivate')
              .withPolicy(access.income)
              .validateMutation({
                operation: 'createOne',
                values: {
                  id: p.id,
                  monthlyCents: String(input.monthlyCents),
                  currency: 'CNY',
                },
              });
            if (!granted.valid) fail('CERTIFICATE_INCOME_DENIED');
            await print.source(p.id, actorId, access, 'zh-CN', tx);
          }
          return p;
        }
        if (r.status !== 'issuing') fail('CERTIFICATE_PREPARATION_STALE');
        const task = await engine.read(
          async () =>
            (await engine.approvals.runViewsFor(CERTIFICATE_KIND, id))
              .flatMap((v) => v.tasks)
              .find((t) => t.status === 'claimed' && t.assigneeId === actorId),
          tx,
        );
        if (!task) fail('CERTIFICATE_CLAIM_REQUIRED');
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(input.issueDate) ||
          Number.isNaN(Date.parse(input.issueDate))
        )
          fail('CERTIFICATE_INVALID');
        if (!access.template) fail('CERTIFICATE_TEMPLATE_DENIED');
        const revision = await d.templates.revisionSnapshot(
          input.templateId,
          input.revisionId,
          access.template,
          tx,
          access.templateRevision ?? {
            read: false,
            create: false,
            update: false,
            delete: false,
          },
        );
        if (
          String(revision.source) !== 'certificates' ||
          revision.schemaVersion !== 1 ||
          !revision.contentHash ||
          !revision.revisionId
        )
          fail('CERTIFICATE_TEMPLATE_DENIED');
        const employee = await d.employees.getById(r.employeeId, tx),
          user = await d.users.withConnection(tx).get(r.applicantId),
          dept = await d.org.primaryDepartmentOf(r.applicantId, tx);
        if (!employee || !user || !dept || dept.id !== r.departmentId)
          fail('CERTIFICATE_SOURCE_STALE');
        const sensitivity =
          r.certificateType === 'income' ? 'income' : 'ordinary';
        const pid = randomUUID();
        if (sensitivity === 'income') {
          if (
            !access.income ||
            !Number.isSafeInteger(input.monthlyCents) ||
            input.monthlyCents! < 0
          )
            fail('CERTIFICATE_INCOME_DENIED');
          const checked = await tx
            .repository('certificatePreparationPrivate')
            .withPolicy(access.income)
            .validateMutation({
              operation: 'createOne',
              values: {
                id: pid,
                monthlyCents: String(input.monthlyCents),
                currency: 'CNY',
              },
            });
          if (!checked.valid) fail('CERTIFICATE_INCOME_DENIED');
          await tx
            .repository('certificatePreparationPrivate')
            .withPolicy(access.income)
            .createOne({
              values: {
                id: pid,
                monthlyCents: String(input.monthlyCents),
                currency: 'CNY',
              },
            });
        } else if (input.monthlyCents !== undefined)
          fail('CERTIFICATE_INVALID');
        const number = await d.sequences.next('CERT', tx),
          safeFacts: Omit<CertificateRenderData, 'income'> = {
            number,
            issueDate: input.issueDate,
            employee: { id: employee.id, name: user.name },
            department: { id: dept.id, name: dept.title },
            certificateType: r.certificateType,
            purpose: r.purpose,
            copies: r.copies,
            deliveryMethod: r.deliveryMethod,
          };
        const p: Preparation = {
          id: pid,
          requestId: id,
          number,
          issueDate: input.issueDate,
          templateId: input.templateId,
          revisionId: revision.revisionId,
          templateHash: revision.contentHash,
          sourceHash: certificateDigest([
            safeFacts,
            input.monthlyCents ?? null,
          ]),
          requestHash: fingerprint(r),
          requestVersion: r.lifecycleVersion,
          runId: task.runId,
          taskId: task.id,
          applicantId: r.applicantId,
          employeeId: r.employeeId,
          preparedById: actorId,
          preparedAt: new Date(),
          status: 'prepared',
          sensitivity,
          safeFacts,
          fileId: null,
          fileHash: null,
        };
        await tx
          .repository<Preparation>('certificatePreparations')
          .createOne({ values: p });
        await tx
          .repository('certificateRequests')
          .withPolicy(access.issue)
          .updateOne({
            filter: { id, lifecycleVersion: r.lifecycleVersion },
            values: { preparationId: pid },
          });
        await d.audit.record(
          {
            actorId,
            action: 'certificate.prepared',
            targetType: 'certificatePreparations',
            targetId: pid,
            after: {
              requestId: id,
              number,
              revisionId: revision.revisionId,
              sensitivity,
            },
          },
          tx,
        );
        await receipt(c, id, { id: pid }, tx);
        return p;
      });
    },
    async generate(
      preparationId: string,
      actorId: string,
      access: CertificateAccess,
    ) {
      async function currentClaim(p: Preparation, tx: DatabaseConnection) {
        const tasks = await engine.within(tx, () =>
          engine.read(
            async () =>
              (
                await engine.approvals.runViewsFor(
                  CERTIFICATE_KIND,
                  p.requestId,
                )
              ).flatMap((v) => v.tasks),
            tx,
          ),
        );
        if (
          !tasks.some(
            (t) =>
              t.id === p.taskId &&
              t.runId === p.runId &&
              t.status === 'claimed' &&
              t.assigneeId === actorId,
          )
        )
          fail('CERTIFICATE_CLAIM_REQUIRED');
      }
      const p = await d.db.transaction(async (tx) => {
        await hr(actorId, tx);
        const found = await tx
          .repository<Preparation>('certificatePreparations')
          .findOne({ filter: { id: preparationId } });
        if (!found) fail('CERTIFICATE_PREPARATION_MISSING');
        if (!access.printSource) fail('CERTIFICATE_TEMPLATE_DENIED');
        await read(found.requestId, access.printSource, tx);
        const r = await read(found.requestId, access.view, tx);
        await mutation(r.id, access.issue, tx, { preparationId });
        if (
          r.status !== 'issuing' ||
          r.lifecycleVersion !== found.requestVersion ||
          r.preparationId !== found.id ||
          fingerprint(r) !== found.requestHash ||
          found.preparedById !== actorId
        )
          fail('CERTIFICATE_PREPARATION_STALE');
        await currentClaim(found, tx);
        return found;
      });
      if (!access.template) fail('CERTIFICATE_TEMPLATE_DENIED');
      await print.source(p.id, actorId, access, 'zh-CN');
      let file = await d.db
        .repository<Artifact>('certificateFiles')
        .findOne({ filter: { preparationId: p.id } });
      if (!file) {
        const rendered = await d.templates.render(
          p.templateId,
          actorId,
          { recordId: p.id, revisionId: p.revisionId, locale: 'zh-CN' },
          access.template,
          access.view,
        );
        const generated = unzipSync(rendered.bytes);
        if (
          !generated['[Content_Types].xml'] ||
          !generated['word/document.xml'] ||
          rendered.bytes.length > 32 * 1024 * 1024
        )
          fail('CERTIFICATE_ARTIFACT_MISSING');
        const hash = certificateDigest(Array.from(rendered.bytes));
        const uploaded = await d.files
          .repository('certificateFiles', {
            disk: 'local',
            accessPath: '/private/certificates',
            policy: {
              read: true,
              create: {
                scope: {
                  preparationId: p.id,
                  ownerId: actorId,
                  contentHash: hash,
                },
                defaults: {
                  preparationId: p.id,
                  ownerId: actorId,
                  contentHash: hash,
                },
              },
              update: false,
              delete: false,
            },
          })
          .uploadOne({
            file: new File([rendered.bytes], `${p.number}.docx`, {
              type: DOCX_MIME,
            }),
          });
        file = await d.db
          .repository<Artifact>('certificateFiles')
          .findOne({ filter: { id: uploaded.record.id } });
        if (!file) fail('CERTIFICATE_ARTIFACT_MISSING');
      }
      return run(access, async (tx) => {
        await hr(actorId, tx);
        const r = await lock(p.requestId, access, tx);
        await mutation(r.id, access.issue, tx, { preparationId: p.id });
        if (
          r.status !== 'issuing' ||
          r.preparationId !== p.id ||
          r.lifecycleVersion !== p.requestVersion ||
          fingerprint(r) !== p.requestHash
        )
          fail('CERTIFICATE_PREPARATION_STALE');
        await currentClaim(p, tx);
        if (!access.templateRevision) fail('CERTIFICATE_TEMPLATE_DENIED');
        const revision = await d.templates.revisionSnapshot(
          p.templateId,
          p.revisionId,
          access.template!,
          tx,
          access.templateRevision,
        );
        if (
          revision.contentHash !== p.templateHash ||
          String(revision.source) !== 'certificates'
        )
          fail('CERTIFICATE_TEMPLATE_DENIED');
        if (p.sensitivity === 'income')
          await print.source(p.id, actorId, access, 'zh-CN', tx);
        await tx.repository('certificatePreparations').updateOne({
          filter: (f) =>
            f.and([
              f.string('id').eq(p.id),
              f.or([
                f.string('status').eq('prepared'),
                f.string('status').eq('generated'),
              ]),
            ]),
          values: {
            status: 'generated',
            fileId: file.id,
            fileHash: file.contentHash,
          },
        });
        return { preparationId: p.id, generated: true };
      });
    },
    async content(issueId: string, actorId: string, access: CertificateAccess) {
      return d.db.transaction(async (tx) => {
        const issue = await tx
          .repository<Issue>('certificateIssues')
          .findOne({ filter: { id: issueId } });
        if (!issue) fail('CERTIFICATE_ARTIFACT_MISSING');
        const r = await read(issue.requestId, access.view, tx);
        if (r.issueId !== issue.id) fail('CERTIFICATE_ARTIFACT_MISSING');
        if (issue.sensitivity === 'income') {
          await hr(actorId, tx);
          if (!access.income || access.income.read === false)
            fail('CERTIFICATE_INCOME_DENIED');
          const allowed = await tx
            .repository('certificatePreparationPrivate')
            .withPolicy(access.income)
            .findOne({ filter: { id: issue.preparationId } });
          if (
            !allowed ||
            !('monthlyCents' in allowed) ||
            !('currency' in allowed)
          )
            fail('CERTIFICATE_INCOME_DENIED');
        }
        const file = await tx.repository<Artifact>('certificateFiles').findOne({
          filter: { id: issue.fileId, contentHash: issue.contentHash },
        });
        if (!file) fail('CERTIFICATE_ARTIFACT_MISSING');
        const stream = await d.drive.use(file.disk).getStream(file.key);
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of stream) {
          const b = Buffer.from(chunk as Uint8Array);
          size += b.length;
          if (size > 32 * 1024 * 1024) fail('CERTIFICATE_ARTIFACT_MISSING');
          chunks.push(b);
        }
        const bytes = Buffer.concat(chunks);
        if (certificateDigest(Array.from(bytes)) !== issue.contentHash)
          fail('CERTIFICATE_ARTIFACT_MISSING');
        return { bytes, filename: file.filename };
      });
    },
  };
  return { requests, print };
}
export type CertificateApplication = ReturnType<
  typeof createCertificateApplication
>;
