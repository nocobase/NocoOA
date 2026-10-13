export default {
  expensePlans: {
    businessErrors: {
      EXPENSE_PLAN_DEPARTMENT_REQUIRED:
        'The applicant needs an active primary department. Ask HR to update the employee record.',
      EXPENSE_PLAN_INVALID_DATE: 'Select a valid expected expense date.',
      EXPENSE_PLAN_INVALID_DICTIONARY:
        'Select an enabled matter type and budget subject.',
      EXPENSE_PLAN_INVALID_INPUT:
        'Enter a positive amount, participants and the expense reason.',
    },

    new: 'New expense preapproval',
    edit: 'Edit expense preapproval',
    formDescription:
      'Plan entertainment, team building or an event before spending.',
    matterType: 'Matter type',
    subject: 'Budget subject',
    amount: 'Estimated expense (yuan)',
    yuan: 'yuan',
    participants: 'Participants',
    eventDate: 'Event date',
    budgetYear: 'Submitted budget year',
    department: 'Submitted primary department',
    primaryDepartment:
      'Current primary department: {{department}}. It is checked again at submission.',
    proxyDepartment:
      "The applicant's active primary department is determined at submission.",
    departmentMissing: 'Not configured',
    departmentPending: 'Determined at submission',
    departmentUnavailable: 'Department is currently unavailable',
    year: 'Budget year: {{year}} · company calendar: {{timeZone}}',
    amountHint:
      'Enter decimal yuan; amounts are stored as exact integer cents.',
    amountInvalid:
      'Enter a positive amount with at most two decimal places within the safe limit.',
    participantsInvalid: 'Enter an integer from 1 to 100000.',
    dateInvalid: 'Choose a valid date.',
    disabled: 'Disabled',
    subjectInactive: 'Choose an active matter type and budget subject.',
    optionsEmpty:
      'An active matter type and budget subject must be configured before saving.',
    reserveHint:
      'Submission reserves budget. Final approval grants a quota for reimbursement.',
    revisionHold:
      'The original budget reservation is retained during revision. It changes only when resubmitted.',
    retainedHold:
      'Original reservation: {{subject}} · {{amount}} yuan. This is separate from the revised proposal.',
    actualHold: 'Reservation at approval',
    holdFactHint:
      'This is the source reservation fact, not the remaining balance after later reimbursements.',
    frozenThreshold:
      'Submitted thresholds: executive > {{vp}} yuan; general manager > {{gm}} yuan.',
    applied:
      'An approved quota has been issued. This does not indicate reimbursement or payment.',
    reserved: 'Budget is reserved while this application awaits approval.',
    awaitingEffect: 'No approved quota has been issued for this application.',
    uncertainCreate:
      'The save result is uncertain. Close and check My requests before creating another draft.',
    unknownEdit:
      'The save result is uncertain. Your entries are locked until the latest record is loaded.',
    authorization: 'Approved quota',
    quotaId: 'Quota reference',
    grantedAmount: 'Granted amount',
    quotaState: 'Quota status',
    deadline: 'Expiry date',
    quotaHint:
      'Reimbursements settle this quota. Closure or expiry does not undo this approval.',
    mergedTitle: 'Same-person merge',
    quotaStates: { open: 'Open', closed: 'Closed', expired: 'Expired' },
    createdBy: 'Created by',
    authz: {
      resource: 'Expense preapproval',
      submit: 'Submit an expense preapproval',
      delegate: 'Submit expense preapproval for an employee',
      view: 'Read expense preapproval',
    },
    stages: {
      head: 'Department head',
      finance: 'Finance',
      executive: 'Executive in charge',
      gm: 'General manager',
    },
    states: { approved: 'Approved quota issued' },
    merged:
      'Executive and general manager merged: the same person approved in their own capacity.',
    errors: {
      invalid:
        'Review the date, participants, amount, matter type and subject.',
      department: 'The applicant needs an active primary department.',
      insufficient: 'This budget account has insufficient available funds.',
      inactive: 'The applicant must have an active employee archive.',
      configuration:
        'This approval clock configuration is unsupported. Contact an administrator.',
    },
  },
};
