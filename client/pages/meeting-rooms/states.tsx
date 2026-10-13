import { errorKey } from './errors.js';
import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { DoorOpen } from 'lucide-react';
import type { ReactNode } from 'react';
import { SessionExpiredAlert } from '#components/session-expired-alert';
import { Alert, AlertDescription, AlertAction } from '#components/ui/alert';
import { Button } from '#components/ui/button';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '#components/ui/empty';
import { Skeleton } from '#components/ui/skeleton';
export function MeetingError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const { t } = useTranslation();
  if (error instanceof ApiClientError && error.status === 401)
    return <SessionExpiredAlert />;
  return (
    <Alert variant='destructive'>
      <AlertDescription>
        {t(`meetingRooms.errors.${errorKey(error)}`)}
      </AlertDescription>
      {!(
        error instanceof ApiClientError && [403, 404].includes(error.status)
      ) ? (
        <AlertAction>
          <Button variant='outline' onClick={retry}>
            {t('meetingRooms.retry')}
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}
export function Loading() {
  const { t } = useTranslation();
  return (
    <div
      role='status'
      aria-label={t('meetingRooms.loading')}
      className='flex flex-col gap-4'
    >
      {[0, 1, 2].map((n) => (
        <Skeleton key={n} className='h-10 w-full' />
      ))}
    </div>
  );
}
export function NoRecords({
  filtered,
  action,
}: {
  filtered: boolean;
  action?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Empty className='min-h-48 border border-dashed'>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          <DoorOpen />
        </EmptyMedia>
        <EmptyTitle>
          {t(`meetingRooms.empty.${filtered ? 'filtered' : 'title'}`)}
        </EmptyTitle>
        <EmptyDescription>
          {t('meetingRooms.empty.description')}
        </EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

export function FormError({
  error,
}: {
  error?: { type?: string | number; message?: string };
}) {
  if (!error) return null;
  if (error.type === 'sessionExpired') return <SessionExpiredAlert />;
  return (
    <Alert variant='destructive'>
      <AlertDescription>{error.message}</AlertDescription>
    </Alert>
  );
}
