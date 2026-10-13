import {
  Link,
  Outlet,
  useLocation,
  useOutletContext,
  useParams,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { RecordDetailDrawer } from '#components/record-detail-drawer';
import { Button } from '#components/ui/button';
import { useRecruitmentResource } from './resource.js';
import { ErrorState, Loading, Refresh } from './shared.js';
import type { Requisition, Source } from './types.js';
export default function RequisitionDetail() {
  const { requisitionId = '' } = useParams(),
    location = useLocation(),
    { t } = useTranslation(),
    parent = useOutletContext<Source>(),
    r = useRecruitmentResource<{ data: Requisition }>(
      `requisitions/${encodeURIComponent(requisitionId)}`,
    ),
    grant = useCan({
      resource: { type: 'composite', id: 'oa.requisitions' },
      action: 'close',
    }),
    record = r.data?.data,
    reload = () => {
      r.reload();
      parent.reload();
    };
  return (
    <RecordDetailDrawer
      title={t('recruitment.requisitions')}
      footer={
        <>
          {record &&
          !r.loading &&
          !r.error &&
          record.status === 'recruiting' &&
          grant.can &&
          !grant.isPending &&
          !grant.error ? (
            <Button
              nativeButton={false}
              variant='destructive'
              render={
                <Link
                  to={{
                    pathname: 'close',
                    search: location.search,
                    hash: location.hash,
                  }}
                />
              }
            >
              {t('recruitment.actions.close')}
            </Button>
          ) : null}
          <Refresh busy={r.loading} onClick={reload} />
        </>
      }
    >
      {r.error ? (
        <ErrorState error={r.error} retry={reload} />
      ) : r.loading ? (
        <Loading />
      ) : record ? (
        <dl className='grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] sm:grid-cols-[8rem_minmax(0,1fr)] gap-3'>
          {(
            [
              'id',
              'requestId',
              'departmentId',
              'positionId',
              'gradeId',
              'sourceYear',
              'sourceVersion',
              'originalQuantity',
              'remaining',
              'consumed',
              'status',
            ] as const
          ).map((key) => (
            <div className='contents' key={key}>
              <dt className='text-muted-foreground'>
                {t(`recruitment.fields.${key}`)}
              </dt>
              <dd className='min-w-0 break-words'>
                {key === 'status'
                  ? t(`recruitment.status.${record.status}`)
                  : record[key]}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <Outlet context={{ reload }} />
    </RecordDetailDrawer>
  );
}
