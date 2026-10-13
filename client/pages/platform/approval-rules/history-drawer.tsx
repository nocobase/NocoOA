import { ruleNodeTargets } from '../../process-management/node-settings.js';
import { ResponsiveTable as Table } from '#components/responsive-table';
import { useApiClient, useToaster } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { PencilIcon, Undo2Icon } from 'lucide-react';
import { type ReactElement, useMemo, useState } from 'react';
import { Link, Outlet, useOutletContext, useParams } from 'react-router';

import { RouteDrawer } from '#components/route-drawer';
import { SessionExpiredAlert } from '#components/session-expired-alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#components/ui/alert-dialog';
import { Badge } from '#components/ui/badge';
import { Button } from '#components/ui/button';
import { Spinner } from '#components/ui/spinner';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';

import { OverlayCloseButton } from '../shared/overlay-buttons.js';
import { reasonOf, statusOf } from '../shared/errors.js';
import { LoadErrorAlert, TableSkeleton } from '../shared/states.js';
import type { RuleSummary, RuleVersion } from '../shared/types.js';
import { useListResource, useResource } from '../shared/use-resource.js';
import {
  formatRuleValue,
  ruleKeyId,
  RULES_SETTINGS,
  type RulesOutletContext,
} from './rule-format.js';

/** `:key`: every version of a rule, newest first; scheduled versions may be withdrawn. */
export default function RuleHistoryDrawer(): ReactElement {
  const { key = '' } = useParams();
  return <HistoryDrawer key={key} ruleKey={key} />;
}

function HistoryDrawer({
  ruleKey,
}: {
  readonly ruleKey: string;
}): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const parent = useOutletContext<RulesOutletContext>();
  const update = useCan({
    resource: { type: 'settings', id: RULES_SETTINGS },
    action: 'update',
  });
  const canUpdate = update.can && !update.isPending && !update.error;
  const versions = useListResource<RuleVersion>(
    `approvalRules/${encodeURIComponent(ruleKey)}/versions`,
  );
  const rules = useResource<RuleSummary[]>('approvalRules', { area: 'rules' });
  const rule = rules.data?.find((item) => item.key === ruleKey);
  const name = t(`platform.rules.keys.${ruleKeyId(ruleKey)}.label`, {
    defaultValue: ruleKey,
  });
  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    [locale],
  );
  const [withdrawal, setWithdrawal] = useState<{
    readonly open: boolean;
    readonly version: RuleVersion | null;
  }>({ open: false, version: null });

  const reloadVersions = versions.reload;
  const reloadRules = rules.reload;
  const reloadParent = parent.reload;
  const outletContext = useMemo<RulesOutletContext>(
    () => ({
      reload: () => {
        reloadVersions();
        reloadRules();
        reloadParent();
      },
    }),
    [reloadParent, reloadRules, reloadVersions],
  );

  const rows = versions.data?.data;
  // When the drawer opened: what is scheduled and what is in effect is judged against it.
  const [now] = useState(() => Date.now());
  const currentId = rows?.find(
    (version) => new Date(version.effectiveFrom).getTime() <= now,
  )?.id;
  const error = versions.error ?? rules.error;

  let body: ReactElement;
  if (error) {
    body = (
      <LoadErrorAlert
        error={error}
        notFoundMessage={t('platform.rules.notFound')}
        onRetry={() => {
          versions.reload();
          rules.reload();
        }}
      />
    );
  } else if (!rows || !rule) {
    body = <TableSkeleton rows={3} columns={3} />;
  } else {
    body = (
      <div className='overflow-hidden rounded-lg border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('platform.rules.fields.effectiveFrom')}</TableHead>
              <TableHead className='text-right'>
                {t('platform.rules.fields.value')}
              </TableHead>
              <TableHead>{t('platform.rules.fields.changedBy')}</TableHead>
              <TableHead>
                <span className='sr-only'>{t('platform.common.actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((version) => {
              const scheduled = new Date(version.effectiveFrom).getTime() > now;
              const epoch = new Date(version.effectiveFrom).getTime() === 0;
              return (
                <TableRow key={version.id}>
                  <TableCell className='align-top'>
                    <div className='flex flex-col items-start gap-1'>
                      <span className='whitespace-nowrap'>
                        {epoch
                          ? t('platform.rules.defaultVersion')
                          : dateFormat.format(new Date(version.effectiveFrom))}
                      </span>
                      {scheduled ? (
                        <Badge variant='outline'>
                          {t('platform.rules.versionStatus.scheduled')}
                        </Badge>
                      ) : version.id === currentId ? (
                        <Badge variant='secondary'>
                          {t('platform.rules.versionStatus.current')}
                        </Badge>
                      ) : null}
                      {version.note ? (
                        <span className='max-w-56 text-xs whitespace-pre-wrap text-muted-foreground'>
                          {version.note}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className='text-right align-top tabular-nums'>
                    {formatRuleValue(t, locale, rule.type, version.value)}
                  </TableCell>
                  <TableCell className='align-top'>
                    {version.updatedByName ?? (
                      <span className='text-muted-foreground'>—</span>
                    )}
                  </TableCell>
                  <TableCell className='text-right align-top'>
                    {scheduled && canUpdate ? (
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => setWithdrawal({ open: true, version })}
                      >
                        <Undo2Icon data-icon='inline-start' />
                        {t('platform.rules.withdraw')}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <RouteDrawer
      title={t('platform.rules.historyTitle', { name })}
      description={t(`platform.rules.keys.${ruleKeyId(ruleKey)}.description`, {
        defaultValue: '',
      })}
      footer={
        <>
          <OverlayCloseButton label={t('actions.close')} />
          {canUpdate && rule && ruleNodeTargets(rule.key).length ? (
            <Button
              render={<Link to={ruleNodeTargets(rule.key)[0].path} />}
              nativeButton={false}
            >
              <PencilIcon data-icon='inline-start' />
              {t('platform.rules.editAtNode')}
            </Button>
          ) : null}
        </>
      }
    >
      {body}
      {rule ? (
        <WithdrawDialog
          ruleKey={ruleKey}
          name={name}
          version={withdrawal.version}
          open={withdrawal.open}
          dateText={
            withdrawal.version
              ? dateFormat.format(new Date(withdrawal.version.effectiveFrom))
              : ''
          }
          valueText={
            withdrawal.version
              ? formatRuleValue(t, locale, rule.type, withdrawal.version.value)
              : ''
          }
          onOpenChange={(open) =>
            setWithdrawal((current) => ({ ...current, open }))
          }
          onDone={() => {
            setWithdrawal((current) => ({ ...current, open: false }));
            outletContext.reload();
          }}
        />
      ) : null}
      <Outlet context={outletContext} />
    </RouteDrawer>
  );
}

function WithdrawDialog({
  ruleKey,
  name,
  version,
  open,
  dateText,
  valueText,
  onOpenChange,
  onDone,
}: {
  readonly ruleKey: string;
  readonly name: string;
  readonly version: RuleVersion | null;
  readonly open: boolean;
  readonly dateText: string;
  readonly valueText: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onDone: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>(); // 'sessionExpired' or a message;

  async function withdraw(target: RuleVersion): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      await api.request({
        path: `approvalRules/${encodeURIComponent(ruleKey)}/versions/${target.id}`,
        method: 'DELETE',
      });
    } catch (caught: unknown) {
      const status = statusOf(caught);
      if (status !== 404) {
        const reason = reasonOf(caught);
        setError(
          status === 401
            ? 'sessionExpired'
            : reason === 'RULE_VERSION_IN_EFFECT'
              ? t('platform.rules.errors.inEffect')
              : reason === 'RULE_ORDER_VIOLATED'
                ? t('platform.rules.errors.orderViolated')
                : status === 403
                  ? t('platform.common.writeForbidden')
                  : t('platform.common.saveFailed'),
        );
        setPending(false);
        return;
      }
    }
    setPending(false);
    toaster.show({
      type: 'success',
      title: t('platform.rules.withdrawn', { name }),
    });
    onDone();
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        if (!next) setError(undefined);
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('platform.rules.withdrawTitle', { name, date: dateText })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('platform.rules.withdrawDescription', { value: valueText })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error === 'sessionExpired' ? (
          <SessionExpiredAlert />
        ) : error ? (
          <p role='alert' className='text-sm text-destructive'>
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t('actions.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            variant='destructive'
            disabled={pending || error !== undefined}
            onClick={() => {
              if (version) void withdraw(version);
            }}
          >
            {pending ? <Spinner data-icon='inline-start' /> : null}
            {t('platform.rules.withdraw')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
