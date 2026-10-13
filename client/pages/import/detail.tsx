import { UserName } from '#components/user-name';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { type ReactElement, type ReactNode, useMemo } from 'react';
import { useParams } from 'react-router';

import { RecordDetailDrawer } from '#components/record-detail-drawer';
import { Badge } from '#components/ui/badge';
import { Button } from '#components/ui/button';
import { Skeleton } from '#components/ui/skeleton';
import { useRouteOverlay } from '#components/use-route-overlay';

import { ProblemTable } from './problems.js';
import { LoadErrorAlert } from './states.js';
import type { ImportRunDetail } from './types.js';
import { useResource } from './use-resource.js';

function CloseButton(): ReactElement {
  const { t } = useTranslation();
  const { close, isClosing } = useRouteOverlay();
  return (
    <Button
      type='button'
      variant='outline'
      disabled={isClosing}
      onClick={() => void close()}
    >
      {t('actions.close')}
    </Button>
  );
}

/** `:runId`: one import attempt — what was imported, by whom, the counts, the file, and the problems of a failure. */
export default function ImportRunDrawer(): ReactElement {
  const { runId = '' } = useParams();
  const { t } = useTranslation();
  const { locale } = useLocale();
  const run = useResource<ImportRunDetail>(
    `imports/${encodeURIComponent(runId)}`,
  );
  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'medium',
      }),
    [locale],
  );
  const numberFormat = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const entry = run.data;

  let body: ReactElement;
  if (run.error) {
    body = (
      <LoadErrorAlert
        error={run.error}
        notFoundMessage={t('import.detail.notFound')}
        onRetry={run.reload}
      />
    );
  } else if (!entry) {
    body = (
      <div
        role='status'
        aria-label={t('status.loading')}
        className='grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] sm:grid-cols-[8rem_minmax(0,1fr)] gap-3'
      >
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className='contents'>
            <Skeleton className='h-4 w-20' />
            <Skeleton className='h-4 w-40' />
          </div>
        ))}
      </div>
    );
  } else {
    const details: [string, ReactNode][] = [
      [
        t('import.fields.kind'),
        <Badge key='kind' variant='outline'>
          {t(`import.kinds.${entry.kind}`)}
        </Badge>,
      ] as const,
      [
        t('import.fields.status'),
        <Badge
          key='status'
          variant={entry.status === 'succeeded' ? 'secondary' : 'destructive'}
        >
          {t(`import.status.${entry.status}`)}
        </Badge>,
      ] as const,
      [
        t('import.fields.file'),
        entry.file ? (
          <a
            key='file'
            href={entry.file.contentUrl}
            download={entry.filename}
            className='underline-offset-4 hover:underline'
          >
            {entry.filename}
          </a>
        ) : (
          entry.filename
        ),
      ] as const,
      [
        t('import.fields.actor'),
        <UserName
          key={t('import.fields.actor')}
          name={entry.actor?.name ?? '—'}
        />,
      ] as const,
      [
        t('import.fields.createdAt'),
        dateFormat.format(new Date(entry.createdAt)),
      ],
      [
        t('import.fields.finishedAt'),
        dateFormat.format(new Date(entry.finishedAt)),
      ],
      [t('import.fields.rowCount'), numberFormat.format(entry.rowCount)],
      [
        t('import.fields.createdCount'),
        numberFormat.format(entry.createdCount),
      ],
      [
        t('import.fields.updatedCount'),
        numberFormat.format(entry.updatedCount),
      ],
      [
        t('import.fields.unchangedCount'),
        numberFormat.format(entry.unchangedCount),
      ],
      [t('import.fields.errorCount'), numberFormat.format(entry.errorCount)],
    ];
    body = (
      <div className='flex flex-col gap-6'>
        <dl className='grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] sm:grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm'>
          {details.map(([label, value]) => (
            <div key={label} className='contents'>
              <dt className='text-muted-foreground'>{label}</dt>
              <dd className='min-w-0 wrap-anywhere'>{value}</dd>
            </div>
          ))}
        </dl>
        {entry.errors.length ? (
          <section className='flex flex-col gap-3'>
            <h3 className='text-base font-medium'>
              {t('import.detail.problems')}
            </h3>
            <ProblemTable errors={entry.errors} total={entry.errorCount} />
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <RecordDetailDrawer
      title={
        entry
          ? t('import.detail.title', { name: entry.filename })
          : t('import.detail.titleLoading')
      }
      className='sm:max-w-2xl'
      footer={<CloseButton />}
    >
      {body}
    </RecordDetailDrawer>
  );
}
