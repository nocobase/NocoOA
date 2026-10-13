import { approvalStatusTone } from './status-tone.js';
import { ApplicationSearch } from '#components/application-search';
import { useBatchApprove } from './batch-approve.js';
import { UserName } from '#components/user-name';
import { ApplicationTableSkeleton } from '#components/application-table-skeleton';
import { ApplicationToolbar } from '#components/application-toolbar';
import { RequestActions } from '#components/request-actions';
import {
  requestActionDefinitions,
  type RequestActionAvailability,
} from '#components/request-action-definitions';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '#components/ui/dialog';
import type { Options as ContractOptions } from '../contracts/types.js';
import type { Options as AssetRequestOptions } from '../asset-requests/types.js';
import type { QualificationOptions } from '../vendor-qualifications/types.js';
import { useResource } from './use-resource.js';
import type { DepartureOptions } from '../departure-requests/types.js';
import type { ProbationOptions } from '../probation-requests/types.js';
import { approvalStateLabel } from './business-metadata.js';
import { approvalBusiness, approvalBusinesses } from './business-metadata.js';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { ClipboardCheck, MoreHorizontal, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useResolvedPath } from 'react-router';
import { TruncatedText } from '#components/truncated-text';
import { PageHeader } from '#components/page-header';
import { DataTableServer } from '#components/data-table/server-table';
import { DataTableColumnHeader } from '#components/data-table/column-header';
import { Button } from '#components/ui/button';
import { Badge } from '#components/ui/badge';
import { StatusBadge } from '#components/status-badge';
import { Spinner } from '#components/ui/spinner';
import {
  Empty,
  EmptyMedia,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '#components/ui/empty';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from '#components/ui/dropdown-menu';
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
import { useUrlSearch } from '#hooks/use-url-search';

import { ErrorState } from './states.js';
import { TAB_VIEW } from './types.js';
import { useCenterResource, type CenterRecord } from './use-center-resource.js';
import { Tabs, TabsList, TabsTrigger } from '#components/ui/tabs';

const kindLabel = (kind: string) =>
  kind === 'all' ? 'all' : approvalBusiness(kind)?.label;
const mineCategories = [
  'all',
  'drafts',
  'revisions',
  'inProgress',
  'submitted',
] as const;
const detailPath = (kind: string) => approvalBusiness(kind)?.detail;
export default function ApprovalList() {
  const { t, i18n } = useTranslation();
  const { session } = useAuthentication();
  const leaveDelegate = useCan({
    resource: { type: 'composite', id: 'oa.leave' },
    action: 'delegate',
  }).can;
  const overtimeDelegate = useCan({
    resource: { type: 'composite', id: 'oa.overtime' },
    action: 'delegate',
  }).can;
  const location = useLocation();
  const path = useResolvedPath('.');
  const tab = path.pathname.split('/').at(-1) ?? 'todo';
  const view = TAB_VIEW[tab] ?? 'pending';

  const permission = useCan({
    resource: { type: 'composite', id: 'oa.leave' },
    action: 'submit',
  });
  const transferPermission = useCan({
    resource: { type: 'composite', id: 'oa.transfer' },
    action: 'submit',
  });
  const transferOptions = useResource<{ canCreateAsHR: boolean }>(
    transferPermission.can &&
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
  const vehicleOptions = useResource<{ canCreate: boolean }>(
    vehiclePermission.can &&
      !vehiclePermission.isPending &&
      !vehiclePermission.error
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
  const transferEdit = useCan({
    resource: { type: 'composite', id: 'oa.transfer' },
    action: 'edit',
  }).can;
  const certificateEdit = useCan({
    resource: { type: 'composite', id: 'oa.certificateRequests' },
    action: 'edit',
  }).can;
  const search = useUrlSearch({ resetParams: ['page'] });
  const searchRef = useRef<HTMLInputElement>(null);
  const overtimePermission = useCan({
    resource: { type: 'composite', id: 'oa.overtime' },
    action: 'submit',
  });
  const cancellationPermission = useCan({
    resource: { type: 'composite', id: 'oa.leaveCancellation' },
    action: 'submit',
  });
  const cancellationDelegate = useCan({
    resource: { type: 'composite', id: 'oa.leaveCancellation' },
    action: 'delegate',
  }).can;
  const supplySubmit = useCan({
    resource: { type: 'composite', id: 'oa.supplies' },
    action: 'submit',
  }).can;
  const generalPermission = useCan({
    resource: { type: 'composite', id: 'oa.general' },
    action: 'submit',
  }).can;
  const generalDelegate = useCan({
    resource: { type: 'composite', id: 'oa.general' },
    action: 'delegate',
  }).can;
  const attendanceSubmit = useCan({
    resource: { type: 'composite', id: 'oa.attendanceChange' },
    action: 'submit',
  }).can;
  const attendanceDelegate = useCan({
    resource: { type: 'composite', id: 'oa.attendanceChange' },
    action: 'delegate',
  }).can;
  const outingSubmit = useCan({
    resource: { type: 'composite', id: 'oa.outing' },
    action: 'submit',
  }).can;
  const outingDelegate = useCan({
    resource: { type: 'composite', id: 'oa.outing' },
    action: 'delegate',
  }).can;
  const expensePlanSubmit = useCan({
    resource: { type: 'composite', id: 'oa.expensePlan' },
    action: 'submit',
  }).can;
  const expensePlanDelegate = useCan({
    resource: { type: 'composite', id: 'oa.expensePlan' },
    action: 'delegate',
  }).can;
  const trainingSubmit = useCan({
    resource: { type: 'composite', id: 'oa.training' },
    action: 'submit',
  }).can;
  const trainingDelegate = useCan({
    resource: { type: 'composite', id: 'oa.training' },
    action: 'delegate',
  }).can;
  const assetSubmit = useCan({
    resource: { type: 'composite', id: 'oa.assetRequests' },
    action: 'create',
  });
  const assetOptions = useResource<AssetRequestOptions>(
    assetSubmit.can && !assetSubmit.isPending && !assetSubmit.error
      ? 'assetRequests/options'
      : null,
    { viewer: session?.user.id ?? '' },
  );
  const contractSubmit = useCan({
    resource: { type: 'composite', id: 'oa.contract' },
    action: 'submit',
  });
  const contractOptions = useResource<ContractOptions>(
    contractSubmit.can && !contractSubmit.isPending && !contractSubmit.error
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
    vendorSubmit.can && !vendorSubmit.isPending && !vendorSubmit.error
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
    departureSubmit.can || departureDelegate.can
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
  const probationDelegate = useCan({
    resource: { type: 'composite', id: 'oa.probation' },
    action: 'delegate',
  }).can;
  const probationOptions = useResource<ProbationOptions>(
    probationDelegate ? 'probationRequests/options' : null,
    { viewer: session?.user.id ?? '' },
  );
  const probationCreate =
    probationDelegate &&
    !probationOptions.loading &&
    !probationOptions.error &&
    !!probationOptions.data?.canCreateManualDraft;
  const paymentSubmit = useCan({
    resource: { type: 'composite', id: 'oa.payment' },
    action: 'submit',
  }).can;
  const loanSubmit = useCan({
    resource: { type: 'composite', id: 'oa.loan' },
    action: 'submit',
  }).can;
  const purchaseSubmit = useCan({
    resource: { type: 'composite', id: 'oa.purchase' },
    action: 'submit',
  }).can;
  const reimbursementSubmit = useCan({
    resource: { type: 'composite', id: 'oa.reimbursement' },
    action: 'submit',
  }).can;
  const reimbursementDelegate = useCan({
    resource: { type: 'composite', id: 'oa.reimbursement' },
    action: 'delegate',
  }).can;
  const travelSubmit = useCan({
    resource: { type: 'composite', id: 'oa.travel' },
    action: 'submit',
  }).can;
  const travelDelegate = useCan({
    resource: { type: 'composite', id: 'oa.travel' },
    action: 'delegate',
  }).can;
  const travelCancellationSubmit = useCan({
    resource: { type: 'composite', id: 'oa.travelCancellation' },
    action: 'submit',
  }).can;
  const travelCancellationDelegate = useCan({
    resource: { type: 'composite', id: 'oa.travelCancellation' },
    action: 'delegate',
  }).can;
  const budgetSubmit = useCan({
    resource: { type: 'composite', id: 'oa.budgetAdjustment' },
    action: 'submit',
  }).can;
  const budgetDelegate = useCan({
    resource: { type: 'composite', id: 'oa.budgetAdjustment' },
    action: 'delegate',
  }).can;
  const sealEdit = useCan({
    resource: { type: 'composite', id: 'oa.sealRequests' },
    action: 'edit',
  }).can;
  const grants = useMemo(
    () => ({
      'oa.recruitment': { submit: recruitmentPermission.can, delegate: false },
      'oa.sealRequest': { submit: sealEdit, delegate: false },
      'oa.vehicleRequest': { submit: vehiclePermission.can, delegate: false },
      'oa.attendanceChange': {
        submit: attendanceSubmit,
        delegate: attendanceDelegate,
      },
      'oa.outing': { submit: outingSubmit, delegate: outingDelegate },
      'oa.leave': { submit: permission.can, delegate: leaveDelegate },
      'oa.overtime': {
        submit: overtimePermission.can,
        delegate: overtimeDelegate,
      },
      'oa.leaveCancellation': {
        submit: cancellationPermission.can,
        delegate: cancellationDelegate,
      },
      'oa.expensePlan': {
        submit: expensePlanSubmit,
        delegate: expensePlanDelegate,
      },
      'oa.training': { submit: trainingSubmit, delegate: trainingDelegate },
      'oa.contract': { submit: contractSubmit.can, delegate: false },
      'oa.assetRequest': { submit: assetCreate, delegate: false },
      'oa.vendorQualification': { submit: vendorCreate, delegate: false },
      'oa.departure': { submit: departureSelf, delegate: departureManual },
      'oa.probation': { submit: probationCreate, delegate: probationCreate },
      'oa.payment': { submit: paymentSubmit, delegate: false },
      'oa.loan': { submit: loanSubmit, delegate: false },
      'oa.purchase': { submit: purchaseSubmit, delegate: false },
      'oa.reimbursement': {
        submit: reimbursementSubmit,
        delegate: reimbursementDelegate,
      },
      'oa.travel': { submit: travelSubmit, delegate: travelDelegate },
      'oa.travelCancellation': {
        submit: travelCancellationSubmit,
        delegate: travelCancellationDelegate,
      },
      'oa.budgetAdjustment': { submit: budgetSubmit, delegate: budgetDelegate },
      'oa.supplies': { submit: supplySubmit, delegate: false },
      'oa.general': { submit: generalPermission, delegate: generalDelegate },
      'oa.transfer': { submit: transferEdit, delegate: transferEdit },
      'oa.certificateRequest': { submit: certificateEdit, delegate: false },
    }),
    [
      recruitmentPermission.can,
      sealEdit,
      vehiclePermission.can,
      transferEdit,
      certificateEdit,
      permission.can,
      leaveDelegate,
      overtimePermission.can,
      overtimeDelegate,
      cancellationPermission.can,
      cancellationDelegate,
      expensePlanSubmit,
      expensePlanDelegate,
      trainingSubmit,
      trainingDelegate,
      reimbursementSubmit,
      paymentSubmit,
      probationCreate,
      assetCreate,
      contractSubmit.can,
      vendorCreate,
      departureSelf,
      departureManual,
      loanSubmit,
      purchaseSubmit,
      reimbursementDelegate,
      travelSubmit,
      travelDelegate,
      travelCancellationSubmit,
      travelCancellationDelegate,
      budgetSubmit,
      budgetDelegate,
      supplySubmit,
      generalPermission,
      generalDelegate,
      attendanceSubmit,
      attendanceDelegate,
      outingSubmit,
      outingDelegate,
    ],
  );
  const kind = search.searchParams.get('kind') ?? 'all';
  const rawCategory = search.searchParams.get('category');
  const category =
    view === 'mine' && mineCategories.some((value) => value === rawCategory)
      ? rawCategory!
      : 'all';
  const invalidCategory =
    rawCategory !== null && (view !== 'mine' || category === 'all');
  const sort = search.searchParams.get('orderBy') ?? 'createdAt';
  const desc = search.searchParams.get('direction') !== 'asc';
  const sorting: SortingState = [
    {
      id: sort === 'dueAt' ? 'dueAt' : 'createdAt',
      desc,
    },
  ];
  const pageSize = [10, 20, 50].includes(
    Number(search.searchParams.get('pageSize')),
  )
    ? Number(search.searchParams.get('pageSize'))
    : 20;
  const page = Math.max(
    0,
    Number(search.searchParams.get('page') ?? 1) - 1 || 0,
  );
  const resource = useCenterResource({
    view,
    page: String(page + 1),
    pageSize: String(pageSize),
    orderBy: sorting[0].id,
    direction: desc ? 'desc' : 'asc',
    ...(kind !== 'all' ? { kind } : {}),
    ...(category !== 'all' ? { category } : {}),
    ...(search.search ? { search: search.search } : {}),
  });
  const hasFilters = !!search.text || kind !== 'all' || category !== 'all';
  const updateSearch = search.updateParams;
  const obsoleteStatus = search.searchParams.has('status');
  const obsoletePeriodSort = sort === 'startDate';
  const retiredSearch = search.searchParams.toString();
  const cleanedSearchRef = useRef<string | null>(null);
  useEffect(() => {
    // Retired filters and columns must not silently affect bookmarked center views.
    if (obsoleteStatus || obsoletePeriodSort || invalidCategory) {
      // Navigation may be deferred by the application guard; issue it once per URL.
      if (cleanedSearchRef.current === retiredSearch) return;
      cleanedSearchRef.current = retiredSearch;
      updateSearch((p) => {
        p.delete('status');
        if (invalidCategory) p.delete('category');
        if (obsoletePeriodSort) p.delete('orderBy');
        p.delete('page');
      });
      return;
    }
    cleanedSearchRef.current = null;
    if (!resource.loading && resource.meta && resource.meta.page !== page + 1)
      updateSearch((p) => {
        p.set('page', String(resource.meta!.page));
      });
  }, [
    obsoleteStatus,
    obsoletePeriodSort,
    invalidCategory,
    retiredSearch,
    resource.loading,
    resource.meta,
    page,
    updateSearch,
  ]);
  const empty = resource.meta?.total === 0 && !hasFilters;
  const available: RequestActionAvailability = {
    vehicle: vehicleCreate,
    recruitment: recruitmentCreate,
    seal: sealCreate,
    transfer: transferCreate,
    certificate: certificateCreate,
    leave: permission.can,
    attendance: attendanceSubmit,
    outing: outingSubmit,
    expensePlan: expensePlanSubmit,
    contract: contractCreate,
    asset: assetCreate,
    vendor: vendorCreate,
    departure: departureCreate,
    probation: probationCreate,
    payment: paymentSubmit,
    loan: loanSubmit,
    purchase: purchaseSubmit,
    reimbursement: reimbursementSubmit || reimbursementDelegate,
    travel: travelSubmit,
    travelCancellation: travelCancellationSubmit,
    training: trainingSubmit,
    budget: budgetSubmit,
    supplies: supplySubmit,
    general: generalPermission,
    overtime: overtimePermission.can,
    cancellation: cancellationPermission.can,
  };
  const canCreate = requestActionDefinitions.some(({ key }) => available[key]);
  const recordPath = (r: CenterRecord) => detailPath(r.kind);
  const [requestPickerOpen, setRequestPickerOpen] = useState(false);
  const create = (
    <Dialog open={requestPickerOpen} onOpenChange={setRequestPickerOpen}>
      <DialogTrigger render={<Button />}>
        {t('approvalCenter.newRequest')}
      </DialogTrigger>
      <DialogContent className='flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-2xl'>
        <DialogHeader className='shrink-0'>
          <DialogTitle>{t('approvalCenter.newRequest')}</DialogTitle>
          <DialogDescription>
            {t('workbench.newRequestDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className='-mx-4 min-h-0 flex-1 overflow-y-auto px-4'>
          <RequestActions
            available={available}
            onSelect={() => setRequestPickerOpen(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
  const batch = useBatchApprove(
    resource.data,
    view === 'pending' && !resource.loading && !resource.error,
    location.pathname + location.search,
    resource.reload,
  );
  const columns = useMemo<ColumnDef<CenterRecord, unknown>[]>(() => {
    const columns: ColumnDef<CenterRecord, unknown>[] = [
      {
        id: 'reference',
        header: t('approvalCenter.reference'),
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => (
          <TruncatedText
            text={
              row.original.title ??
              row.original.number ??
              t(
                row.original.status === 'draft'
                  ? 'approvals.draft'
                  : 'approvals.detail',
              )
            }
          >
            <Link
              className='text-primary underline-offset-4 hover:underline'
              to={{
                pathname: `${recordPath(row.original)}/${row.original.id}`,
                search: location.search,
                hash: location.hash,
              }}
            >
              {row.original.title ??
                row.original.number ??
                t(
                  row.original.status === 'draft'
                    ? 'approvals.draft'
                    : 'approvals.detail',
                )}
            </Link>
          </TruncatedText>
        ),
      },
      {
        id: 'applicant',
        header: t('approvalCenter.initiator'),
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => (
          <UserName
            name={row.original.applicant?.name ?? t('approvals.unknownPerson')}
          />
        ),
      },
      {
        accessorKey: 'kind',
        header: t('approvalCenter.kind'),
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => (
          <Badge variant='outline'>
            {t(`approvalCenter.kinds.${kindLabel(row.original.kind)}`)}
          </Badge>
        ),
      },
      {
        accessorKey: 'status',
        header: t('approvals.status'),
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => (
          <StatusBadge
            tone={approvalStatusTone(row.original.status, row.original.kind)}
          >
            {approvalStateLabel(row.original.status, t, row.original.kind)}
          </StatusBadge>
        ),
      },
      {
        accessorKey: 'dueAt',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('workItems.dueAt')} />
        ),
        cell: ({ row }) =>
          row.original.dueAt
            ? new Intl.DateTimeFormat(i18n.language, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(row.original.dueAt))
            : '—',
      },
      {
        accessorKey: 'createdAt',
        enableHiding: false,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('approvals.createdAt')}
          />
        ),
        cell: ({ row }) =>
          row.original.createdAt
            ? new Intl.DateTimeFormat(i18n.language, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(row.original.createdAt))
            : '—',
      },
      {
        id: 'actions',
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant='ghost'
                  size='icon-sm'
                  aria-label={t('approvals.actions', {
                    name:
                      row.original.title ??
                      row.original.number ??
                      t(
                        row.original.status === 'draft'
                          ? 'approvals.draft'
                          : 'approvals.detail',
                      ),
                  })}
                />
              }
            >
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-auto min-w-40'>
              <DropdownMenuGroup>
                <DropdownMenuItem
                  render={
                    <Link
                      to={{
                        pathname: `${recordPath(row.original)}/${row.original.id}`,
                        search: location.search,
                        hash: location.hash,
                      }}
                    />
                  }
                >
                  {t('approvals.detail')}
                </DropdownMenuItem>
                {['draft', 'revision', 'exception'].includes(
                  row.original.status,
                ) &&
                view === 'mine' &&
                (row.original.applicantId === session?.user.id
                  ? grants[row.original.kind as keyof typeof grants]?.submit
                  : grants[row.original.kind as keyof typeof grants]
                      ?.delegate) ? (
                  <DropdownMenuItem
                    render={
                      <Link
                        to={{
                          pathname: `${approvalBusiness(row.original.kind).edit}/${row.original.id}`,
                          search: location.search,
                          hash: location.hash,
                        }}
                      />
                    }
                  >
                    {t('approvals.edit')}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ];
    return view === 'mine'
      ? columns.filter((column) => column.id !== 'applicant')
      : columns;
  }, [
    t,
    i18n.language,
    location.search,
    location.hash,
    view,
    session?.user.id,
    grants,
  ]);
  return (
    <>
      <PageHeader
        title={t('approvals.navigation.center')}
        description={t('approvalCenter.description')}
      />
      <Tabs value={tab}>
        <TabsList className='max-w-full overflow-x-auto'>
          {['todo', 'done', 'copied', 'mine'].map((value) => (
            <TabsTrigger
              nativeButton={false}
              key={value}
              value={value}
              render={
                <Link
                  to={{
                    pathname: `../${value}`,
                    search: (() => {
                      const params = new URLSearchParams(location.search);
                      if (
                        value === tab ||
                        (!params.has('category') && !params.has('page'))
                      )
                        return location.search;
                      if (value !== tab) {
                        params.delete('category');
                        params.delete('page');
                      }
                      return params.toString() ? `?${params}` : '';
                    })(),
                    hash: location.hash,
                  }}
                />
              }
            >
              {t(`approvals.tabs.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <p className='text-sm text-muted-foreground'>
        {t('approvalCenter.scope')}
      </p>
      <ApplicationToolbar
        actions={
          <>
            <>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant='outline'
                      size='icon'
                      aria-label={t('approvals.refresh')}
                      disabled={resource.loading}
                      onClick={() => {
                        resource.reload();
                      }}
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
            {canCreate ? create : null}
          </>
        }
      >
        {view === 'mine' ? (
          <Select
            value={category}
            items={mineCategories.map((value) => ({
              value,
              label: t(`approvalCenter.categories.${value}`),
            }))}
            onValueChange={(value) =>
              search.updateParams((p) => {
                if (!value || value === 'all') p.delete('category');
                else p.set('category', value);
                p.delete('page');
              })
            }
          >
            <SelectTrigger
              className='w-full sm:w-40'
              aria-label={t('approvalCenter.category')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {mineCategories.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`approvalCenter.categories.${value}`)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}
        <Select
          value={kind}
          items={['all', ...Object.keys(approvalBusinesses)].map((value) => ({
            value,
            label: t(`approvalCenter.kinds.${kindLabel(value)}`),
          }))}
          onValueChange={(value) =>
            search.updateParams((p) => {
              p.set('kind', value ?? 'all');
              p.delete('page');
            })
          }
        >
          <SelectTrigger
            className='w-full sm:w-40'
            aria-label={t('approvalCenter.kind')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
            <SelectGroup>
              {['all', ...Object.keys(approvalBusinesses)].map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`approvalCenter.kinds.${kindLabel(value)}`)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <ApplicationSearch
          {...search.inputProps}
          ref={searchRef}
          className='w-full sm:max-w-xs'
          placeholder={t('approvalCenter.search')}
          aria-label={t('approvalCenter.search')}
        />
        {hasFilters ? (
          <Button
            variant='ghost'
            onClick={() => {
              search.clear((p) => {
                p.delete('status');
                p.delete('kind');
                p.delete('category');
                p.delete('page');
              });
              searchRef.current?.focus();
            }}
          >
            {t('approvals.clear')}
          </Button>
        ) : null}
        {resource.loading && resource.data ? <Spinner /> : null}
      </ApplicationToolbar>
      {batch.controls}
      {resource.error ? (
        <ErrorState error={resource.error} retry={resource.reload} />
      ) : null}
      {!resource.data && resource.loading ? (
        <ApplicationTableSkeleton columns={columns.length} />
      ) : resource.data ? (
        <DataTableServer
          columns={
            view === 'pending' && batch.hasCandidates
              ? [batch.column, ...columns]
              : columns
          }
          rows={resource.data}
          total={resource.meta?.total ?? 0}
          getRowId={(r) => `${r.kind}:${r.id}`}
          pagination={{ pageIndex: page, pageSize }}
          pageSizeOptions={[10, 20, 50]}
          sorting={sorting}
          onSortingChange={(next) =>
            search.updateParams((p) => {
              p.set('orderBy', next[0]?.id ?? 'createdAt');
              p.set('direction', next[0]?.desc ? 'desc' : 'asc');
              p.delete('page');
            })
          }
          onPaginationChange={(next) =>
            search.updateParams((p) => {
              p.set('page', String(next.pageIndex + 1));
              p.set('pageSize', String(next.pageSize));
            })
          }
          emptyMessage={
            empty ? (
              <Empty className='min-h-48'>
                <EmptyHeader>
                  <EmptyMedia variant='icon'>
                    <ClipboardCheck />
                  </EmptyMedia>
                  <EmptyTitle>
                    {t(
                      `approvals.empty${tab[0].toUpperCase() + tab.slice(1)}Title`,
                    )}
                  </EmptyTitle>
                  <EmptyDescription>
                    {t(
                      `approvals.empty${tab[0].toUpperCase() + tab.slice(1)}Description`,
                    )}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div>
                {t('approvals.noResults')}
                <Button
                  variant='ghost'
                  onClick={() =>
                    search.clear((p) => {
                      p.delete('status');
                      p.delete('kind');
                      p.delete('category');
                      p.delete('page');
                    })
                  }
                >
                  {t('approvals.clear')}
                </Button>
              </div>
            )
          }
        />
      ) : null}
      <Outlet
        context={{
          reload: resource.reload,
          basePath: path.pathname,
          search: location.search,
        }}
      />
    </>
  );
}
