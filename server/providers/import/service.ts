import type { HeadcountService } from '../headcounts/contract.js';
import type { UserAdministrationService } from '@nocobase/app-plugin-authentication';
import type { ServerFileRepository } from '@nocobase/app-plugin-file/server';
import type {
  DatabaseConnection,
  DatabaseManager,
  RepositoryRecord,
} from '@nocobase/db';
import {
  createServiceToken,
  type ServiceToken,
} from '@nocobase/service-provider';

import type { AuditService } from '../audit/index.js';
import type { EmployeeModuleService } from '../employees/service.js';
import type { OrganizationService } from '../org/service.js';
import { loadUserIndex } from './cells.js';
import { MAX_REPORTED_ERRORS, type ImportKind } from './constants.js';
import { ImportWriteError, planImport, type Outcome } from './importers.js';
import type {
  ImportReport,
  ImportRowError,
  ImportRun,
  ImportRunDetail,
  ImportRunStatus,
} from './types.js';
import { buildTemplate, readSheet } from './workbook.js';

export interface ListImportRunsQuery {
  readonly kind?: ImportKind | undefined;
  /** By start time; newest first unless `asc`. */
  readonly order?: 'asc' | 'desc' | undefined;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * The Excel import. `preview` checks a file and applies it inside a transaction it then rolls back, so the counts it
 * answers are exactly what `run` would write; `run` keeps the uploaded file, applies the file in one transaction and
 * records the attempt in the history, whether it succeeded or not.
 *
 * Every write goes through the organisation and employee services, which keep their invariants and audit each change
 * with the reason `import:<run id>`; a row that would change nothing is not written, so a repeated import leaves no
 * trace beyond its own history row and audit entry.
 */
export interface ImportService {
  template(kind: ImportKind, locale?: string): Promise<Uint8Array<ArrayBuffer>>;
  preview(
    kind: ImportKind,
    file: File,
    actorId: string | null,
  ): Promise<ImportReport>;
  run(
    kind: ImportKind,
    file: File,
    actorId: string | null,
  ): Promise<ImportRunDetail>;
  listRuns(
    query: ListImportRunsQuery,
  ): Promise<{ items: ImportRun[]; total: number }>;
  getRun(id: string): Promise<ImportRunDetail | undefined>;
}

export const importServiceToken: ServiceToken<ImportService> =
  createServiceToken<ImportService>('oa/import-service');

export interface ImportServiceDependencies {
  readonly headcounts?: () => HeadcountService;
  readonly database: DatabaseManager;
  readonly organization: () => OrganizationService;
  readonly employees: () => EmployeeModuleService;
  readonly users: () => UserAdministrationService;
  readonly audit: () => AuditService;
  /** The `importFiles` repository of the file plugin, where every uploaded workbook is kept. */
  readonly files: () => ServerFileRepository;
  readonly generateId: () => string;
  /** The application's public base path, such as `/main`, which content URLs start with. */
  readonly publicBasePath: () => string;
}

/** Ends the import's transaction without committing: a preview, or a file that failed validation. */
class Rollback extends Error {
  public readonly report: ImportReport;

  public constructor(report: ImportReport) {
    super('Import rolled back.');
    this.report = report;
  }
}

function report(
  kind: ImportKind,
  rowCount: number,
  errors: readonly ImportRowError[],
  outcome?: Outcome,
): ImportReport {
  return {
    kind,
    result: errors.length ? 'invalid' : 'ok',
    rowCount,
    createdCount: outcome?.created ?? 0,
    updatedCount: outcome?.updated ?? 0,
    unchangedCount: outcome?.unchanged ?? 0,
    errorCount: errors.length,
    errors: errors.slice(0, MAX_REPORTED_ERRORS),
  };
}

/** A stored scalar as text; ids come back as strings or numbers depending on the dialect. */
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint')
    return value.toString();
  return '';
}

function iso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function errorsOf(value: unknown): ImportRowError[] {
  const parsed: unknown =
    typeof value === 'string' ? JSON.parse(value) : (value ?? []);
  return Array.isArray(parsed) ? (parsed as ImportRowError[]) : [];
}

export function createImportService(
  deps: ImportServiceDependencies,
): ImportService {
  const { database } = deps;

  /**
   * Reads, validates and applies the file in one transaction. Without `commit` (a preview) the transaction is rolled
   * back once the counts are known; a file with errors is always rolled back, before anything is written.
   */
  async function apply(
    kind: ImportKind,
    file: File,
    actorId: string | null,
    reason: string,
    commit?: (
      connection: DatabaseConnection,
      result: ImportReport,
    ) => Promise<void>,
  ): Promise<ImportReport> {
    const sheet = await readSheet(
      kind,
      new Uint8Array(await file.arrayBuffer()),
    );
    const rowCount = sheet.rows.length;
    if (sheet.errors.length) return report(kind, rowCount, sheet.errors);
    try {
      const applyTransaction = async (connection: DatabaseConnection) => {
        // Inside the transaction: on SQLite it holds the only connection, so every read goes through it.
        const users = await loadUserIndex(
          deps.users().withConnection(connection),
        );
        const plan = await planImport(kind, sheet, {
          connection,
          organization: deps.organization(),
          employees: deps.employees(),
          users,
          write: { actorId, connection, reason },
          actorId,
          reason,
        });
        if (plan.errors.length)
          throw new Rollback(report(kind, rowCount, plan.errors));
        const result = report(kind, rowCount, [], await plan.execute());
        if (commit) await commit(connection, result);
        return result;
      };
      return await database.transaction(async (connection) => {
        const result = await (kind === 'employees' && deps.headcounts
          ? deps
              .headcounts()
              .protectRoster(undefined, connection, applyTransaction)
          : applyTransaction(connection));
        if (!commit) throw new Rollback(result);
        return result;
      });
    } catch (error) {
      if (error instanceof Rollback) return error.report;
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        String(error.code).startsWith('HEADCOUNT_')
      )
        return report(kind, rowCount, [
          {
            row: null,
            column: null,
            header: null,
            code: 'WRITE_FAILED',
            params: {
              reason: String(error.code),
              message:
                'The initialized roster cannot be changed without a verified business occupancy source.',
            },
          },
        ]);
      if (error instanceof ImportWriteError)
        return report(kind, rowCount, [error.detail]);
      throw error;
    }
  }

  async function insertRun(
    connection: DatabaseConnection,
    values: {
      id: string;
      kind: ImportKind;
      status: ImportRunStatus;
      fileId: string | null;
      filename: string;
      actorId: string | null;
      result: ImportReport;
      createdAt: Date;
    },
  ): Promise<void> {
    const { result } = values;
    await connection.repository('importRuns').createOne({
      values: {
        id: values.id,
        kind: values.kind,
        status: values.status,
        fileId: values.fileId,
        filename: values.filename,
        actorId: values.actorId,
        rowCount: result.rowCount,
        createdCount: result.createdCount,
        updatedCount: result.updatedCount,
        unchangedCount: result.unchangedCount,
        errorCount: result.errorCount,
        errors: values.status === 'failed' ? [...result.errors] : null,
        createdAt: values.createdAt,
        finishedAt: new Date(),
      },
    });
  }

  async function views(
    rows: readonly RepositoryRecord[],
  ): Promise<ImportRunDetail[]> {
    const fileIds = [
      ...new Set(rows.flatMap((row) => (row.fileId ? [text(row.fileId)] : []))),
    ];
    const actorIds = [
      ...new Set(
        rows.flatMap((row) => (row.actorId ? [text(row.actorId)] : [])),
      ),
    ];
    const files = fileIds.length
      ? await deps.files().findMany({
          filter: (f) => f.or(fileIds.map((id) => f.string('id').eq(id))),
        })
      : [];
    const fileById = new Map(files.map((file) => [String(file.id), file]));
    const actors = new Map<string, string>();
    for (let offset = 0; offset < actorIds.length; offset += 100) {
      const page = await deps.users().list({
        userIds: actorIds.slice(offset, offset + 100),
        page: 1,
        pageSize: 100,
        kind: 'all',
      });
      for (const user of page.items) actors.set(user.id, user.name);
    }
    const base = deps.publicBasePath().replace(/\/$/u, '');
    return rows.map((row) => {
      const file = row.fileId ? fileById.get(text(row.fileId)) : undefined;
      const actorId = row.actorId ? text(row.actorId) : null;
      return {
        id: text(row.id),
        kind: text(row.kind) as ImportKind,
        status: text(row.status) as ImportRunStatus,
        filename: text(row.filename),
        file: file
          ? {
              id: String(file.id),
              size: Number(file.size),
              contentUrl: `${base}${deps.files().getUrl({ id: String(file.id), ext: String(file.ext) })}`,
            }
          : null,
        actor: actorId
          ? { id: actorId, name: actors.get(actorId) ?? actorId }
          : null,
        rowCount: Number(row.rowCount ?? 0),
        createdCount: Number(row.createdCount ?? 0),
        updatedCount: Number(row.updatedCount ?? 0),
        unchangedCount: Number(row.unchangedCount ?? 0),
        errorCount: Number(row.errorCount ?? 0),
        errors: errorsOf(row.errors),
        createdAt: iso(row.createdAt),
        finishedAt: iso(row.finishedAt),
      };
    });
  }

  return {
    template: buildTemplate,

    preview(kind, file, actorId) {
      return apply(kind, file, actorId, 'import:preview');
    },

    async run(kind, file, actorId) {
      const id = deps.generateId();
      const createdAt = new Date();
      const reason = `import:${id}`;
      // Kept before the import's transaction opens (the upload commits on its own), so a failed attempt keeps it too.
      const { record } = await deps.files().uploadOne({ file });
      const fileId = String(record.id);
      const base = {
        id,
        kind,
        fileId,
        filename: file.name,
        actorId,
        createdAt,
      };
      const audit = (status: ImportRunStatus, result: ImportReport) => ({
        actorId,
        action: status === 'succeeded' ? 'import.run' : 'import.fail',
        targetType: 'importRuns',
        targetId: id,
        after: {
          kind,
          filename: file.name,
          fileId,
          rowCount: result.rowCount,
          createdCount: result.createdCount,
          updatedCount: result.updatedCount,
          unchangedCount: result.unchangedCount,
          errorCount: result.errorCount,
        },
        reason,
      });
      const result = await apply(
        kind,
        file,
        actorId,
        reason,
        async (connection, result) => {
          await insertRun(connection, { ...base, status: 'succeeded', result });
          await deps.audit().record(audit('succeeded', result), connection);
        },
      );
      if (result.result === 'invalid')
        await database.transaction(async (connection) => {
          await insertRun(connection, { ...base, status: 'failed', result });
          await deps.audit().record(audit('failed', result), connection);
        });
      return (await this.getRun(id))!;
    },

    async listRuns({ kind, order = 'desc', page, pageSize }) {
      const repository = database.repository('importRuns');
      const filter = kind ? { filter: { kind } } : {};
      const [rows, total] = await Promise.all([
        repository.findMany({
          ...filter,
          sort: (sort) =>
            order === 'asc'
              ? [sort.field('createdAt').asc(), sort.field('id').asc()]
              : [sort.field('createdAt').desc(), sort.field('id').desc()],
          limit: pageSize,
          offset: (page - 1) * pageSize,
        }),
        repository.count(filter),
      ]);
      const items = await views(rows);
      return {
        // The list leaves the row errors to the detail.
        items: items.map(({ errors: _errors, ...run }) => run),
        total,
      };
    },

    async getRun(id) {
      const row = await database
        .repository('importRuns')
        .findOne({ filter: { id } });
      if (!row) return undefined;
      return (await views([row]))[0];
    },
  };
}
