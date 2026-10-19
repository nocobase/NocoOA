import { AppCommand } from '@nocobase/app-cli';
import { Flags } from '@oclif/core';

/** Review and install only the fictional content catalogue, without regenerating any workflow. */
export default class TrialTranslations extends AppCommand {
  static override summary =
    'Add missing bilingual trial content without changing business records or passwords.';
  static override flags = {
    'dry-run': Flags.boolean({
      default: false,
      description: 'Show translation counts without starting the application.',
    }),
  };
  async run(): Promise<unknown> {
    const { flags } = await this.parse(TrialTranslations);
    const { trialTranslationEntries } =
      await import('../../server/locales/trial-data/catalog.js');
    if (flags['dry-run']) {
      this.setStatus('success-noop');
      return {
        dataset: 'oa-trial-v1',
        locales: ['zh-CN', 'en-US'],
        translations: trialTranslationEntries().length,
      };
    }
    const { trialContentLocalizationToken } =
      await import('../../server/providers/trial-data-localization/index.js');
    return this.withApp(async ({ app }) => {
      await app.start();
      // A local administrative command, with an auditable system actor rather than an invented business user.
      const added = await app.container
        .resolve(trialContentLocalizationToken)
        .initialize(null);
      return { dataset: 'oa-trial-v1', added };
    });
  }
}
