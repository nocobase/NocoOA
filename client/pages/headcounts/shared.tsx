import { ApplicationRefreshButton } from '#components/application-refresh-button';
import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactNode } from 'react';
import { UsersRound } from 'lucide-react';
import { Button } from '#components/ui/button';
import { Alert, AlertDescription, AlertAction } from '#components/ui/alert';
import { SessionExpiredAlert } from '#components/session-expired-alert';
import { Skeleton } from '#components/ui/skeleton';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '#components/ui/empty';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '#components/ui/select';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '#components/ui/alert-dialog';
import type { useCloseGuard } from './use-close-guard.js';
export function Failure({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const { t } = useTranslation();
  if (error instanceof ApiClientError && error.status === 401)
    return <SessionExpiredAlert />;
  const status = error instanceof ApiClientError ? error.status : 0;
  const reason = error instanceof ApiClientError ? error.reason : undefined;
  const key = reason?.startsWith('HEADCOUNT_')
    ? `headcounts.errors.${reason}`
    : status === 403
      ? 'headcounts.noAccess'
      : status === 404
        ? 'headcounts.missing'
        : 'headcounts.failed';
  return (
    <Alert variant='destructive'>
      <AlertDescription>{t(key)}</AlertDescription>
      {retry && ![401, 403, 404].includes(status) ? (
        <AlertAction>
          <Button type='button' variant='outline' onClick={retry}>
            {t(
              status === 409 || status === 412
                ? 'headcounts.loadLatest'
                : 'status.retry',
            )}
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
      aria-label={t('status.loading')}
      className='flex flex-col gap-4'
    >
      <Skeleton className='h-8 w-full' />
      <Skeleton className='h-8 w-full' />
      <Skeleton className='h-8 w-full' />
    </div>
  );
}
export function Choice({
  id,
  label,
  value,
  items,
  onChange,
  disabled,
  invalid,
}: {
  id?: string;
  label: string;
  value: string;
  items: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <Select
      items={items}
      value={value || null}
      onValueChange={(v) => onChange(v ?? '')}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        aria-label={label}
        aria-invalid={invalid || undefined}
        className='w-full'
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
        <SelectGroup>
          {items.map((v) => (
            <SelectItem key={v.value} value={v.value}>
              {v.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
export function Refresh({
  busy,
  onClick,
}: {
  busy: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ApplicationRefreshButton
      label={t('headcounts.refresh')}
      loading={busy}
      onClick={onClick}
    />
  );
}
export function EmptyState({
  filtered,
  manage,
}: {
  filtered: boolean;
  manage: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          <UsersRound />
        </EmptyMedia>
        <EmptyTitle>
          {t(filtered ? 'headcounts.noResults' : 'headcounts.empty')}
        </EmptyTitle>
        <EmptyDescription>
          {t(
            filtered
              ? 'headcounts.filterHelp'
              : manage
                ? 'headcounts.emptyManage'
                : 'headcounts.emptyRead',
          )}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
export function Confirmation({
  open,
  title,
  description,
  confirm,
  onCancel,
  onConfirm,
  destructive = false,
}: {
  open: boolean;
  title: ReactNode;
  description: ReactNode;
  confirm: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  destructive?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>
            {t('headcounts.cancel')}
          </AlertDialogCancel>
          <Button
            type='button'
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
          >
            {confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
export function Discard({
  guard,
}: {
  guard: ReturnType<typeof useCloseGuard>;
}) {
  const { t } = useTranslation();
  return (
    <Confirmation
      open={guard.confirm}
      title={t('headcounts.discard')}
      description={t('headcounts.discardDescription')}
      confirm={t('headcounts.discardConfirm')}
      onCancel={guard.stay}
      onConfirm={guard.discard}
      destructive
    />
  );
}
