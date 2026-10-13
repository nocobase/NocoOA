export default {
  businessErrors: {
    TRANSFER_INVALID_DATE:
      'Select a valid effective date for the personnel change.',
    TRANSFER_NO_CHANGE:
      'No business details changed. Modify at least one permitted field.',
    TRANSFER_SALARY_INVALID:
      'Enter a valid salary amount within the supported range.',
    TRANSFER_RATIO_INVALID:
      'Check the salary adjustment ratio against the configured limit.',
    TRANSFER_INVALID_PROMOTION:
      'The selected grade does not qualify as a promotion. Check the current and target grades.',
    TRANSFER_TARGET_DEPARTMENT_UNAVAILABLE:
      'Select an active target department.',
    TRANSFER_TARGET_POSITION_UNAVAILABLE:
      'Select an active position in the target department.',
    TRANSFER_ACCOUNT_UNAVAILABLE:
      'Select a matching initialized headcount account with sufficient capacity.',
    TRANSFER_YEAR_REBIND_REQUIRED:
      'The year changed. Rebind the request to the matching annual headcount account.',
    TRANSFER_SOURCE_CHANGED:
      "The employee's current assignment changed. Refresh and revise the proposal.",
    TRANSFER_COMPENSATION_CHANGED:
      "The employee's salary changed. Refresh before revising compensation.",
    TRANSFER_NOT_DUE:
      'The effective date has not arrived. Wait until the scheduled date.',
    TRANSFER_INVALID_KINDS:
      'Choose the personnel change types that match the changed fields.',
  },

  moreActions: 'More actions',
  return: 'Return',
  destructiveConsequence:
    'This action ends or changes the current approval. Review the consequences before confirming.',
  searchPeople: 'Search candidate name',
  title: 'Personnel changes',
  description: 'Track approval and effectiveness of personnel changes.',
  create: 'New request',
  search: 'Search by reason or request ID',
  searchEmployees: 'Search employee name or code',
  empty: 'No personnel change requests',
  noResults: 'No matching requests',
  refresh: 'Refresh',
  clear: 'Clear filters',
  allStatuses: 'All statuses',
  employeeInDetail: 'See detail',
  salary: 'Private salary',
  currentSalary: 'Current salary',
  salaryDenied: 'You cannot view salary for this request',
  failedToExecute:
    'Effectiveness failed. Resolve employee facts or capacity accounts before retry.',
  loading: 'Loading…',
  saved: 'Operation completed',
  saving: 'Saving…',
  save: 'Save',
  cancel: 'Cancel',
  confirm: 'Confirm action',
  retry: 'Retry',
  loadLatest: 'Load latest',
  reviewEditWarning: 'Changes restart approval and close existing tasks.',
  cancelConsequence:
    'Capacity stays allocated until an independent HR confirms cancellation.',
  rebindConsequence:
    'Rebind actual current-year accounts. Effectiveness remains pending maintenance.',
  confirmAction: 'Review the current request and action, and provide a reason.',
  unavailable:
    'The task or permission changed. Return to the detail and refresh.',
  recipient: 'Recipient',
  select: 'Select an option',
  none: 'None',
  required: 'This field is required',
  tooLong: 'The content is too long',
  noChanges: 'Change at least one permitted field',
  capacityResolved:
    'Capacity account identities resolved. Reservation is validated in the approval transaction.',
  capacityRequired:
    'Select the employee, target department, position and effective date to resolve actual capacity accounts.',
  previous: 'Previous',
  next: 'Next',
  discardTitle: 'Discard unsaved changes?',
  discardDescription: 'Leaving will discard your current input.',
  keepEditing: 'Keep editing',
  discard: 'Discard changes',

  fields: {
    id: 'Request ID',
    employeeId: 'Employee',
    kinds: 'Change types',
    targetDepartmentId: 'Target department',
    targetPositionId: 'Target position',
    targetGradeId: 'Target grade',
    targetManagerId: 'Target manager',
    effectiveDate: 'Effective date',
    targetSalary: 'Target salary (CNY)',
    reason: 'Reason',
    status: 'Status',
    applicantId: 'Applicant',
    createdAt: 'Created at',
  },
  factFields: {
    employee: 'Employee',
    department: 'Target department',
    position: 'Target position',
    grade: 'Target grade',
    manager: 'Target manager',
  },
  status: {
    completed: 'Effective',
    draft: 'Draft',
    revision: 'Returned for revision',
    manager: 'Manager review',
    sourceHead: 'Source department review',
    targetHead: 'Target department review',
    hr: 'HR review',
    executive: 'Executive review',
    gm: 'General manager review',
    pendingEffective: 'Pending effectiveness',
    cancellationReview: 'Cancellation awaiting confirmation',
    executed: 'Effective',
    cancelled: 'Cancelled',
    rejected: 'Rejected',
    withdrawn: 'Withdrawn',
    terminated: 'Terminated',
  },
  operations: {
    submit: 'Submit',
    edit: 'Edit request',
    reviewEdit: 'Revise review fields',
    withdraw: 'Withdraw',
    terminate: 'Terminate',
    requestCancellation: 'Request cancellation',
    rebind: 'Rebind current-year capacity',
  },
  kinds: {
    transfer: 'Transfer',
    salaryChange: 'Salary change',
    promotion: 'Promotion',
  },
  authz: {
    rebind: 'Rebind capacity for the current year',
    resource: 'Personnel changes',
    view: 'View requests',
    operate: 'Perform approval actions',
    viewSalary: 'View salary',
    submit: 'Submit and edit requests',
    reviewEdit: 'Revise permitted review fields',
    cancel: 'Request cancellation before effectiveness',
    readable: 'Own and involved requests',
  },
  errors: {
    missing: 'This request is unavailable. Return to the list and refresh.',
    conflict: 'The request changed. Load the latest detail and try again.',
    precondition:
      'Business conditions are unavailable. Check employee facts and capacity accounts.',
    salary:
      'Enter a salary within the allowed range with up to two decimal places.',

    denied: 'You do not have permission for this personnel change.',
    failed:
      'The personnel change could not be completed. Refresh and try again.',
  },
};
