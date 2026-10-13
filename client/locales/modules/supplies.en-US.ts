export default {
  supplies: {
    businessErrors: {
      SUPPLY_REQUIRED_FIELDS: 'Add at least one item and enter its purpose.',
      SUPPLY_ITEM_UNAVAILABLE:
        'A selected item is unavailable. Select an enabled item again.',
      SUPPLY_CONTENT_CHANGED:
        'The approved items changed. Refresh the request before recording issuance.',
    },

    rowActions: 'Record actions',
    number: 'Requisition number',
    unknownEdit:
      'The save result is uncertain. Load the latest request before editing again.',
    emptyCatalog:
      'No active office items are configured. Contact Administration.',
    ledgerDetail: 'Issuance record',
    ledgerDescription:
      'Recorded quantities and administrative closures. Unconfirmed quantities do not establish delivery.',
    entryMissing: 'This issuance record is unavailable.',
    authz: {
      resource: 'Supplies requisitions',
      ledger: 'Read supplies issuance ledger',
    },
    navigation: 'Supplies ledger',
    new: 'New supplies requisition',
    edit: 'Edit supplies requisition',
    formDescription:
      'Choose items and quantities. Your manager approves the request before Administration issues them.',
    purpose: 'Purpose',
    item: 'Item',
    items: 'Requested items',
    quantity: 'Quantity',
    quantityValue: 'Quantity: {{quantity}}',
    chooseItem: 'Choose an item',
    line: 'Item {{number}}',
    remove: 'Remove item {{number}}',
    addItem: 'Add item',
    quantityInvalid: 'Enter a whole quantity from 1 to 100,000.',
    duplicate: 'Choose each item once.',
    emailInvalid: 'Enter a valid email address.',
    printRequired: 'Complete the required business card printing information.',
    print: {
      name: 'Name',
      title: 'Job title',
      phone: 'Phone',
      email: 'Email',
      address: 'Address',
      department: 'Department (optional)',
    },
    approvedAt: 'Manager approval time',
    issuingStage: 'Administrative issuance',
    resubmitHint:
      'Resubmitting unchanged items and purpose returns to Administration. Changing them requires manager approval again. The previous approval remains in the history.',
    forcedHint:
      'An approval administrator closed this request without confirming physical issuance. Actual quantities are unconfirmed.',
    uncertainCreate:
      'The save result is uncertain. Close and check My requests before creating another draft.',
    invalid: 'Check the purpose, item choices and whole quantities.',
    itemUnavailable:
      'An item is disabled or missing. Refresh before submitting changed content.',
    inactive: 'An active employee archive is required.',
    configuration:
      'The approval clock configuration is unsupported. Contact an administrator.',
    contentChanged:
      'The contents no longer match the approved request. Load the latest version.',
    reasonRequired: 'Provide a reason.',
    actions: {
      claim: 'Claim issuance',
      release: 'Release claim',
      assign: 'Assign handler',
      complete: 'Confirm issuance',
      unable: 'Unable to issue',
      forceComplete: 'Force close',
    },
    actionHints: {
      complete:
        'Confirm that every requested item was physically issued in the full requested quantity. This writes the issuance ledger.',
      unable:
        'Explain the stock shortage or other reason issuance cannot be completed. The manager approval is retained.',
      release:
        'Release this claim so another administrative handler may take it.',
      forceComplete:
        'Close by administrative decision without confirming delivery. Actual quantities will be recorded as unconfirmed. A reason is required.',
    },
    states: {
      issuing: 'Awaiting issuance',
      exception: 'Issuance exception',
      issued: 'Issued',
      forcedClosed: 'Administratively closed',
    },
    ledgerTitle: 'Supplies issuance ledger',
    requestedQuantity: 'Requested quantity',
    actualQuantity: 'Actual quantity',
    outcome: 'Result',
    recipient: 'Recipient',
    issuer: 'Handler',
    unconfirmed: 'Unconfirmed',
    reason: 'Reason',
    emptyLedger: 'No issuance records',
    viewRequest: 'View requisition',
  },
};
