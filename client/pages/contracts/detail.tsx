import { statusTone } from './status-tone.js';
import { PrintEntry } from '../template-print/entry.js';
import { useMissing } from './use-missing.js';
import { useMemo, useReducer } from 'react';
import {
  Link,
  Outlet,
  useOutletContext,
  useParams,
  useLocation,
} from 'react-router';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { RecordDetailDrawer } from '#components/record-detail-drawer';

import { Button } from '#components/ui/button';
import { StatusBadge } from '#components/status-badge';
import { Alert, AlertDescription } from '#components/ui/alert';
import { useResource } from '../approvals/use-resource.js';
import { ErrorState, Loading, Refresh } from './shared.js';
import { useTrail } from './breadcrumb.js';
import { offersOf, money, dateLabel } from './model.js';
import { SecureFiles } from './files.js';
import { ContractHistory } from './approval-mapping.js';
import type { ContractDetail, SourceContext } from './types.js';
export default function RequestDetail() {
  const { requestId = '' } = useParams(),
    { session } = useAuthentication(),
    { t, i18n } = useTranslation(),
    location = useLocation(),
    parent = useOutletContext<SourceContext>(),
    [refreshKey, refreshFiles] = useReducer((n: number) => n + 1, 0);
  const grant = useCan({
      resource: { type: 'composite', id: 'oa.contract' },
      action: 'view',
    }),
    mutation = useCan({
      resource: { type: 'composite', id: 'oa.contract' },
      action: 'submit',
    }),
    historical = useCan({
      resource: { type: 'composite', id: 'oa.contract' },
      action: 'historicalEntry',
    });
  const resource = useResource<ContractDetail>(
    grant.can && !grant.isPending && !grant.error
      ? `contractRequests/${encodeURIComponent(requestId)}`
      : null,
    { viewer: session?.user.id ?? '' },
  );
  const data =
      grant.can && !grant.isPending && !grant.error ? resource.data : undefined,
    name = data?.record.number ?? t('contracts.draftName');
  const trail = useTrail(name);
  useMissing(resource.error, trail.source, trail.search, parent?.reload);
  const writable = !!data && !resource.loading && !resource.error;
  const transitions =
    writable && mutation.can && !mutation.isPending && !mutation.error
      ? data.view.available.filter(
          (a) =>
            a.allowed &&
            ['edit', 'submit', 'withdraw', 'terminate', 'rebase'].includes(
              a.name,
            ),
        )
      : [];
  const canHistorical =
    writable &&
    historical.can &&
    !historical.isPending &&
    !historical.error &&
    data.view.available.some((a) => a.allowed && a.name === 'historicalEntry');
  const offers = writable
    ? offersOf(data).filter((a) =>
        [
          'approve',
          'reject',
          'return',
          'claim',
          'comment',
          'read',
          'transfer',
          'addSigner',
          'urge',
          'appoint',
          'reassign',
        ].includes(a.name),
      )
    : [];
  const primary = transitions.some((a) => a.name === 'submit')
    ? 'submit'
    : offers.find((a) => a.primary)?.key;
  const { update, reload } = resource;
  const context = useMemo(
    () =>
      data
        ? {
            detail: data,
            apply: update,
            reload: () => {
              reload();
              refreshFiles();
              parent?.reload();
            },
            focusList: parent?.focusList,
          }
        : undefined,
    [data, update, reload, parent],
  );
  const actionLink = (path: string) => ({
    pathname: path,
    search: location.search,
  });
  return (
    <RecordDetailDrawer
      headerStatus={
        data ? (
          <StatusBadge tone={statusTone(data.record.status)}>
            {t(`contracts.statuses.${data.record.status}`)}
          </StatusBadge>
        ) : null
      }
      printable
      printDisabled={!data || resource.loading || !!resource.error}
      title={name}
      footer={
        <>
          <div className='flex flex-wrap gap-2'>
            {transitions.map((a) => (
              <Button
                key={a.name}
                variant={primary === a.name ? 'default' : 'outline'}
                nativeButton={false}
                render={
                  <Link
                    to={actionLink(
                      a.name === 'edit'
                        ? 'edit'
                        : a.name === 'rebase'
                          ? 'rebase'
                          : `action/${a.name}/${requestId}`,
                    )}
                  />
                }
              >
                {t(`contracts.actions.${a.name}`)}
              </Button>
            ))}
            {offers.map((a) => (
              <Button
                key={a.key}
                variant={primary === a.key ? 'default' : 'outline'}
                nativeButton={false}
                render={
                  <Link
                    to={actionLink(
                      `action/${a.name}/${encodeURIComponent('taskId' in a.target ? a.target.taskId : a.target.runId)}`,
                    )}
                  />
                }
              >
                {t(`contracts.actions.${a.name}`)}
              </Button>
            ))}
            <PrintEntry source='contracts' readable={writable} />
            {canHistorical ? (
              <Button
                variant='outline'
                nativeButton={false}
                render={
                  <Link
                    to={actionLink(`action/historicalEntry/${requestId}`)}
                  />
                }
              >
                {t('contracts.historicalEntry')}
              </Button>
            ) : null}
          </div>
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
        {!grant.isPending && !grant.can ? (
          <Alert>
            <AlertDescription>{t('contracts.noAccess')}</AlertDescription>
          </Alert>
        ) : !data ? (
          !resource.error && <Loading fields={10} />
        ) : (
          <>
            <section className='flex flex-col gap-4'>
              <h2 className='text-base font-medium'>
                {t('contracts.proposal')}
              </h2>
              <dl className='grid gap-3 sm:grid-cols-[8rem_1fr]'>
                {[
                  'operation',
                  'contractType',
                  'counterparty',
                  'amountCents',
                  'startsOn',
                  'endsOn',
                  'paymentTerms',
                  'standardTemplate',
                  'reason',
                  'baseVersion',
                ].map((key) => (
                  <div key={key} className='contents'>
                    <dt className='text-muted-foreground'>
                      {t(`contracts.${key}`)}
                    </dt>
                    <dd className='min-w-0 whitespace-pre-wrap break-words'>
                      {key === 'operation'
                        ? t(`contracts.operations.${data.record.operation}`)
                        : key === 'counterparty'
                          ? data.record.counterparty.name
                          : key === 'amountCents'
                            ? money(data.record.amountCents, i18n.language)
                            : key === 'startsOn' || key === 'endsOn'
                              ? dateLabel(data.record[key], i18n.language)
                              : key === 'standardTemplate'
                                ? t(
                                    data.record.standardTemplate
                                      ? 'contracts.yes'
                                      : 'contracts.no',
                                  )
                                : String(
                                    data.record[
                                      key as
                                        | 'contractType'
                                        | 'paymentTerms'
                                        | 'reason'
                                        | 'baseVersion'
                                    ] ?? '—',
                                  ) || '—'}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className='flex flex-col gap-4'>
              <h2 className='text-base font-medium'>
                {t('contracts.textVersionId')}
              </h2>
              <SecureFiles requestId={requestId} text refreshKey={refreshKey} />
            </section>
            <section className='flex flex-col gap-4'>
              <h2 className='text-base font-medium'>
                {t('contracts.attachments')}
              </h2>
              <SecureFiles
                requestId={requestId}
                ids={data.record.attachments}
                refreshKey={refreshKey}
              />
            </section>
            <ContractHistory detail={data} />
          </>
        )}
        {context && (
          <Outlet
            context={{
              ...context,
              printSource: 'contracts',
              printRecordId: data?.record.id,
              printRecordName: name,
              printRefresh: context.reload,
            }}
          />
        )}
      </div>
    </RecordDetailDrawer>
  );
}
