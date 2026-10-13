import { statusTone } from './status-tone.js';
import { ApprovalProgress } from '#components/approval-progress';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useToaster } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { offeredActions } from '@nocobase/app-plugin-approval/client';
import {
  Link,
  Outlet,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from 'react-router';
import { RefreshCw } from 'lucide-react';

import { RecordDetailDrawer } from '#components/record-detail-drawer';
import { Button } from '#components/ui/button';
import { StatusBadge } from '#components/status-badge';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import {
  ApprovalUiProvider,
  ApprovalTimeline,
} from '#extensions/nocobase-approval-ui';
import { useResource } from './resource.js';
import { ErrorState, FieldsSkeleton } from './states.js';
import { Facts } from './facts.js';
import { progressOf, copiesOf, timelineOf } from './approval-mapping.js';
import { useSourceTrail, focusSource } from './breadcrumb.js';
import {
  editableRecord,
  fullAllocation,
  statusOf,
  type Detail,
  type SourceContext,
  type AssetOption,
  type Page,
} from './types.js';
function Value({ id, generation }: { id: string; generation: number }) {
  const { t, i18n } = useTranslation();
  const r = useResource<{ data: { originalValueCents: number | null } }>(
    `assetRequests/${id}/value`,
  );
  const generationRef = useRef(generation);
  useEffect(() => {
    if (generationRef.current !== generation) {
      generationRef.current = generation;
      r.reload();
    }
  }, [generation, r]);
  return (
    <section className='flex flex-col gap-4'>
      <h2 className='text-base font-medium'>
        {t('assetRequests.originalValue')}
      </h2>
      {r.error ? (
        <ErrorState error={r.error} retry={r.reload} />
      ) : r.data ? (
        <p className='text-sm tabular-nums'>
          {r.data.data.originalValueCents === null
            ? '—'
            : new Intl.NumberFormat(i18n.language, {
                style: 'currency',
                currency: 'CNY',
              }).format(r.data.data.originalValueCents / 100)}
        </p>
      ) : (
        <FieldsSkeleton fields={1} />
      )}
    </section>
  );
}
export default function AssetRequestDetail() {
  const { requestId } = useParams();
  const { t, i18n } = useTranslation();
  const location = useLocation(),
    navigate = useNavigate(),
    toaster = useToaster();
  const parent = useOutletContext<SourceContext>();
  const r = useResource<{ data: Detail }>(
    `assetRequests/${encodeURIComponent(requestId ?? '')}`,
  );
  const d = r.data?.data,
    name = d?.record.number ?? t('assetRequests.draft');
  const trail = useSourceTrail(name);
  const missingRef = useRef(false);
  const [refreshGeneration, setRefreshGeneration] = useState(0);
  const access = useCan({
      resource: { type: 'composite', id: 'oa.assetRequests' },
      action: 'operate',
    }),
    edit = useCan({
      resource: { type: 'composite', id: 'oa.assetRequests' },
      action: 'edit',
    }),
    value = useCan({
      resource: { type: 'composite', id: 'oa.assetRequests' },
      action: 'viewValue',
    }),
    returning = useCan({
      resource: { type: 'composite', id: 'oa.assetRequests' },
      action: 'returnIssued',
    });
  const returnEligibility = useResource<Page<AssetOption>>(
    returning.can &&
      d?.record.operation === 'use' &&
      d.record.status === 'issued' &&
      !r.error
      ? 'assetRequests/eligibleAssets'
      : null,
    {
      purpose: 'receive',
      mode: 'returnIssued',
      requestId: requestId ?? '',
      page: '1',
      pageSize: '1',
    },
  );
  useEffect(() => {
    if (statusOf(r.error) === 404 && !missingRef.current) {
      missingRef.current = true;
      parent?.reload?.();
      toaster.show({
        type: 'error',
        title: t('assetRequests.missingNamed', { name }),
      });
      void navigate(
        { pathname: trail.source, search: trail.search },
        { replace: true },
      );
      focusSource();
    }
  }, [r.error, parent, navigate, toaster, t, name, trail.source, trail.search]);
  const actions =
    d && !r.error && !r.loading && access.can
      ? offeredActions(
          d.taskActions,
          d.runActions,
          d.runs.map((v) => v.run),
        )
      : [];
  const lifecycle =
    d && !r.error && !r.loading
      ? d.view.available.filter(
          (a) =>
            a.allowed && ['submit', 'withdraw', 'terminate'].includes(a.name),
        )
      : [];
  const text = useMemo(
    () => ({
      t: (key: string, options?: Record<string, unknown>) => t(key, options),
      name: (id: string | null | undefined) =>
        d?.users.find((v) => v.id === id)?.name ?? t('approvals.unknownPerson'),
      stage: (key: string) =>
        t(`assetRequests.statuses.${key}`, {
          defaultValue: t('approvals.progress'),
        }),
    }),
    [t, d],
  );
  const link = (path: string) => ({ pathname: path, search: location.search });
  return (
    <RecordDetailDrawer
      headerStatus={
        d ? (
          <StatusBadge tone={statusTone(d.record.status)}>
            {t(`assetRequests.statuses.${d.record.status}`)}
          </StatusBadge>
        ) : null
      }
      printable
      printDisabled={!d || r.loading || !!r.error}
      title={name}
      description={t('assetRequests.detailDescription')}
      footer={
        <div className='flex flex-wrap items-center gap-2'>
          {d &&
          !r.error &&
          !r.loading &&
          edit.can &&
          editableRecord(d.record) &&
          d.view.available.some((a) => a.name === 'edit' && a.allowed) ? (
            <Button variant='outline' render={<Link to={link('edit')} />}>
              {t('assetRequests.edit')}
            </Button>
          ) : null}
          {lifecycle.map((a) =>
            access.can ? (
              <Button
                key={a.name}
                variant={a.name === 'submit' ? 'default' : 'outline'}
                render={<Link to={link(`action/${a.name}/record`)} />}
              >
                {t(`assetRequests.actions.${a.name}`)}
              </Button>
            ) : null,
          )}
          {actions.map((a, index) => (
            <Button
              key={a.key}
              variant={
                a.tone === 'danger'
                  ? 'destructive'
                  : !lifecycle.some((v) => v.name === 'submit') &&
                      index === 0 &&
                      a.primary
                    ? 'default'
                    : 'outline'
              }
              render={
                <Link
                  to={link(
                    `action/${a.name}/${'taskId' in a.target ? a.target.taskId : a.target.runId}`,
                  )}
                />
              }
            >
              {t(`assetRequests.actions.${a.name}`)}
            </Button>
          ))}
          {d &&
          !r.error &&
          !r.loading &&
          returning.can &&
          fullAllocation(d.record) &&
          !!returnEligibility.data &&
          !returnEligibility.error &&
          !returnEligibility.loading &&
          d.record.operation === 'use' &&
          d.record.status === 'issued' ? (
            <Button variant='outline' render={<Link to={link('return')} />}>
              {t('assetRequests.actions.returnIssued')}
            </Button>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant='outline'
                  size='icon'
                  aria-label={t('assetRequests.refresh')}
                  disabled={r.loading}
                  onClick={() => {
                    r.reload();
                    returnEligibility.reload();
                    setRefreshGeneration((v) => v + 1);
                  }}
                />
              }
            >
              <RefreshCw className={r.loading ? 'animate-spin' : undefined} />
            </TooltipTrigger>
            <TooltipContent>{t('assetRequests.refresh')}</TooltipContent>
          </Tooltip>
        </div>
      }
    >
      <div className='space-y-6'>
        {r.error ? <ErrorState error={r.error} retry={r.reload} /> : null}
        {!d ? (
          r.loading ? (
            <FieldsSkeleton />
          ) : null
        ) : (
          <>
            <Facts record={d.record} timeZone={d.timeZone} />
            {returnEligibility.error ? (
              <ErrorState error={returnEligibility.error} />
            ) : null}
            {value.can && !value.isPending && !value.error && d.record.id ? (
              <Value
                key={d.record.id}
                id={d.record.id}
                generation={refreshGeneration}
              />
            ) : null}
            <ApprovalUiProvider
              personName={text.name}
              formatDateTime={(v) =>
                new Intl.DateTimeFormat(i18n.language, {
                  timeZone: d.timeZone,
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(v))
              }
            >
              <section className='flex flex-col gap-4'>
                <h2 className='text-base font-medium'>
                  {t('approvals.progress')}
                </h2>
                <ApprovalProgress
                  steps={progressOf(d, text, i18n.language)}
                  copies={copiesOf(d)}
                />
              </section>
              <section className='flex flex-col gap-4'>
                <h2 className='text-base font-medium'>
                  {t('approvals.timeline')}
                </h2>
                <ApprovalTimeline lines={timelineOf(d, text)} />
              </section>
            </ApprovalUiProvider>
            <Outlet
              context={{
                detail: d,
                updateDetail: (detail: Detail) => r.update({ data: detail }),
                reload: () => {
                  r.reload();
                  parent?.reload?.();
                },
              }}
            />
          </>
        )}
      </div>
    </RecordDetailDrawer>
  );
}
