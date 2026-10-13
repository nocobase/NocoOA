import { ResponsiveTable as Table } from '#components/responsive-table';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { type ReactElement, useMemo } from 'react';
import { useParams } from 'react-router';

import { RecordDetailDrawer } from '#components/record-detail-drawer';
import { Badge } from '#components/ui/badge';
import { Skeleton } from '#components/ui/skeleton';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';

import { OverlayCloseButton } from '../shared/overlay-buttons.js';
import { LoadErrorAlert } from '../shared/states.js';
import type { AuditLog } from '../shared/types.js';
import { useResource } from '../shared/use-resource.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function show(value: unknown): string {
  if (value === undefined) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

interface DiffRow {
  readonly field: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly changed: boolean;
}

/** Field by field when both snapshots are objects (or one is absent); otherwise one row for the whole value. */
function diffOf(before: unknown, after: unknown): DiffRow[] {
  const beforeObject = before === null || before === undefined ? {} : before;
  const afterObject = after === null || after === undefined ? {} : after;
  if (!isRecord(beforeObject) || !isRecord(afterObject))
    return [
      {
        field: '',
        before,
        after,
        changed: JSON.stringify(before) !== JSON.stringify(after),
      },
    ];
  const fields = [
    ...new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)]),
  ];
  return fields.map((field) => ({
    field,
    before: beforeObject[field],
    after: afterObject[field],
    changed:
      JSON.stringify(beforeObject[field]) !==
      JSON.stringify(afterObject[field]),
  }));
}

/** `:auditLogId`: one entry, with what changed field by field. */
export default function AuditLogDetail(): ReactElement {
  const { auditLogId = '' } = useParams();
  const { t } = useTranslation();
  const { locale } = useLocale();
  const log = useResource<AuditLog>(
    `auditLogs/${encodeURIComponent(auditLogId)}`,
  );
  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'medium',
      }),
    [locale],
  );
  const entry = log.data;

  let body: ReactElement;
  if (log.error) {
    body = (
      <LoadErrorAlert
        error={log.error}
        notFoundMessage={t('platform.auditLogs.notFound')}
        onRetry={log.reload}
      />
    );
  } else if (!entry) {
    body = (
      <div
        role='status'
        aria-label={t('status.loading')}
        className='grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] sm:grid-cols-[8rem_minmax(0,1fr)] gap-3'
      >
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className='contents'>
            <Skeleton className='h-4 w-20' />
            <Skeleton className='h-4 w-40' />
          </div>
        ))}
      </div>
    );
  } else {
    const rows = diffOf(entry.before, entry.after);
    const details: [string, ReactElement | string][] = [
      [
        t('platform.auditLogs.fields.at'),
        dateFormat.format(new Date(entry.at)),
      ],
      [
        t('platform.auditLogs.fields.actor'),
        entry.actorName ?? entry.actorId ?? t('platform.auditLogs.system'),
      ],
      [
        t('platform.auditLogs.fields.action'),
        <Badge key='action' variant='outline'>
          {entry.action}
        </Badge>,
      ],
      [t('platform.auditLogs.fields.targetType'), entry.targetType],
      [t('platform.auditLogs.fields.targetId'), entry.targetId ?? '—'],
      [t('platform.auditLogs.fields.reason'), entry.reason ?? '—'],
    ];
    body = (
      <div className='flex flex-col gap-6'>
        <dl className='grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] sm:grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm'>
          {details.map(([label, value]) => (
            <div key={label} className='contents'>
              <dt className='text-muted-foreground'>{label}</dt>
              <dd className='min-w-0 whitespace-pre-wrap wrap-anywhere'>
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <section className='flex flex-col gap-3'>
          <h3 className='text-base font-medium'>
            {t('platform.auditLogs.changes')}
          </h3>
          {rows.length === 0 ? (
            <p className='text-sm text-muted-foreground'>
              {t('platform.auditLogs.noChanges')}
            </p>
          ) : (
            <div className='overflow-x-auto rounded-lg border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {t('platform.auditLogs.fields.field')}
                    </TableHead>
                    <TableHead>
                      {t('platform.auditLogs.fields.before')}
                    </TableHead>
                    <TableHead>
                      {t('platform.auditLogs.fields.after')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.field || 'value'}>
                      <TableCell className='align-top'>
                        <div className='flex flex-col items-start gap-1'>
                          <code className='text-xs'>
                            {row.field || t('platform.auditLogs.wholeValue')}
                          </code>
                          {row.changed ? (
                            <Badge variant='secondary'>
                              {t('platform.auditLogs.changed')}
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className='max-w-64 align-top'>
                        <pre className='text-xs whitespace-pre-wrap wrap-anywhere text-muted-foreground'>
                          {show(row.before)}
                        </pre>
                      </TableCell>
                      <TableCell className='max-w-64 align-top'>
                        <pre className='text-xs whitespace-pre-wrap wrap-anywhere'>
                          {show(row.after)}
                        </pre>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <RecordDetailDrawer
      title={
        entry
          ? t('platform.auditLogs.detailTitle', { action: entry.action })
          : t('platform.auditLogs.detailTitleLoading')
      }
      className='sm:max-w-2xl'
      footer={<OverlayCloseButton label={t('actions.close')} />}
    >
      {body}
    </RecordDetailDrawer>
  );
}
