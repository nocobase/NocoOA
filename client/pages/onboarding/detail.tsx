import { statusTone } from './status-tone.js';
import { StatusBadge } from '#components/status-badge';
import { Timeline } from './timeline.js';
import { Attachments } from './attachments.js';
import { UserName } from '#components/user-name';
import { useState } from 'react';
import {
  Link,
  Outlet,
  useParams,
  useLocation,
  useOutletContext,
} from 'react-router';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { RecordDetailDrawer } from '#components/record-detail-drawer';
import { Button } from '#components/ui/button';
import { Failure, Loading } from '../work-items/states.js';
import { useOnboardingResource, useViewerKey } from './resource.js';
import { resource, type Detail, type Source } from './types.js';
export default function Page() {
  return <Body key={useViewerKey()} />;
}
function Private({ id, kind }: { id: string; kind: 'bank' | 'salary' }) {
  const { t } = useTranslation(),
    grant = useCan({
      resource,
      action: kind === 'bank' ? 'viewBank' : 'viewSalary',
    }),
    [open, setOpen] = useState(false),
    allowed = grant.can && !grant.isPending && !grant.error,
    r = useOnboardingResource<{ data: Record<string, string> | null }>(
      open && allowed ? `onboardings/${id}/${kind}` : null,
    );
  return allowed ? (
    <section>
      <Button variant='outline' onClick={() => setOpen((v) => !v)}>
        {t(`onboarding.${kind}`)}
      </Button>
      {open ? (
        r.loading ? (
          <Loading />
        ) : r.error ? (
          <Failure module='onboarding' error={r.error} retry={r.reload} />
        ) : (
          <dl>
            {Object.entries(r.data?.data ?? {}).map(([key, value]) => (
              <div key={key}>
                <dt>{t(`onboarding.fields.${key}`)}</dt>
                <dd className='break-words'>{value}</dd>
              </div>
            ))}
          </dl>
        )
      ) : null}
    </section>
  ) : null;
}
function Body() {
  const { onboardingId = '' } = useParams(),
    { t } = useTranslation(),
    parent = useOutletContext<Source>(),
    location = useLocation(),
    r = useOnboardingResource<{ data: Detail }>(`onboardings/${onboardingId}`),
    d = r.data?.data;
  const reload = () => {
      r.reload();
      parent.reload();
    },
    link = (pathname: string) => ({
      pathname,
      search: location.search,
      hash: location.hash,
    });
  // A task form replaces this record overlay; nested modal portals otherwise leave the parent's focus trap above it.
  if (
    location.pathname.includes('/tasks/') ||
    location.pathname.endsWith('/cancel')
  )
    return <Outlet context={{ ...parent, reload }} />;
  return (
    <RecordDetailDrawer
      headerStatus={
        d ? (
          <StatusBadge tone={statusTone(d.record.status)}>
            {t(`onboarding.states.${d.record.status}`)}
          </StatusBadge>
        ) : null
      }
      printable
      printDisabled={!d || r.loading || !!r.error}
      title={
        d ? <UserName name={d.record.user.name} /> : t('onboarding.detail')
      }
      closeTo={link(parent.basePath)}
      footer={
        <>
          <Button variant='outline' onClick={reload}>
            {t('onboarding.refresh')}
          </Button>
          {d?.canCancel && !r.loading && !r.error ? (
            <Button
              variant='destructive'
              nativeButton={false}
              render={<Link to={link('cancel')} />}
            >
              {t('onboarding.actions.cancel')}
            </Button>
          ) : null}
        </>
      }
    >
      {r.loading ? (
        <Loading />
      ) : r.error ? (
        <Failure module='onboarding' error={r.error} retry={r.reload} />
      ) : d ? (
        <div className='flex flex-col gap-5'>
          <dl className='grid gap-3 sm:grid-cols-2'>
            {[
              [
                'employee',
                <UserName key={'employee'} name={d.record.user.name} />,
              ] as const,
              [
                'creator',
                <UserName key={'creator'} name={d.record.creator.name} />,
              ] as const,
              ['fields.hireDate', d.record.hireDate],
              [
                'fields.mentorEmployeeId',
                d.record.mentorName ?? t('onboarding.unavailable'),
              ],
              [
                'fields.workstationRequirement',
                d.record.workstationRequirement ?? t('onboarding.unavailable'),
              ],
              ['fields.requisitionId', d.record.requisitionId],
            ].map(([key, value]) => (
              <div key={key}>
                <dt className='text-muted-foreground'>
                  {t(`onboarding.${key}`)}
                </dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {d.tasks.map((task) => (
            <section
              key={task.id}
              className='min-w-0 rounded-lg border p-4 flex flex-col gap-2'
            >
              <h3 className='font-medium'>
                {t(
                  `onboarding.kinds.${task.kind.startsWith('recovery:') ? 'recovery' : task.kind}`,
                )}
              </h3>
              <div className='flex flex-wrap gap-2'>
                <StatusBadge tone={statusTone(task.status)}>
                  {t(`onboarding.states.${task.status}`)}
                </StatusBadge>
                {task.forced ? (
                  <StatusBadge tone='warning'>
                    {t('onboarding.forced')}
                  </StatusBadge>
                ) : null}
              </div>
              <p>
                {t('onboarding.dueDate')}: {task.dueDate}
              </p>
              <p>
                {t('onboarding.assignee')}:{' '}
                <UserName
                  name={task.assignee?.name ?? task.target?.name ?? '—'}
                />
              </p>
              <dl>
                {Object.entries(task.facts ?? {})
                  .filter(
                    ([key]) =>
                      ![
                        'privateFactsId',
                        'sourceTaskId',
                        'attachmentIds',
                      ].includes(key),
                  )
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt className='text-muted-foreground'>
                        {t(`onboarding.fields.${key}`)}
                      </dt>
                      <dd
                        className={
                          key === 'assetReceiptId'
                            ? 'whitespace-pre-wrap break-all'
                            : 'whitespace-pre-wrap break-words'
                        }
                      >
                        {value}
                      </dd>
                    </div>
                  ))}
              </dl>
              {task.facts?.attachmentIds ? (
                <Attachments
                  id={onboardingId}
                  taskId={task.id}
                  ids={JSON.parse(task.facts.attachmentIds) as string[]}
                />
              ) : null}
              <div className='flex flex-wrap gap-2'>
                {task.actions.map((action) => (
                  <Button
                    key={action}
                    variant={
                      action === 'forceComplete' ? 'destructive' : 'outline'
                    }
                    nativeButton={false}
                    render={
                      <Link
                        to={link(
                          `tasks/${encodeURIComponent(task.id)}/${action}`,
                        )}
                      />
                    }
                  >
                    {t(`onboarding.actions.${action}`)}
                  </Button>
                ))}
              </div>
            </section>
          ))}
          <Timeline entries={d.timeline ?? []} timeZone={d.timeZone ?? 'UTC'} />
          <Private id={onboardingId} kind='salary' />
          <Private id={onboardingId} kind='bank' />
        </div>
      ) : null}
      <Outlet context={{ ...parent, reload }} />
    </RecordDetailDrawer>
  );
}
