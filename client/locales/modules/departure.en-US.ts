export default {
  businessErrors: {
    DEPARTURE_CHECKLIST_REQUIRED:
      'Complete the departure checklist before proceeding.',
    DEPARTURE_LAST_WORKING_DAY_REQUIRED:
      "Confirm the employee's last working day.",
    DEPARTURE_DATE_PAST:
      'The last working day cannot be earlier than today in the company time zone.',
    DEPARTURE_HANDOVER_INVALID:
      'Select an eligible handover recipient other than the departing employee.',
    DEPARTURE_HANDOVER_INCOMPLETE:
      'Complete the handover items before proceeding.',
    DEPARTURE_ORDINARY_WORK_INCOMPLETE:
      'Complete the ordinary handover work before settling departure.',
    DEPARTURE_LOAN_UNCLEARED:
      "Clear the employee's outstanding loans before settling departure.",
    DEPARTURE_RECEIPT_REQUIRED:
      'Enter the receipt or clearance evidence for this handover item.',
    DEPARTURE_SETTLEMENT_NOTE_REQUIRED: 'Enter the departure settlement note.',
    DEPARTURE_REASSIGNMENT_INCOMPLETE:
      'Complete outstanding task reassignment before proceeding.',
    DEPARTURE_APPLICATION_INCOMPLETE:
      'Complete the departure type, reason and required employee details.',
    DEPARTURE_TYPE_INVALID: 'Select an enabled departure type.',
    DEPARTURE_ALREADY_ACTIVE:
      'This employee already has an active departure request. Open the existing request.',
    DEPARTURE_CANCELLATION_PENDING:
      'Departure cancellation is pending. Resolve it before proceeding.',
    DEPARTURE_EXECUTION_BASELINE_CHANGED:
      'The employee or departure facts changed. Refresh and verify them before execution.',
  },

  authz: {
    cancel: 'Cancel departure',
    resource: 'Departure and handover',
    view: 'View departure requests',
    submit: 'Submit departure requests',
    delegate: 'Create departure requests for employees',
    work: 'Handle departure handover',
    settle: 'Confirm departure settlement',
  },
  schedule: {
    title: 'Departure execution',
    description:
      'Execute due departures and retry incomplete account and membership changes.',
  },

  title: 'Departure and handover',
  description: 'Review departures, handover and effective-date execution.',
  new: 'New departure request',
  edit: 'Edit',
  number: 'Request number',
  refresh: 'Refresh',
  search: 'Search by request number, employee or reason',
  view: 'View',
  allTypes: 'All departure types',
  allStatuses: 'All statuses',
  clearFilters: 'Clear filters',
  emptyTitle: 'No departure requests',
  emptyDescription:
    'Departure applications and handover progress will appear here.',
  noResults: 'No matching departure requests',
  departureType: 'Departure type',
  reason: 'Reason',
  expectedLastWorkingDay: 'Expected last working day',
  lastWorkingDay: 'Confirmed last working day',
  handoverUser: 'Handover recipient',
  createdBy: 'Created by',
  application: 'Application',
  settlement: 'HR settlement',
  settlementDate: 'Settlement date',
  settlementNote: 'Settlement note',
  execution: 'Departure execution',
  notSettled: 'Settlement is not completed.',
  notExecuted:
    'Departure execution is incomplete. The account has not been disabled.',
  executionComplete:
    'The account and organization memberships have been disabled.',
  cancellationReason: 'Cancellation reason',
  cancellationGuidance:
    'After the HR interview, HR may request cancellation before actual departure. A different HR reviewer must confirm before employment is restored.',
  handover: 'Handover work',
  claimant: 'Claimed by',
  receiver: 'Recipient',
  manager: 'Responsible manager',
  forcedBy: 'Exempted by',
  forceReason: 'Exemption reason',
  checklistConfirmed: 'Checklist confirmed',
  receiverAcknowledged: 'Receipt acknowledged',
  yes: 'Yes',
  no: 'No',
  notReady: 'The submission requirements are incomplete.',
  views: {
    mine: 'Mine',
    pending: 'Pending',
    done: 'Done',
    copied: 'Copied',
  },
  statuses: {
    cancellationReview: 'Cancellation confirmation',
    cancelled: 'Cancelled',
    draft: 'Draft',
    revision: 'Returned for revision',
    manager: 'Manager review',
    head: 'Department head review',
    hr: 'HR interview',
    gm: 'General manager review',
    handover: 'Handover',
    completed: 'Settlement completed',
    withdrawn: 'Withdrawn',
    rejected: 'Rejected',
    terminated: 'Terminated',
  },
  workKinds: {
    work: 'Work handover',
    it: 'IT and accounts',
    admin: 'Assets and workplace',
    finance: 'Loans and reimbursements',
  },
  workStates: {
    cancelled: 'Cancelled',
    open: 'Available for claim',
    claimed: 'In progress',
    completed: 'Completed',
  },
  executionStates: {
    cancelled: 'Cancelled',
    ready: 'Waiting for effective date',
    transferring: 'Transferring pending approvals',
    blocked: 'Execution blocked',
    executed: 'Account disabled',
  },
  errors: {
    missingUnnamed:
      'This departure request no longer exists. Returned to the source list.',
    missingReturned:
      '"{{name}}" is no longer available. Returned to the source list.',
    forbidden: 'You no longer have access to this record.',
    notFound: 'This record does not exist. Return to the list.',
    conflict:
      'This record changed. Load the latest record before confirming again.',
    invalid:
      'The operation requirements are not satisfied. Review the current record.',
    failed: 'The request failed. Try loading it again.',
  },
  form: {
    create: 'New departure request',
    edit: 'Edit departure request',
    save: 'Save draft',
    saved: 'Saved "{{name}}"',
    mode: 'Create for',
    self: 'My resignation',
    manual: 'HR delegated request',
    employee: 'Employee',
    employeeSearch: 'Search employees',
    chooseEmployee: 'Choose an active employee',
    employeesDenied: 'Employee archive access is required to select a target.',
    previous: 'Previous candidates',
    next: 'Next candidates',
    chooseType: 'Choose a departure type',
    chooseHandover: 'Choose a handover recipient',
    searchHandover: 'Search eligible recipients',
    refineHandoverSearch:
      'Many recipients match. Enter a more specific name to narrow the search.',
    required: 'Complete this field.',
    dateInvalid: 'Choose a valid calendar date.',
    invalid: 'Review this field and try again.',
    dateHelp:
      'The date confirmed during the HR interview is the final last working day.',
    manualHelp:
      'HR may create dismissal or contract expiry requests for employees.',
    unavailable:
      'You cannot create this request. Check your employee status and permissions.',
    unknown:
      'The save result is unconfirmed. Check existing drafts before creating another request.',
    checkDrafts: 'Check existing drafts',
    noProof:
      'No matching draft was found. This does not prove that saving failed. Keep this request locked and contact HR.',
    openDraft: 'Open this draft for verification',
    confirmDraft: 'This is the saved request',
    storageUnavailable:
      'Browser storage is unavailable. Saving is disabled to prevent duplicate requests after an interrupted save.',
    unknownPersisted:
      'An earlier create request is still unconfirmed. This lock persists after refresh.',
  },
  actionForm: {
    approveConsequence:
      'The offered approval is recorded. Final approval applies the approved employment outcome.',

    uncertain:
      'The result is unconfirmed. Keep this input and retry the identical operation; do not issue a changed request.',
    replay: 'Retry identical operation',
    unsupported:
      'This action needs an input contract that this page does not support.',
    person: 'Recipient',
    mode: 'Signer position',
    place: 'Approval place',
    releaseConsequence:
      'This releases pending approval tasks and cannot be undone here.',
    returnConsequence:
      'The request returns for correction and current pending work closes.',
    submitConsequence:
      'The request enters approval with its submitted facts frozen.',
    genericConsequence:
      'The server applies the offered operation to the selected approval target.',
    latest: 'Read latest version',
    conflict:
      'The departure request changed. Your input is retained. Read the latest version, review it, then confirm again.',
    completed: '{{action}} completed for “{{name}}”',
    committed:
      'The operation completed. Refresh the departure request before taking another action.',
    before: 'Before',
    after: 'After',
    alongside: 'Alongside',
    revision: 'Applicant correction',
    required: 'Complete this field.',
    limit: 'This value is too long.',
    title: '{{action}} departure "{{name}}"',
    comment: 'Comment / reason',
    confirm: 'Confirm',
    saved: 'Updated "{{name}}"',
    unavailable: 'This action is no longer available. Load the latest record.',
    unknown:
      'The result is unconfirmed. Load the latest record before continuing.',
    to: 'Recipient',
    returnTarget: 'Return to',
    confirmTitle: '{{action}} "{{name}}"?',
    confirmDescription:
      'This updates the departure decision. Confirm the employee and current record.',
    lastWorkingDay: 'Confirmed last working day',
    settlementDate: 'Settlement date',
    settlementNote: 'Settlement note',
    labels: {
      requestCancellation: 'Request departure cancellation',
      submit: 'Submit',
      withdraw: 'Withdraw',
      terminate: 'Terminate',
      settle: 'Confirm settlement',
      approve: 'Approve',
      reject: 'Reject',
      return: 'Return',
      returnTo: 'Return',
      comment: 'Comment',
      read: 'Mark read',
      urge: 'Urge',
      transfer: 'Transfer',
      addSigner: 'Add signer',
      cc: 'Copy',
      claim: 'Claim',
      release: 'Release',
      appoint: 'Appoint',
      reassign: 'Reassign',
    },
  },
  work: {
    labels: {
      requestCancellation: 'Request departure cancellation',
      claim: 'Claim',
      confirmChecklist: 'Confirm checklist',
      acknowledgeReceipt: 'Acknowledge receipt',
      complete: 'Complete',
      forceComplete: 'Force completion',
    },
    title: '{{action}} {{kind}} for "{{name}}"',
    reason: 'Exemption reason',
    confirmChecklist: 'I have completed the checklist.',
    acknowledgeReceipt: 'I have received the handover.',
    blocked: 'Clearance is incomplete. Resolve the listed outstanding items.',
    forceWarning:
      'Forced handover completion does not alter asset or financial ledger facts.',
    forceConfirm: 'Exempt {{kind}} for "{{name}}"?',
    forceDescription:
      'Normal clearance evidence will be bypassed. The reason and actual actor will be audited.',
  },
  blockers: {
    generic:
      'A requirement is not satisfied. Refresh and ask the responsible person to resolve it.',
    DEPARTURE_ASSET_SERVICE_UNAVAILABLE:
      'Normal asset clearance is not available yet.',
    DEPARTURE_REIMBURSEMENT_SERVICE_UNAVAILABLE:
      'Reimbursement clearance is not available.',
    DEPARTURE_LOANS_NOT_CLEARED:
      'Loans or reserved repayments are not cleared.',
    REIMBURSEMENT_DEPARTURE_NOT_CLEARED:
      'Reimbursement requests are still open.',
    DEPARTURE_APPLICATION_INCOMPLETE:
      'Choose the expected date and handover recipient.',
    DEPARTURE_DATE_PAST: 'The expected last working day is in the past.',
    DEPARTURE_REASSIGNMENT_UNAVAILABLE:
      'Approval transfer is unavailable. The account remains enabled.',
    DEPARTURE_REASSIGNMENT_INCOMPLETE:
      'Pending approvals remain assigned to this employee.',
    DEPARTURE_EXECUTION_FAILED:
      'Departure execution failed and will be retried by the daily job.',
  },
};
