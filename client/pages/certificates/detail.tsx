import { statusTone } from './status-tone.js';
import { UserNameText } from '#components/user-name';
import { UserName } from '#components/user-name';
import { useEffect, useRef, useState } from 'react';
import {
  Link,
  Outlet,
  useLocation,
  useParams,
  useOutletContext,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useAuthorizationRevision } from '@nocobase/app-plugin-authorization/client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { Download, RefreshCw } from 'lucide-react';
import { RouteDrawer } from '#components/route-drawer';
import { Button } from '#components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '#components/ui/dropdown-menu';
import { Spinner } from '#components/ui/spinner';
import { StatusBadge } from '#components/status-badge';
import { useCertificateResource } from './resource.js';
import { CertificateError, CertificateSkeleton } from './states.js';
import { downloadDocx, documentName } from './download.js';
import type { Detail, Context } from './types.js';
export default function CertificateDetail() {
  const { certificateId } = useParams(),
    { session } = useAuthentication(),
    revision = useAuthorizationRevision();
  return (
    <Body
      key={`${revision}:${session?.user.id}:${certificateId}`}
      id={certificateId!}
    />
  );
}
function Body({ id }: { id: string }) {
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    parent = useOutletContext<Context>(),
    api = useApiClient();
  const r = useCertificateResource<{ data: Detail }>(
      `certificateRequests/${encodeURIComponent(id)}`,
    ),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  const controllerRef = useRef(new AbortController());
  useEffect(() => {
    controllerRef.current = new AbortController();
    return () => controllerRef.current.abort();
  }, []);
  const d = r.data?.data,
    link = (pathname: string) => ({ pathname, search: location.search });
  const operations = d
    ? [
        ...(d.capabilities.canIssue
          ? [{ name: 'issue', path: 'issue', primary: true }]
          : []),
        ...d.capabilities.transitions.map((name) => ({
          name,
          path: name === 'edit' ? 'edit' : `actions/${name}`,
          primary: name === 'submit',
        })),
        ...d.capabilities.taskActions.flatMap((o) =>
          o.actions
            .filter((a) => a.name !== 'complete')
            .map((a) => ({
              name: a.name,
              path: `actions/${a.name}`,
              primary: a.primary,
            })),
        ),
      ].filter(
        (item, index, all) =>
          all.findIndex((other) => other.name === item.name) === index,
      )
    : [];
  const primary = operations.find((item) => item.primary) ?? operations[0];
  const secondary = operations.filter((item) => item !== primary);
  const label = (name: string) =>
    name === 'issue' || name === 'edit'
      ? t(`certificates.${name}`)
      : t(`certificates.actions.${name}`);
  const refreshed = () => {
    r.reload();
    parent.reload();
  };
  return (
    <RouteDrawer
      headerStatus={
        d ? (
          <StatusBadge tone={statusTone(d.record.status)}>
            {t(`certificates.states.${d.record.status}`)}
          </StatusBadge>
        ) : null
      }
      printable
      printDisabled={!d || r.loading || !!r.error}
      title={t('certificates.detail')}
      footer={
        d ? (
          <div className='flex flex-wrap gap-2'>
            {!r.loading && !r.error ? (
              <>
                {primary ? (
                  <Button
                    nativeButton={false}
                    render={<Link to={link(primary.path)} />}
                  >
                    {label(primary.name)}
                  </Button>
                ) : null}
                {secondary.length ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant='outline' />}>
                      {t('certificates.moreActions')}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align='end'
                      className='w-auto min-w-40'
                    >
                      {secondary.map((item) => (
                        <DropdownMenuItem
                          key={item.name}
                          render={<Link to={link(item.path)} />}
                        >
                          {label(item.name)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                {d.capabilities.canDownload && d.capabilities.issue ? (
                  <Button
                    variant='outline'
                    disabled={busy}
                    onClick={() => {
                      void (async () => {
                        setBusy(true);
                        setError(undefined);
                        try {
                          await downloadDocx(
                            api,
                            {
                              path: `certificateIssues/${encodeURIComponent(d.capabilities.issue!.id)}/content`,
                              signal: controllerRef.current.signal,
                            },
                            documentName(d.capabilities.issue!.number),
                          );
                        } catch (e) {
                          if (!controllerRef.current.signal.aborted) {
                            setError(e);
                            r.reload();
                          }
                        } finally {
                          if (!controllerRef.current.signal.aborted)
                            setBusy(false);
                        }
                      })();
                    }}
                  >
                    {busy ? <Spinner /> : <Download />}
                    {t('certificates.download')}
                  </Button>
                ) : null}
              </>
            ) : null}
            <Button variant='outline' disabled={r.loading} onClick={refreshed}>
              <RefreshCw />
              {t('certificates.refresh')}
            </Button>
          </div>
        ) : undefined
      }
    >
      {r.error ? <CertificateError error={r.error} retry={r.reload} /> : null}
      {!d && r.loading ? <CertificateSkeleton /> : null}
      {d ? (
        <div className='flex flex-col gap-6'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <h2 className='text-lg font-semibold'>
              <UserNameText
                text={
                  d.capabilities.issue?.number ??
                  t('certificates.recordName', {
                    name: d.record.applicant.name,
                  })
                }
                name={d.record.applicant.name}
              />
            </h2>
          </div>
          <dl className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            {[
              [
                'applicant',
                <UserName key={'applicant'} name={d.record.applicant.name} />,
              ] as const,
              ['type', t(`certificates.types.${d.record.certificateType}`)],
              ['purpose', d.record.purpose],
              ['copies', String(d.record.copies)],
              [
                'delivery',
                t(`certificates.deliveries.${d.record.deliveryMethod}`),
              ],
              ['number', d.capabilities.issue?.number ?? '—'],
              ['issueDate', d.capabilities.issue?.issueDate ?? '—'],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className='text-sm text-muted-foreground'>
                  {t(`certificates.${label}`)}
                </dt>
                <dd className='mt-1 whitespace-pre-wrap break-words text-sm'>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          {error ? <CertificateError error={error} /> : null}
          <section className='flex flex-col gap-3'>
            <h3 className='font-semibold'>{t('certificates.history')}</h3>
            {d.actions.length ? (
              d.actions.map((a) => (
                <div
                  key={a.id}
                  className='flex flex-wrap justify-between gap-2 border-b pb-2 text-sm'
                >
                  <span>
                    <UserName name={a.actor.name} /> ·{' '}
                    {t(`certificates.actions.${a.action}`)}
                  </span>
                  <span className='text-muted-foreground'>
                    {new Date(a.createdAt).toLocaleString(i18n.language)}
                  </span>
                </div>
              ))
            ) : (
              <p className='text-sm text-muted-foreground'>—</p>
            )}
          </section>
        </div>
      ) : null}
      <Outlet
        context={{
          reload: () => {
            r.invalidate();
            parent.reload();
          },
        }}
      />
    </RouteDrawer>
  );
}
