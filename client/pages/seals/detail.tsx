import { statusTone } from './status-tone.js';
import { PrintEntry } from '../template-print/entry.js';
import type { LedgerDetail } from './types.js';
import { UserName } from '#components/user-name';
import {
  Link,
  Outlet,
  useParams,
  useLocation,
  useOutletContext,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { RecordDetailDrawer } from '#components/record-detail-drawer';
import { Button } from '#components/ui/button';
import { StatusBadge } from '#components/status-badge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '#components/ui/dropdown-menu';
import { useSealResource } from './resource.js';
import { SealError, SealSkeleton } from './states.js';
import {
  supportedAction,
  type Detail,
  type Capabilities,
  type Source,
} from './types.js';
export default function SealDetail() {
  const { sealRequestId } = useParams(),
    { t } = useTranslation(),
    location = useLocation(),
    parent = useOutletContext<Source>(),
    r = useSealResource<{ data: Detail }>(
      `sealRequests/${encodeURIComponent(sealRequestId!)}`,
    ),
    c = useSealResource<{ data: Capabilities }>(
      `sealBrowser/requests/${encodeURIComponent(sealRequestId!)}/capabilities`,
    ),
    d = r.data?.data,
    cap = c.data?.data,
    link = (pathname: string) => ({
      pathname,
      search: location.search,
      hash: location.hash,
    });
  const ledger = useSealResource<{ data: LedgerDetail }>(
    d?.record.status === 'completed' && d.record.ledgerId
      ? `sealLedger/${encodeURIComponent(d.record.ledgerId)}`
      : null,
  );
  const printReadable = readyForPrint(r, ledger, d);
  const ops = cap
    ? [
        ...cap.transitions.map((name) => ({
          name,
          path:
            name === 'edit'
              ? 'edit'
              : ['submit', 'withdraw'].includes(name)
                ? `transitions/${name}`
                : `actions/${name}`,
        })),
        ...cap.taskActions.flatMap((o) =>
          o.actions
            .filter((a) => supportedAction(a))
            .map((a) => ({
              name: a.name,
              path: `actions/${a.name}/${o.taskId}`,
            })),
        ),
        ...(cap.canActualReturn
          ? [{ name: 'actualReturn', path: 'actualReturn' }]
          : []),
      ]
    : [];
  const ready = !r.loading && !c.loading && !r.error && !c.error,
    primary = ops[0],
    reload = () => {
      r.invalidate();
      c.invalidate();
      parent?.reload();
    };
  return (
    <RecordDetailDrawer
      headerStatus={
        d ? (
          <StatusBadge tone={statusTone(d.record.status)}>
            {t(`seals.states.${d.record.status}`)}
          </StatusBadge>
        ) : null
      }
      printable
      printDisabled={!ready || !d}
      title={d?.record.number ?? t('seals.detail')}
      footer={
        <div className='flex flex-wrap gap-2'>
          <PrintEntry source='sealRegistration' readable={printReadable} />
          {ready && primary ? (
            <Button
              nativeButton={false}
              render={<Link to={link(primary.path)} />}
            >
              {t(`seals.actions.${primary.name}`)}
            </Button>
          ) : null}
          {ready && ops.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant='outline' />}>
                {t('seals.moreActions')}
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                {ops.slice(1).map((o) => (
                  <DropdownMenuItem
                    key={o.path}
                    render={<Link to={link(o.path)} />}
                  >
                    {t(`seals.actions.${o.name}`)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Button
            variant='outline'
            onClick={() => {
              r.reload();
              c.reload();
            }}
            disabled={r.loading || c.loading}
          >
            {t('seals.refresh')}
          </Button>
        </div>
      }
    >
      {r.error || c.error ? <SealError error={r.error ?? c.error} /> : null}
      {r.loading && !d ? <SealSkeleton /> : null}
      {d ? (
        <div className='flex flex-col gap-6'>
          <dl className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            {[
              'applicant',
              'purpose',
              'sealType',
              'copies',
              'external',
              'returnDueAt',
              'contractId',
              'contractVersion',
              'contact',
              'sealId',
              'actualCopies',
              'sealedAt',
              'borrowedAt',
              'returnedAt',
              'ledgerId',
              'exceptionReason',
              'administrativeReason',
            ].map((field) => {
              const v =
                field === 'applicant'
                  ? d.record.applicant.name
                  : d.record[field as keyof typeof d.record];
              return (
                <div key={field}>
                  <dt className='text-muted-foreground'>
                    {t(`seals.${field}`)}
                  </dt>
                  <dd className='mt-1 whitespace-pre-wrap break-words'>
                    {v === null || v === ''
                      ? '—'
                      : typeof v === 'boolean'
                        ? t(v ? 'seals.yes' : 'seals.no')
                        : field === 'sealType' && typeof v === 'string'
                          ? t(`seals.types.${v}`)
                          : typeof v === 'string' || typeof v === 'number'
                            ? String(v)
                            : '—'}
                  </dd>
                </div>
              );
            })}
          </dl>
          <p className='text-muted-foreground'>{t('seals.physicalNotice')}</p>
          {d.record.fileIds.length ? (
            <section>
              <h3 className='font-medium'>{t('seals.files')}</h3>
              {d.record.fileIds.map((id) => (
                <FileDownload key={id} id={id} requestId={d.record.id} />
              ))}
            </section>
          ) : null}
          <section className='flex flex-col gap-3'>
            <h3 className='font-medium'>{t('seals.history')}</h3>
            {d.actions.map((a) => (
              <div
                key={a.id}
                className='flex flex-wrap justify-between gap-2 border-b pb-2'
              >
                <span>
                  <UserName name={a.actor.name} /> ·{' '}
                  {t(`seals.actions.${a.name}`)}
                </span>
                <span>{a.createdAt}</span>
              </div>
            ))}
          </section>
        </div>
      ) : null}
      <Outlet
        context={{
          reload,
          printRefresh: reload,
          printSource: 'sealRegistration',
          printRecordId: printReadable ? d?.record.ledgerId : undefined,
          printRecordName: d?.record.number ?? t('seals.detail'),
        }}
      />
    </RecordDetailDrawer>
  );
}
import { useState } from 'react';
import { useApiClient } from '@nocobase/app-client';
function FileDownload({ id, requestId }: { id: string; requestId: string }) {
  const api = useApiClient(),
    { t } = useTranslation(),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  return (
    <div className='flex flex-col gap-2'>
      <Button
        variant='outline'
        disabled={busy}
        onClick={() => {
          void (async () => {
            setBusy(true);
            setError(undefined);
            try {
              const stream = await api.stream({
                path: `sealRequests/${requestId}/files/${id}/content`,
              });
              const reader = stream.getReader();
              const chunks: Uint8Array<ArrayBuffer>[] = [];
              let size = 0;
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > 21 * 1024 * 1024) {
                  await reader.cancel();
                  throw new Error('File too large');
                }
                chunks.push(new Uint8Array(value));
              }
              const url = URL.createObjectURL(new Blob(chunks)),
                a = document.createElement('a');
              a.href = url;
              a.download = id;
              a.click();
              URL.revokeObjectURL(url);
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        {t('seals.download')} · {id}
      </Button>
      {error ? <SealError error={error} /> : null}
    </div>
  );
}

function readyForPrint(
  r: { loading: boolean; error?: unknown },
  ledger: { loading: boolean; error?: unknown; data?: { data: LedgerDetail } },
  detail?: Detail,
) {
  return (
    !r.loading &&
    !r.error &&
    !ledger.loading &&
    !ledger.error &&
    detail?.record.status === 'completed' &&
    !!detail.record.ledgerId &&
    ledger.data?.data.printable === true &&
    ledger.data.data.record.id === detail.record.ledgerId &&
    ledger.data.data.record.requestId === detail.record.id
  );
}
