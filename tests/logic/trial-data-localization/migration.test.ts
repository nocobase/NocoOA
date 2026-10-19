// @vitest-environment node
import path from 'node:path';
import { describeMigration } from '@nocobase/app-testing/server';

describeMigration('202610190001_create_trial_content_translations', {
  sources: [
    {
      packageName: 'oa-trial-translations-test',
      directory: path.resolve(
        import.meta.dirname,
        '../../../database/main/migrations',
      ),
    },
  ],
  async up({ expectCollection }) {
    await expectCollection('trialContentTranslations').toExist();
    for (const field of [
      'id',
      'dataset',
      'sourceText',
      'englishText',
      'createdAt',
    ]) {
      await expectCollection('trialContentTranslations').toHaveField(field, {
        nullable: false,
      });
    }
  },
  async down({ expectCollection }) {
    await expectCollection('trialContentTranslations').not.toExist();
  },
});
