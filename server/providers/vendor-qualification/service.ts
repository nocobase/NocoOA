import { createHash, randomUUID } from 'node:crypto';
import { createServiceToken } from '@nocobase/service-provider';
import {
  lockUserForAdministration,
  type UserAdministrationService,
} from '@nocobase/app-plugin-authentication';
import {
  isOpenRun,
  type PerformInput,
  type ApprovalService,
  type ActionTarget,
  type PeopleQuery,
} from '@nocobase/app-plugin-approval/server';
import type {
  DatabaseManager,
  DatabaseConnection,
  RepositoryPolicy,
} from '@nocobase/db';
import type { JsonObject, EffectDispatcher } from '@nocobase/lifecycle';
import type { ApprovalNotificationService } from '../approval-notifications/contract.js';
import type { AuditService } from '../audit/index.js';
import type { OrgService } from '../org/contract.js';
import type { EmployeeService } from '../employees/contract.js';
import type { ApprovalDirectoryService } from '../approval-directory/contract.js';
import type {
  CalendarService,
  RuleService,
  SequenceService,
  DictionaryService,
} from '../platform/index.js';
import type { VendorService } from '../vendors/contract.js';
import { committeeCandidates } from './committee.js';
import { createCommitteeConfiguration } from './configuration.js';
import { createQualificationRuntime } from './runtime.js';
import {
  vendorQualificationInputSchema,
  validateQualificationSubmission,
} from './validation.js';
import {
  VENDOR_QUALIFICATION_KIND,
  type VendorQualificationInput,
  type VendorQualificationRecord,
} from './contract.js';
import { refuse, VendorQualificationError } from './errors.js';
interface Bank {
  requestId: string;
  bankName: string;
  bankAccount: string;
  bankAccountName: string;
  version: number;
  updatedAt: Date;
}
interface Creation {
  id: string;
  actorId: string;
  requestKey: string;
  requestId: string;
  fingerprint: string;
  createdAt: Date;
}
export interface QualificationDependencies {
  db: DatabaseManager;
  audit: AuditService;
  org: OrgService;
  employees: EmployeeService;
  users: UserAdministrationService;
  directory: ApprovalDirectoryService;
  calendar: CalendarService;
  rules: RuleService;
  sequences: SequenceService;
  dictionaries: DictionaryService;
  vendors: VendorService;
  validateAttachments(
    record: VendorQualificationRecord,
    tx: DatabaseConnection,
  ): Promise<void>;
  notifications: ApprovalNotificationService;
  dispatcher?: EffectDispatcher;
}
export function createVendorQualificationService(d: QualificationDependencies) {
  const configuration = createCommitteeConfiguration(
    d.audit,
    async (person, source, tx) => {
      const directory = await d.directory.snapshot(tx);
      return (
        directory.isActive(person) &&
        (!['purchasing', 'finance', 'legal'].includes(source) ||
          directory.hasRole(person, source))
      );
    },
  );
  let runningVersion = 0;
  let initialized:
    Promise<ReturnType<typeof createQualificationRuntime>> | undefined;
  async function sdk() {
    return (initialized ??= (async () => {
      const versions = await configuration.versions(d.db.connection());
      const current = Math.max(...versions.map((v) => v.version));
      runningVersion = current;
      return createQualificationRuntime(
        d.db,
        d.directory,
        {
          versions,
          calendar: d.calendar,
          taskNotice: async (task, reason, directory) => {
            const record = await d.db
              .repository<VendorQualificationRecord>('vendorQualifications')
              .findOne({ filter: { id: task.recordId } });
            await d.notifications.task({
              task,
              reason,
              directory,
              applicantId: record?.applicantId,
              kind: VENDOR_QUALIFICATION_KIND,
            });
          },
          resultNotice: (record, state, key) =>
            d.notifications.result({
              kind: VENDOR_QUALIFICATION_KIND,
              recordId: record.id,
              applicantId: record.applicantId,
              state,
              transitionId: key,
            }),
          edit: async (record, input, tx) => {
            const next = vendorQualificationInputSchema.parse(input);
            if (
              next.operation !== record.operation ||
              next.vendorId !== record.vendorId
            )
              refuse(
                'SOURCE_IMMUTABLE',
                'The operation and vendor cannot change after draft creation.',
              );
            await d.validateAttachments({ ...record, ...next }, tx);
            return next;
          },
          submit: async (record, _actorId, tx, now) => {
            const clean = vendorQualificationInputSchema.parse(
              Object.fromEntries(
                Object.keys(vendorQualificationInputSchema.shape).map((key) => [
                  key,
                  record[key],
                ]),
              ),
            );
            validateQualificationSubmission(clean, d.calendar.localDate(now));
            const employee = await d.employees.getByUserId(
              record.applicantId,
              tx,
            );
            const department = await d.org.primaryDepartmentOf(
              record.applicantId,
              tx,
            );
            if (!employee?.active || employee.status === 'left' || !department)
              refuse(
                'EMPLOYEE_REQUIRED',
                'An active employee and primary department are required.',
              );
            const directory = await d.directory.snapshot(tx);
            if (
              record.operation === 'remove' &&
              !directory.hasRole(record.applicantId, 'purchasing')
            )
              refuse(
                'PURCHASING_REQUIRED',
                'Only purchasing may request supplier removal.',
                'permission',
              );
            const vendor = await d.vendors.qualificationSource(
              record.vendorId,
              tx,
            );
            if (
              !vendor ||
              !vendor.active ||
              !['manual', 'qualified'].includes(vendor.status)
            )
              refuse('VENDOR_INVALID', 'Choose an active vendor.');
            if (record.operation === 'qualify') {
              if (
                !(await d.dictionaries.list('supplierCategory', {}, tx)).some(
                  (entry) => entry.code === record.category,
                )
              )
                refuse(
                  'CATEGORY_INVALID',
                  'Choose an active supplier category.',
                );
              await d.validateAttachments(record, tx);
              const bank = await tx
                .repository<Bank>('vendorQualificationBanks')
                .findOne({ filter: { requestId: record.id } });
              if (!bank?.bankName || !bank.bankAccount || !bank.bankAccountName)
                refuse(
                  'BANK_REQUIRED',
                  'Complete the protected supplier bank information before submission.',
                );
            }
            const ruleSnapshot = await d.rules.snapshot(
              ['committee.min', 'sla.remindHours', 'sla.escalateHours'],
              now,
              tx,
            );
            if (
              ruleSnapshot['sla.remindHours'] !== 24 ||
              ruleSnapshot['sla.escalateHours'] !== 48
            )
              refuse(
                'SLA_UNSUPPORTED',
                'Only the installed 24/48 approval clocks are supported.',
              );
            const structure = versions.find(
              (version) =>
                version.version === (record.committeeVersion ?? current),
            )!;
            // Immutable structural threshold takes precedence over later global rule edits.
            ruleSnapshot['committee.min'] = structure.min;
            return {
              departmentId: department.id,
              sourceVendorVersion: vendor.version,
              committeeVersion: structure.version,
              committeeSnapshot: structure,
              ruleSnapshot,
              number:
                record.number ??
                (await d.sequences.next('VENDORQUAL', tx, now)),
            };
          },
          restart: async (record, actorId, reason, tx) => {
            const source = await d.vendors.qualificationSource(
              record.vendorId,
              tx,
            );
            if (!source?.active)
              refuse('VENDOR_INVALID', 'The vendor is no longer active.');
            await d.audit.record(
              {
                actorId,
                action: 'vendorQualification.restartReview',
                targetType: 'vendorQualifications',
                targetId: record.id,
                reason,
                before: { sourceVendorVersion: record.sourceVendorVersion },
                after: { sourceVendorVersion: source.version },
              },
              tx,
            );
            return { sourceVendorVersion: source.version };
          },
          candidates: async (record, version, seatKey, tx) => {
            tx ??= d.db.connection();
            const assignments = await configuration.assignments(
              version.version,
              tx,
            );
            const directory = await d.directory.snapshot(tx);
            const map: Record<string, string | null> = Object.fromEntries(
              assignments.map((a) => [a.seatKey, a.personId]),
            );
            for (const seat of version.seats)
              if (seat.source === 'applicantHead')
                map[seat.key] = record.departmentId
                  ? ((await d.org.headOf(record.departmentId, tx)) ?? null)
                  : null;
            return committeeCandidates(
              version,
              record.applicantId,
              map,
              (person, seat) =>
                directory.isActive(person) &&
                (!['purchasing', 'finance', 'legal'].includes(seat.source) ||
                  directory.hasRole(person, seat.source)),
            )[seatKey];
          },
          removalHead: async (tx) => {
            tx ??= d.db.connection();
            const setting = await tx
              .repository<{ id: string; personId: string | null }>(
                'vendorRemovalConfiguration',
              )
              .findOne({ filter: { id: 'main' } });
            const directory = await d.directory.snapshot(tx);
            return setting?.personId &&
              directory.isActive(setting.personId) &&
              directory.hasRole(setting.personId, 'purchasing')
              ? setting.personId
              : null;
          },
          apply: async (record, actorId, tx) => {
            if (
              record.operation === 'qualify' &&
              (!record.qualificationExpiry ||
                record.qualificationExpiry <= d.calendar.localDate(new Date()))
            )
              refuse(
                'QUALIFICATION_EXPIRED',
                'Qualification evidence must still be valid on the final approval date.',
              );
            if (record.sourceVendorVersion === null)
              refuse(
                'SOURCE_VERSION_REQUIRED',
                'The submitted vendor version is missing.',
              );
            const bank =
              record.operation === 'qualify'
                ? await tx
                    .repository<Bank>('vendorQualificationBanks')
                    .findOne({ filter: { requestId: record.id } })
                : null;
            const source = await d.vendors.qualificationSource(
              record.vendorId,
              tx,
            );
            if (!source || source.version !== record.sourceVendorVersion)
              refuse(
                'VENDOR_VERSION_CONFLICT',
                'Vendor maintenance changed the submitted facts. An administrator must restart review against the latest version.',
                'conflict',
              );
            await d.vendors.applyQualification(
              {
                vendorId: record.vendorId,
                expectedVersion: record.sourceVendorVersion,
                qualificationId: record.id,
                actorId,
                reason: record.reason,
                outcome:
                  record.operation === 'qualify' ? 'qualified' : 'removed',
                qualificationExpiry: record.qualificationExpiry,
                ...(bank
                  ? {
                      account: {
                        bankName: bank.bankName,
                        bankAccount: bank.bankAccount,
                        bankAccountName: bank.bankAccountName,
                      },
                    }
                  : {}),
                ...(record.operation === 'qualify'
                  ? {
                      proposal: {
                        name: record.name,
                        category: record.category,
                        contactName: record.contactName,
                        contactPhone: record.contactPhone,
                        contactEmail: record.contactEmail,
                      },
                    }
                  : {}),
              },
              tx,
            );
          },
        },
        d.dispatcher,
      );
    })());
  }
  async function canRead(
    id: string,
    actorId: string,
    policy?: RepositoryPolicy,
  ) {
    const repo = d.db.repository<VendorQualificationRecord>(
      'vendorQualifications',
    );
    const record = (await (policy ? repo.withPolicy(policy) : repo).findOne({
      filter: { id },
    })) as VendorQualificationRecord | undefined;
    if (!record)
      refuse(
        'ACCESS_DENIED',
        'The vendor qualification is not accessible.',
        'permission',
      );
    if (
      [
        ...Object.keys(vendorQualificationInputSchema.shape),
        'createdById',
        'departmentId',
        'number',
        'lifecycleVersion',
        'sourceVendorVersion',
        'committeeVersion',
        'committeeSnapshot',
        'ruleSnapshot',
        'createdAt',
        'updatedAt',
      ].some((key) => !(key in record)) ||
      !record.applicantId ||
      !record.status
    )
      refuse(
        'FIELDS_RESTRICTED',
        'Complete qualification fields are required.',
        'permission',
      );
    record.quoteCents = Number(record.quoteCents);
    if (!Number.isSafeInteger(record.quoteCents) || record.quoteCents < 0)
      refuse(
        'STORED_AMOUNT_INVALID',
        'Stored quotation must be safe integer cents.',
      );
    if (policy) return record;
    const directory = await d.directory.snapshot();
    if (
      record.applicantId === actorId ||
      record.createdById === actorId ||
      ['finance', 'financeManager', 'cfo', 'gm', 'approval.admin'].some(
        (role) => directory.hasRole(actorId, role),
      )
    )
      return record;
    const kit = await sdk();
    if (
      (
        await kit.read(() =>
          kit.approvals.involvementOf(VENDOR_QUALIFICATION_KIND, id, actorId),
        )
      ).length
    )
      return record;
    const department = await d.org.primaryDepartmentOf(actorId);
    if (
      department &&
      (await d.org.headOf(department.id)) === actorId &&
      record.departmentId &&
      (await d.org.subtreeIds(department.id)).includes(record.departmentId)
    )
      return record;
    refuse(
      'ACCESS_DENIED',
      'The vendor qualification is not accessible.',
      'permission',
    );
  }
  async function listAuthorized(
    actorId: string,
    query: {
      view: 'all' | 'mine' | 'pending' | 'done' | 'copied';
      search?: string;
      status?: string;
      sort: 'createdAt' | 'number' | 'name';
      direction: 'asc' | 'desc';
    },
    policy: RepositoryPolicy,
  ) {
    const rows = await d.db
      .repository<VendorQualificationRecord>('vendorQualifications')
      .withPolicy(policy)
      .findMany({
        sort: (sort) =>
          query.direction === 'asc'
            ? [sort.field(query.sort).asc(), sort.field('id').asc()]
            : [sort.field(query.sort).desc(), sort.field('id').desc()],
      });
    const kit = await sdk(),
      result: VendorQualificationRecord[] = [];
    for (const row of rows) {
      if (!row.id) continue;
      const record = await canRead(row.id, actorId, policy);
      if (query.status && record.status !== query.status) continue;
      if (
        query.search &&
        ![record.name, record.number ?? '', record.reason].some((value) =>
          value
            .toLocaleLowerCase()
            .includes(query.search!.trim().toLocaleLowerCase()),
        )
      )
        continue;
      if (query.view === 'all') {
        result.push(record);
        continue;
      }
      if (query.view === 'mine') {
        if (record.applicantId === actorId || record.createdById === actorId)
          result.push(record);
        continue;
      }
      const tasks = await kit.read(() =>
        kit.approvals.tasksFor(VENDOR_QUALIFICATION_KIND, record.id),
      );
      if (
        (query.view === 'pending' &&
          tasks.some(
            (task) =>
              task.assigneeId === actorId &&
              ['pending', 'candidate', 'claimed'].includes(task.status) &&
              task.role !== 'info',
          )) ||
        (query.view === 'done' &&
          tasks.some(
            (task) =>
              task.assigneeId === actorId &&
              task.status === 'completed' &&
              task.role !== 'info',
          )) ||
        (query.view === 'copied' &&
          tasks.some(
            (task) => task.assigneeId === actorId && task.role === 'info',
          ))
      )
        result.push(record);
    }

    return result;
  }
  async function decorate(records: readonly VendorQualificationRecord[]) {
    const ids = [
      ...new Set(records.flatMap((r) => [r.applicantId, r.createdById])),
    ];
    const people = new Map(
      (await Promise.all(ids.map((id) => d.users.get(id))))
        .filter((user) => user !== undefined)
        .map((user) => [user.id, { id: user.id, name: user.name }]),
    );
    return records.map((record) => ({
      ...record,
      applicant: people.get(record.applicantId) ?? null,
      createdBy: people.get(record.createdById) ?? null,
    }));
  }
  return {
    initialize: sdk,
    approvals: {
      async tasksOf(...input: Parameters<ApprovalService['tasksOf']>) {
        const kit = await sdk();
        return kit.read(() => kit.approvals.tasksOf(...input));
      },
      async runsFor(...input: Parameters<ApprovalService['runsFor']>) {
        const kit = await sdk();
        return kit.read(() => kit.approvals.runsFor(...input));
      },
      async actionsOf(...input: Parameters<ApprovalService['actionsOf']>) {
        const kit = await sdk();
        return kit.read(() => kit.approvals.actionsOf(...input));
      },
    },
    configuration,
    async configurationView() {
      const tx = d.db.connection(),
        versions = await configuration.versions(tx);
      const assignments = await Promise.all(
        versions.map((v) => configuration.assignments(v.version, tx)),
      );
      const removalHead = await configuration.removalHead(tx);
      const ids = [
        ...new Set(
          [
            ...assignments.flat().map((row) => row.personId),
            removalHead?.personId,
          ].filter((id): id is string => Boolean(id)),
        ),
      ];
      const knownUsers = (await Promise.all(ids.map((id) => d.users.get(id))))
        .filter((user) => user !== undefined)
        .map((user) => ({ id: user.id, name: user.name }));
      return {
        versions,
        assignments,
        removalHead,
        knownUsers,
        activeCommitteeVersion: runningVersion,
      };
    },
    async configurationCandidates(
      source: 'purchasing' | 'finance' | 'technical' | 'legal',
      query: { search?: string; offset: number; limit: number },
    ) {
      const directory = await d.directory.snapshot();
      const ids =
        source === 'technical'
          ? ((await directory.searchPeople?.({
              search: query.search,
              offset: 0,
              limit: Number.MAX_SAFE_INTEGER,
            })) ?? [])
          : directory.roleMembers(source);
      if (!ids.length) return { people: [], nextOffset: null };
      const page = await d.users.list({
        userIds: ids.filter((id) => directory.isActive(id)),
        search: query.search,
        status: 'enabled',
        page: 1,
        pageSize: Number.MAX_SAFE_INTEGER,
      });
      const people = page.items
        .map((user) => ({ id: user.id, name: user.name }))
        .sort(
          (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
        );
      return {
        people: people.slice(query.offset, query.offset + query.limit),
        nextOffset:
          query.offset + query.limit < people.length
            ? query.offset + query.limit
            : null,
      };
    },
    canRead,
    async create(
      input: VendorQualificationInput,
      actorId: string,
      requestKey: string,
      createPolicy?: RepositoryPolicy,
    ) {
      const clean = vendorQualificationInputSchema.parse(input);
      if (!requestKey || requestKey.length > 128)
        refuse(
          'REQUEST_KEY_REQUIRED',
          'A stable creation request key is required.',
        );
      const kit = await sdk();
      const fingerprint = createHash('sha256')
        .update(JSON.stringify(clean))
        .digest('hex');
      return d.db.transaction(async (tx) => {
        await lockUserForAdministration(tx, actorId);
        const employee = await d.employees.getByUserId(actorId, tx),
          department = await d.org.primaryDepartmentOf(actorId, tx);
        if (!employee?.active || employee.status === 'left' || !department)
          refuse(
            'EMPLOYEE_REQUIRED',
            'An active employee and primary department are required.',
          );
        if (
          clean.operation === 'remove' &&
          !(await d.directory.snapshot(tx)).hasRole(actorId, 'purchasing')
        )
          refuse(
            'PURCHASING_REQUIRED',
            'Only purchasing may initiate supplier removal.',
            'permission',
          );
        const repo = tx.repository<Creation>(
          'vendorQualificationCreationCommands',
        );
        const previous = await repo.findOne({
          filter: { actorId, requestKey },
        });
        if (previous) {
          if (previous.fingerprint !== fingerprint)
            refuse(
              'REQUEST_CONFLICT',
              'This request key was used with different draft facts.',
              'conflict',
            );
          const existing = await tx
            .repository<VendorQualificationRecord>('vendorQualifications')
            .findOne({ filter: { id: previous.requestId } });
          if (!existing)
            refuse(
              'CREATION_RECORD_MISSING',
              'The original draft is no longer available.',
              'conflict',
            );
          const quoteCents = Number(existing.quoteCents);
          if (!Number.isSafeInteger(quoteCents) || quoteCents < 0)
            refuse(
              'STORED_AMOUNT_INVALID',
              'Stored quotation must be safe integer cents.',
            );
          return { record: { ...existing, quoteCents } };
        }
        const source = await d.vendors.qualificationSource(clean.vendorId, tx);
        if (!source)
          refuse('VENDOR_NOT_FOUND', 'Vendor not found.', 'notFound');
        const id = randomUUID();
        const create = () =>
          kit.read(
            () =>
              kit.runtime.create(
                VENDOR_QUALIFICATION_KIND,
                {
                  ...clean,
                  id,
                  applicantId: actorId,
                  createdById: actorId,
                  departmentId: null,
                  number: null,
                  committeeVersion: null,
                  committeeSnapshot: null,
                  sourceVendorVersion: null,
                  ruleSnapshot: {},
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
                { actor: { id: actorId }, transaction: tx },
              ),
            tx,
          );
        const result = createPolicy
          ? await kit.write(createPolicy, create)
          : await create();
        await tx.repository<Bank>('vendorQualificationBanks').createOne({
          values: {
            requestId: id,
            bankName: '',
            bankAccount: '',
            bankAccountName: '',
            version: 1,
            updatedAt: new Date(),
          },
        });
        await repo.createOne({
          values: {
            id: randomUUID(),
            actorId,
            requestKey,
            requestId: id,
            fingerprint,
            createdAt: new Date(),
          },
        });
        return result;
      });
    },
    async readableIds(actorId: string) {
      const rows = await d.db
        .repository<{ id: string }>('vendorQualifications')
        .findMany();
      const ids: string[] = [];
      for (const row of rows) {
        try {
          await canRead(row.id, actorId);
          ids.push(row.id);
        } catch (error) {
          if (
            !(error instanceof VendorQualificationError) ||
            error.kind !== 'permission'
          )
            throw error;
        }
      }
      return ids;
    },
    async detail(id: string, actorId: string, policy?: RepositoryPolicy) {
      const record = await canRead(id, actorId, policy),
        kit = await sdk();
      return kit.read(async () => {
        const runs = await kit.approvals.runViewsFor(
          VENDOR_QUALIFICATION_KIND,
          id,
        );
        const ids = [
          ...new Set([
            record.applicantId,
            record.createdById,
            ...runs.flatMap((run) =>
              run.tasks
                .flatMap((task) => [task.assigneeId])
                .filter((id): id is string => Boolean(id)),
            ),
          ]),
        ];
        const knownUsers = (await Promise.all(ids.map((id) => d.users.get(id))))
          .filter((user) => user !== undefined)
          .map((user) => ({ id: user.id, name: user.name }));
        const lifecycleView = await kit.runtime.view(
          VENDOR_QUALIFICATION_KIND,
          id,
          { id: actorId },
        );
        // Required reasons belong to the actual write; use a valid input only to project eligibility.
        const available = await Promise.all(
          lifecycleView.available.map(async (offer) =>
            offer.name !== 'restartReview'
              ? offer
              : {
                  ...offer,
                  ...(await kit.runtime.can(
                    VENDOR_QUALIFICATION_KIND,
                    id,
                    offer.name,
                    { id: actorId },
                    { input: { reason: 'Eligibility preview' } },
                  )),
                },
          ),
        );
        return {
          record: (await decorate([record]))[0],
          knownUsers,
          runs,
          timeZone: d.calendar.timeZone(),
          timeline: await kit.approvals.timelineFor(
            VENDOR_QUALIFICATION_KIND,
            id,
          ),
          upcoming: await kit.approvals.upcomingStagesFor(
            VENDOR_QUALIFICATION_KIND,
            id,
            { id: actorId },
          ),
          view: { ...lifecycleView, available },
          actions: await kit.approvals.actionsFor(
            VENDOR_QUALIFICATION_KIND,
            id,
            { id: actorId },
          ),
          runActions: await kit.approvals.runActionsFor(
            VENDOR_QUALIFICATION_KIND,
            id,
            { id: actorId },
          ),
        };
      });
    },
    async transition(
      id: string,
      actorId: string,
      name: string,
      version: number,
      requestId: string,
      input: JsonObject,
      policy?: RepositoryPolicy,
      mutationPolicy?: RepositoryPolicy,
    ) {
      if (name === 'edit') vendorQualificationInputSchema.parse(input);
      else {
        const keys = name === 'submit' ? [] : ['reason'];
        if (Object.keys(input).some((key) => !keys.includes(key)))
          refuse(
            'TRANSITION_INPUT_INVALID',
            'Only the declared transition fields are accepted.',
          );
        if (
          name === 'terminate' &&
          (typeof input.reason !== 'string' || !input.reason.trim())
        )
          refuse(
            'REASON_REQUIRED',
            'Administrative termination requires a reason.',
          );
      }
      await canRead(id, actorId, policy);
      const kit = await sdk();
      const fire = () =>
        kit.read(() =>
          kit.runtime.fire(VENDOR_QUALIFICATION_KIND, id, name, {
            actor: { id: actorId },
            expect: { version },
            manual: true,
            requestId,
            input,
          }),
        );
      return mutationPolicy ? kit.write(mutationPolicy, fire) : fire();
    },
    async action(
      id: string,
      actorId: string,
      input: Omit<PerformInput, 'actor'>,
      policy?: RepositoryPolicy,
    ) {
      await canRead(id, actorId, policy);
      const allowed =
        input.action === 'appoint'
          ? ['to', 'place']
          : input.action === 'reassign'
            ? ['to', 'override']
            : input.action === 'return'
              ? ['to']
              : [];
      if (
        input.input &&
        Object.keys(input.input).some((key) => !allowed.includes(key))
      )
        refuse(
          'ACTION_INPUT_INVALID',
          'Only the declared action fields are accepted. Protected banking never enters approval history.',
        );
      const target = input.target;
      const kit = await sdk(),
        views = await kit.read(() =>
          kit.approvals.runViewsFor(VENDOR_QUALIFICATION_KIND, id),
        );
      if (
        !views.some((view) =>
          'runId' in target
            ? view.run.id === target.runId
            : view.tasks.some((task) => task.id === target.taskId),
        )
      )
        refuse(
          'TARGET_MISMATCH',
          'The approval action target belongs to another document.',
          'permission',
        );
      return kit.read(() =>
        kit.approvals.perform({ ...input, actor: { id: actorId } }),
      );
    },
    async candidates(
      id: string,
      actorId: string,
      target: ActionTarget,
      action: 'appoint' | 'reassign',
      query: PeopleQuery,
      policy: RepositoryPolicy,
    ) {
      await canRead(id, actorId, policy);
      const kit = await sdk();
      const views = await kit.read(() =>
        kit.approvals.runViewsFor(VENDOR_QUALIFICATION_KIND, id),
      );
      if (
        !views.some((view) =>
          'runId' in target
            ? view.run.id === target.runId
            : view.tasks.some((task) => task.id === target.taskId),
        )
      )
        refuse(
          'TARGET_MISMATCH',
          'The approval target belongs to another application.',
          'permission',
        );
      const page = await kit.read(() =>
        kit.approvals.candidatesFor({
          target,
          action,
          actor: { id: actorId },
          query,
        }),
      );
      const people = await Promise.all(
        page.people.map(async (id) => ({
          id,
          name: (await d.users.get(id))?.name ?? id,
        })),
      );
      return { people, nextOffset: page.nextOffset };
    },
    async options(actorId: string, vendorPolicy: RepositoryPolicy) {
      await sdk();
      const employee = await d.employees.getByUserId(actorId);
      if (!employee?.active || employee.status === 'left')
        refuse('EMPLOYEE_REQUIRED', 'An active employee archive is required.');
      let sourceOptions: Awaited<ReturnType<VendorService['options']>>;
      try {
        sourceOptions = await d.vendors.options(
          d.db.connection(),
          vendorPolicy,
        );
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'VENDOR_OPTIONS_FIELDS_REQUIRED'
        )
          refuse(
            'VENDOR_FIELDS_RESTRICTED',
            'Vendor identity, category and status read access are required.',
            'permission',
          );
        throw error;
      }
      const permitted = {
        data: sourceOptions.filter(
          (row) => row.active && ['manual', 'qualified'].includes(row.status),
        ),
      };
      const directory = await d.directory.eligibility(
          [actorId],
          ['purchasing'],
        ),
        department = await d.org.primaryDepartmentOf(actorId);
      if (
        permitted.data.some(
          (row) =>
            !row.id ||
            typeof row.name !== 'string' ||
            typeof row.category !== 'string' ||
            typeof row.active !== 'boolean' ||
            !row.status,
        )
      )
        refuse(
          'VENDOR_FIELDS_RESTRICTED',
          'Vendor identity, category and status read access are required.',
          'permission',
        );
      return {
        applicant: { id: actorId, name: employee.name },
        timeZone: d.calendar.timeZone(),
        canCreateQualification: Boolean(department),
        canCreateRemoval:
          Boolean(department) && directory.hasRole(actorId, 'purchasing'),
        categories: await d.dictionaries.list('supplierCategory'),
        vendors: permitted.data.map((row) => ({
          id: row.id,
          name: row.name,
          category: row.category,
          status: row.status,
          eligibleOperations: directory.hasRole(actorId, 'purchasing')
            ? ['qualify', 'remove']
            : ['qualify'],
        })),
        committeeVersions: await configuration.versions(d.db.connection()),
        activeCommitteeVersion: runningVersion,
      };
    },
    async listForCenter(
      actorId: string,
      view: 'all' | 'pending' | 'done' | 'copied',
      policy: RepositoryPolicy,
    ) {
      return decorate(
        await listAuthorized(
          actorId,
          { view, sort: 'createdAt', direction: 'desc' },
          policy,
        ),
      );
    },
    async list(
      actorId: string,
      query: {
        view: 'mine' | 'pending' | 'done' | 'copied';
        page: number;
        pageSize: number;
        search?: string;
        status?: string;
        sort: 'createdAt' | 'number' | 'name';
        direction: 'asc' | 'desc';
      },
      policy: RepositoryPolicy,
    ) {
      const result = await listAuthorized(actorId, query, policy);
      const page = Math.min(
        query.page,
        Math.max(1, Math.ceil(result.length / query.pageSize)),
      );
      return {
        data: await decorate(
          result.slice((page - 1) * query.pageSize, page * query.pageSize),
        ),
        meta: {
          total: result.length,
          page,
          pageSize: query.pageSize,
          timeZone: d.calendar.timeZone(),
        },
      };
    },
    async bankInfo(
      id: string,
      actorId: string,
      viewPolicy: RepositoryPolicy,
      bankPolicy: RepositoryPolicy,
    ) {
      const record = await canRead(id, actorId, viewPolicy);
      if (
        !(await d.db
          .repository('vendorQualifications')
          .withPolicy(bankPolicy)
          .findOne({ filter: { id } }))
      )
        refuse(
          'BANK_ACCESS_DENIED',
          'The protected bank record policy excludes this application.',
          'permission',
        );
      const directory = await d.directory.snapshot();
      if (
        record.applicantId !== actorId &&
        record.createdById !== actorId &&
        !['finance', 'financeManager', 'cfo', 'approval.admin'].some((role) =>
          directory.hasRole(actorId, role),
        )
      )
        refuse(
          'BANK_ACCESS_DENIED',
          'Supplier banking is restricted to its owner and explicitly authorized finance roles.',
          'permission',
        );
      const account = await d.db
        .repository<Bank>('vendorQualificationBanks')
        .findOne({ filter: { requestId: id } });
      return {
        account: account
          ? {
              bankName: account.bankName,
              bankAccount: account.bankAccount,
              bankAccountName: account.bankAccountName,
              version: account.version,
            }
          : null,
        lifecycleVersion: record.lifecycleVersion,
      };
    },
    async updateBank(
      id: string,
      actorId: string,
      input: {
        lifecycleVersion: number;
        bankVersion: number;
        reason: string;
        account: {
          bankName: string;
          bankAccount: string;
          bankAccountName: string;
        };
      },
      viewPolicy: RepositoryPolicy,
      bankPolicy: RepositoryPolicy,
    ) {
      const record = await canRead(id, actorId, viewPolicy);
      if (
        !(await d.db
          .repository('vendorQualifications')
          .withPolicy(bankPolicy)
          .findOne({ filter: { id } }))
      )
        refuse(
          'BANK_ACCESS_DENIED',
          'The protected bank record policy excludes this application.',
          'permission',
        );
      if (
        record.applicantId !== actorId ||
        !['draft', 'revision'].includes(record.status)
      )
        refuse(
          'BANK_FROZEN',
          'Only the applicant may edit protected banking before submission.',
          'permission',
        );
      if (
        !input.reason.trim() ||
        input.reason.length > 4000 ||
        !Number.isSafeInteger(input.bankVersion) ||
        !Number.isSafeInteger(input.lifecycleVersion)
      )
        refuse(
          'BANK_INPUT_INVALID',
          'Current versions and an audit reason are required.',
        );
      for (const key of ['bankName', 'bankAccount', 'bankAccountName'] as const)
        if (
          typeof input.account[key] !== 'string' ||
          input.account[key].length > 255
        )
          refuse(
            'BANK_INPUT_INVALID',
            'Protected account fields must be textual values up to 255 characters.',
          );
      return d.db.transaction(async (tx) => {
        const lock = await tx
          .repository('vendorQualifications')
          .withPolicy(bankPolicy)
          .updateMany({
            filter: {
              id,
              lifecycleVersion: input.lifecycleVersion,
              status: record.status,
            },
            values: { lifecycleVersion: input.lifecycleVersion },
          });
        if (!lock.updatedCount)
          refuse(
            'VERSION_CONFLICT',
            'The application changed; reload its current version.',
            'conflict',
          );
        const account = Object.fromEntries(
          (['bankName', 'bankAccount', 'bankAccountName'] as const).map(
            (key) => [key, input.account[key].trim()],
          ),
        );
        const changed = await tx
          .repository<Bank>('vendorQualificationBanks')
          .updateMany({
            filter: { requestId: id, version: input.bankVersion },
            values: {
              ...account,
              version: input.bankVersion + 1,
              updatedAt: new Date(),
            },
          });
        if (!changed.updatedCount)
          refuse(
            'BANK_VERSION_CONFLICT',
            'Protected account facts changed; reload without overwriting your input.',
            'conflict',
          );
        await d.audit.record(
          {
            actorId,
            action: 'vendorQualification.bank.update',
            targetType: 'vendorQualifications',
            targetId: id,
            reason: input.reason.trim(),
            before: { version: input.bankVersion },
            after: { version: input.bankVersion + 1 },
          },
          tx,
        );
        return { version: input.bankVersion + 1 };
      });
    },
    async maintenanceReassign(
      input: Parameters<ApprovalService['reassign']>[0],
    ) {
      const kit = await sdk();
      return kit.read(() => kit.approvals.reassign(input));
    },
    async sweep() {
      const kit = await sdk(),
        report = await kit.read(() => kit.approvals.sweepReport());
      const directory = await d.directory.snapshot(),
        rows = await d.db
          .repository<VendorQualificationRecord>('vendorQualifications')
          .findMany();
      for (const record of rows) {
        const views = await kit.read(() =>
          kit.approvals.runViewsFor(VENDOR_QUALIFICATION_KIND, record.id),
        );
        for (const view of views) {
          if (!isOpenRun(view.run)) continue;
          const tasks = view.tasks.filter(
            (task) =>
              task.stage === record.status &&
              task.enteredVersion === record.lifecycleVersion &&
              task.depth === 0 &&
              task.kind === 'decide' &&
              !['cancelled', 'transferred', 'voided'].includes(task.status),
          );
          const missing = record.status.startsWith('committee_v')
            ? new Set(tasks.map((task) => task.order)).size <
              (record.committeeSnapshot?.seats.length ?? 0)
            : tasks.length === 0;
          if (missing)
            await d.notifications.alarm({
              kind: VENDOR_QUALIFICATION_KIND,
              recordId: record.id,
              recipients: directory.roleMembers('approval.admin'),
              eventId: `hold:${view.run.id}:${record.lifecycleVersion}`,
              reason: 'unassigned',
            });
        }
      }
      return report;
    },
    async expiryReminders(now = new Date()) {
      const today = d.calendar.localDate(now);
      const directory = await d.directory.snapshot();
      const recipients = directory.roleMembers('purchasing');
      let reminded = 0;
      if (!recipients.length) return { reminded, missingRecipients: true };
      for (const option of await d.vendors.options()) {
        if (!option.active || option.status !== 'qualified') continue;
        const facts = await d.db.transaction(async (tx) => {
          const source = await d.vendors.qualificationSource(option.id, tx);
          if (!source?.qualificationId) return null;
          const record = await tx
            .repository<VendorQualificationRecord>('vendorQualifications')
            .findOne({
              filter: {
                id: source.qualificationId,
                vendorId: source.id,
                status: 'qualified',
              },
            });
          return record &&
            record.qualificationExpiry === source.qualificationExpiry
            ? { source, requestId: record.id }
            : null;
        });
        const source = facts?.source;
        if (
          !source?.qualificationExpiry ||
          source.status !== 'qualified' ||
          !source.active
        )
          continue;
        const start = d.calendar.addCalendarDays(
          source.qualificationExpiry,
          -30,
        );
        if (today < start || today > source.qualificationExpiry) continue;
        await d.notifications.alarm({
          kind: VENDOR_QUALIFICATION_KIND,
          recordId: facts!.requestId,
          recipients,
          eventId: `vendor-expiry:${source.id}:${source.qualificationExpiry}:30`,
          reason: 'qualification-expiry',
          detail: {
            key: 'vendorQualifications.schedule.expiryReminder',
            values: {
              supplierName: source.name,
              expiry: source.qualificationExpiry,
            },
          },
        });
        reminded++;
      }
      return { reminded, missingRecipients: false };
    },
    async approvedQualificationOf(vendorId: string, tx: DatabaseConnection) {
      const vendor = await d.vendors.qualificationSource(vendorId, tx);
      if (
        !vendor?.active ||
        vendor.status !== 'qualified' ||
        !vendor.qualificationId
      )
        return null;
      const rows = await tx
        .repository<VendorQualificationRecord>('vendorQualifications')
        .findMany({
          filter: { id: vendor.qualificationId, vendorId, status: 'qualified' },
          sort: (s) => [s.field('createdAt').desc(), s.field('id').desc()],
        });
      const row = rows[0];
      return row?.qualificationExpiry &&
        row.qualificationExpiry === vendor.qualificationExpiry
        ? { id: row.id, vendorId, qualificationExpiry: row.qualificationExpiry }
        : null;
    },
  };
}

export type VendorQualificationServiceImpl = ReturnType<
  typeof createVendorQualificationService
>;
export type { VendorQualificationRecord } from './contract.js';

export const vendorQualificationHttpServiceToken =
  createServiceToken<VendorQualificationServiceImpl>(
    'oa/vendor-qualification-http',
  );
