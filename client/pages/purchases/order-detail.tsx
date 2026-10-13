import { UserName } from '#components/user-name';
import { useEffect } from 'react';
import {
  Link,
  Outlet,
  useLocation,
  useOutletContext,
  useParams,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { ApiClientError } from '@nocobase/app-client';
import { RefreshCw } from 'lucide-react';
import { RecordDetailDrawer } from '#components/record-detail-drawer';

import { Button } from '#components/ui/button';
import { StatusBadge } from '#components/status-badge';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import { useResource } from '../approvals/use-resource.js';
import { FieldsSkeleton } from '../platform/shared/states.js';
import { ErrorState } from './states.js';
import { amountText } from './money.js';
import type { PurchaseOrder, SourceContext } from './types.js';
export interface OrderDetail {
  record: PurchaseOrder;
  payments: { pendingCents: number; paidCents: number };
  timeZone: string;
  actions: { accept: boolean; cancel: boolean };
}
export default function PurchaseOrderDetail() {
  const { orderId = '' } = useParams(),
    { t, i18n } = useTranslation(),
    location = useLocation(),
    parent = useOutletContext<SourceContext>();
  const resource = useResource<OrderDetail>(
    `purchaseOrders/${encodeURIComponent(orderId)}`,
  );
  useEffect(() => {
    if (
      resource.error instanceof ApiClientError &&
      resource.error.status === 404
    )
      parent.reload();
  }, [parent, resource.error]);
  const data = resource.data,
    record = data?.record;
  const ready = !!data && !resource.error && !resource.loading;
  const date = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(new Date(`${value}T12:00:00Z`));
  const facts =
    record && data
      ? [
          [
            t('purchases.vendor'),
            `${record.vendor.code} · ${record.vendor.name} · ${record.vendor.category}`,
          ],
          [
            t('approvals.applicant'),
            <UserName
              key={t('approvals.applicant')}
              name={record.applicant?.name ?? t('approvals.unknownPerson')}
            />,
          ] as const,
          [t('purchases.actualAmount'), amountText(record.actualCents)],
          [t('purchases.budgetYear'), String(record.account.year)],
          [t('purchases.subject'), record.account.subject],
          [
            t('purchases.pendingPayments'),
            amountText(data.payments.pendingCents),
          ],
          [t('purchases.paidPayments'), amountText(data.payments.paidCents)],
          [
            t('purchases.receiptDate'),
            record.receiptDate ? date(record.receiptDate) : '—',
          ],
          [t('purchases.acceptedBy'), record.acceptedBy?.name ?? '—'],
          [t('purchases.receiptReason'), record.receiptReason ?? '—'],
        ]
      : [];
  return (
    <RecordDetailDrawer
      title={record?.number ?? t('purchases.order')}
      footer={
        <>
          {ready && data.actions.accept ? (
            <Button render={<Link to={`accept${location.search}`} />}>
              {t('purchases.confirmReceipt')}
            </Button>
          ) : null}
          {ready && data.actions.cancel ? (
            <Button
              variant='outline'
              render={<Link to={`cancel${location.search}`} />}
            >
              {t('purchases.cancelOrder')}
            </Button>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant='outline'
                  size='icon'
                  aria-label={t('approvals.refresh')}
                  disabled={resource.loading}
                  onClick={resource.reload}
                />
              }
            >
              <RefreshCw
                className={resource.loading ? 'animate-spin' : undefined}
              />
            </TooltipTrigger>
            <TooltipContent>{t('approvals.refresh')}</TooltipContent>
          </Tooltip>
        </>
      }
    >
      <div className='flex flex-col gap-6'>
        {resource.error ? (
          <ErrorState error={resource.error} retry={resource.reload} />
        ) : null}
        {!data && resource.loading ? <FieldsSkeleton fields={8} /> : null}
        {record && data ? (
          <>
            <StatusBadge
              tone={
                record.status === 'accepted'
                  ? 'success'
                  : record.status === 'cancelled'
                    ? 'warning'
                    : 'info'
              }
            >
              {t(`purchases.orderStates.${record.status}`)}
            </StatusBadge>
            <p className='text-sm text-muted-foreground'>
              {t('purchases.orderHint')}
            </p>
            <dl className='grid gap-4 sm:grid-cols-2'>
              {facts.map(([label, value]) => (
                <div key={label}>
                  <dt className='text-sm text-muted-foreground'>{label}</dt>
                  <dd className='mt-1 wrap-anywhere whitespace-pre-wrap'>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <div className='flex flex-col gap-3'>
              <h2 className='text-base font-semibold'>
                {t('purchases.items')}
              </h2>
              {record.items.map((item) => (
                <div key={item.id} className='rounded-md border p-4'>
                  <p className='font-medium wrap-anywhere'>{item.name}</p>
                  <p className='mt-1 text-sm whitespace-pre-wrap wrap-anywhere'>
                    {item.specification || '—'}
                  </p>
                  <p className='mt-2 text-sm'>
                    {item.quantity} {item.unit}
                  </p>
                </div>
              ))}
            </div>
          </>
        ) : null}
        <Outlet
          context={{
            detail: data,
            reload: () => {
              resource.reload();
              parent.reload();
            },
          }}
        />
      </div>
    </RecordDetailDrawer>
  );
}
