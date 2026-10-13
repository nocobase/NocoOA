export default {
  actionForm: {
    uncertain:
      'The result is unconfirmed. Keep this input and retry the identical operation; do not issue a changed request.',
    replay: 'Retry identical operation',
    ownedScope: 'Reimbursements I own or created',
    title: '{{action}} reimbursement “{{name}}”',
    unavailable:
      'This action is no longer available. Read the latest reimbursement.',
    unsupported:
      'This action needs an input contract that this page does not support.',
    submitRequirements:
      'Approval uses the reason and expense lines saved in the draft. Edit the reimbursement to enter its reason, expense categories, dates, amounts and invoice numbers, and select evidence files for every line.',
    reasonRequired:
      'The draft has no reimbursement reason. Edit the reimbursement first.',
    linesRequired:
      'The draft has no expense lines. Edit the reimbursement and upload evidence files first.',
    lineIncomplete:
      'Expense line {{number}} is incomplete. Add a category, date, positive amount, invoice number and evidence files.',
    duplicateLines:
      'Expense lines are duplicated. Edit the reimbursement and review its lines.',
    editDraft: 'Edit reimbursement',
    comment: 'Opinion or reason',
    person: 'Recipient',
    mode: 'Signer position',
    place: 'Approval place',
    returnTarget: 'Return destination',
    voucher: 'Payment voucher number',
    voucherHint:
      'Leave empty only when administratively recording settlement without a voucher.',
    grossConfirm: 'Confirm gross reimbursement',
    offsetConfirm: 'Confirm loan offset',
    netConfirm: 'Confirm net cash',
    exactAmount: 'Enter the exact amount shown above.',
    confirm: 'Confirm {{action}}',
    confirmDescription:
      'Confirm this operation on “{{name}}”. Gross {{gross}}, loan offset {{offset}}, net cash {{net}}. {{consequence}}',
    releaseConsequence:
      'This releases unsettled reservations and cannot be undone here.',
    returnConsequence:
      'The request returns for correction and current pending work closes.',
    paymentConsequence: 'Record an actual completed payment using its voucher.',
    forcedConsequence:
      'Record administrative settlement; this does not initiate a bank transfer.',
    unableConsequence: 'The request enters a handling exception.',
    submitConsequence:
      'The request enters approval with its submitted facts frozen.',
    genericConsequence:
      'The server applies the offered operation to the selected approval target.',
    line: 'Selected expense line',
    noLine: 'The selected approval line is unavailable.',
    latest: 'Read latest version',
    conflict:
      'The reimbursement changed. Your input is retained. Read the latest version, review it, then confirm again.',
    completed: '{{action}} completed for “{{name}}”',
    committed:
      'The operation completed. Refresh the reimbursement before taking another action.',
    before: 'Before',
    after: 'After',
    alongside: 'Alongside',
    revision: 'Applicant correction',
    required: 'Complete this field.',
    labels: {
      approve: 'Approve',
      reject: 'Reject',
      return: 'Return for correction',
      returnTo: 'Return for correction',
      returnItem: 'Return expense line',
      submit: 'Submit for approval',
      withdraw: 'Withdraw',
      terminate: 'Terminate',
      retryCash: 'Retry cashier',
      retryCashAsAdmin: 'Administrative cashier retry',
      forcePayException: 'Record exceptional settlement',
      forceComplete: 'Administrative settlement',
      reviseBusiness: 'Revise for approval',
      claim: 'Claim',
      release: 'Release',
      assign: 'Assign',
      complete: 'Confirm payment',
      unable: 'Unable to pay',
      transfer: 'Transfer',
      addSigner: 'Add signer',
      cc: 'Copy',
      appoint: 'Appoint',
      reassign: 'Reassign',
      comment: 'Comment',
      read: 'Mark read',
      urge: 'Remind',
    },
  },
};
