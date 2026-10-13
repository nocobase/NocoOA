import { approvalStatusTone } from '../approvals/status-tone.js';
import { PersonalCards } from './personal-cards.js';
import { UserName } from '#components/user-name';
import type { Options as ContractOptions } from '../contracts/types.js';
import type { Options as AssetRequestOptions } from '../asset-requests/types.js';
import type { QualificationOptions } from '../vendor-qualifications/types.js';
import { useResource } from '../approvals/use-resource.js';
import type { DepartureOptions } from '../departure-requests/types.js';
import type { ProbationOptions } from '../probation-requests/types.js';
import { approvalStateLabel } from '../approvals/business-metadata.js';
import {
  approvalBusiness,
  formatApprovalPeriodValue,
} from '../approvals/business-metadata.js';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { ClipboardCheck, RefreshCw, Plus, Info } from 'lucide-react';
import { GroupedRequestActions as RequestActions } from './request-groups.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useResolvedPath } from 'react-router';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { StatusBadge } from '#components/status-badge';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Button } from '#components/ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '#components/ui/card';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '#components/ui/empty';
import { Skeleton } from '#components/ui/skeleton';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import { ErrorState } from '../approvals/states.js';
import {
  useCenterResource,
  type CenterRecord,
} from '../approvals/use-center-resource.js';

export default function HomePage() {
  const { t } = useTranslation();
  const page = useCan({
    resource: { type: 'page', id: 'oa.approvals' },
    action: 'access',
  });
  const view = useCan({
    resource: { type: 'composite', id: 'oa.leave' },
    action: 'view',
  });
  const attendanceView = useCan({
    resource: { type: 'composite', id: 'oa.attendanceChange' },
    action: 'view',
  });
  const outingView = useCan({
    resource: { type: 'composite', id: 'oa.outing' },
    action: 'view',
  });
  const expensePlanView = useCan({
    resource: { type: 'composite', id: 'oa.expensePlan' },
    action: 'view',
  });
  const trainingView = useCan({
    resource: { type: 'composite', id: 'oa.training' },
    action: 'view',
  });
  const assetView = useCan({
    resource: { type: 'composite', id: 'oa.assetRequests' },
    action: 'view',
  });
  const vendorView = useCan({
    resource: { type: 'composite', id: 'oa.vendorQualification' },
    action: 'view',
  });
  const departureView = useCan({
    resource: { type: 'composite', id: 'oa.departure' },
    action: 'view',
  });
  const probationView = useCan({
    resource: { type: 'composite', id: 'oa.probation' },
    action: 'view',
  });
  const paymentView = useCan({
    resource: { type: 'composite', id: 'oa.payment' },
    action: 'view',
  });

  const loanView = useCan({
    resource: { type: 'composite', id: 'oa.loan' },
    action: 'view',
  });

  const purchaseView = useCan({
    resource: { type: 'composite', id: 'oa.purchase' },
    action: 'view',
  });
  const reimbursementView = useCan({
    resource: { type: 'composite', id: 'oa.reimbursement' },
    action: 'view',
  });
  const travelView = useCan({
    resource: { type: 'composite', id: 'oa.travel' },
    action: 'view',
  });
  const travelCancellationView = useCan({
    resource: { type: 'composite', id: 'oa.travelCancellation' },
    action: 'view',
  });
  const budgetView = useCan({
    resource: { type: 'composite', id: 'oa.budgetAdjustment' },
    action: 'view',
  });
  const supplyView = useCan({
    resource: { type: 'composite', id: 'oa.supplies' },
    action: 'view',
  });
  const generalView = useCan({
    resource: { type: 'composite', id: 'oa.general' },
    action: 'view',
  });
  const overtimeView = useCan({
    resource: { type: 'composite', id: 'oa.overtime' },
    action: 'view',
  });
  const cancellationView = useCan({
    resource: { type: 'composite', id: 'oa.leaveCancellation' },
    action: 'view',
  });
  const transferView = useCan({
    resource: { type: 'composite', id: 'oa.transfer' },
    action: 'view',
  });
  const certificateView = useCan({
    resource: { type: 'composite', id: 'oa.certificateRequests' },
    action: 'view',
  });
  const workItemView = useCan({
    resource: { type: 'composite', id: 'oa.workItems' },
    action: 'view',
  });
  const announcementView = useCan({
    resource: { type: 'composite', id: 'oa.announcements' },
    action: 'view',
  });
  // Mount business hooks only after both grants resolve; the landing page remains available to every user.
  if (
    workItemView.isPending ||
    announcementView.isPending ||
    transferView.isPending ||
    certificateView.isPending ||
    page.isPending ||
    view.isPending ||
    attendanceView.isPending ||
    outingView.isPending ||
    generalView.isPending ||
    expensePlanView.isPending ||
    trainingView.isPending ||
    reimbursementView.isPending ||
    paymentView.isPending ||
    probationView.isPending ||
    assetView.isPending ||
    vendorView.isPending ||
    departureView.isPending ||
    loanView.isPending ||
    purchaseView.isPending ||
    travelView.isPending ||
    travelCancellationView.isPending ||
    budgetView.isPending ||
    supplyView.isPending ||
    overtimeView.isPending ||
    cancellationView.isPending
  )
    return (
      <PageContainer>
        <PageHeader
          title={t('workbench.title')}
          description={t('workbench.description')}
        />
        <PersonalCards />
        <LoadingCards />
      </PageContainer>
    );
  if (
    page.can &&
    (workItemView.can ||
      announcementView.can ||
      transferView.can ||
      certificateView.can ||
      view.can ||
      overtimeView.can ||
      cancellationView.can ||
      generalView.can ||
      expensePlanView.can ||
      trainingView.can ||
      reimbursementView.can ||
      paymentView.can ||
      probationView.can ||
      assetView.can ||
      vendorView.can ||
      departureView.can ||
      loanView.can ||
      purchaseView.can ||
      travelView.can ||
      travelCancellationView.can ||
      budgetView.can ||
      supplyView.can ||
      attendanceView.can ||
      outingView.can)
  )
    return <Workbench />;
  return (
    <PageContainer className='space-y-4'>
      <PageHeader
        title={t('workbench.title')}
        description={t('workbench.description')}
      />
      <PersonalCards />
      <Alert role='status'>
        <AlertDescription>{t('workbench.noAccess')}</AlertDescription>
      </Alert>
    </PageContainer>
  );
}

function Workbench() {
  const { session } = useAuthentication();
  const pending = useCenterResource({ view: 'pending', pageSize: '6' });
  const mine = useCenterResource({
    view: 'mine',
    pageSize: '5',
    homeSummary: 'true',
  });
  const requestSectionRef = useRef<HTMLElement>(null);
  const optionsReady = pending.settled && mine.settled;
  // Give the two primary summaries the first read wave. Once enabled, metadata
  // stays enabled on refresh; another identity/revision must settle its own reads.
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const base = useResolvedPath('.');
  const titleRef = useRef<HTMLSpanElement>(null);
  const previousPathRef = useRef(location.pathname);
  useEffect(() => {
    if (
      previousPathRef.current !== location.pathname &&
      location.pathname === base.pathname
    )
      titleRef.current?.focus();
    previousPathRef.current = location.pathname;
  }, [location.pathname, base.pathname]);
  const submit = useCan({
    resource: { type: 'composite', id: 'oa.leave' },
    action: 'submit',
  });
  const attendanceSubmit = useCan({
    resource: { type: 'composite', id: 'oa.attendanceChange' },
    action: 'submit',
  });
  const outingSubmit = useCan({
    resource: { type: 'composite', id: 'oa.outing' },
    action: 'submit',
  });
  const expensePlanSubmit = useCan({
    resource: { type: 'composite', id: 'oa.expensePlan' },
    action: 'submit',
  });
  const contractSubmit = useCan({
    resource: { type: 'composite', id: 'oa.contract' },
    action: 'submit',
  });
  const assetSubmit = useCan({
    resource: { type: 'composite', id: 'oa.assetRequests' },
    action: 'create',
  });
  const assetOptions = useResource<AssetRequestOptions>(
    optionsReady &&
      assetSubmit.can &&
      !assetSubmit.isPending &&
      !assetSubmit.error
      ? 'assetRequests/options'
      : null,
    { viewer: session?.user.id ?? '' },
  );
  const contractOptions = useResource<ContractOptions>(
    optionsReady &&
      contractSubmit.can &&
      !contractSubmit.isPending &&
      !contractSubmit.error
      ? 'contractRequests/options'
      : null,
    { viewer: session?.user.id ?? '' },
  );
  const contractCreate =
    contractSubmit.can &&
    !contractSubmit.isPending &&
    !contractSubmit.error &&
    !contractOptions.loading &&
    !contractOptions.error &&
    contractOptions.data?.eligible === true;
  const assetCreate =
    !assetSubmit.isPending &&
    !assetSubmit.error &&
    assetSubmit.can &&
    !assetOptions.loading &&
    !assetOptions.error &&
    assetOptions.data?.eligible === true;
  const vendorSubmit = useCan({
    resource: { type: 'composite', id: 'oa.vendorQualification' },
    action: 'submit',
  });
  const vendorOptions = useResource<QualificationOptions>(
    optionsReady &&
      vendorSubmit.can &&
      !vendorSubmit.isPending &&
      !vendorSubmit.error
      ? 'vendorQualifications/options'
      : null,
    { viewer: session?.user.id ?? '' },
  );
  const vendorCreate =
    !vendorSubmit.isPending &&
    !vendorSubmit.error &&
    vendorSubmit.can &&
    !vendorOptions.loading &&
    !vendorOptions.error &&
    !!(
      vendorOptions.data?.canCreateQualification ||
      vendorOptions.data?.canCreateRemoval
    );
  const departureSubmit = useCan({
    resource: { type: 'composite', id: 'oa.departure' },
    action: 'submit',
  });
  const departureDelegate = useCan({
    resource: { type: 'composite', id: 'oa.departure' },
    action: 'delegate',
  });
  const departureOptions = useResource<DepartureOptions>(
    optionsReady && (departureSubmit.can || departureDelegate.can)
      ? 'departureRequests/options'
      : null,
    { viewer: session?.user.id ?? '' },
  );
  const departureSelf =
    !departureSubmit.isPending &&
    departureSubmit.can &&
    !departureOptions.loading &&
    !departureOptions.error &&
    !!departureOptions.data?.canCreateSelfDraft;
  const departureManual =
    !departureDelegate.isPending &&
    departureDelegate.can &&
    !departureOptions.loading &&
    !departureOptions.error &&
    !!departureOptions.data?.canCreateManualDraft;
  const departureCreate = departureSelf || departureManual;
  // Eight independent capability reads still contend for PG connections. Run
  // two groups of four after the primary summaries, releasing on errors too.
  const secondaryOptionsReady =
    optionsReady &&
    assetOptions.settled &&
    contractOptions.settled &&
    vendorOptions.settled &&
    departureOptions.settled;
  const probationDelegate = useCan({
    resource: { type: 'composite', id: 'oa.probation' },
    action: 'delegate',
  });
  const probationOptions = useResource<ProbationOptions>(
    secondaryOptionsReady && probationDelegate.can
      ? 'probationRequests/options'
      : null,
    { viewer: session?.user.id ?? '' },
  );
  const probationCreate =
    !probationDelegate.isPending &&
    probationDelegate.can &&
    !probationOptions.loading &&
    !probationOptions.error &&
    !!probationOptions.data?.canCreateManualDraft;
  const paymentSubmit = useCan({
    resource: { type: 'composite', id: 'oa.payment' },
    action: 'submit',
  });

  const loanSubmit = useCan({
    resource: { type: 'composite', id: 'oa.loan' },
    action: 'submit',
  });

  const purchaseSubmit = useCan({
    resource: { type: 'composite', id: 'oa.purchase' },
    action: 'submit',
  });
  const reimbursementSubmit = useCan({
    resource: { type: 'composite', id: 'oa.reimbursement' },
    action: 'submit',
  });
  const travelSubmit = useCan({
    resource: { type: 'composite', id: 'oa.travel' },
    action: 'submit',
  });
  const travelCancellationSubmit = useCan({
    resource: { type: 'composite', id: 'oa.travelCancellation' },
    action: 'submit',
  });
  const trainingSubmit = useCan({
    resource: { type: 'composite', id: 'oa.training' },
    action: 'submit',
  });
  const budgetSubmit = useCan({
    resource: { type: 'composite', id: 'oa.budgetAdjustment' },
    action: 'submit',
  });
  const supplySubmit = useCan({
    resource: { type: 'composite', id: 'oa.supplies' },
    action: 'submit',
  });
  const generalSubmit = useCan({
    resource: { type: 'composite', id: 'oa.general' },
    action: 'submit',
  });
  const overtimeSubmit = useCan({
    resource: { type: 'composite', id: 'oa.overtime' },
    action: 'submit',
  });
  const cancellationSubmit = useCan({
    resource: { type: 'composite', id: 'oa.leaveCancellation' },
    action: 'submit',
  });
  // The server derives attention from the complete authorized mine set, not this page.
  const revisionRows = { ...mine, data: mine.meta?.attention?.revisions };
  const [personalRevision, setPersonalRevision] = useState(0);
  const refreshRef = useRef<HTMLButtonElement>(null);
  const { reload: reloadPending } = pending;
  const { reload: reloadMine } = mine;
  const reload = useCallback(() => {
    setPersonalRevision((revision) => revision + 1);
    reloadPending();
    reloadMine();
  }, [reloadPending, reloadMine]);
  const context = useMemo(
    () => ({ reload, basePath: base.pathname, search: location.search }),
    [reload, base.pathname, location.search],
  );
  const loading = pending.loading || mine.loading;
  const revisions = (revisionRows.data ?? []).filter(
    (r) => r.applicantId === session?.user.id,
  );
  const attention = [
    ...(revisionRows.error
      ? []
      : revisions.map((r) => ({
          record: r,
          next: 'nextRevision',
          priority: 0,
        }))),
    ...(pending.error
      ? []
      : (pending.data ?? []).map((r) => ({
          record: r,
          next:
            r.kind === 'oa.workItem'
              ? 'nextWorkItem'
              : r.kind === 'oa.announcementReceipt'
                ? 'nextAnnouncement'
                : r.status === 'dispatch'
                  ? 'nextDispatch'
                  : r.status === 'issuing'
                    ? 'nextIssue'
                    : 'nextHandling',
          priority: 1,
        }))),
  ].sort(
    (a, b) =>
      a.priority - b.priority ||
      (a.record.createdAt ?? '').localeCompare(b.record.createdAt ?? ''),
  );
  const unique = attention
    .filter(
      (item, index) =>
        attention.findIndex(
          (other) =>
            other.record.id === item.record.id &&
            other.record.kind === item.record.kind,
        ) === index,
    )
    .slice(0, 6);
  const recent =
    mine.meta?.attention?.submitted ??
    (mine.data ?? []).filter((r) => r.status !== 'draft').slice(0, 5);
  const metricLinks: Record<string, string> = {
    pending: '/approvals/todo',
    revision: '/approvals/mine?category=revisions',
    drafts: '/approvals/mine?category=drafts',
    inProgress: '/approvals/mine?category=inProgress',
  };
  const metrics = [
    { key: 'pending', value: pending.meta?.total, error: pending.error },
    {
      key: 'revision',
      value: mine.meta?.counts.revisions,
      error: mine.error,
    },
    {
      key: 'drafts',
      value: mine.meta?.counts.drafts,
      error: mine.error,
    },
    {
      key: 'inProgress',
      value: mine.meta?.counts.inProgress,
      error: mine.error,
    },
  ];
  const transferPermission = useCan({
    resource: { type: 'composite', id: 'oa.transfer' },
    action: 'submit',
  });
  const transferOptions = useResource<{ canCreateAsHR: boolean }>(
    transferPermission.can &&
      secondaryOptionsReady &&
      !transferPermission.isPending &&
      !transferPermission.error
      ? 'transferRequests/capabilities'
      : null,
  );
  const transferCreate =
    transferPermission.can &&
    !transferPermission.isPending &&
    !transferPermission.error &&
    !transferOptions.loading &&
    !transferOptions.error &&
    transferOptions.data?.canCreateAsHR === true;
  const recruitmentPermission = useCan({
    resource: { type: 'composite', id: 'oa.recruitment' },
    action: 'submit',
  });
  const recruitmentOptions = useResource<{ canCreate: boolean }>(
    recruitmentPermission.can &&
      secondaryOptionsReady &&
      !recruitmentPermission.isPending &&
      !recruitmentPermission.error
      ? 'recruitmentRequests/createOptions'
      : null,
  );
  const recruitmentCreate =
    recruitmentPermission.can &&
    !recruitmentPermission.isPending &&
    !recruitmentPermission.error &&
    !recruitmentOptions.loading &&
    !recruitmentOptions.error &&
    recruitmentOptions.data?.canCreate === true;
  const vehiclePermission = useCan({
    resource: { type: 'composite', id: 'oa.vehicleRequests' },
    action: 'submit',
  });
  const vehicleView = useCan({
    resource: { type: 'composite', id: 'oa.vehicleRequests' },
    action: 'view',
  });
  const vehicleOptions = useResource<{ canCreate: boolean }>(
    vehiclePermission.can &&
      secondaryOptionsReady &&
      !vehiclePermission.isPending &&
      !vehiclePermission.error &&
      vehicleView.can &&
      !vehicleView.isPending &&
      !vehicleView.error
      ? 'vehicleBrowser/options'
      : null,
  );
  const vehicleCreate =
    vehiclePermission.can &&
    !vehiclePermission.isPending &&
    !vehiclePermission.error &&
    !vehicleOptions.loading &&
    !vehicleOptions.error &&
    vehicleOptions.data?.canCreate === true;
  const sealPermission = useCan({
    resource: { type: 'composite', id: 'oa.sealRequests' },
    action: 'create',
  });
  const sealCreate =
    sealPermission.can && !sealPermission.isPending && !sealPermission.error;
  const certificatePermission = useCan({
    resource: { type: 'composite', id: 'oa.certificateRequests' },
    action: 'create',
  });
  const certificateCreate =
    certificatePermission.can &&
    !certificatePermission.isPending &&
    !certificatePermission.error;
  const canSubmit =
    vehicleCreate ||
    recruitmentCreate ||
    sealCreate ||
    transferCreate ||
    certificateCreate ||
    contractCreate ||
    assetCreate ||
    vendorCreate ||
    probationCreate ||
    departureCreate ||
    (!submit.isPending && submit.can) ||
    (!attendanceSubmit.isPending && attendanceSubmit.can) ||
    (!outingSubmit.isPending && outingSubmit.can) ||
    (!generalSubmit.isPending && generalSubmit.can) ||
    (!expensePlanSubmit.isPending && expensePlanSubmit.can) ||
    (!trainingSubmit.isPending && trainingSubmit.can) ||
    (!paymentSubmit.isPending && paymentSubmit.can) ||
    (!loanSubmit.isPending && loanSubmit.can) ||
    (!purchaseSubmit.isPending && purchaseSubmit.can) ||
    (!reimbursementSubmit.isPending && reimbursementSubmit.can) ||
    (!travelSubmit.isPending && travelSubmit.can) ||
    (!travelCancellationSubmit.isPending && travelCancellationSubmit.can) ||
    (!budgetSubmit.isPending && budgetSubmit.can) ||
    (!supplySubmit.isPending && supplySubmit.can) ||
    (!overtimeSubmit.isPending && overtimeSubmit.can) ||
    (!cancellationSubmit.isPending && cancellationSubmit.can);
  const retry = () => {
    reload();
    refreshRef.current?.focus();
  };
  return (
    <PageContainer className='space-y-4'>
      <PageHeader
        title={
          <span ref={titleRef} tabIndex={-1}>
            {t('workbench.title')}
          </span>
        }
        description={t('workbench.description')}
        actions={
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    ref={refreshRef}
                    variant='outline'
                    size='icon'
                    aria-label={t('approvals.refresh')}
                    disabled={loading}
                    onClick={reload}
                  />
                }
              >
                <RefreshCw className={loading ? 'animate-spin' : undefined} />
              </TooltipTrigger>
              <TooltipContent>{t('approvals.refresh')}</TooltipContent>
            </Tooltip>
            {canSubmit ? (
              <Button
                onClick={() => {
                  requestSectionRef.current?.scrollIntoView({
                    block: 'start',
                    behavior: 'smooth',
                  });
                  requestSectionRef.current?.focus({ preventScroll: true });
                }}
              >
                <Plus data-icon='inline-start' />
                {t('workbench.newRequest')}
              </Button>
            ) : null}
          </>
        }
      />
      <PersonalCards key={personalRevision} />
      <div className='grid grid-cols-2 gap-4 xl:grid-cols-4'>
        {metrics.map((metric) => {
          const content = (
            <Card className='h-full transition-colors group-hover:bg-muted/50'>
              <CardHeader>
                <CardDescription>
                  {t(`workbench.${metric.key}`)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {metric.error ? (
                  <span className='text-sm text-muted-foreground'>
                    {t('workbench.unavailable')}
                  </span>
                ) : metric.value === undefined ? (
                  <Skeleton
                    className='h-8 w-16'
                    aria-label={t('workbench.loading')}
                  />
                ) : (
                  <span className='text-3xl font-semibold tabular-nums'>
                    {new Intl.NumberFormat(i18n.language).format(metric.value)}
                  </span>
                )}
              </CardContent>
            </Card>
          );
          return metric.error || metric.value === undefined ? (
            <div key={metric.key}>{content}</div>
          ) : (
            <Link
              key={metric.key}
              to={metricLinks[metric.key]}
              className='group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring'
              aria-label={`${t(`workbench.${metric.key}`)} ${metric.value}`}
            >
              {content}
            </Link>
          );
        })}
      </div>
      {loading && (pending.data || mine.data) ? (
        <p role='status' className='text-sm text-muted-foreground'>
          {t('workbench.refreshing')}
        </p>
      ) : null}

      {revisionRows.error ? (
        <ErrorState context='query' error={revisionRows.error} retry={retry} />
      ) : null}
      <div className='flex flex-col items-stretch gap-4 md:flex-row'>
        <Card className='min-w-0 flex-1'>
          <CardHeader>
            <CardTitle>
              <div className='flex items-center gap-2'>
                <h2>{t('workbench.attention')}</h2>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant='ghost'
                        size='icon-sm'
                        aria-label={t('approvalCenter.scope')}
                      />
                    }
                  >
                    <Info aria-hidden='true' />
                  </TooltipTrigger>
                  <TooltipContent>{t('approvalCenter.scope')}</TooltipContent>
                </Tooltip>
              </div>
            </CardTitle>
            <CardDescription>
              {t('workbench.attentionDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent className='flex flex-col gap-4'>
            {pending.error ? (
              <ErrorState context='query' error={pending.error} retry={retry} />
            ) : null}
            {mine.error ? (
              <ErrorState context='query' error={mine.error} retry={retry} />
            ) : null}
            {unique.length ? (
              <ul className='flex flex-col'>
                {unique.map(({ record, priority }) => (
                  <WorkRow
                    key={`${record.kind}:${record.id}`}
                    record={record}
                    showInitiator
                    showApplicant={priority === 1}
                    disabled={loading}
                  />
                ))}
              </ul>
            ) : pending.loading || mine.loading ? (
              <RowsSkeleton />
            ) : !pending.error && !mine.error ? (
              <EmptyCard kind='Attention' canSubmit={canSubmit} />
            ) : null}
          </CardContent>
          <CardFooter className='mt-auto flex flex-wrap gap-2'>
            <ListLink to='/approvals/todo' label={t('workbench.viewPending')} />
            {(mine.meta?.counts.revisions ?? 0) > 0 ? (
              <ListLink
                to='/approvals/mine?category=revisions'
                label={t('workbench.viewRevisions')}
              />
            ) : null}
          </CardFooter>
        </Card>
        <Card className='min-w-0 flex-1'>
          <CardHeader>
            <CardTitle>
              <h2>{t('workbench.mine')}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {mine.error ? (
              <ErrorState context='query' error={mine.error} retry={retry} />
            ) : recent.length ? (
              <ul className='flex flex-col'>
                {recent.map((record) => (
                  <WorkRow
                    key={`${record.kind}:${record.id}`}
                    record={record}
                    disabled={loading}
                  />
                ))}
              </ul>
            ) : mine.loading ? (
              <RowsSkeleton />
            ) : (
              <EmptyCard kind='Mine' canSubmit={canSubmit} />
            )}
          </CardContent>
          <CardFooter className='mt-auto'>
            <ListLink to='/approvals/mine' label={t('workbench.viewMine')} />
          </CardFooter>
        </Card>
      </div>
      {canSubmit ? (
        <section
          id='request-actions'
          ref={requestSectionRef}
          tabIndex={-1}
          aria-label={t('workbench.newRequest')}
          className='scroll-mt-6 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring'
        >
          <NewRequestCard
            vehicle={vehicleCreate}
            recruitment={recruitmentCreate}
            seal={sealCreate}
            transfer={transferCreate}
            certificate={certificateCreate}
            leave={submit.can}
            attendance={attendanceSubmit.can}
            outing={outingSubmit.can}
            expensePlan={expensePlanSubmit.can}
            training={trainingSubmit.can}
            reimbursement={reimbursementSubmit.can}
            probation={probationCreate}
            departure={departureCreate}
            contract={contractCreate}
            asset={assetCreate}
            vendor={vendorCreate}
            payment={paymentSubmit.can}
            loan={loanSubmit.can}
            purchase={purchaseSubmit.can}
            travel={travelSubmit.can}
            travelCancellation={travelCancellationSubmit.can}
            budget={budgetSubmit.can}
            supplies={supplySubmit.can}
            general={generalSubmit.can}
            overtime={overtimeSubmit.can}
            cancellation={cancellationSubmit.can}
          />
        </section>
      ) : null}
      <Outlet context={context} />
    </PageContainer>
  );
}

function WorkRow({
  record,
  showInitiator = false,
  showApplicant = false,
  disabled,
}: {
  record: CenterRecord;
  showInitiator?: boolean;
  showApplicant?: boolean;
  disabled: boolean;
}) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const date = (value: string) =>
    formatApprovalPeriodValue(value, i18n.language);
  const tone = approvalStatusTone(record.status, record.kind);
  const business = t(
    `approvalCenter.kinds.${approvalBusiness(record.kind).label}`,
  );
  const title =
    record.title?.trim() ||
    t(
      record.status === 'draft'
        ? 'workbench.draftWithoutSummary'
        : 'workbench.requestWithoutSummary',
      { type: business },
    );
  const to = {
    pathname: `${approvalBusiness(record.kind).detail}/${record.id}`,
    search: location.search,
    hash: location.hash,
  };
  const { session } = useAuthentication();
  const isApproval = !['oa.workItem', 'oa.announcementReceipt'].includes(
    record.kind,
  );
  const showPerson =
    showInitiator &&
    ((showApplicant && isApproval) || record.applicantId !== session?.user?.id);
  const relevantDate = record.dueAt || record.updatedAt || record.createdAt;
  const dateLabel = record.dueAt
    ? 'workbench.dueAt'
    : record.updatedAt
      ? 'workbench.updatedAt'
      : 'workbench.createdAt';
  const linkClass =
    'rounded-sm text-sm font-medium text-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:outline-ring focus-visible:outline-2';
  return (
    <li className='grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border-b border-border py-3 first:pt-0 last:border-0 last:pb-0'>
      <div className='min-w-0 break-words'>
        {disabled ? (
          <span className='text-sm font-medium'>{title}</span>
        ) : (
          <Link className={linkClass} to={to}>
            {title}
          </Link>
        )}
      </div>
      <StatusBadge tone={tone} className='justify-self-end'>
        {approvalStateLabel(record.status, t, record.kind)}
      </StatusBadge>
      {showPerson ||
      title !== business ||
      (record.startDate && record.endDate) ||
      relevantDate ? (
        <div className='col-span-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground'>
          {showPerson ? (
            <span className='inline-flex min-w-0 items-center gap-1'>
              <span>
                {t(isApproval ? 'approvals.applicant' : 'workbench.initiator')}:
              </span>
              <UserName
                name={record.applicant?.name ?? t('approvals.unknownPerson')}
              />
            </span>
          ) : null}
          <span>{business}</span>
          {record.unit === 'cents' && record.amount !== null ? (
            <span>
              {new Intl.NumberFormat(i18n.language, {
                style: 'currency',
                currency: 'CNY',
              }).format(record.amount / 100)}
            </span>
          ) : null}
          {relevantDate ? (
            <time dateTime={relevantDate}>
              {t(dateLabel, { date: date(relevantDate) })}
            </time>
          ) : null}
          {!(record.unit === 'cents' && record.amount !== null) &&
          record.startDate &&
          record.endDate ? (
            <span>
              {date(record.startDate)}–{date(record.endDate)}
            </span>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function ListLink({ to, label }: { to: string; label: string }) {
  return (
    <Button
      variant='ghost'
      size='sm'
      render={<Link to={to} />}
      nativeButton={false}
    >
      {label}
    </Button>
  );
}
/** This card contains business creation actions only; browsing belongs in the sidebar and summary footers. */
function NewRequestCard({
  vehicle,
  recruitment,
  seal,
  transfer,
  certificate,
  contract,
  leave,
  overtime,
  cancellation,
  general,
  supplies,
  budget,
  expensePlan,
  training,
  reimbursement,
  probation,
  departure,
  asset,
  vendor,
  payment,
  loan,
  purchase,
  travel,
  travelCancellation,
  attendance,
  outing,
}: {
  vehicle: boolean;
  recruitment: boolean;
  seal: boolean;
  transfer: boolean;
  certificate: boolean;
  leave: boolean;
  overtime: boolean;
  cancellation: boolean;
  general: boolean;
  supplies: boolean;
  budget: boolean;
  expensePlan: boolean;
  training: boolean;
  reimbursement: boolean;
  probation: boolean;
  departure: boolean;
  contract: boolean;
  asset: boolean;
  vendor: boolean;
  payment: boolean;
  loan: boolean;
  purchase: boolean;
  travel: boolean;
  travelCancellation: boolean;
  attendance: boolean;
  outing: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Card className='min-w-0'>
      <CardHeader>
        <CardTitle>
          <h2>{t('workbench.newRequest')}</h2>
        </CardTitle>
        <CardDescription>
          {t('workbench.newRequestDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RequestActions
          available={{
            vehicle,
            recruitment,
            seal,
            transfer,
            certificate,
            attendance,
            outing,
            general,
            leave,
            overtime,
            cancellation,
            expensePlan,
            contract,
            asset,
            vendor,
            departure,
            probation,
            payment,
            loan,
            purchase,
            reimbursement,
            travel,
            travelCancellation,
            training,
            budget,
            supplies,
          }}
        />
      </CardContent>
    </Card>
  );
}

function EmptyCard({
  kind,
  canSubmit,
}: {
  kind: 'Attention' | 'Mine' | 'Drafts';
  canSubmit: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Empty className='min-h-48 border border-dashed'>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          <ClipboardCheck />
        </EmptyMedia>
        <EmptyTitle>{t(`workbench.empty${kind}`)}</EmptyTitle>
        <EmptyDescription>
          {t(
            kind === 'Mine' && !canSubmit
              ? 'workbench.emptyMineRestricted'
              : `workbench.empty${kind}Description`,
          )}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
function RowsSkeleton() {
  const { t } = useTranslation();
  return (
    <div className='flex flex-col gap-4' aria-label={t('workbench.loading')}>
      {[0, 1, 2].map((key) => (
        <div key={key} className='flex flex-col gap-2'>
          <Skeleton className='h-5 w-1/3' />
          <Skeleton className='h-4 w-2/3' />
        </div>
      ))}
    </div>
  );
}
function LoadingCards() {
  return (
    <div className='flex flex-col gap-4'>
      <div className='grid grid-cols-2 gap-4 xl:grid-cols-4'>
        {[0, 1, 2, 3].map((key) => (
          <Card key={key}>
            <CardContent>
              <RowsSkeleton />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent>
          <RowsSkeleton />
        </CardContent>
      </Card>
    </div>
  );
}
