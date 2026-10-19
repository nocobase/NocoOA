import { AppCommand, CommandError } from '@nocobase/app-cli';
import { Flags } from '@oclif/core';

export default class TrialData extends AppCommand {
  static override summary =
    'Create repeatable OA trial accounts, resources and actionable workflows.';
  static override examples = [
    '<%= config.bin %> <%= command.id %> --dry-run --json',
    '<%= config.bin %> <%= command.id %> --json',
  ];
  static override flags = {
    locale: Flags.string({
      options: ['en-US', 'zh-CN'],
      default: 'en-US',
      description:
        'Language of trial coverage metadata; stored business records retain their source text.',
    }),
    'headcounts-only': Flags.boolean({
      default: false,
      description:
        'Supplement headcount accounts only; requires existing trial identities and preserves workflows, limits and passwords.',
    }),
    'reset-passwords': Flags.boolean({
      default: false,
      description:
        'Reset only trial accounts to full lowercase name pinyin plus 123456; revokes their existing sessions.',
    }),
    'replace-legacy-trial-duties': Flags.boolean({
      default: false,
      description:
        'Move business duties and fixed committee seats from oa.testNNN@example.test sample accounts to trial accounts; preserves accounts and documents.',
    }),
    'dry-run': Flags.boolean({
      default: false,
      description:
        'Show trial coverage without starting the application or writing data.',
    }),
  };

  async run(): Promise<unknown> {
    const { flags } = await this.parse(TrialData);
    const { trialPlan, generateTrialData } =
      await import('./lib/trial-data/index.js');
    if (
      flags['headcounts-only'] &&
      (flags['reset-passwords'] || flags['replace-legacy-trial-duties'])
    )
      throw new CommandError(
        'Headcounts-only cannot reset passwords or replace duties.',
        { code: 'INVALID_TRIAL_OPTIONS' },
      );
    if (flags['dry-run']) {
      this.setStatus('success-noop');
      this.log('Preview only: no accounts or business data were changed.');
      if (flags['headcounts-only'])
        return (await import('./lib/trial-data/headcounts.js'))
          .headcountSamplePlan;
      const { trialTranslationEntries } =
        await import('../../server/locales/trial-data/catalog.js');
      const { translateTrialMetadata } =
        await import('../../server/providers/trial-data-localization/transform.js');
      return flags.locale === 'zh-CN'
        ? trialPlan
        : translateTrialMetadata(trialPlan, new Map(trialTranslationEntries()));
    }
    const result = await this.withApp(async ({ app }) => {
      await app.start();
      return generateTrialData(app, (message) => this.logToStderr(message), {
        replaceLegacyTrialDuties: flags['replace-legacy-trial-duties'],
        resetPasswords: flags['reset-passwords'],
        headcountsOnly: flags['headcounts-only'],
      });
    });
    const { trialTranslationEntries } =
      await import('../../server/locales/trial-data/catalog.js');
    const { translateTrialMetadata } =
      await import('../../server/providers/trial-data-localization/transform.js');
    const localizedResult =
      flags.locale === 'zh-CN'
        ? result
        : translateTrialMetadata(result, new Map(trialTranslationEntries()));
    if (result.failures.length) {
      throw new CommandError(
        'Trial data is incomplete; successful records are preserved. Rerun after fixing the listed failures.',
        {
          code: 'TRIAL_DATA_INCOMPLETE',
          details: localizedResult,
        },
      );
    }
    this.log(`Trial data ready. Account access file: ${result.accessFile}`);
    return localizedResult;
  }
}
