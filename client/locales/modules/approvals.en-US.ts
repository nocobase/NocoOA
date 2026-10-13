import registryLocale from '../../extensions/nocobase-approval-ui/locales/en-US.js';
import { approvalLocaleEnUS as pluginLocale } from '@nocobase/app-plugin-approval/client';
const existing = {
  approvals: {
    printPdf: 'Print / Save PDF',
    printFailed: 'Printing failed. Please try again.',
    saving: 'Saving…',
    noAvailableAction: 'No action is currently available',
    authz: {
      cancellation: 'Leave cancellation',
      section: 'OA approvals',
      leave: 'Leave requests',
      submit: 'Submit own leave',
      delegate: 'Submit leave for an employee',
      view: 'Read leave requests',
      delegations: 'Approval delegations',
      read: 'Read',
      update: 'Manage',
    },
    permissionSets: { delegations: 'Approval delegation administration' },
  },
};

const copy = {
  actionErrors: {
    REASON_REQUIRED: 'Enter the reason for this operation.',
    CLAIM_FIRST: 'Claim this handling task before recording its result.',
    TASK_CLOSED:
      'This task has ended. Refresh the request and use its currently available actions.',
    ALREADY_ANSWERED:
      'This task already has your response. Refresh to see the recorded result.',
    NOT_YOUR_TURN: 'An earlier approval is still pending. Wait for your turn.',
    STALE: 'The approval changed. Load the latest request before continuing.',
    CONTENT_CHANGED:
      'The reviewed content changed. Refresh and review it again before acting.',
    STALE_CONTENT:
      'The reviewed content changed. Refresh and review it again before acting.',
    INVALID_ANSWER:
      'This decision is not available at the current stage. Refresh and choose an available action.',
    NOT_ALLOWED:
      'This action is no longer available. Refresh and choose a current action.',
    NO_ASSIGNEE:
      'No eligible handler is assigned. Ask an approval administrator to assign one.',
    NO_STAGE:
      'No active approval stage is available. Refresh and ask an approval administrator to check the request.',
    ASSIGNMENT_LOOP:
      'This reassignment would return the task to an earlier handler. Select another eligible recipient.',
  },
  businessErrorFields: '{{message}} Check these fields: {{fields}}.',
  invalidFields: 'Check these fields: {{fields}}.',
  fieldSeparator: ', ',
  businessErrors: {
    LEAVE_MAX_DAYS:
      "The requested leave exceeds this leave type's maximum. Shorten the period.",
    LEAVE_NO_WORKDAYS:
      'The selected period contains no working half-days. Adjust the dates.',
    LEAVE_TYPE_UNAVAILABLE:
      'This leave type is unavailable. Select an enabled leave type.',
    LEAVE_DELEGATE_REQUIRED:
      'Select a different active employee for the delegated request.',
  },

  creationUnknown:
    'The save result is unknown. Retry the same save or check existing drafts.',
  resubmit: 'Resubmit',
  submitted: 'Submitted {{name}}',
  draftSavedSubmitFailed:
    'Draft saved. Submission did not complete. Resolve the issue and try again.',
  submissionUnknown:
    'The submission result is unknown. Retry Submit with the same content before making changes.',
  transfer: 'Transfer',
  addSigner: 'Add signer',
  urge: 'Remind',
  recipientSearch: 'Search eligible recipients',
  moreRecipients: 'Load more recipients',
  signerMode: 'Signer mode',
  signerbefore: 'Before my decision',
  signeralongside: 'Alongside my decision',
  emptyTodoTitle: 'No pending approvals',
  emptyTodoDescription: 'Approvals requiring your action will appear here.',
  emptyDoneTitle: 'No completed approvals',
  emptyDoneDescription: 'Approvals you have acted on will appear here.',
  emptyCopiedTitle: 'No copied approvals',
  emptyCopiedDescription: 'Requests copied to you will appear here.',
  emptyMineTitle: 'No requests started',
  emptyMineDescription:
    'Complete a leave request and submit it, or save a draft.',
  calendarTimeZone: 'Dates use the working calendar in {{zone}}.',
  refreshAfterSuccess:
    'The action succeeded, but the latest details could not load. Refresh without repeating the action.',
  domainInvalid:
    'The request does not meet business conditions. Review the leave type, dates, handover person and request details.',
  confirmSubmit:
    'Submitting starts the approval process. Confirm the request details.',
  confirmWithdraw: 'Withdrawing exits the current approval process.',
  confirmReject: 'Rejecting ends this request and its approval process.',
  confirmReturn:
    'Returning allows the applicant to revise the request. Resubmission starts at the first stage.',
  confirmTerminate: 'Administrative termination ends this approval process.',

  navigation: {
    center: 'Task center',
    delegations: 'Approval delegations',
  },
  description: 'Process approval tasks and follow your requests.',
  tabs: {
    todo: 'To do',
    done: 'Done',
    copied: 'Copied to me',
    mine: 'My requests',
  },
  newLeave: 'New leave request',
  editLeave: 'Edit leave request',
  draft: 'Draft',
  search: 'Search by reference or applicant',
  clear: 'Clear filters',
  all: 'All',
  noResults: 'No matching records',
  emptyTitle: 'No requests yet',
  emptyDescription: 'New approval tasks and requests will appear here.',
  refresh: 'Refresh',
  loading: 'Loading',
  reference: 'Request number',
  applicant: 'Applicant',
  type: 'Leave type',
  days: 'Days',
  status: 'Status',
  createdAt: 'Requested at',
  actions: 'Actions for "{{name}}"',
  detail: 'View',
  edit: 'Edit',
  saveDraft: 'Save draft',
  save: 'Save',
  cancel: 'Cancel',
  close: 'Close',
  submit: 'Submit',
  withdraw: 'Withdraw',
  terminate: 'Terminate',
  read: 'Mark as read',
  approve: 'Approve',
  reject: 'Reject',
  return: 'Return',
  comment: 'Comment',
  appoint: 'Appoint',
  reassign: 'Reassign',
  reason: 'Reason',
  opinion: 'Comment',
  person: 'Approver',
  place: 'Unassigned place',
  startDate: 'Start date',
  endDate: 'End date',
  startHalf: 'Start half',
  endHalf: 'End half',
  am: 'Morning',
  pm: 'Afternoon',
  handover: 'Handover person',
  delegate: 'Delegate approvals during leave',
  attachmentMissing:
    'Some attachments are unavailable. Reload the request or contact its applicant.',
  attachments: 'Attachments',
  attachmentRequired:
    'Add the supporting attachments required by the selected leave type.',
  attachmentUnavailable:
    'Attachment uploads are temporarily unavailable. Try again later or contact an administrator.',
  attachmentInvalid:
    'Some selected attachments are invalid or do not belong to this request. Reload the request and select them again.',
  attachmentLimit:
    'Attachments: PDF, JPEG, PNG or WebP, up to 5 MiB per file and 10 files. A valid draft is saved before the first upload.',
  attachmentSize: 'Choose a nonempty file up to 5 MiB.',
  attachmentType:
    'Choose a PDF, JPEG, PNG or WebP file with a matching format.',
  attachmentCount: 'At most 10 attachments are allowed.',
  attachmentDenied:
    'You cannot access attachments on this request. Reload the request to check access.',
  attachmentFailed:
    'Upload failed. Check the form and connection, then choose the file again.',
  attachmentUploading: 'Saving draft and uploading…',
  attachmentRemove: 'Remove attachment {{number}}',
  balanceInsufficient:
    'Available leave balance is insufficient. Reduce the days or contact HR.',
  balanceLimit:
    'Annual and compensatory leave will be available with leave balances.',
  unavailable: 'This action is unavailable. Review its blockers.',
  formDescription: 'Complete the request and submit it, or save a draft.',
  preview: 'Approval route preview',
  facts: 'Request details',
  progress: 'Approval progress',
  timeline: 'Approval history',
  saved: 'Saved leave request "{{name}}"',
  completed: '{{action}} completed for leave request "{{name}}"',
  actionTitle: '{{action}} leave request "{{name}}"',
  returnHint:
    'Return to the applicant; resubmission starts at the first stage.',
  confirmDescription:
    'This ends the current approval task. Confirm the reviewed content.',
  discard: 'Discard changes?',
  discardDescription: 'Unsaved changes will be lost.',
  discardConfirm: 'Discard changes',
  readOnly: 'This record is read only.',
  hrPreview:
    'For a request made on behalf of an employee, the route is calculated at submission.',
  dateRange: 'The end must not be before the start.',
  required: 'Enter a value.',
  limit: 'Use no more than 10,000 characters.',
  handoverRequired: 'Select a handover person to enable delegation.',
  unknownPerson: 'Name unavailable',
  yes: 'Yes',
  no: 'No',
  error: {
    invalid:
      'The content or action does not meet the requirements. Review and adjust it.',
    overlap:
      'An active or approved leave request already overlaps this period. Adjust the dates.',
    configuration:
      'The current approval deadline configuration is unsupported. Contact an administrator.',
    inactive: 'A required employee is unavailable. Review employee status.',

    failed: 'The request failed. Please retry.',
    forbidden: 'Access denied. Contact an administrator.',
    notFound: 'This record is missing or deleted. Return to the list.',
    conflict: 'This request changed. Load the latest content before acting.',
    stale: 'This task is closed or the action is no longer available.',
  },
  loadLatest: 'Load latest',
  retry: 'Retry',
  states: {
    draft: 'Draft',
    revision: 'Needs revision',
    manager: 'Manager review',
    head: 'Department head review',
    hr: 'HR review',
    approved: 'Approved',
    rejected: 'Rejected',
    withdrawn: 'Withdrawn',
    terminated: 'Terminated',
  },
  stages: {
    manager: 'Direct manager',
    head: 'Department head',
    hr: 'HR',
    revision: 'Applicant revision',
  },
  delegations: {
    description: 'Let a delegate process approvals during a specified period.',
    new: 'New delegation',
    edit: 'Edit delegation',
    disable: 'Disable',
    principal: 'Principal',
    delegate: 'Delegate',
    scope: 'Scope',
    from: 'Start',
    to: 'End',
    source: 'Source',
    active: 'Active',
    inactive: 'Inactive',
    manual: 'Manual',
    leave: 'Leave',
    search: 'Search by principal or delegate',
    sourceLeave: 'Created from leave. Manage it through the related request.',
    invalid: 'Select different active employees and an end after the start.',
    overlap:
      'A delegation already covers this scope and period. Adjust the period or scope.',
    disableTitle: 'Disable delegation from "{{principal}}" to "{{delegate}}"?',
    disableDescription:
      'The delegate will no longer process approvals in this scope.',
    saved: 'Saved delegation for "{{name}}"',
    empty: 'No approval delegations yet',
    emptyDescription:
      'Create a delegation to let someone process approvals for a period.',
    timeZone: 'Times use {{zone}}. The end instant is excluded.',
  },
  typeUnavailable: 'Leave type unavailable',
  noPickerPermission:
    'Selecting people requires user read permission. Contact an administrator.',
};
export default {
  ...registryLocale,
  ...pluginLocale,
  approvals: {
    ...existing.approvals,
    ...copy,
    authz: {
      ...existing.approvals.authz,
      readableScope: 'Readable approval requests',
    },
    delegations: {
      ...copy.delegations,
      allScope: 'All approvals',
      leaveScope: 'Leave approvals',
      fromTime: 'Start time (HH:mm)',
      toTime: 'End time (HH:mm)',
      timeInvalid: 'Choose dates and enter valid 24-hour times.',
      disabled: 'Disabled approval delegation for "{{name}}"',
      readOnly: 'This delegation is read-only.',
    },
  },
};
