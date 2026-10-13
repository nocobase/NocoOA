import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef } from '@tanstack/react-table';
import { HistoryIcon, MoreHorizontalIcon } from 'lucide-react';
import { type ReactElement, useMemo } from 'react';
import { Link, Outlet, useLocation } from 'react-router';

import { ruleNodeTargets } from '../../process-management/node-settings.js';
import { useProcessText } from '../../process-management/text.js';
import { DataTable } from '#components/data-table';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Badge } from '#components/ui/badge';
import { Button } from '#components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#components/ui/dropdown-menu';
import { Spinner } from '#components/ui/spinner';

import { LoadErrorAlert, TableSkeleton } from '../shared/states.js';
import { RULE_DOMAINS, type RuleSummary } from '../shared/types.js';
import { useResource } from '../shared/use-resource.js';
import {
  formatRuleValue,
  ruleKeyId,
  RULES_SETTINGS,
  type RulesOutletContext,
} from './rule-format.js';

/**
 * Route /approval-rules: every rule key of the rules area, grouped by domain, with the value in effect and
 * the versions scheduled for later. Editing opens the owning process node; history remains here.
 */
export default function ApprovalRulesPage(): ReactElement {
  const { t } = useTranslation();
  const text = useProcessText();
  const { locale } = useLocale();
  const location = useLocation();
  const update = useCan({
    resource: { type: 'settings', id: RULES_SETTINGS },
    action: 'update',
  });
  const canUpdate = update.can && !update.isPending && !update.error;
  const rules = useResource<RuleSummary[]>('approvalRules', { area: 'rules' });
  const { reload } = rules;
  const outletContext = useMemo<RulesOutletContext>(
    () => ({ reload }),
    [reload],
  );

  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    [locale],
  );

  const columns = useMemo<ColumnDef<RuleSummary>[]>(
    () => [
      {
        id: 'rule',
        header: t('platform.rules.fields.rule'),
        cell: ({ row }) => (
          <div className='flex min-w-48 flex-col gap-0.5 whitespace-normal'>
            <span className='font-medium'>
              {t(`platform.rules.keys.${ruleKeyId(row.original.key)}.label`)}
            </span>
            <span className='text-xs text-muted-foreground'>
              {t(
                `platform.rules.keys.${ruleKeyId(row.original.key)}.description`,
              )}
            </span>
          </div>
        ),
      },
      {
        id: 'current',
        header: () => (
          <div className='text-right'>{t('platform.rules.fields.current')}</div>
        ),
        cell: ({ row }) => (
          <div className='text-right whitespace-nowrap tabular-nums'>
            {formatRuleValue(
              t,
              locale,
              row.original.type,
              row.original.current?.value ?? row.original.defaultValue,
            )}
          </div>
        ),
      },
      {
        id: 'scheduled',
        header: t('platform.rules.fields.scheduled'),
        cell: ({ row }) =>
          row.original.scheduled.length > 0 ? (
            <div className='flex flex-col items-start gap-1'>
              {row.original.scheduled.map((version) => (
                <Badge key={version.id} variant='outline'>
                  {t('platform.rules.scheduledValue', {
                    date: dateFormat.format(new Date(version.effectiveFrom)),
                    value: formatRuleValue(
                      t,
                      locale,
                      row.original.type,
                      version.value,
                    ),
                  })}
                </Badge>
              ))}
            </div>
          ) : (
            <span className='text-muted-foreground'>—</span>
          ),
      },
      {
        id: 'flows',
        header: t('platform.rules.relatedFlows'),
        cell: ({ row }) => (
          <div className='flex flex-col items-start gap-1'>
            {ruleNodeTargets(row.original.key).map((target) => (
              <Link
                key={target.kind}
                className='text-primary underline underline-offset-4'
                to={
                  canUpdate
                    ? target.path
                    : `/processManagement/definitions/${encodeURIComponent(target.kind)}`
                }
              >
                {text.name(target.kind)}
              </Link>
            ))}
            {!ruleNodeTargets(row.original.key).length && (
              <span className='text-muted-foreground'>—</span>
            )}
          </div>
        ),
      },
      {
        id: 'actions',
        header: () => (
          <span className='sr-only'>{t('platform.common.actions')}</span>
        ),
        cell: ({ row }) => {
          const name = t(
            `platform.rules.keys.${ruleKeyId(row.original.key)}.label`,
          );
          return (
            <div className='flex justify-end'>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant='ghost'
                      size='icon-sm'
                      aria-label={t('platform.common.actionsFor', { name })}
                    />
                  }
                >
                  <MoreHorizontalIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end' className='w-auto min-w-40'>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      render={
                        <Link
                          to={{
                            pathname: encodeURIComponent(row.original.key),
                            search: location.search,
                          }}
                        />
                      }
                    >
                      <HistoryIcon />
                      {t('platform.rules.history')}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ],
    [canUpdate, dateFormat, locale, location.search, t, text],
  );

  let content: ReactElement;
  if (rules.error) {
    content = (
      <LoadErrorAlert
        error={rules.error}
        title={t('platform.rules.loadFailedTitle')}
        onRetry={rules.reload}
      />
    );
  } else if (!rules.data || update.isPending) {
    content = <TableSkeleton rows={6} columns={3} />;
  } else {
    const data = rules.data;
    content = (
      <>
        {RULE_DOMAINS.filter((domain) =>
          data.some((rule) => rule.domain === domain),
        ).map((domain) => (
          <Card key={domain}>
            <CardHeader>
              <CardTitle>
                {t(`platform.rules.domains.${domain}.title`)}
              </CardTitle>
              <CardDescription>
                {t(`platform.rules.domains.${domain}.description`)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={columns}
                data={data.filter((rule) => rule.domain === domain)}
                getRowId={(row) => row.key}
                pagination={false}
                showSelectedCount={false}
              />
            </CardContent>
          </Card>
        ))}
      </>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={
          <span className='flex items-center gap-2'>
            {t('platform.rules.title')}
            {rules.loading && rules.data ? (
              <Spinner className='size-4 text-muted-foreground' />
            ) : null}
          </span>
        }
        description={t('platform.rules.description')}
      />
      {content}
      <Outlet context={outletContext} />
    </PageContainer>
  );
}
