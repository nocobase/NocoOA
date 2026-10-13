import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  Link,
  Outlet,
  useLocation,
  useOutletContext,
  useParams,
} from 'react-router';
import { Pencil, RefreshCw } from 'lucide-react';
import { RecordDetailDrawer } from '#components/record-detail-drawer';
import { Button } from '#components/ui/button';
import { StatusBadge } from '#components/status-badge';
import { RESOURCE, type Vendor, type VendorContext } from './types.js';
import { useVendorResource } from './resource.js';
import { VendorError, VendorSkeleton } from './states.js';
export default function VendorDetail() {
  const { vendorId = '' } = useParams(),
    { t, i18n } = useTranslation(),
    parent = useOutletContext<VendorContext>(),
    location = useLocation();
  const r = useVendorResource<{ data: Vendor }>(
      `vendors/${encodeURIComponent(vendorId)}`,
    ),
    p = useCan({
      resource: { type: 'composite', id: RESOURCE },
      action: 'manage',
    }),
    row = r.data?.data;
  return (
    <RecordDetailDrawer
      title={row?.name ?? t('vendors.view')}
      description={t('vendors.description')}
      footer={
        <>
          {p.can && !p.error && !p.isPending ? (
            <Button
              disabled={r.loading || !row}
              render={
                <Link to={{ pathname: 'edit', search: location.search }} />
              }
            >
              <Pencil data-icon='inline-start' />
              {t('vendors.edit')}
            </Button>
          ) : null}
          <Button variant='outline' disabled={r.loading} onClick={r.reload}>
            <RefreshCw data-icon='inline-start' />
            {t('vendors.refresh')}
          </Button>
        </>
      }
    >
      {r.error ? <VendorError error={r.error} retry={r.reload} /> : null}
      {!row ? (
        r.loading ? (
          <VendorSkeleton />
        ) : null
      ) : (
        <div className='flex flex-col gap-4'>
          <StatusBadge tone={row.active ? 'success' : 'neutral'}>
            {t(`vendors.statuses.${row.status}`)}
          </StatusBadge>
          <dl className='grid grid-cols-1 gap-4'>
            {(
              [
                'code',
                'name',
                'category',
                'contactName',
                'contactPhone',
                'contactEmail',
                'bankName',
                'bankAccount',
                'bankAccountName',
              ] as const
            )
              .filter((k) => typeof row[k] === 'string')
              .map((k) => (
                <div key={k} className='flex flex-col gap-1'>
                  <dt className='text-sm text-muted-foreground'>
                    {t(`vendors.fields.${k}`)}
                  </dt>
                  <dd className='break-words'>{row[k] || '—'}</dd>
                </div>
              ))}
            <div className='flex flex-col gap-1'>
              <dt className='text-sm text-muted-foreground'>
                {t('vendors.updatedAt')}
              </dt>
              <dd>
                {new Intl.DateTimeFormat(i18n.language, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(row.updatedAt))}
              </dd>
            </div>
          </dl>
        </div>
      )}
      <Outlet
        context={{
          onSaved: () => {
            r.reload();
            parent?.onSaved();
          },
        }}
      />
    </RecordDetailDrawer>
  );
}
