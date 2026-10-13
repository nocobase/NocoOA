import { UserName } from '#components/user-name';
import { useTranslation } from '@nocobase/i18n/client';
import { Link, useLocation } from 'react-router';
import { Button } from '#components/ui/button';
import { StatusBadge } from '#components/status-badge';
import { Alert, AlertDescription } from '#components/ui/alert';
import { calendarDateLabel, typeLabel, type DepartureDetail } from './types.js';
const knownBlockers = new Set([
  'DEPARTURE_ASSET_SERVICE_UNAVAILABLE',
  'DEPARTURE_REIMBURSEMENT_SERVICE_UNAVAILABLE',
  'DEPARTURE_LOANS_NOT_CLEARED',
  'REIMBURSEMENT_DEPARTURE_NOT_CLEARED',
  'DEPARTURE_APPLICATION_INCOMPLETE',
  'DEPARTURE_DATE_PAST',
  'DEPARTURE_REASSIGNMENT_UNAVAILABLE',
  'DEPARTURE_REASSIGNMENT_INCOMPLETE',
  'DEPARTURE_EXECUTION_FAILED',
]);
export function Blocker({ code }: { code: string }) {
  const { t } = useTranslation();
  return (
    <p className='text-sm text-muted-foreground'>
      {t(
        `departureRequests.blockers.${knownBlockers.has(code) ? code : 'generic'}`,
      )}
    </p>
  );
}
export function DepartureFacts({
  detail,
  writable,
}: {
  detail: DepartureDetail;
  writable: boolean;
}) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const r = detail.record;
  const values = [
    [
      t('departureRequests.form.employee'),
      <UserName
        key={t('departureRequests.form.employee')}
        name={r.applicant?.name ?? '—'}
      />,
    ] as const,
    [
      t('departureRequests.createdBy'),
      <UserName
        key={t('departureRequests.createdBy')}
        name={r.createdBy?.name ?? '—'}
      />,
    ] as const,
    [
      t('departureRequests.departureType'),
      typeLabel(r.departureTypeLabel, i18n.language, r.departureType),
    ],
    [t('departureRequests.reason'), r.reason],
    ...(r.cancellationReason
      ? [[t('departureRequests.cancellationReason'), r.cancellationReason]]
      : []),
    [
      t('departureRequests.expectedLastWorkingDay'),
      calendarDateLabel(r.expectedLastWorkingDay, i18n.language),
    ],
    [
      t('departureRequests.lastWorkingDay'),
      calendarDateLabel(r.lastWorkingDay, i18n.language),
    ],
    [
      t('departureRequests.handoverUser'),
      <UserName
        key={t('departureRequests.handoverUser')}
        name={r.handoverUser?.name ?? '—'}
      />,
    ] as const,
    [
      t('departureRequests.settlementDate'),
      calendarDateLabel(r.settlementDate, i18n.language),
    ],
    [t('departureRequests.settlementNote'), r.settlementNote ?? '—'],
  ];
  return (
    <div className='flex flex-col gap-6'>
      <dl className='grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]'>
        {values.map(([label, value]) => (
          <div key={label} className='contents'>
            <dt className='text-muted-foreground'>{label}</dt>
            <dd className='min-w-0 whitespace-pre-wrap break-words'>{value}</dd>
          </div>
        ))}
      </dl>
      {!detail.readyForSubmission &&
      ['draft', 'revision'].includes(r.status) ? (
        <Alert>
          <AlertDescription>
            {t('departureRequests.notReady')}
            {detail.blockedBy.map((code) => (
              <Blocker key={code} code={code} />
            ))}
          </AlertDescription>
        </Alert>
      ) : null}
      {r.hrInterviewCompleted && r.status !== 'cancelled' ? (
        <p className='text-sm text-muted-foreground'>
          {t('departureRequests.cancellationGuidance')}
        </p>
      ) : null}
      {detail.workItems.length ? (
        <section className='flex flex-col gap-4'>
          <h2 className='text-base font-medium'>
            {t('departureRequests.handover')}
          </h2>
          {detail.workItems.map((item) => (
            <article
              key={item.id}
              className='flex flex-col gap-3 rounded-lg border p-4'
            >
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <h3 className='font-medium'>
                  {t(`departureRequests.workKinds.${item.kind}`)}
                </h3>
                <StatusBadge
                  tone={item.status === 'completed' ? 'success' : 'neutral'}
                >
                  {t(`departureRequests.workStates.${item.status}`)}
                </StatusBadge>
              </div>
              <dl className='grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]'>
                {[
                  [
                    t('departureRequests.manager'),
                    <UserName
                      key={t('departureRequests.manager')}
                      name={item.manager?.name ?? '—'}
                    />,
                  ] as const,
                  [
                    t('departureRequests.claimant'),
                    <UserName
                      key={t('departureRequests.claimant')}
                      name={item.claimedBy?.name ?? '—'}
                    />,
                  ] as const,
                  [
                    t('departureRequests.receiver'),
                    <UserName
                      key={t('departureRequests.receiver')}
                      name={item.receiver?.name ?? '—'}
                    />,
                  ] as const,
                  [
                    t('departureRequests.checklistConfirmed'),
                    t(
                      `departureRequests.${item.checklistConfirmed ? 'yes' : 'no'}`,
                    ),
                  ],
                  [
                    t('departureRequests.receiverAcknowledged'),
                    t(
                      `departureRequests.${item.receiverAcknowledged ? 'yes' : 'no'}`,
                    ),
                  ],
                  ...(item.forcedBy
                    ? [
                        [
                          t('departureRequests.forcedBy'),
                          <UserName
                            key={t('departureRequests.forcedBy')}
                            name={item.forcedBy.name}
                          />,
                        ] as const,
                        [
                          t('departureRequests.forceReason'),
                          item.forceReason ?? '—',
                        ],
                      ]
                    : []),
                ].map(([label, value]) => (
                  <div className='contents' key={label}>
                    <dt className='text-muted-foreground'>{label}</dt>
                    <dd className='min-w-0 whitespace-pre-wrap break-words'>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className='flex flex-wrap gap-2'>
                {item.offers.map((offer) => (
                  <div key={offer.name} className='flex flex-col gap-1'>
                    <Button
                      variant={
                        offer.name === 'forceComplete'
                          ? 'destructive'
                          : 'outline'
                      }
                      disabled={!writable || !offer.allowed}
                      nativeButton={!writable || !offer.allowed}
                      render={
                        writable && offer.allowed ? (
                          <Link
                            to={{
                              pathname: `work/${offer.name}/${encodeURIComponent(item.id)}`,
                              search: location.search,
                            }}
                          />
                        ) : undefined
                      }
                    >
                      {t(`departureRequests.work.labels.${offer.name}`)}
                    </Button>
                    {offer.blockers.map((code) => (
                      <Blocker key={code.code} code={code.code} />
                    ))}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>
      ) : null}
      {detail.execution ? (
        <section className='flex flex-col gap-2'>
          <h2 className='text-base font-medium'>
            {t('departureRequests.execution')}
          </h2>
          <StatusBadge
            tone={
              detail.execution.status === 'executed'
                ? 'success'
                : detail.execution.status === 'blocked'
                  ? 'warning'
                  : 'info'
            }
          >
            {t(`departureRequests.executionStates.${detail.execution.status}`)}
          </StatusBadge>
          <p className='text-sm text-muted-foreground'>
            {t(
              `departureRequests.${detail.execution.status === 'executed' ? 'executionComplete' : 'notExecuted'}`,
            )}
          </p>
          {detail.execution.failureCode ? (
            <Blocker code={detail.execution.failureCode} />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
