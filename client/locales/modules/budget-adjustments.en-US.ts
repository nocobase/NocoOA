export default {
  budgetAdjustments: {
    businessErrors: {
      BUDGET_ADJUSTMENT_INVALID_ACCOUNT:
        'Select an active department and valid budget year.',
      BUDGET_ADJUSTMENT_INVALID_AMOUNT:
        'Enter a positive adjustment amount and a reason.',
      BUDGET_ADJUSTMENT_INVALID_SUBJECT: 'Select an enabled budget subject.',
      BUDGET_ADJUSTMENT_INVALID_TRANSFER:
        'For a transfer, use different source and target subjects. For an increase, clear the source subject.',
      BUDGET_ADJUSTMENT_INACTIVE_HEAD:
        'The department head is unavailable. Ask an administrator to update the department assignment.',
    },

    authz: {
      resource: 'Budget adjustments',
      submit: 'Submit a budget adjustment',
      delegate: 'Submit a budget adjustment for an employee',
      view: 'Read budget adjustments',
    },
    new: 'New budget adjustment',
    edit: 'Edit budget adjustment',
    formDescription:
      'Propose a transfer between subjects or an additional budget.',
    department: 'Budget department',
    yearInvalid: 'Enter an integer year from 1900 to 9999.',
    year: 'Budget year',
    type: 'Adjustment type',
    transfer: 'Transfer between subjects',
    increase: 'Additional budget',
    targetSubject: 'Target subject',
    sourceSubject: 'Source subject',
    amount: 'Amount (yuan)',
    yuan: 'yuan',
    reason: 'Reason',
    amountInvalid:
      'Enter a positive decimal amount with at most two decimal places within the safe limit.',
    sourceInvalid: 'Choose a different source and target subject.',
    amountHint: 'Use decimal yuan. Amounts are stored as exact integer cents.',
    reserveHint:
      'Submission reserves source funds for a transfer. The budget takes effect only after final approval.',
    revisionHold:
      'The original reservation remains while returned. Changing the proposal releases and replaces it only when resubmitted.',
    retainedHold:
      'Current original reservation: {{subject}} · {{amount}} yuan. This is separate from the revised proposal.',
    actualHold: 'Current source reservation',
    frozenThreshold:
      'Submitted GM threshold for an increase: {{amount}} yuan (only strictly above it).',
    applied: 'Final approval has applied this budget adjustment.',
    reserved:
      'Source funds are reserved; this adjustment has not taken effect.',
    awaitingEffect:
      'This proposal has not taken effect. Additional budget is applied only after final approval.',
    insufficient:
      'The source budget has insufficient available funds. Review the amount and source; your entries are retained.',
    subjectInactive:
      'This subject is disabled. Choose an active subject before submitting.',
    disabled: 'Disabled',
    inactive: 'The applicant must be an active employee.',
    configuration:
      'This approval clock configuration is unsupported. Contact an administrator.',
    invalid: 'Review the account, adjustment type, amount and reason.',
    uncertainCreate:
      'The save result is uncertain. Close and check My requests before creating another draft.',
    stages: {
      head: 'Department head',
      finance: 'Finance manager',
      cfo: 'Chief financial officer',
      gm: 'General manager',
    },
  },
};
