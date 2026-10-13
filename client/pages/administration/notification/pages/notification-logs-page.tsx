import { StatusBadge as ApplicationStatusBadge } from '#components/status-badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '#components/ui/dialog';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '#components/ui/select';
import { Button } from '#components/ui/button';
import { RefreshCw } from 'lucide-react';
import { ApplicationToolbar } from '#components/application-toolbar';
import { ResponsiveTable as Table } from '#components/responsive-table';
import { PageContainer } from '../components/page-container.js';
import { PageHeader } from '../components/page-header.js';
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { useTranslation } from '@nocobase/i18n/client';

import type {
  NotificationDeliveryDetails,
  NotificationLogDetails,
  NotificationStatus,
  NotificationTestTarget,
} from '../notification-client.js';
import { getNotificationClient } from '../runtime.js';

const notification = getNotificationClient();

type Translate = (
  key: string,
  options?: Readonly<Record<string, unknown>>,
) => string;

export default function NotificationLogsPage(): ReactElement {
  const { t } = useTranslation('@nocobase/app-plugin-notification');
  const [logs, setLogs] = useState<readonly NotificationLogDetails[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [testOpen, setTestOpen] = useState(false);
  const [testTargets, setTestTargets] =
    useState<readonly NotificationTestTarget[]>();
  const [testTargetsError, setTestTargetsError] = useState<string>();

  const refresh = (): void => {
    setLoading(true);
    setError(undefined);
    setRevision((value) => value + 1);
  };

  useEffect(() => {
    let active = true;
    void notification
      .listLogs()
      .then(
        (nextLogs) => {
          if (active) setLogs(nextLogs);
        },
        (cause: unknown) => {
          if (active)
            setError(
              errorMessage(
                cause,
                t('errors.requestFailed', {
                  defaultValue: 'Notification request failed.',
                }),
              ),
            );
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [revision, t]);

  useEffect(() => {
    let active = true;
    void notification.listTestTargets().then(
      (targets) => {
        if (active) {
          setTestTargets(targets);
          setTestTargetsError(undefined);
        }
      },
      (cause: unknown) => {
        if (active) {
          setTestTargets([]);
          setTestTargetsError(
            errorMessage(
              cause,
              t('errors.requestFailed', {
                defaultValue: 'Notification request failed.',
              }),
            ),
          );
        }
      },
    );
    return () => {
      active = false;
    };
  }, [t]);

  const totals = useMemo(
    () => ({
      deliveries: logs.reduce((sum, item) => sum + item.deliveries.length, 0),
      attention: logs.filter((item) =>
        ['failed', 'partial', 'unknown'].includes(item.log.status),
      ).length,
    }),
    [logs],
  );

  return (
    <PageContainer>
      <PageHeader
        title={t('logs.title', { defaultValue: 'Notification logs' })}
        description={t('logs.description', {
          defaultValue:
            'Trace notification delivery and every provider attempt. Message bodies, recipients, and lease tokens are redacted.',
        })}
      />
      <ApplicationToolbar
        actions={
          <>
            <Button
              variant='outline'
              size='icon'
              aria-label={t('logs.refresh', { defaultValue: 'Refresh' })}
              title={t('logs.refresh', { defaultValue: 'Refresh' })}
              disabled={loading}
              onClick={refresh}
              type='button'
            >
              <RefreshCw className={loading ? 'animate-spin' : undefined} />
            </Button>
            <Button onClick={() => setTestOpen(true)} type='button'>
              {t('logs.sendTest', {
                defaultValue: 'Send test notification',
              })}
            </Button>
          </>
        }
      />

      <div className='space-y-5'>
        <div className='grid max-w-md grid-cols-2 gap-3'>
          <Metric
            label={t('logs.deliveriesShown', {
              defaultValue: 'Deliveries shown',
            })}
            value={totals.deliveries}
          />
          <Metric
            attention
            label={t('logs.needAttention', { defaultValue: 'Need attention' })}
            value={totals.attention}
          />
        </div>

        {error ? (
          <div className='rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive'>
            <p className='font-medium'>
              {t('logs.unavailable', { defaultValue: 'Logs unavailable' })}
            </p>
            <p className='mt-1'>{error}</p>
          </div>
        ) : null}

        <section className='overflow-hidden rounded-xl border bg-card shadow-sm'>
          <div className='border-b bg-muted/20 px-5 py-4'>
            <h2 className='font-semibold'>
              {t('logs.recent', { defaultValue: 'Recent notifications' })}
            </h2>
          </div>
          {loading ? (
            <div className='p-12 text-center text-sm text-muted-foreground'>
              {t('logs.loading', {
                defaultValue: 'Loading delivery history…',
              })}
            </div>
          ) : logs.length === 0 ? (
            <div className='p-12 text-center'>
              <p className='font-medium'>
                {t('logs.emptyTitle', { defaultValue: 'No deliveries yet' })}
              </p>
              <p className='mt-1 text-sm text-muted-foreground'>
                {t('logs.emptyDescription', {
                  defaultValue:
                    'Delivery records will appear here after notifications are sent.',
                })}
              </p>
            </div>
          ) : (
            <NotificationLogsTable logs={logs} targets={testTargets} />
          )}
        </section>
      </div>
      {testOpen ? (
        <TestNotificationDialog
          targets={testTargets}
          targetsError={testTargetsError}
          onClose={() => setTestOpen(false)}
          onSent={refresh}
        />
      ) : null}
    </PageContainer>
  );
}

function TestNotificationDialog({
  targets,
  targetsError,
  onClose,
  onSent,
}: {
  readonly targets?: readonly NotificationTestTarget[];
  readonly targetsError?: string;
  readonly onClose: () => void;
  readonly onSent: () => void;
}): ReactElement {
  const { t } = useTranslation('@nocobase/app-plugin-notification');
  const [selected, setSelected] = useState<NotificationTestTarget>();
  const [values, setValues] = useState<Readonly<Record<string, string>>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();

  const send = (): void => {
    if (!selected) return;
    setSending(true);
    setError(undefined);
    setSuccess(undefined);
    void notification
      .sendTest({
        channel: selected.channel.name,
        values,
      })
      .then(
        (result) => {
          setSuccess(
            t('test.accepted', {
              defaultValue: `Test notification ${result.notificationId} accepted.`,
              id: result.notificationId,
            }),
          );
          onSent();
        },
        (cause: unknown) =>
          setError(
            errorMessage(
              cause,
              t('errors.requestFailed', {
                defaultValue: 'Notification request failed.',
              }),
            ),
          ),
      )
      .finally(() => setSending(false));
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !sending) onClose();
      }}
    >
      <DialogContent
        showCloseButton={!sending}
        className='flex flex-col overflow-hidden sm:max-w-xl'
      >
        <DialogHeader>
          <DialogTitle>
            {t('test.title', { defaultValue: 'Send test notification' })}
          </DialogTitle>
          <DialogDescription>
            {t('test.description', {
              defaultValue:
                'Select a Channel, then click Send. The message is sent to the recipient you provide and recorded below.',
            })}
          </DialogDescription>
        </DialogHeader>
        <div className='flex min-h-0 flex-col gap-4 overflow-y-auto'>
          {targetsError ? (
            <div className='rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive'>
              {targetsError}
            </div>
          ) : targets === undefined ? (
            <span className='rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground'>
              {t('test.loadingProviders', {
                defaultValue: 'Loading configured Providers…',
              })}
            </span>
          ) : targets.length === 0 ? (
            <span className='rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground'>
              {t('test.noProviders', {
                defaultValue: 'No enabled Providers are configured.',
              })}
            </span>
          ) : (
            <label className='grid gap-1.5 text-sm font-medium'>
              {t('test.channelProvider', {
                defaultValue: 'Delivery method',
              })}
              <Select
                items={targets.map((item) => ({
                  value: providerKey(item),
                  label: item.channel.name,
                }))}
                disabled={sending}
                value={selected ? providerKey(selected) : null}
                onValueChange={(value) => {
                  const target = targets.find(
                    (item) => providerKey(item) === value,
                  );
                  setSelected(target);
                  setValues(
                    Object.fromEntries(
                      (target?.fields ?? []).map((field) => [
                        field.name,
                        field.defaultValue ?? '',
                      ]),
                    ),
                  );
                }}
              >
                <SelectTrigger
                  className='w-full'
                  aria-label={t('test.channelProvider', {
                    defaultValue: 'Delivery method',
                  })}
                >
                  <SelectValue
                    placeholder={t('test.selectProvider', {
                      defaultValue: 'Select a delivery method',
                    })}
                  />
                </SelectTrigger>
                <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
                  {targets.map((item) => (
                    <SelectItem
                      key={providerKey(item)}
                      value={providerKey(item)}
                    >
                      {item.channel.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}

          {selected?.fields.map((field) => (
            <label
              className='grid gap-1.5 text-sm font-medium'
              key={field.name}
            >
              {field.label}
              {field.type === 'textarea' ? (
                <Textarea
                  aria-label={field.label}
                  disabled={sending}
                  maxLength={field.maxLength}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [field.name]: event.target.value,
                    }))
                  }
                  placeholder={field.placeholder}
                  required={field.required}
                  value={values[field.name] ?? ''}
                />
              ) : (
                <Input
                  aria-label={field.label}
                  disabled={sending}
                  maxLength={field.maxLength}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [field.name]: event.target.value,
                    }))
                  }
                  placeholder={field.placeholder}
                  required={field.required}
                  type={field.type}
                  value={values[field.name] ?? ''}
                />
              )}
            </label>
          ))}

          {error ? (
            <div className='rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive'>
              {error}
            </div>
          ) : null}
          {success ? (
            <div className='rounded-lg border border-(--status-success)/30 bg-(--status-success-background) p-3 text-sm text-(--status-success)'>
              {success}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant='outline'
            disabled={sending}
            onClick={onClose}
            type='button'
          >
            {t('test.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            disabled={
              sending ||
              !selected ||
              selected.fields.some(
                (field) => field.required && !values[field.name]?.trim(),
              )
            }
            onClick={send}
            type='button'
          >
            {sending
              ? t('test.sending', { defaultValue: 'Sending…' })
              : t('test.send', { defaultValue: 'Send' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function providerKey(item: NotificationTestTarget): string {
  return item.channel.name;
}

function Metric({
  label,
  value,
  attention = false,
}: {
  readonly label: string;
  readonly value: number;
  readonly attention?: boolean;
}): ReactElement {
  return (
    <div className='rounded-xl border bg-card px-4 py-3 shadow-sm'>
      <div
        className={`text-2xl font-semibold tabular-nums ${attention && value > 0 ? 'text-destructive' : ''}`}
      >
        {value}
      </div>
      <div className='text-xs text-muted-foreground'>{label}</div>
    </div>
  );
}

function NotificationLogsTable({
  logs,
  targets,
}: {
  readonly logs: readonly NotificationLogDetails[];
  readonly targets?: readonly NotificationTestTarget[];
}): ReactElement {
  const { t } = useTranslation('@nocobase/app-plugin-notification');
  return (
    <div className='min-w-0'>
      <Table className='w-full min-w-[860px] text-sm'>
        <thead className='bg-muted/35 text-left'>
          <tr className='border-b'>
            <th
              className='w-12 px-4 py-3'
              aria-label={t('logs.expand', {
                defaultValue: 'Expand notification',
              })}
            />
            <th className='px-4 py-3 font-medium'>
              {t('logs.columns.source', { defaultValue: 'Source' })}
            </th>
            <th className='px-4 py-3 font-medium'>
              {t('logs.columns.notificationId', {
                defaultValue: 'Notification ID',
              })}
            </th>
            <th className='px-4 py-3 font-medium'>
              {t('logs.columns.status', { defaultValue: 'Status' })}
            </th>
            <th className='px-4 py-3 text-right font-medium'>
              {t('logs.columns.deliveries', { defaultValue: 'Deliveries' })}
            </th>
            <th className='px-4 py-3 font-medium'>
              {t('logs.columns.created', { defaultValue: 'Created' })}
            </th>
          </tr>
        </thead>
        <tbody>
          {logs.map((details) => (
            <NotificationTableRow
              key={details.log.id}
              details={details}
              targets={targets}
            />
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function NotificationTableRow({
  details,
  targets,
}: {
  readonly details: NotificationLogDetails;
  readonly targets?: readonly NotificationTestTarget[];
}): ReactElement {
  const { t, i18n } = useTranslation('@nocobase/app-plugin-notification');
  const [open, setOpen] = useState(false);
  return (
    <Fragment>
      <tr className='border-b' aria-expanded={open}>
        <td className='px-4 py-3'>
          <button
            className='grid size-8 place-items-center rounded-md hover:bg-muted'
            aria-label={
              open
                ? t('logs.collapse', {
                    defaultValue: 'Collapse notification',
                  })
                : t('logs.expand', { defaultValue: 'Expand notification' })
            }
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            type='button'
          >
            <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>
              ›
            </span>
          </button>
        </td>
        <td className='px-4 py-3'>
          <div className='font-medium'>{details.log.sourceType}</div>
          {details.log.sourceReferenceId ? (
            <div className='mt-0.5 max-w-48 truncate text-xs text-muted-foreground'>
              {details.log.sourceReferenceId}
            </div>
          ) : null}
        </td>
        <td className='px-4 py-3'>
          <code
            className='text-xs text-muted-foreground'
            title={details.log.id}
          >
            {details.log.id}
          </code>
        </td>
        <td className='px-4 py-3'>
          <StatusBadge status={details.log.status} />
        </td>
        <td className='px-4 py-3 text-right tabular-nums'>
          {details.deliveries.length}
        </td>
        <td className='whitespace-nowrap px-4 py-3 text-muted-foreground'>
          <time dateTime={details.log.createdAt}>
            {formatTime(details.log.createdAt, i18n.language)}
          </time>
        </td>
      </tr>
      {open ? (
        <tr className='border-b bg-muted/15'>
          <td colSpan={6} className='p-4 sm:px-12'>
            <DeliveryTable deliveries={details.deliveries} targets={targets} />
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

function DeliveryTable({
  deliveries,
  targets,
}: {
  readonly deliveries: readonly NotificationDeliveryDetails[];
  readonly targets?: readonly NotificationTestTarget[];
}): ReactElement {
  const { t, i18n } = useTranslation('@nocobase/app-plugin-notification');
  if (deliveries.length === 0) {
    return (
      <p className='py-4 text-center text-sm text-muted-foreground'>
        {t('logs.noDeliveries', {
          defaultValue: 'No deliveries recorded.',
        })}
      </p>
    );
  }

  return (
    <div className='min-w-0 rounded-lg border bg-card'>
      <Table className='w-full min-w-[760px] text-sm'>
        <thead className='bg-muted/35 text-left'>
          <tr className='border-b'>
            <th className='px-4 py-3 font-medium'>
              {t('logs.columns.channel', { defaultValue: 'Channel' })}
            </th>
            <th className='px-4 py-3 font-medium'>
              {t('logs.columns.provider', { defaultValue: 'Provider' })}
            </th>
            <th className='px-4 py-3 font-medium'>
              {t('logs.columns.status', { defaultValue: 'Status' })}
            </th>
            <th className='px-4 py-3 text-right font-medium'>
              {t('logs.columns.attempts', { defaultValue: 'Attempts' })}
            </th>
            <th className='px-4 py-3 font-medium'>
              {t('logs.columns.updated', { defaultValue: 'Updated' })}
            </th>
          </tr>
        </thead>
        <tbody>
          {deliveries.map((details) => {
            const presentation = providerPresentation(
              details.delivery.channelName,
              details.delivery.providerType,
              targets,
            );
            return (
              <Fragment key={details.delivery.id}>
                <tr className='border-b'>
                  <td className='px-4 py-3'>{presentation.channel}</td>
                  <td className='px-4 py-3'>
                    <div className='font-medium'>{presentation.provider}</div>
                    {presentation.detail ? (
                      <div className='text-xs text-muted-foreground'>
                        {presentation.detail}
                      </div>
                    ) : null}
                  </td>
                  <td className='px-4 py-3'>
                    <StatusBadge status={details.delivery.status} />
                  </td>
                  <td className='px-4 py-3 text-right tabular-nums'>
                    {details.attempts.length}
                  </td>
                  <td className='whitespace-nowrap px-4 py-3 text-muted-foreground'>
                    {formatTime(details.delivery.updatedAt, i18n.language)}
                  </td>
                </tr>
                <tr className='border-b bg-muted/10'>
                  <td colSpan={5} className='px-4 py-3'>
                    <AttemptList details={details} targets={targets} />
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}

function AttemptList({
  details,
  targets,
}: {
  readonly details: NotificationDeliveryDetails;
  readonly targets?: readonly NotificationTestTarget[];
}): ReactElement {
  const { t } = useTranslation('@nocobase/app-plugin-notification');
  if (details.attempts.length === 0) {
    return (
      <p className='text-xs text-muted-foreground'>
        {t('logs.noAttempts', { defaultValue: 'No attempts recorded.' })}
      </p>
    );
  }
  return (
    <div className='grid gap-1.5'>
      {details.attempts.map((attempt) => {
        const presentation = providerPresentation(
          details.delivery.channelName,
          attempt.providerType,
          targets,
        );
        return (
          <div
            key={attempt.id}
            className='grid grid-cols-[2.5rem_minmax(8rem,1fr)_auto] items-center gap-3 rounded-md bg-muted/35 px-3 py-2 text-xs'
          >
            <span className='font-mono text-muted-foreground'>
              #{attempt.sequence}
            </span>
            <span className='min-w-0'>
              <strong>{presentation.provider}</strong>
              {presentation.detail ? (
                <span className='ml-2 text-muted-foreground'>
                  {presentation.detail}
                </span>
              ) : null}
              {attempt.error ? (
                <span className='mt-1 block truncate text-destructive'>
                  {providerErrorMessage(t, attempt.error)}
                </span>
              ) : null}
            </span>
            <StatusBadge status={attempt.status} />
          </div>
        );
      })}
    </div>
  );
}

function providerPresentation(
  channel: string,
  providerType: string,
  targets?: readonly NotificationTestTarget[],
): {
  readonly channel: string;
  readonly provider: string;
  readonly detail?: string;
} {
  const target = targets?.find(
    (candidate) =>
      candidate.channel.name === channel &&
      candidate.provider.type === providerType,
  );
  return { channel, provider: target?.provider.label ?? providerType };
}

function StatusBadge({
  status,
}: {
  readonly status: NotificationStatus;
}): ReactElement {
  const { t } = useTranslation('@nocobase/app-plugin-notification');
  return (
    <ApplicationStatusBadge tone={statusTone(status)}>
      {t(`status.${status}`, { defaultValue: status.replace('_', ' ') })}
    </ApplicationStatusBadge>
  );
}

function statusTone(
  status: NotificationStatus,
): 'success' | 'destructive' | 'warning' {
  if (status === 'completed' || status === 'accepted') {
    return 'success';
  }
  if (status === 'failed' || status === 'unknown' || status === 'partial') {
    return 'destructive';
  }
  return 'warning';
}

function formatTime(value: string, language: string): string {
  return new Intl.DateTimeFormat(language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function errorMessage(value: unknown, fallback: string): string {
  return value instanceof Error ? value.message : fallback;
}

function providerErrorMessage(
  t: Translate,
  error: { readonly message: string; readonly code?: string },
): string {
  if (
    error.code === 'IN_APP_NOTIFICATION_RECIPIENT_NOT_FOUND' ||
    error.message === 'In-app notification recipient does not exist.'
  )
    return t('errors.inAppRecipientNotFound', {
      defaultValue: 'In-app notification recipient does not exist.',
    });
  return error.message;
}
