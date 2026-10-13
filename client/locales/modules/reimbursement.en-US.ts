import actionCopy from './reimbursement-actions.en-US.js';
import formCopy from './reimbursement-forms.en-US.js';
export default {
  reimbursementRequests: {
    businessErrors: {
      REIMBURSEMENT_INVALID_LINE_AMOUNT:
        'Each expense line must have a positive amount within the supported range.',
      REIMBURSEMENT_INVALID_LINE_DATE:
        'Select a valid expense date for each line.',
      REIMBURSEMENT_VOUCHER_REQUIRED:
        'Enter the payment voucher number before confirming payment.',
      REIMBURSEMENT_PAYMENT_CONFIRMATION_REQUIRED:
        'Enter a reason and confirm the exact reimbursement total, loan offset and cash payment.',
      REIMBURSEMENT_HANDLING_REASON_REQUIRED:
        'Enter the reason payment could not be completed.',
      REIMBURSEMENT_PAYMENT_ACCOUNT_STALE:
        'The payment account changed. Load the latest account before correcting it.',
      REIMBURSEMENT_AUTHORIZATION_CHANGED:
        'The approved allowance changed. Refresh it and check the reimbursement total.',
      REIMBURSEMENT_INVOICES_CHANGED:
        'Invoice evidence changed. Refresh the request and reselect available invoices.',
      REIMBURSEMENT_LOAN_CHANGED:
        'The loan offset changed. Refresh the loan and confirm the offset amount.',
      REIMBURSEMENT_TOTAL_TOO_LARGE:
        'The expense total exceeds the supported amount. Reduce the total or split the request.',
      REIMBURSEMENT_FILE_SIZE:
        'Select a nonempty attachment no larger than 5 MiB.',
      REIMBURSEMENT_FILE_TYPE:
        'Upload a PDF, JPEG, PNG or WebP file with a matching file type.',
    },

    ...formCopy,
    ...actionCopy,
    title: 'Expense reimbursements',
    description:
      'Review expense evidence and track line approvals and payment handling.',
    new: 'New reimbursement',
    edit: 'Edit reimbursement',
    details: 'View details',
    number: 'Number',
    reason: 'Reason',
    gross: 'Gross reimbursement',
    offset: 'Loan offset',
    net: 'Net cash',
    search: 'Search number, reason or applicant',
    view: 'Record view',
    allStatuses: 'All statuses',
    refresh: 'Refresh reimbursements',
    clearFilters: 'Clear filters',
    emptyTitle: 'No reimbursements yet',
    emptyDescription: 'Create a draft, then add expense lines and evidence.',
    noResults: 'No matching reimbursements. Adjust the filters.',
    rowActions: 'Actions for {{name}}',
    views: {
      mine: 'Mine',
      pending: 'Pending',
      done: 'Done',
      copied: 'Copied',
    },
    statuses: {
      draft: 'Draft',
      revision: 'Revision',
      manager: 'Manager review',
      head: 'Department review',
      finance: 'Finance review',
      executive: 'Executive review',
      gm: 'General manager review',
      cashier: 'Cashier handling',
      exception: 'Handling exception',
      paid: 'Paid',
      forcedPaid: 'Administratively recorded settlement',
      rejected: 'Rejected',
      withdrawn: 'Withdrawn',
      terminated: 'Terminated',
    },
    errors: {
      invoiceDuplicate:
        'Invoice numbers must be unique within this reimbursement. Check each expense line.',
      overrunReasonRequired:
        'Cumulative claims exceed the linked approved allowance by more than 20%. Enter an overrun explanation.',
      invoiceUnavailable:
        'The invoice is reserved or used by another reimbursement. Check the invoice number and request.',
      paymentAccountRequired:
        'The employee payment account is incomplete. Ask HR to complete the bank name, account number and account holder before submitting.',
      employeeInactive:
        'The applicant needs an active employee profile. Contact HR to check it.',
      departmentRequired:
        'The applicant has no active primary department. Ask HR or an organization administrator to assign one.',
      categoryInvalid:
        'An expense category is inactive or unavailable. Choose an active category for each line.',
      sourceInvalid:
        'The linked allowance is unavailable, not approved, or belongs to another applicant. Check the linked request.',
      sourceRebind:
        'A submitted reimbursement cannot change its linked allowance or loan. Keep the original links.',
      loanRequired:
        'Select a loan for the offset amount, or enter 0 if no loan will be offset.',
      loanInvalid:
        'The selected loan is unavailable or belongs to another applicant. Choose another loan.',
      loanInsufficient:
        'The available loan balance is insufficient. Reduce the offset and check the balance.',
      invalidOffset:
        'The loan offset cannot exceed the reimbursement total. Check the amounts.',
      attachmentInvalid:
        'Some evidence is unavailable or belongs to another reimbursement. Select or upload evidence for this request.',
      slaConfiguration:
        'The approval time limits are unsupported. Contact the workflow administrator.',
      inputInvalid:
        'Enter a reimbursement reason and complete distinct expense lines with evidence.',
      configuration:
        'The reimbursement data structure is incomplete. Ask the system administrator to repair it before retrying.',
      forbidden: 'You cannot access this reimbursement.',
      notFound: 'This reimbursement no longer exists.',
      conflict:
        'This reimbursement changed. Reload and review before acting again.',
      standardReason:
        'Explain each line in a day exceeding the approved standard.',
      standardCategoryChanged:
        'This category is outside the original policy. Create a new request to use the current policy.',
      standardConfiguration:
        'The approved travel standard is incomplete. Ask an administrator to check the configuration.',
      invalid: 'Check the reimbursement content and required evidence.',
      failed: 'The request did not complete. Try again.',
    },
    standard: {
      title: 'Frozen expense policy',
      unsubmitted: 'The policy is frozen on first submission.',
      frozenHint:
        'These saved classifications and approved travel limits remain unchanged on revision. Daily amounts are aggregated by standard kind.',
      gradeCode: 'Travel grade',
      gradeRank: 'Grade rank',
      lodging: 'Lodging per night (yuan)',
      allowance: 'Allowance per day (yuan)',
      notApplicable: 'No approved travel standard applies to this request.',
      kinds: {
        none: 'No travel daily limit',
        lodging: 'Lodging daily limit',
        allowance: 'Allowance daily limit',
      },
    },
    detail: {
      lines: 'Expense lines',
      failure: 'Handling failure',
      voucher: 'Payment voucher',
      forcedReason: 'Administrative settlement reason',
      noLines: 'No expense lines yet.',
      line: 'Expense line {{number}}',
      financeResult: 'Finance result',
      lineStates: {
        approved: 'Approved',
        returned: 'Returned for correction',
        pending: 'Pending review',
      },
    },
    bank: {
      title: 'Private payment account',
      bankName: 'Bank',
      bankAccount: 'Bank account',
      bankAccountName: 'Account holder',
      missing: 'No saved payment account.',
      correct: 'Correct payment account',
      saved: 'Payment account corrected',
      denied: 'Payment account access is denied.',
      unavailable:
        'Account correction is unavailable. Reload this reimbursement and check its saved account.',
    },
    authz: {
      resource: 'Expense reimbursements',
      submit: 'Create and submit my reimbursements',
      delegate: 'Create reimbursements for employees',
      view: 'View reimbursements',
      paymentAccount: 'Read and correct authorized payment accounts',
    },
  },
};
