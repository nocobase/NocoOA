import { defineMigration } from '@nocobase/db';

/** Optional demo translations; no business records or public data resource are created by this migration. */
export default defineMigration({
  name: '202610190001_create_trial_content_translations',
  async up({ builder }) {
    await builder.createCollection('trialContentTranslations', (table) => {
      table.string('id', { length: 64, nullable: false });
      table.primary('id');
      table.string('dataset', { length: 64, nullable: false });
      table.text('sourceText', { nullable: false });
      table.text('englishText', { nullable: false });
      table.datetime('createdAt', { nullable: false });
      table.index('dataset');
    });
  },
  async down({ builder }) {
    await builder.dropCollection('trialContentTranslations');
  },
});
