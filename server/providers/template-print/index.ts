import { trialContentLocalizationToken } from '../trial-data-localization/index.js';
import { contractServiceToken } from '../contracts/contract.js';
import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
import type { Application } from '@nocobase/app-server/application';
import { ServiceProvider } from '@nocobase/service-provider';
import { databaseManagerToken } from '@nocobase/db';
import { serverFileRepositoryManagerToken } from '@nocobase/app-plugin-file/server';
import { driveManagerToken } from '@nocobase/app-server/drive';
import { i18nToken } from '@nocobase/app-server/i18n';
import {
  authorizationToken,
  defineDatabasePermission,
} from '@nocobase/app-plugin-authorization/server';
import { defineCompositeResource } from '@nocobase/authorization/core';
import { auditServiceToken } from '../audit/index.js';
import { calendarServiceToken } from '../platform/index.js';
import { leaveServiceToken } from '../leave/index.js';
import { reimbursementServiceToken } from '../reimbursement/index.js';
import { paymentRequestServiceToken } from '../payment-requests/contract.js';
import {
  createPrintSourceRegistry,
  printSourceRegistryToken,
  templatePrintServiceToken,
  PRINT_SOURCES,
} from './contract.js';
import { createPublicDetailSource } from './sources.js';
import { createTemplatePrintService } from './service.js';
import {
  SEAL_PRINT_RECEIPT_FIELDS,
  SEAL_PRINT_REQUEST_FIELDS,
} from '../seals/contract.js';
export * from './contract.js';
const read = defineDatabasePermission((p) =>
  p.collection('printTemplates').read('*'),
);
const revisionMetadata = defineDatabasePermission((p) =>
  p
    .collection('printTemplateRevisions')
    .read((r) => r.fields('id', 'templateId', 'contentHash', 'schemaVersion')),
);
export const templatePrintResource = defineCompositeResource(
  'oa.templatePrint',
  (r) => {
    let resource = r
      .title({ key: 'templatePrint.authz.resource', ns: 'nb3-oa' })
      .action('manage', (a) =>
        a
          .title({ key: 'templatePrint.authz.manage', ns: 'nb3-oa' })
          .grant('printTemplates', read.create('*').update('*')),
      )
      .action('use', (a) =>
        a
          .title({ key: 'templatePrint.authz.use', ns: 'nb3-oa' })
          .grant('printTemplates', read)
          .grant('printTemplateRevisions', revisionMetadata),
      );
    for (const source of PRINT_SOURCES) {
      const collection =
        source === 'leave'
          ? 'leaveRequests'
          : source === 'reimbursement'
            ? 'reimbursementRequests'
            : source === 'payment'
              ? 'paymentRequests'
              : source === 'contracts'
                ? 'contractRequests'
                : source === 'certificates'
                  ? 'certificateRequests'
                  : source === 'sealRegistration'
                    ? 'sealLedger'
                    : undefined;
      resource = resource.action(
        `print${source[0].toUpperCase()}${source.slice(1)}`,
        (a) => {
          const action = a
            .title({ key: `templatePrint.authz.${source}`, ns: 'nb3-oa' })
            .grant('printTemplates', read)
            .grant('printTemplateRevisions', revisionMetadata);
          if (source === 'sealRegistration')
            return action
              .grant(
                'sealLedger',
                defineDatabasePermission((p) =>
                  p.collection('sealLedger').read('*'),
                ),
              )
              .grant(
                'sealReceipts',
                defineDatabasePermission((p) =>
                  p
                    .collection('sealReceipts')
                    .read((r) => r.fields(...SEAL_PRINT_RECEIPT_FIELDS)),
                ),
              )
              .grant(
                'sealRequests',
                defineDatabasePermission((p) =>
                  p
                    .collection('sealRequests')
                    .read((r) => r.fields(...SEAL_PRINT_REQUEST_FIELDS)),
                ),
              );
          return collection
            ? action.grant(
                collection,
                defineDatabasePermission((p) =>
                  p.collection(collection).read('*'),
                ),
              )
            : action;
        },
      );
    }
    return resource;
  },
);
export default class TemplatePrintProvider extends ServiceProvider<Application> {
  readonly name = 'oa/template-print-provider';
  private offUploads?: () => void;
  override register() {
    const c = this.app.container;
    c.singleton(printSourceRegistryToken, () => {
      const registry = createPrintSourceRegistry(),
        db = c.resolve(databaseManagerToken),
        i18n = c.resolve(i18nToken);
      registry.add(
        createPublicDetailSource({
          name: 'contracts',
          collection: 'contractRequests',
          viewResource: 'oa.contract',
          db,
          i18n,
          users: c.resolve(userAdministrationServiceToken),
          detail: (id, actor, policy) =>
            c.resolve(contractServiceToken).printDetail(id, actor, policy),
        }),
      );
      registry.add(
        createPublicDetailSource({
          name: 'leave',
          collection: 'leaveRequests',
          viewResource: 'oa.leave',
          db,
          i18n,
          users: c.resolve(userAdministrationServiceToken),
          detail: (id, actor, policy) =>
            c.resolve(leaveServiceToken).detail(id, actor, policy),
        }),
      );
      registry.add(
        createPublicDetailSource({
          name: 'reimbursement',
          collection: 'reimbursementRequests',
          viewResource: 'oa.reimbursement',
          db,
          i18n,
          users: c.resolve(userAdministrationServiceToken),
          detail: (id, actor, policy) =>
            c.resolve(reimbursementServiceToken).detail(id, actor, policy),
        }),
      );
      registry.add(
        createPublicDetailSource({
          name: 'payment',
          collection: 'paymentRequests',
          viewResource: 'oa.payment',
          db,
          i18n,
          users: c.resolve(userAdministrationServiceToken),
          detail: (id, actor, policy) =>
            c.resolve(paymentRequestServiceToken).detail(id, actor, policy),
        }),
      );
      return registry;
    });
    c.singleton(templatePrintServiceToken, () =>
      createTemplatePrintService({
        db: c.resolve(databaseManagerToken),
        files: c.resolve(serverFileRepositoryManagerToken),
        drive: c.resolve(driveManagerToken),
        audit: c.resolve(auditServiceToken),
        calendar: c.resolve(calendarServiceToken),
        sources: c.resolve(printSourceRegistryToken),
        trialTranslations: () =>
          c.resolve(trialContentLocalizationToken).pairs(),
        users: c.resolve(userAdministrationServiceToken),
      }),
    );
  }
  override async boot() {
    const authz = this.app.container.resolve(authorizationToken);
    authz.database.collections.add({
      name: 'printTemplates',
      title: { key: 'templatePrint.authz.resource', ns: 'nb3-oa' },
    });
    authz.database.collections.add({
      name: 'printTemplateRevisions',
      title: { key: 'templatePrint.authz.resource', ns: 'nb3-oa' },
    });
    authz.compositeResources.define(templatePrintResource);
  }
  override async start() {
    const db = this.app.container.resolve(databaseManagerToken),
      audit = this.app.container.resolve(auditServiceToken);
    this.offUploads = db.connection().onRepositoryMutation(
      {
        id: 'oa/template-print-upload-audit',
        collections: ['printTemplateFiles'],
      },
      {
        inTransaction: async (event, tx) => {
          if (event.granularity !== 'rows') return;
          for (const change of event.changes) {
            if (
              change.collection !== 'printTemplateFiles' ||
              change.kind !== 'created'
            )
              continue;
            const file = await tx
              .repository<{
                id: string;
                templateId: string;
                ownerId: string;
                uploadKey: string;
                filename: string;
                size: string | number;
              }>('printTemplateFiles')
              .findOne({ filter: { id: String(change.key.id) } });
            if (!file)
              throw new Error('Uploaded print template metadata is missing.');
            await audit.record(
              {
                actorId: file.ownerId,
                action: 'printTemplate.upload',
                targetType: 'printTemplateFiles',
                targetId: file.id,
                after: {
                  templateId: file.templateId,
                  uploadKey: file.uploadKey,
                  filename: file.filename,
                  size: file.size,
                },
              },
              tx,
            );
          }
        },
      },
    );
  }
  override async shutdown() {
    this.offUploads?.();
    this.offUploads = undefined;
  }
}
