import { translateTrialPayload } from '../trial-data-localization/transform.js';
import { createHash, randomUUID } from 'node:crypto';
import type {
  DatabaseManager,
  DatabaseConnection,
  RepositoryPolicy,
} from '@nocobase/db';
import type {
  ServerFileRepositoryManager,
  FileRecord,
} from '@nocobase/app-plugin-file/server';
import type { NocoBaseDriveManager } from '@nocobase/drive';
import type { UserAdministrationService } from '@nocobase/app-plugin-authentication';
import type { AuditService } from '../audit/index.js';
import type { CalendarService } from '../platform/calendar.js';
import type {
  PrintTemplate,
  PrintRevision,
  PrintSourceRegistry,
  PrintSourceName,
} from './contract.js';
import { TemplatePrintError, validateDocx } from './validation.js';
import { DOCX_MIME, renderValidatedDocx } from './renderer.js';
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fail(code: string): never {
  throw new TemplatePrintError(code);
}
interface Dependencies {
  db: DatabaseManager;
  files: ServerFileRepositoryManager;
  drive: NocoBaseDriveManager;
  audit: AuditService;
  calendar: CalendarService;
  sources: PrintSourceRegistry;
  trialTranslations?: () => Promise<readonly (readonly [string, string])[]>;
  users: Pick<UserAdministrationService, 'get'>;
}
interface Command {
  createdAt: Date | string;
  id: string;
  actorId: string;
  requestKey: string;
  bodyHash: string;
  receipt: Record<string, unknown> | null;
}
interface StoredFile extends FileRecord {
  templateId: string;
  ownerId: string;
  uploadKey: string;
}
export interface CommandInput {
  requestKey: string;
}
export function createTemplatePrintService(d: Dependencies) {
  async function publicTemplate(record: PrintTemplate, knownName?: string) {
    const user = knownName ? undefined : await d.users.get(record.createdById);
    return {
      ...record,
      createdBy: {
        id: record.createdById,
        name: knownName ?? user?.name ?? record.createdById,
      },
    };
  }
  const commandId = (actorId: string, key: string) => hash([actorId, key]);
  async function previous(actorId: string, requestKey: string, body: unknown) {
    const id = commandId(actorId, requestKey);
    let row = await d.db
      .repository<Command>('printTemplateCommands')
      .findOne({ filter: { id } });
    if (!row) {
      try {
        await d.db.repository<Command>('printTemplateCommands').createOne({
          values: {
            id,
            actorId,
            requestKey,
            bodyHash: hash(body),
            receipt: null,
            createdAt: new Date(),
          },
        });
      } catch (error) {
        row = await d.db
          .repository<Command>('printTemplateCommands')
          .findOne({ filter: { id } });
        if (!row) throw error;
      }
      row ??= await d.db
        .repository<Command>('printTemplateCommands')
        .findOne({ filter: { id } });
    }
    if (!row || row.bodyHash !== hash(body)) fail('PRINT_COMMAND_CONFLICT');
    return row.receipt;
  }
  async function lockCommand(
    tx: DatabaseConnection,
    actorId: string,
    requestKey: string,
    body: unknown,
  ) {
    const id = commandId(actorId, requestKey);
    // A portable write acquires this immutable command's row lock before any template mutation.
    await tx.query
      .updateTable('printTemplateCommands')
      .set({ bodyHash: hash(body) })
      .where('id', '=', id)
      .where('bodyHash', '=', hash(body))
      .execute();
    const command = await tx
      .repository<Command>('printTemplateCommands')
      .findOne({ filter: { id } });
    if (!command || command.bodyHash !== hash(body))
      fail('PRINT_COMMAND_CONFLICT');
    return command.receipt;
  }
  async function receipt(
    tx: DatabaseConnection,
    actorId: string,
    requestKey: string,
    body: unknown,
    result: Record<string, unknown>,
  ) {
    await tx.repository<Command>('printTemplateCommands').updateOne({
      filter: { id: commandId(actorId, requestKey), bodyHash: hash(body) },
      values: { receipt: result },
    });
  }
  async function template(id: string, policy: RepositoryPolicy) {
    const row = await d.db
      .repository<PrintTemplate>('printTemplates')
      .withPolicy(policy)
      .findOne({ filter: { id } });
    if (
      !row ||
      !['name', 'source', 'active', 'currentRevisionId', 'version'].every(
        (k) => k in row,
      )
    )
      fail('PRINT_TEMPLATE_DENIED');
    return row as PrintTemplate;
  }
  async function bytes(file: StoredFile) {
    if (
      !Number.isSafeInteger(Number(file.size)) ||
      Number(file.size) <= 0 ||
      Number(file.size) > 5 * 1024 * 1024
    )
      fail('PRINT_TEMPLATE_INVALID');
    const stream = await d.drive.use(file.disk).getStream(file.key);
    const chunks: Buffer[] = [];
    let length = 0;
    try {
      for await (const chunk of stream) {
        const b = Buffer.from(chunk as Uint8Array);
        length += b.length;
        if (length > 5 * 1024 * 1024) fail('PRINT_TEMPLATE_INVALID');
        chunks.push(b);
      }
    } finally {
      stream.destroy();
    }
    if (length !== Number(file.size)) fail('PRINT_TEMPLATE_INVALID');
    return Buffer.concat(chunks);
  }
  async function cleanup(file: StoredFile) {
    // Only an uncommitted upload belonging to this exact command is eligible; never delete historic revisions.
    if (
      await d.db
        .repository<PrintRevision>('printTemplateRevisions')
        .exists({ filter: { fileId: file.id } })
    )
      return;
    await d.drive.use(file.disk).delete(file.key);
    await d.db
      .repository('printTemplateFiles')
      .deleteOne({ filter: { id: file.id, uploadKey: file.uploadKey } });
  }
  return {
    async revisionSnapshot(
      id: string,
      revisionId: string,
      policy: RepositoryPolicy,
      tx: DatabaseConnection,
      revisionPolicy: RepositoryPolicy,
    ) {
      const record = await tx
        .repository<PrintTemplate>('printTemplates')
        .withPolicy(policy)
        .findOne({ filter: { id } });
      if (
        !record ||
        ['id', 'active', 'source'].some((field) => !(field in record))
      )
        fail('PRINT_TEMPLATE_DENIED');
      if (!record.active) fail('PRINT_TEMPLATE_DENIED');
      const revision = await tx
        .repository<PrintRevision>('printTemplateRevisions')
        .withPolicy(revisionPolicy)
        .findOne({ filter: { id: revisionId, templateId: id } });
      if (
        !revision ||
        ['id', 'templateId', 'contentHash', 'schemaVersion'].some(
          (field) => !(field in revision),
        )
      )
        fail('PRINT_TEMPLATE_DENIED');
      return {
        templateId: id,
        source: record.source,
        active: record.active,
        revisionId: revision.id,
        contentHash: revision.contentHash,
        schemaVersion: revision.schemaVersion,
      };
    },
    async list(
      policy: RepositoryPolicy,
      page: number,
      pageSize: number,
      source?: PrintSourceName,
    ) {
      const repo = d.db
        .repository<PrintTemplate>('printTemplates')
        .withPolicy(policy);
      const filter = source ? { source } : undefined;
      const rows = await repo.findMany({
        ...(filter ? { filter } : {}),
        offset: (page - 1) * pageSize,
        limit: pageSize,
        sort: (s) => [s.field('updatedAt').desc(), s.field('id').asc()],
      });
      return {
        data: await Promise.all(
          rows.map((row) => publicTemplate(row as PrintTemplate)),
        ),
        meta: {
          total: await repo.count(filter ? { filter } : {}),
          page,
          pageSize,
        },
      };
    },
    async detail(id: string, policy: RepositoryPolicy) {
      const record = await template(id, policy);
      const revisions = await d.db
        .repository<PrintRevision>('printTemplateRevisions')
        .findMany({
          filter: { templateId: id },
          sort: (s) => [s.field('number').desc()],
          limit: 100,
        });
      return {
        record: await publicTemplate(record),
        revisions: await Promise.all(
          revisions.map(async ({ fileId: _fileId, ...revision }) => ({
            ...revision,
            createdBy: {
              id: revision.createdById,
              name:
                (await d.users.get(revision.createdById))?.name ??
                revision.createdById,
            },
          })),
        ),
        sourceReady: !!d.sources.get(record.source),
      };
    },
    async create(
      actorId: string,
      input: CommandInput & { name: string; source: PrintSourceName },
      policy: RepositoryPolicy,
    ) {
      const body = { action: 'create', name: input.name, source: input.source };
      const creatorName = (await d.users.get(actorId))?.name ?? actorId;
      const old = await previous(actorId, input.requestKey, body);
      if (old) return old;
      return d.db.transaction(async (tx) => {
        const replay = await lockCommand(tx, actorId, input.requestKey, body);
        if (replay) return replay;
        const record = (
          await tx
            .repository<PrintTemplate>('printTemplates')
            .withPolicy(policy)
            .createOne({
              values: {
                id: randomUUID(),
                name: input.name,
                source: input.source,
                active: true,
                currentRevisionId: null,
                version: 1,
                createdById: actorId,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            })
        ).record;
        await d.audit.record(
          {
            actorId,
            action: 'printTemplate.create',
            targetType: 'printTemplates',
            targetId: record.id,
            after: { name: record.name, source: record.source },
          },
          tx,
        );
        const result = {
          record: await publicTemplate(record as PrintTemplate, creatorName),
        };
        await receipt(tx, actorId, input.requestKey, body, result);
        return result;
      });
    },
    async update(
      id: string,
      actorId: string,
      input: CommandInput & { version: number; name: string; active: boolean },
      policy: RepositoryPolicy,
    ) {
      const initial = await template(id, policy);
      const creatorName =
        (await d.users.get(initial.createdById))?.name ?? initial.createdById;
      const body = {
        action: 'update',
        id,
        version: input.version,
        name: input.name,
        active: input.active,
      };
      const old = await previous(actorId, input.requestKey, body);
      if (old) return old;
      return d.db.transaction(async (tx) => {
        const replay = await lockCommand(tx, actorId, input.requestKey, body);
        if (replay) return replay;
        const existing = await tx
          .repository<PrintTemplate>('printTemplates')
          .withPolicy(policy)
          .findOne({ filter: { id, version: input.version } });
        if (!existing) fail('PRINT_VERSION_CONFLICT');
        const record = (
          await tx
            .repository<PrintTemplate>('printTemplates')
            .withPolicy(policy)
            .updateOne({
              filter: { id, version: input.version },
              values: {
                name: input.name,
                active: input.active,
                version: input.version + 1,
                updatedAt: new Date(),
              },
            })
        ).record;
        await d.audit.record(
          {
            actorId,
            action: 'printTemplate.update',
            targetType: 'printTemplates',
            targetId: id,
            before: { name: existing.name, active: existing.active },
            after: { name: record.name, active: record.active },
          },
          tx,
        );
        const result = {
          record: await publicTemplate(record as PrintTemplate, creatorName),
        };
        await receipt(tx, actorId, input.requestKey, body, result);
        return result;
      });
    },
    async upload(
      id: string,
      actorId: string,
      input: CommandInput & { version: number; file: File },
      policy: RepositoryPolicy,
    ) {
      const record = await template(id, policy);
      const creatorName =
        (await d.users.get(record.createdById))?.name ?? record.createdById;
      const uploaderName = (await d.users.get(actorId))?.name ?? actorId;
      if (
        !/\.docx$/i.test(input.file.name) ||
        ![DOCX_MIME, 'application/octet-stream', ''].includes(input.file.type)
      )
        fail('PRINT_TEMPLATE_INVALID');
      if (input.file.size > 5 * 1024 * 1024 || !input.file.size)
        fail('PRINT_TEMPLATE_INVALID');
      const content = new Uint8Array(await input.file.arrayBuffer());
      const source = d.sources.get(record.source);
      if (!source) fail('PRINT_SOURCE_UNAVAILABLE');
      const checked = validateDocx(content, Object.keys(source.fields));
      const body = {
        action: 'upload',
        id,
        version: input.version,
        contentHash: checked.hash,
        filename: input.file.name,
      };
      const old = await previous(actorId, input.requestKey, body);
      if (old) return old;
      if (record.version !== input.version) fail('PRINT_VERSION_CONFLICT');
      const uploadKey = hash([actorId, input.requestKey, hash(body)]);
      let file = await d.db
        .repository<StoredFile>('printTemplateFiles')
        .findOne({ filter: { uploadKey } });
      if (!file) {
        const uploaded = await d.files
          .repository('printTemplateFiles', {
            disk: 'local',
            accessPath: '/private/printTemplates',
            policy: {
              read: true,
              create: {
                scope: { templateId: id, ownerId: actorId, uploadKey },
                defaults: { templateId: id, ownerId: actorId, uploadKey },
              },
              update: false,
              delete: false,
            },
          })
          .uploadOne({ file: input.file });
        file = await d.db.repository<StoredFile>('printTemplateFiles').findOne({
          filter: {
            id: uploaded.record.id,
            templateId: id,
            ownerId: actorId,
            uploadKey,
          },
        });
      }
      if (!file) fail('PRINT_UPLOAD_FAILED');
      const uploadedFile = file;
      try {
        const stored = await bytes(uploadedFile);
        if (createHash('sha256').update(stored).digest('hex') !== checked.hash)
          fail('PRINT_UPLOAD_FAILED');
        return await d.db.transaction(async (tx) => {
          const replay = await lockCommand(tx, actorId, input.requestKey, body);
          if (replay) return replay;
          const existing = await tx
            .repository<PrintTemplate>('printTemplates')
            .withPolicy(policy)
            .findOne({ filter: { id, version: input.version } });
          if (!existing) fail('PRINT_VERSION_CONFLICT');
          const revision: PrintRevision = {
            id: randomUUID(),
            templateId: id,
            number: input.version,
            fileId: uploadedFile.id,
            contentHash: checked.hash,
            paths: checked.paths,
            schemaVersion: source.schemaVersion,
            createdById: actorId,
            createdAt: new Date(),
          };
          await tx
            .repository<PrintRevision>('printTemplateRevisions')
            .createOne({ values: revision });
          const next = (
            await tx
              .repository<PrintTemplate>('printTemplates')
              .withPolicy(policy)
              .updateOne({
                filter: { id, version: input.version },
                values: {
                  currentRevisionId: revision.id,
                  version: input.version + 1,
                  updatedAt: new Date(),
                },
              })
          ).record;
          await d.audit.record(
            {
              actorId,
              action: 'printTemplate.revise',
              targetType: 'printTemplates',
              targetId: id,
              before: { revisionId: existing.currentRevisionId },
              after: { revisionId: revision.id, contentHash: checked.hash },
            },
            tx,
          );
          const { fileId: _fileId, ...publicRevision } = revision;
          const result = {
            record: await publicTemplate(next as PrintTemplate, creatorName),
            revision: {
              ...publicRevision,
              createdBy: {
                id: actorId,
                name: uploaderName,
              },
            },
          };
          await receipt(tx, actorId, input.requestKey, body, result);
          return result;
        });
      } catch (error) {
        await cleanup(uploadedFile).catch(() => {});
        throw error;
      }
    },
    async download(id: string, revisionId: string, policy: RepositoryPolicy) {
      await template(id, policy);
      const revision = await d.db
        .repository<PrintRevision>('printTemplateRevisions')
        .findOne({ filter: { id: revisionId, templateId: id } });
      if (!revision) fail('PRINT_TEMPLATE_DENIED');
      const file = await d.db
        .repository<StoredFile>('printTemplateFiles')
        .findOne({ filter: { id: revision.fileId, templateId: id } });
      if (!file) fail('PRINT_TEMPLATE_INVALID');
      const result = await bytes(file);
      if (
        createHash('sha256').update(result).digest('hex') !==
        revision.contentHash
      )
        fail('PRINT_TEMPLATE_INVALID');
      return { bytes: result, filename: file.filename };
    },
    async render(
      id: string,
      actorId: string,
      input: {
        recordId: string;
        revisionId?: string;
        locale: 'zh-CN' | 'en-US';
        signal?: AbortSignal;
      },
      policy: RepositoryPolicy,
      sourcePolicy: RepositoryPolicy,
    ) {
      const record = await template(id, policy);
      if (!record.active) fail('PRINT_TEMPLATE_DENIED');
      const source = d.sources.get(record.source);
      if (!source) fail('PRINT_SOURCE_UNAVAILABLE');
      const revision = await d.db
        .repository<PrintRevision>('printTemplateRevisions')
        .findOne({
          filter: {
            id: input.revisionId ?? record.currentRevisionId ?? '',
            templateId: id,
          },
        });
      if (!revision || revision.schemaVersion !== source.schemaVersion)
        fail('PRINT_TEMPLATE_INVALID');
      const download = await this.download(id, revision.id, policy);
      const checked = validateDocx(download.bytes, Object.keys(source.fields));
      if (checked.hash !== revision.contentHash) fail('PRINT_TEMPLATE_INVALID');
      const started = Date.now();
      const timeZone = d.calendar.timeZone();
      try {
        const data = await source.load({
          recordId: input.recordId,
          actorId,
          policy: sourcePolicy,
          paths: checked.paths,
          locale: input.locale,
          timeZone,
        });
        const output = await renderValidatedDocx({
          template: download.bytes,
          data:
            input.locale === 'en-US' && d.trialTranslations
              ? translateTrialPayload(
                  data,
                  new Map(await d.trialTranslations()),
                )
              : data,
          locale: input.locale,
          timeZone,
          signal: input.signal,
        });
        await d.audit.record({
          actorId,
          action: 'printTemplate.render',
          targetType: source.collection,
          targetId: input.recordId,
          after: {
            templateId: id,
            revisionId: revision.id,
            contentHash: revision.contentHash,
            result: 'success',
            durationMs: Date.now() - started,
          },
        });
        return { ...output, filename: `${record.name}.docx` };
      } catch (error) {
        await d.audit.record({
          actorId,
          action: 'printTemplate.render',
          targetType: source.collection,
          targetId: input.recordId,
          after: {
            templateId: id,
            revisionId: revision.id,
            result: 'failed',
            durationMs: Date.now() - started,
          },
        });
        throw error;
      }
    },
  };
}
export type TemplatePrintService = ReturnType<
  typeof createTemplatePrintService
>;
