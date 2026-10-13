import { StatusBadge } from '#components/status-badge';
import { statusTone } from './status-tone.js';
import { UserName } from '#components/user-name';
import {
  Link,
  Outlet,
  useLocation,
  useOutletContext,
  useParams,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useAuthorizationRevision } from '@nocobase/app-plugin-authorization/client';
import { RecordDetailDrawer } from '#components/record-detail-drawer';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { Button } from '#components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '#components/ui/dropdown-menu';
import { useWorkResource } from './resource.js';
import { Attachments } from './attachments.js';
import { Loading, Failure } from './states.js';
import type { Item, Context, Envelope, Source } from './types.js';
export default function Detail() {
  const { session } = useAuthentication(),
    revision = useAuthorizationRevision(),
    { workItemId } = useParams();
  return (
    <Body
      key={`${session?.user.id}:${revision}:${workItemId}`}
      id={workItemId!}
    />
  );
}
function Body({ id }: { id: string }) {
  const { t, i18n } = useTranslation(),
    parent = useOutletContext<Source>(),
    location = useLocation(),
    handover = useCan({
      resource: { type: 'composite', id: 'oa.workItems' },
      action: 'handoverConfirmation',
    }),
    r = useWorkResource<Envelope<Item>>(`workItems/${id}`),
    ctx = useWorkResource<Envelope<Context>>('workItems/context'),
    d = r.data?.data;
  const active = d && !r.loading && !r.error ? d.actions : [],
    primary =
      active.find((v) =>
        ['dispatch', 'claim', 'complete', 'confirm', 'resume'].includes(v),
      ) ?? active[0],
    other = active.filter((v) => v !== primary);
  const link = (pathname: string) => ({
      pathname,
      search: location.search,
      hash: location.hash,
    }),
    detailPath = location.pathname
      .split('/actions/')[0]
      .replace(/\/handover-confirmation$/, ''),
    reload = () => {
      r.reload();
      parent.reload();
    };
  if (
    location.pathname.endsWith('/edit') ||
    location.pathname.endsWith('/actions/complete')
  )
    return <Outlet context={{ ...parent, detailPath, reload }} />;
  return (
    <>
      <RecordDetailDrawer
        title={d?.title ?? t('workItems.detail')}
        footer={
          <div className='flex flex-wrap gap-2'>
            {primary ? (
              <Button
                nativeButton={false}
                render={<Link to={link(`actions/${primary}`)} />}
              >
                {t(`workItems.actions.${primary}`)}
              </Button>
            ) : null}
            {d?.canEdit && !r.loading && !r.error ? (
              <Button
                variant='outline'
                nativeButton={false}
                render={<Link to={link('edit')} />}
              >
                {t('workItems.edit')}
              </Button>
            ) : null}
            {d?.canHandoverConfirmation &&
            !r.loading &&
            !r.error &&
            handover.can &&
            !handover.isPending ? (
              <Button
                variant='outline'
                nativeButton={false}
                render={<Link to={link('handover-confirmation')} />}
              >
                {t('workItems.handoverTitle')}
              </Button>
            ) : null}
            {other.length ? (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant='outline' />}>
                  {t('workItems.more')}
                </DropdownMenuTrigger>
                <DropdownMenuContent className='w-auto min-w-40'>
                  {other.map((v) => (
                    <DropdownMenuItem
                      key={v}
                      render={<Link to={link(`actions/${v}`)} />}
                    >
                      {t(`workItems.actions.${v}`)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <Button variant='outline' onClick={reload} disabled={r.loading}>
              {t('workItems.refresh')}
            </Button>
          </div>
        }
      >
        {r.loading && !d ? (
          <Loading />
        ) : r.error ? (
          <>
            <Failure error={r.error} retry={r.reload} />
            <Button
              nativeButton={false}
              render={<Link to={link(parent.basePath)} />}
            >
              {t('workItems.back')}
            </Button>
          </>
        ) : d ? (
          <div className='flex flex-col gap-5'>
            <div className='flex flex-wrap gap-2'>
              <StatusBadge tone={statusTone(d.status)}>
                {t(`workItems.states.${d.status}`)}
              </StatusBadge>
              {d.forced ? (
                <StatusBadge tone='warning'>
                  {t('workItems.forced')}
                </StatusBadge>
              ) : null}
              {d.overdue ? (
                <StatusBadge tone='warning'>
                  {t('workItems.overdue')}
                </StatusBadge>
              ) : null}
            </div>
            <dl className='grid gap-3 sm:grid-cols-2'>
              {[
                [
                  t('workItems.creator'),
                  <UserName
                    key={t('workItems.creator')}
                    name={d.creator.name}
                  />,
                ] as const,
                [
                  t('workItems.confirmationOwner'),
                  <UserName
                    key={t('workItems.confirmationOwner')}
                    name={d.confirmationOwner?.name ?? '—'}
                  />,
                ] as const,
                [
                  t('workItems.assignee'),
                  <UserName
                    key={t('workItems.assignee')}
                    name={d.assignee?.name ?? d.target?.name ?? '—'}
                  />,
                ] as const,
                [
                  t('workItems.pool'),
                  typeof d.dutyRole?.title === 'string'
                    ? d.dutyRole.title
                    : d.dutyRole
                      ? t(d.dutyRole.title.key, { ns: d.dutyRole.title.ns })
                      : '—',
                ],
                [
                  t('workItems.dueAt'),
                  new Intl.DateTimeFormat(i18n.language, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: ctx.data?.data.timeZone ?? 'UTC',
                  }).format(new Date(d.dueAt)),
                ],
                [
                  t('workItems.confirmation'),
                  t(
                    d.requiresConfirmation
                      ? 'workItems.required'
                      : 'workItems.notRequired',
                  ),
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className='text-muted-foreground'>{label}</dt>
                  <dd className='break-words'>{value}</dd>
                </div>
              ))}
            </dl>
            {[
              ['descriptionField', d.description],
              ['result', d.result],
              ['reason', d.reason],
            ].map(([key, value]) => (
              <section key={key}>
                <h3 className='font-medium'>{t(`workItems.${key}`)}</h3>
                <p className='whitespace-pre-wrap break-words'>
                  {value || '—'}
                </p>
              </section>
            ))}
            <section>
              <h3 className='font-medium'>{t('workItems.attachments')}</h3>
              <Attachments id={id} ids={d.attachments} />
            </section>
            <section>
              <h3 className='font-medium'>
                {t('workItems.resultAttachments')}
              </h3>
              <Attachments id={id} ids={d.resultAttachments} />
            </section>
            {d.completedAt ? (
              <p>
                {t('workItems.completedAt')}:{' '}
                {new Intl.DateTimeFormat(i18n.language, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: ctx.data?.data.timeZone ?? 'UTC',
                }).format(new Date(d.completedAt))}
              </p>
            ) : null}
          </div>
        ) : null}
        <Outlet context={{ ...parent, detailPath, reload }} />
      </RecordDetailDrawer>
    </>
  );
}
