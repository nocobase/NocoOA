import { UserName } from '#components/user-name';
import { ResponsiveTable as Table } from '#components/responsive-table';
import { useMissing } from './use-missing.js';
import { useMemo, useReducer } from 'react';
import {
  useParams,
  useLocation,
  useOutletContext,
  Link,
  Outlet,
} from 'react-router';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { RecordDetailDrawer } from '#components/record-detail-drawer';

import { Button } from '#components/ui/button';
import { StatusBadge } from '#components/status-badge';
import {
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '#components/ui/table';
import { useResource } from '../approvals/use-resource.js';
import { useTrail } from './breadcrumb.js';
import { money, dateLabel } from './model.js';
import { ErrorState, Loading, Refresh } from './shared.js';
import { SecureFiles } from './files.js';
import type { LedgerDetail, SourceContext } from './types.js';
export default function LedgerDetailPage() {
  const { contractId = '' } = useParams(),
    location = useLocation(),
    parent = useOutletContext<SourceContext>(),
    { session } = useAuthentication(),
    { t, i18n } = useTranslation(),
    [refreshKey, refreshFiles] = useReducer((n: number) => n + 1, 0);
  const resource = useResource<LedgerDetail>(`contracts/${contractId}`, {
      viewer: session?.user.id ?? '',
    }),
    data = resource.data;
  const submit = useCan({
      resource: { type: 'composite', id: 'oa.contract' },
      action: 'submit',
    }),
    application = useCan({
      resource: { type: 'page', id: 'oa-contract-requests' },
      action: 'access',
    }),
    view = useCan({
      resource: { type: 'composite', id: 'oa.contract' },
      action: 'view',
    }),
    canRequest =
      application.can &&
      !application.isPending &&
      !application.error &&
      view.can &&
      !view.isPending &&
      !view.error;
  const trail = useTrail(data?.contract.number ?? t('contracts.ledgerTitle'));
  useMissing(resource.error, trail.source, trail.search, parent?.reload);
  const { reload } = resource;
  const context = useMemo(
    () => ({
      reload: () => {
        reload();
        refreshFiles();
        parent?.reload();
      },
      focusList: parent?.focusList,
    }),
    [reload, parent],
  );
  function link(operation: string) {
    const p = new URLSearchParams(location.search);
    p.set('operation', operation);
    p.set('source', contractId);
    return { pathname: 'newContract', search: p.toString() };
  }
  return (
    <RecordDetailDrawer
      title={data?.contract.number ?? t('contracts.ledgerTitle')}
      footer={
        <>
          {data &&
          ['active', 'activePendingSeal'].includes(data.contract.status) &&
          submit.can &&
          !submit.isPending &&
          !submit.error &&
          canRequest ? (
            <div className='flex flex-wrap gap-2'>
              {['change', 'renew', 'terminate'].map((operation) => (
                <Button
                  key={operation}
                  variant='outline'
                  nativeButton={false}
                  render={<Link to={link(operation)} />}
                >
                  {t(`contracts.operations.${operation}`)}
                </Button>
              ))}
            </div>
          ) : null}
          <Refresh
            busy={resource.loading}
            onClick={() => {
              resource.reload();
              refreshFiles();
            }}
          />
        </>
      }
    >
      <div className='flex flex-col gap-6'>
        {resource.error ? (
          <ErrorState error={resource.error} retry={resource.reload} />
        ) : null}
        {!data ? (
          !resource.error && <Loading fields={8} />
        ) : (
          <>
            <StatusBadge
              tone={data.contract.status === 'active' ? 'success' : 'neutral'}
            >
              {t(`contracts.statuses.${data.contract.status}`)}
            </StatusBadge>
            <dl className='grid gap-4 sm:grid-cols-2'>
              {(
                [
                  'version',
                  'amountCents',
                  'paidCents',
                  'heldCents',
                  'availableCents',
                ] as const
              ).map((key) => (
                <div key={key}>
                  <dt className='text-sm text-muted-foreground'>
                    {t(`contracts.${key}`)}
                  </dt>
                  <dd className='tabular-nums'>
                    {key === 'version'
                      ? data.contract.version
                      : money(data.contract[key], i18n.language)}
                  </dd>
                </div>
              ))}
            </dl>
            <section className='flex flex-col gap-4'>
              <h2 className='text-base font-medium'>
                {t('contracts.proposal')}
              </h2>
              <dl className='grid gap-3 sm:grid-cols-[8rem_1fr]'>
                {[
                  'contractType',
                  'counterparty',
                  'startsOn',
                  'endsOn',
                  'paymentTerms',
                  'standardTemplate',
                ].map((key) => (
                  <div key={key} className='contents'>
                    <dt className='text-muted-foreground'>
                      {t(`contracts.${key}`)}
                    </dt>
                    <dd className='min-w-0 whitespace-pre-wrap break-words'>
                      {key === 'counterparty'
                        ? data.contract.facts.counterparty.name
                        : key === 'startsOn' || key === 'endsOn'
                          ? dateLabel(data.contract.facts[key], i18n.language)
                          : key === 'standardTemplate'
                            ? t(
                                data.contract.facts.standardTemplate
                                  ? 'contracts.yes'
                                  : 'contracts.no',
                              )
                            : String(
                                data.contract.facts[
                                  key as 'contractType' | 'paymentTerms'
                                ] ?? '—',
                              )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className='flex flex-col gap-4'>
              <h2 className='text-base font-medium'>
                {t('contracts.versions')}
              </h2>
              <p className='text-sm text-muted-foreground'>
                {t('contracts.privateTextHint')}
              </p>
              <div className='overflow-x-auto'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      {[
                        'version',
                        'amountCents',
                        'actor',
                        'createdAt',
                        'textVersionId',
                        'request',
                      ].map((key) => (
                        <TableHead
                          key={key}
                          className={
                            key === 'version' || key === 'amountCents'
                              ? 'text-right'
                              : undefined
                          }
                        >
                          {t(`contracts.${key}`)}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.versions.map((version) => (
                      <TableRow key={version.id}>
                        <TableCell className='text-right tabular-nums'>
                          {version.version ?? '—'}
                        </TableCell>
                        <TableCell className='text-right tabular-nums'>
                          {money(version.amountCents, i18n.language)}
                        </TableCell>
                        <TableCell>
                          <UserName name={version.actor?.name ?? '—'} />
                        </TableCell>
                        <TableCell>
                          {dateLabel(
                            version.at,
                            i18n.language,
                            data.timeZone ?? 'UTC',
                          )}
                        </TableCell>
                        <TableCell>
                          {version.requestId ? (
                            <SecureFiles
                              requestId={version.requestId}
                              text
                              refreshKey={refreshKey}
                            />
                          ) : (
                            <span>—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {version.requestId && canRequest ? (
                            <Button
                              variant='outline'
                              nativeButton={false}
                              render={
                                <Link
                                  to={{
                                    pathname: `contract/${version.requestId}`,
                                    search: location.search,
                                  }}
                                />
                              }
                            >
                              {t('contracts.openRequest')}
                            </Button>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          </>
        )}
        <Outlet context={context} />
      </div>
    </RecordDetailDrawer>
  );
}
