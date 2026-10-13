export default {
  paymentRequests: {
    businessErrors: {
      PAYMENT_REQUEST_INVALID_INPUT:
        'Complete the reason, payee, positive amount, invoice number and invoice evidence.',
      PAYMENT_REQUEST_ACCOUNT_REQUIRED:
        "Complete the payee's protected bank account before submitting.",
      PAYMENT_REQUEST_ACCOUNT_STALE:
        'The payee account changed. Load the latest account before correcting it.',
      PAYMENT_REQUEST_DEPARTMENT_REQUIRED:
        'The applicant needs an active primary department. Ask HR to update the employee record.',
      PAYMENT_REQUEST_METHOD_INVALID: 'Select an enabled payment method.',
      PAYMENT_REQUEST_SOURCE_REQUIRED:
        'Explain why there is no prior approval, and clear the linked purchase order.',
      PAYMENT_REQUEST_SOURCE_INVALID:
        'Select an effective purchase order or contract and its original payee.',
      PAYMENT_REQUEST_SOURCE_STALE:
        'The source document changed. Refresh the payment and source before acting again.',
      PAYMENT_REQUEST_CONTRACT_STALE:
        'The contract changed. Refresh its version and revise the payment before resubmitting.',
      PAYMENT_REQUEST_VOUCHER_REQUIRED:
        'Enter the payment voucher number and upload or select payment evidence.',
      PAYMENT_REQUEST_FORCE_CONFIRMATION_REQUIRED:
        'Confirm the exact approved amount before forcing payment completion.',
      PAYMENT_REQUEST_HANDLING_REASON_REQUIRED:
        'Enter the reason payment could not be completed.',
      PAYMENT_REQUEST_ALREADY_PAID:
        'This payment is already settled. Refresh it to see the recorded result.',
      PAYMENT_REQUEST_CONTRACT_ACTUAL_PAYMENT_REQUIRED:
        'Record actual contract payment before completing this operation.',
      PAYMENT_FILE_SIZE: 'Select a nonempty attachment no larger than 5 MiB.',
      PAYMENT_FILE_TYPE:
        'Upload a PDF, JPEG, PNG or WebP file with a matching file type.',
      PAYMENT_ATTACHMENT_INVALID:
        'Select evidence uploaded for this payment request.',
    },

    title: 'Payment requests',
    description:
      'Review payment applications, frozen source facts and cashier handling.',
    new: 'New payment request',
    edit: 'Edit',
    details: 'View details',
    number: 'Number',
    reason: 'Reason',
    vendor: 'Payee',
    amount: 'Payment amount (yuan)',
    search: 'Search number, reason, applicant or payee',
    view: 'Record view',
    allStatuses: 'All statuses',
    refresh: 'Refresh',
    clearFilters: 'Clear filters',
    emptyTitle: 'No payment requests yet',
    emptyDescription:
      'Create a draft to request a payment and attach its invoice evidence.',
    noResults: 'No matching records. Clear or adjust the filters.',
    rowActions: 'Actions for {{name}}',
    yes: 'Yes',
    no: 'No',
    frozenHint: 'Source, payee, amount and invoice are frozen at submission.',
    sourceModes: {
      contract: 'Contract',
      purchase: 'Purchase order',
      none: 'No prior approval',
    },
    views: { mine: 'Mine', pending: 'Pending', done: 'Done', copied: 'Copied' },
    statuses: {
      draft: 'Draft',
      revision: 'Revision',
      head: 'Department review',
      finance: 'Finance review',
      executive: 'Executive review',
      gm: 'General manager review',
      cashier: 'Cashier handling',
      exception: 'Handling exception',
      paid: 'Paid',
      forcedPaid: 'Forced payment recorded',
      rejected: 'Rejected',
      withdrawn: 'Withdrawn',
      terminated: 'Terminated',
    },
    errors: {
      forbidden:
        'You do not have access. Ask an administrator to check your permission.',
      notFound:
        'This record no longer exists or is unavailable. Return to the source page.',
      conflict:
        'This payment changed. Read the latest record before acting again.',
      invalid: 'Check the payment content and required evidence.',
      failed: 'The request did not complete. Try again.',
    },
    detail: {
      creator: 'Created by',
      sourceMode: 'Source',
      order: 'Purchase order',
      noPriorReason: 'No prior approval reason',
      invoice: 'Invoice number',
      method: 'Payment method',
      failure: 'Handling failure',
      voucher: 'Payment voucher',
      forcedReason: 'Forced payment reason',
      paidAt: 'Paid at',
      sourceFacts: 'Frozen source facts',
      cumulativeHint:
        'Submitted cumulative payments include pending payments. The current request reservation is shown separately and must not be added again. Payment does not confirm delivery or receipt.',
      sourceApproved: 'Approved order amount (yuan)',
      sourceCumulative: 'Submitted cumulative amount (yuan)',
      sourceHeld: 'Current source reservation (yuan)',
      fullApproval: 'Full approval required',
      attachments: 'Invoice evidence',
      voucherAttachments: 'Payment evidence',
      notSubmitted: 'Rules are frozen at submission.',
    },
    rules: {
      spend_vp: 'Executive threshold (yuan)',
      spend_gm: 'General manager threshold (yuan)',
      sla_remindHours: 'Reminder working hours',
      sla_escalateHours: 'Escalation working hours',
      sla_urgeCooldownHours: 'Reminder cooldown hours',
    },
    authz: {
      voucherEvidence: 'Upload payment voucher evidence',
      ownScope: 'Payments I own or created',
      resource: 'Payment requests',
      view: 'View payment requests',
      submit: 'Create and submit my payments',
      delegate: 'Create payments for employees',
      paymentAccount: 'Read and correct authorized payment accounts',
    },
  },
};
