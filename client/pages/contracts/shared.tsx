import { useBusinessErrorMessage } from '#hooks/use-business-error-message';
import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactNode } from 'react';
import { useCloseGuard } from './use-close-guard.js';
import { Button } from '#components/ui/button';
import { Alert, AlertDescription, AlertAction } from '#components/ui/alert';
import { SessionExpiredAlert } from '#components/session-expired-alert';
import { Skeleton } from '#components/ui/skeleton';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '#components/ui/select';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '#components/ui/alert-dialog';
import { RefreshCw } from 'lucide-react';
export function ErrorState({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const businessMessage = useBusinessErrorMessage(error, 'contracts');
  const { t } = useTranslation();
  if (error instanceof ApiClientError && error.status === 401)
    return <SessionExpiredAlert />;
  const status = error instanceof ApiClientError ? error.status : 0;
  const reason = error instanceof ApiClientError ? error.reason : undefined;
  const key =
    status === 403
      ? reason === 'CONTRACT_FIELDS_RESTRICTED'
        ? 'fieldsRestricted'
        : 'noAccess'
      : status === 404
        ? 'missing'
        : status === 409
          ? 'conflict'
          : status === 400 || status === 412
            ? 'invalid'
            : 'failed';
  return (
    <Alert variant='destructive'>
      <AlertDescription>
        {businessMessage ?? t(`contracts.${key}`)}
      </AlertDescription>
      {retry &&
        (!businessMessage ||
          (error instanceof ApiClientError && error.status === 409)) &&
        (key === 'failed' || key === 'conflict') && (
          <AlertAction>
            <Button variant='outline' onClick={retry}>
              {t(
                key === 'conflict' ? 'contracts.loadLatest' : 'contracts.retry',
              )}
            </Button>
          </AlertAction>
        )}
    </Alert>
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
  renderLabel,
}: {
  id?: string;
  label: string;
  value: string;
  items: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  renderLabel?: (item: { value: string; label: string }) => ReactNode;
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
        <SelectValue>
          {renderLabel && items.find((item) => item.value === value)
            ? renderLabel(items.find((item) => item.value === value)!)
            : undefined}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {renderLabel ? renderLabel(item) : item.label}
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
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant='outline'
            size='icon'
            disabled={busy}
            aria-label={t('contracts.refresh')}
            onClick={onClick}
          />
        }
      >
        <RefreshCw className={busy ? 'animate-spin' : undefined} />
      </TooltipTrigger>
      <TooltipContent>{t('contracts.refresh')}</TooltipContent>
    </Tooltip>
  );
}
export function Loading({ fields = 6 }: { fields?: number }) {
  const { t } = useTranslation();
  return (
    <div
      className='flex flex-col gap-4'
      role='status'
      aria-label={t('status.loading')}
    >
      {Array.from({ length: fields }, (_, i) => (
        <Skeleton key={i} className='h-8 w-full' />
      ))}
    </div>
  );
}
export function Confirmation({
  open,
  title,
  description,
  confirm,
  onCancel,
  onConfirm,
  busy,
  destructive = false,
}: {
  open: boolean;
  title: ReactNode;
  description: ReactNode;
  confirm: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
  destructive?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !busy) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} onClick={onCancel}>
            {t('contracts.cancel')}
          </AlertDialogCancel>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={busy}
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
      title={t('contracts.discard')}
      description={t('contracts.discardDescription')}
      confirm={t('contracts.discardConfirm')}
      onCancel={guard.stay}
      onConfirm={guard.discard}
      destructive
    />
  );
}
