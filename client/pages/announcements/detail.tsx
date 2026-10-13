import { UserName } from '#components/user-name';
import { useEffect, useReducer } from 'react';
import {
  Link,
  Outlet,
  useLocation,
  useOutletContext,
  useParams,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { RefreshCw } from 'lucide-react';
import { RecordDetailDrawer } from '#components/record-detail-drawer';
import { Button } from '#components/ui/button';
import { StatusBadge } from '#components/status-badge';
import { statusTone } from './status-tone.js';
import { useAnnouncementResource } from './resource.js';
import { Failure, Loading } from './states.js';
import { Attachments } from './files.js';
import {
  currentActions,
  effective,
  dateLabel,
  type Context,
  type Detail,
  type Options,
} from './types.js';
export default function AnnouncementDetail() {
  const { announcementId } = useParams(),
    { t, i18n } = useTranslation(),
    location = useLocation(),
    parent = useOutletContext<Context>();
  const r = useAnnouncementResource<{ data: Detail }>(
      `announcements/${encodeURIComponent(announcementId!)}`,
    ),
    o = useAnnouncementResource<{ data: Options }>('announcements/context');
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const timer = setInterval(tick, 15000);
    return () => clearInterval(timer);
  }, []);
  const row = r.data?.data,
    actions = row && !r.loading && !r.error ? currentActions(row) : [];
  const refresh = () => {
      r.reload();
      o.reload();
    },
    saved = () => {
      refresh();
      parent.reload();
    };
  const link = (path: string) => ({
    pathname: path,
    search: location.search,
    hash: location.hash,
  });
  return (
    <RecordDetailDrawer
      title={row?.title ?? t('announcements.detail')}
      closeTo={link('..')}
      footer={
        <>
          {actions
            .filter((a) => a !== 'receipts')
            .map((a) => (
              <Button
                key={a}
                variant={
                  a === 'revoke'
                    ? 'destructive'
                    : a === 'confirm' || a === 'publish'
                      ? 'default'
                      : 'outline'
                }
                nativeButton={false}
                render={
                  <Link to={link(a === 'edit' ? 'edit' : `actions/${a}`)} />
                }
              >
                {t(`announcements.actions.${a}`)}
              </Button>
            ))}
          {actions.includes('receipts') ? (
            <Button
              variant='outline'
              nativeButton={false}
              render={<Link to={link('receipts')} />}
            >
              {t('announcements.receipts')}
            </Button>
          ) : null}
          <Button
            variant='outline'
            size='icon'
            aria-label={t('announcements.refresh')}
            title={t('announcements.refresh')}
            disabled={r.loading || o.loading}
            onClick={refresh}
          >
            <RefreshCw />
          </Button>
        </>
      }
    >
      {r.error ? <Failure error={r.error} retry={refresh} /> : null}
      {o.error ? <Failure error={o.error} retry={refresh} /> : null}
      {!row ? (
        r.loading ? (
          <Loading />
        ) : null
      ) : (
        <div className='flex flex-col gap-4'>
          <StatusBadge tone={statusTone(row.status)}>
            {t(`announcements.status.${row.status}`)}
          </StatusBadge>
          <dl className='grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3'>
            <dt className='text-muted-foreground'>
              {t('announcements.publisher')}
            </dt>
            <dd className='break-words'>
              <UserName name={row.publisher.name} />
            </dd>
            {o.data ? (
              <>
                <dt className='text-muted-foreground'>
                  {t('announcements.timeZone')}
                </dt>
                <dd>{o.data.data.timeZone}</dd>
                {(['validFrom', 'validUntil'] as const).map((k) => (
                  <div className='contents' key={k}>
                    <dt className='text-muted-foreground'>
                      {t(`announcements.fields.${k}`)}
                    </dt>
                    <dd>
                      {dateLabel(row[k], i18n.language, o.data!.data.timeZone)}
                    </dd>
                  </div>
                ))}
              </>
            ) : null}
          </dl>
          {row.status === 'scheduled' ||
          row.status === 'revoked' ||
          (row.status === 'published' && !effective(row)) ? (
            <p className='text-muted-foreground'>
              {t(
                `announcements.notice.${row.status === 'published' ? 'expired' : row.status}`,
              )}
            </p>
          ) : null}
          <div className='whitespace-pre-wrap break-words'>{row.body}</div>
          {row.knowledgeLink ? (
            <div className='rounded-lg border p-4'>
              <p>
                {t('announcements.linkedKnowledge', {
                  title: row.knowledgeLink.title,
                  version: row.knowledgeLink.version,
                })}
              </p>
              {row.hasNewVersion ? (
                <p className='mt-2 text-muted-foreground'>
                  {t('announcements.newVersion')}
                </p>
              ) : null}
            </div>
          ) : null}
          {row.attachments.length ? (
            <Attachments announcementId={row.id} selected={row.attachments} />
          ) : null}
          <p>
            {t(
              !row.requiresConfirmation
                ? 'announcements.noConfirmation'
                : row.capabilities.ownReceipt?.status === 'confirmed'
                  ? 'announcements.confirmed'
                  : row.capabilities.ownReceipt?.status === 'pending'
                    ? 'announcements.pending'
                    : 'announcements.noOwnReceipt',
            )}
            {row.capabilities.ownReceipt?.confirmedAt && o.data
              ? ` · ${dateLabel(row.capabilities.ownReceipt.confirmedAt, i18n.language, o.data.data.timeZone)}`
              : ''}
          </p>
        </div>
      )}
      <Outlet
        context={{
          ...parent,
          reload: saved,
          updateDetail: (data: Detail) => r.update({ data }),
        }}
      />
    </RecordDetailDrawer>
  );
}
