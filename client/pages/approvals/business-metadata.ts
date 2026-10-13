import { supplyStateLabel } from '../supplies/words.js';
/** Browser route and copy metadata for each published OA approval business. */
export const approvalBusinesses = {
  'oa.workItem': {
    label: 'workItem',
    detail: 'workItem',
    edit: 'editWorkItem',
  },
  'oa.announcementReceipt': {
    label: 'announcementReceipt',
    detail: 'announcement',
    edit: 'editAnnouncement',
  },
  'oa.recruitment': {
    label: 'recruitment',
    detail: 'recruitment',
    edit: 'editRecruitment',
  },
  'oa.sealRequest': { label: 'seal', detail: 'seal', edit: 'editSeal' },
  'oa.vehicleRequest': {
    label: 'vehicleRequest',
    detail: 'vehicle',
    edit: 'editVehicleRequest',
  },
  'oa.transfer': {
    label: 'transfer',
    detail: 'transfer',
    edit: 'editTransfer',
  },
  'oa.certificateRequest': {
    label: 'certificate',
    detail: 'certificate',
    edit: 'editCertificate',
  },
  'oa.contract': {
    label: 'contract',
    detail: 'contract',
    edit: 'editContract',
  },
  'oa.assetRequest': {
    label: 'assetRequest',
    detail: 'assetRequest',
    edit: 'editAssetRequest',
  },
  'oa.vendorQualification': {
    label: 'vendorQualification',
    detail: 'vendorQualification',
    edit: 'editVendorQualification',
  },
  'oa.departure': {
    label: 'departure',
    detail: 'departure',
    edit: 'editDeparture',
  },
  'oa.probation': {
    label: 'probation',
    detail: 'probation',
    edit: 'editProbation',
  },
  'oa.payment': { label: 'payment', detail: 'payment', edit: 'editPayment' },
  'oa.loan': { label: 'loan', detail: 'loan', edit: 'editLoan' },
  'oa.purchase': {
    label: 'purchase',
    detail: 'purchase',
    edit: 'editPurchase',
  },
  'oa.reimbursement': {
    label: 'reimbursement',
    detail: 'reimbursement',
    edit: 'editReimbursement',
  },
  'oa.travel': { label: 'travel', detail: 'travel', edit: 'editTravel' },
  'oa.travelCancellation': {
    label: 'travelCancellation',
    detail: 'travelCancellation',
    edit: 'editTravelCancellation',
  },
  'oa.expensePlan': {
    label: 'expensePlan',
    detail: 'expensePlan',
    edit: 'editExpensePlan',
  },
  'oa.training': {
    label: 'training',
    detail: 'training',
    edit: 'editTraining',
  },
  'oa.budgetAdjustment': {
    label: 'budgetAdjustment',
    detail: 'budgetAdjustment',
    edit: 'editBudgetAdjustment',
  },
  'oa.attendanceChange': {
    label: 'attendanceChange',
    detail: 'attendanceChange',
    edit: 'editAttendanceChange',
  },
  'oa.outing': { label: 'outing', detail: 'outings', edit: 'editOuting' },
  'oa.leave': { label: 'leave', detail: 'leave', edit: 'editLeave' },
  'oa.overtime': {
    label: 'overtime',
    detail: 'overtime',
    edit: 'editOvertime',
  },
  'oa.leaveCancellation': {
    label: 'cancellation',
    detail: 'cancellation',
    edit: 'editCancellation',
  },
  'oa.supplies': { label: 'supplies', detail: 'supply', edit: 'editSupply' },
  'oa.general': { label: 'general', detail: 'general', edit: 'editGeneral' },
} as const;
export type ApprovalBusinessKind = keyof typeof approvalBusinesses;
export const approvalBusiness = (kind: string) =>
  approvalBusinesses[kind as ApprovalBusinessKind];

export function formatApprovalPeriodValue(value: string, language: string) {
  const timestamp = value.includes('T');
  return new Intl.DateTimeFormat(language, {
    dateStyle: 'medium',
    ...(timestamp ? { timeStyle: 'short' as const } : { timeZone: 'UTC' }),
  }).format(new Date(timestamp ? value : `${value}T00:00:00Z`));
}

export function approvalStateLabel(
  state: string,
  t: (key: string) => string,
  kind?: string,
) {
  if (kind === 'oa.workItem') return t(`workItems.states.${state}`);
  if (kind === 'oa.announcementReceipt')
    return t(`announcements.receipt.${state}`);
  if (kind === 'oa.recruitment') return t(`recruitment.status.${state}`);
  if (kind === 'oa.sealRequest') return t(`seals.states.${state}`);
  if (kind === 'oa.vehicleRequest') return t(`vehicles.status.${state}`);
  if (kind === 'oa.transfer') return t(`transfer.status.${state}`);
  if (kind === 'oa.certificateRequest')
    return t(`certificates.states.${state}`);
  if (kind === 'oa.contract') return t(`contracts.statuses.${state}`);
  if (kind === 'oa.assetRequest') return t(`assetRequests.statuses.${state}`);
  if (kind === 'oa.vendorQualification')
    return t(
      state.startsWith('committee_v')
        ? 'vendorQualifications.statuses.committee'
        : `vendorQualifications.statuses.${state}`,
    );
  if (kind === 'oa.departure') return t(`departureRequests.statuses.${state}`);
  if (kind === 'oa.probation') return t(`probationRequests.statuses.${state}`);
  if (kind === 'oa.payment') return t(`paymentRequests.statuses.${state}`);
  if (kind === 'oa.loan') return t(`loanRequests.stages.${state}`);
  if (kind === 'oa.purchase') return t(`purchases.stages.${state}`);
  if (['purchasing'].includes(state)) return t(`purchases.stages.${state}`);
  if (['cashier', 'paid', 'forcedPaid'].includes(state))
    return t(`reimbursementRequests.statuses.${state}`);
  if (state === 'unbooking') return t('travelCancellation.stages.unbooking');
  if (kind === 'oa.travel' && state === 'completed')
    return t('travel.stages.completed');
  if (state === 'booking') return t('travel.stages.booking');
  return ['finance', 'cfo', 'gm', 'executive'].includes(state)
    ? t(
        state === 'executive'
          ? 'training.stages.executive'
          : `budgetAdjustments.stages.${state}`,
      )
    : supplyStateLabel(state, t);
}
