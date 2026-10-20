import { createHash } from 'node:crypto';
import type { Application } from '@nocobase/app-server/application';
import { databaseManagerToken, type DatabaseManager } from '@nocobase/db';
import {
  createServiceToken,
  ServiceProvider,
} from '@nocobase/service-provider';
import { trialTranslationEntries } from '../../locales/trial-data/catalog.js';
import { auditServiceToken } from '../audit/index.js';

export interface TrialContentLocalization {
  pairs(): Promise<readonly (readonly [string, string])[]>;
  /** Adds missing translations only. It never rewrites business records or existing translations. */
  initialize(actorId: string | null): Promise<number>;
}
export const trialContentLocalizationToken =
  createServiceToken<TrialContentLocalization>('oa.trialContentLocalization');

export default class TrialContentLocalizationProvider extends ServiceProvider<Application> {
  override name = 'oa/trial-content-localization';
  override register(): void {
    const container = this.app.container;
    container.singleton(trialContentLocalizationToken, () => {
      const db: DatabaseManager = container.resolve(databaseManagerToken);
      return {
        async pairs() {
          const rows = await db
            .repository<{
              dataset: string;
              sourceText: string;
              englishText: string;
            }>('trialContentTranslations')
            .findMany({ filter: { dataset: 'oa-trial-v1' } });
          return rows.map((row) => [row.sourceText, row.englishText] as const);
        },
        async initialize(actorId) {
          return db.transaction(async (tx) => {
            let added = 0;
            for (const [sourceText, englishText] of trialTranslationEntries()) {
              const id = createHash('sha256')
                .update(`oa-trial-v1:${sourceText}`)
                .digest('hex');
              if (
                await tx
                  .repository('trialContentTranslations')
                  .exists({ filter: { id } })
              )
                continue;
              await tx.repository('trialContentTranslations').createOne({
                values: {
                  id,
                  dataset: 'oa-trial-v1',
                  sourceText,
                  englishText,
                  createdAt: new Date(),
                },
              });
              added++;
            }
            if (added)
              await container.resolve(auditServiceToken).record(
                {
                  actorId,
                  action: 'trialContentTranslations.initialize',
                  targetType: 'trialContentTranslations',
                  after: { added },
                  reason:
                    'Initialize reviewed bilingual fictional trial content',
                },
                tx,
              );
            return added;
          });
        },
      } satisfies TrialContentLocalization;
    });
  }
}
