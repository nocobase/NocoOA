export default {
  purchases: {
    businessErrors: {
      PURCHASE_INVALID_ITEMS:
        'Each purchase item needs a name, unit and positive quantity. Check for duplicate items.',
      PURCHASE_INVALID_DATE: 'Select a valid expected receipt date.',
      PURCHASE_INVALID_PRICE:
        'Enter a positive actual price, select a supplier and attach its quote evidence.',
      PURCHASE_INVALID_QUOTES:
        'A quote file cannot be reused for different suppliers. Select separate evidence.',
      PURCHASE_QUOTES_REQUIRED:
        'This amount requires quotes from three different suppliers, each with an attachment.',
      PURCHASE_PRICE_CONFIRMATION_REQUIRED:
        'Revise the estimated budget to the confirmed quoted price before resubmitting.',
      PURCHASE_INVALID_INPUT:
        'Add purchase items and a purpose, and enter a positive estimated amount.',
      PURCHASE_DEPARTMENT_REQUIRED:
        'The applicant needs an active primary department. Ask HR to update the employee record.',
      INVALID_RECEIPT:
        'Select the actual receipt date and enter a receipt confirmation reason.',
    },

    discardThenNavigate:
      'Discard these unsaved changes? After confirming, select your destination again.',
    localInputsRetained:
      'Latest version loaded. Your inputs are retained; review them before saving again.',
    chooseForceMode: 'Choose a handling method',
    confirmForceClose: 'Close purchase {{name}}?',
    confirmPricing: 'Confirm quotation for {{name}}?',
    confirmCancelOrder: 'Cancel order {{name}}?',
    priceWillReturn:
      'The price exceeds the estimate by more than 20%. This returns the request to the applicant for confirmation before finance review.',
    pricingSubmitConsequence:
      'Submitting freezes this quotation for the next approval stage and adjusts the budget hold.',

    new: 'New purchase',
    edit: 'Edit purchase',
    saved: 'Purchase saved',
    formDescription:
      'Describe the items, purpose and estimate. Submission reserves the primary department budget for the current company-calendar year.',
    applicantHint: 'Applicant: {{name}}',
    primaryDepartment: 'Primary department: {{department}}',
    yearHint:
      'The submission year follows the company calendar ({{timeZone}}).',
    departmentMissing: 'No primary department',
    department: 'Department',
    departmentPending: 'Determined on submission',
    departmentUnavailable: 'Department unavailable',
    budgetYear: 'Budget year',
    purpose: 'Purpose',
    subject: 'Budget subject',
    selectSubject: 'Select budget subject',
    estimated: 'Estimated amount',
    actual: 'Actual price',
    actualAmount: 'Actual price (yuan)',
    yuan: 'yuan',
    expectedDate: 'Expected delivery date',
    suggestedVendor: 'Suggested vendor',
    selectedVendor: 'Selected vendor',
    vendor: 'Vendor',
    vendorUnavailable: 'Vendor unavailable',
    noSuggestedVendor: 'No suggested vendor',
    vendorInactive: 'Choose an active vendor',
    subjectInactive: 'Choose an active budget subject',
    disabled: 'Disabled',
    inactive: 'Inactive',
    fieldInvalid: 'Check this field',
    amountInvalid: 'Enter a positive amount with at most two decimal places',
    amountHint: 'Use at most two decimal places.',
    dateInvalid: 'Choose a valid date',
    items: 'Purchase items',
    itemName: 'Item name',
    itemNumber: 'Item {{number}}',
    specification: 'Specification',
    quantity: 'Quantity',
    unit: 'Unit',
    quantityInvalid: 'Enter a positive quantity; decimals are supported',
    quantityHint: 'Decimal quantities are supported, for example 1.5 kg.',
    addItem: 'Add item',
    removeItem: 'Remove item',
    reserveHint: 'Drafts do not reserve budget. Submission creates the hold.',
    loadLatest: 'Load latest request',
    unknownCreate:
      'The save result is uncertain. Another creation is blocked. Check the task center for the draft.',
    unknownEdit:
      'The save result is uncertain. Load the latest request before continuing.',
    unknownPricing:
      'The result is uncertain and the form is locked. Retry sends the identical payload and request ID.',
    quotes: 'Quote evidence',
    quoteEvidence: 'Vendor quote evidence',
    quoteEvidenceDescription:
      'Upload evidence for each vendor. Existing evidence can be reused when requirements are unchanged. Above the frozen quote threshold, evidence from three distinct vendors is required.',
    addQuote: 'Add vendor quote',
    removeQuote: 'Remove quote selection',
    threeQuotesRequired:
      'Above the quote threshold, provide quote attachments from three distinct vendors.',
    selectExistingQuote: 'Select existing quote: {{filename}}',
    refreshQuotes: 'Refresh existing quotes',
    completePricing: 'Complete pricing',
    forcePricing: 'Administrator procurement action',
    forceMode: 'Action mode',
    forcePriced: 'Submit complete results for financial approval',
    forceClose: 'Force close without an order',
    forceCloseDescription:
      'Force closing releases the budget hold and records the administrator reason. It does not declare procurement or receipt complete and creates no order.',
    priceConfirmationDescription:
      'Prices above 120% of the estimate return to the applicant for confirmation. Other results enter financial approval.',
    confirmPriceHint:
      'The price exceeds 120% of the estimate. Review it and resubmit to confirm.',
    handler: 'Procurement handler',
    forcedClosedHint:
      'An administrator force closed this request. The hold is released and no order or receipt was created.',
    actualHold: 'Current budget hold',
    holdHint:
      'Approval retains the budget hold. Budget settles when the applicant confirms receipt.',
    order: 'Purchase order',
    orderHint:
      'The order freezes the approved price, vendor and items. Receipt and payment are tracked separately.',
    openOrder: 'Open order',
    mergedTitle: 'Adjacent approvals merged',
    merged:
      '{{name}} personally completed the adjacent stage; the same-person approval was merged.',
    authz: {
      orderScope: 'Orders of purchases this user may read',
      resource: 'Purchases',
      submit: 'Submit purchases',
      view: 'View purchases',
      orders: 'View purchase orders',
      accept: 'Confirm receipt',
    },
    errors: {
      insufficient:
        'Available budget is insufficient. Contact the budget owner.',
      inactive: 'The applicant is inactive.',
      configuration:
        'The approval configuration is unsupported. Contact an administrator.',
      invalid: 'Check the highlighted fields.',
    },
    states: {
      draft: 'Draft',
      revision: 'Revision',
      head: 'Department approval',
      purchasing: 'Procurement handling',
      exception: 'Procurement exception',
      finance: 'Financial approval',
      executive: 'Executive approval',
      gm: 'General manager approval',
      approved: 'Approved',
      rejected: 'Rejected',
      withdrawn: 'Withdrawn',
      terminated: 'Terminated',
      forcedClosed: 'Force closed',
    },
    stages: {
      draft: 'Draft',
      revision: 'Revision',
      head: 'Department approval',
      purchasing: 'Procurement handling',
      exception: 'Procurement exception',
      finance: 'Financial approval',
      executive: 'Executive approval',
      gm: 'General manager approval',
      approved: 'Approved',
      rejected: 'Rejected',
      withdrawn: 'Withdrawn',
      terminated: 'Terminated',
      forcedClosed: 'Force closed',
    },
    actions: {
      claim: 'Claim',
      release: 'Release claim',
      complete: 'Complete pricing',
      unable: 'Cannot procure',
      forceComplete: 'Administrator action',
      cc: 'Copy',
    },
    ledgerTitle: 'Purchase order ledger',
    ledgerDescription:
      'Review approved purchase orders, receipt status and payment records. Receipt settles budget; payments are recorded independently.',
    orderNumber: 'Order number',
    emptyOrders: 'No purchase orders in your scope',
    pendingPayments: 'Pending payments (yuan)',
    paidPayments: 'Paid amount (yuan)',
    receiptDate: 'Receipt date',
    acceptedBy: 'Receipt confirmed by',
    receiptReason: 'Receipt notes',
    confirmReceipt: 'Confirm receipt',
    cancelOrder: 'Cancel order',
    orderSaved: 'Order updated',
    unknownOrderAction:
      'The result is uncertain. The form is locked; retry sends the identical payload and request ID.',
    receiptSettlementHint:
      'Confirmation settles the order budget hold. It does not mean the vendor has been paid. The confirmed receipt is immutable.',
    cancelOrderHint:
      'Only approval administrators can cancel an unreceived order with no pending or paid amounts. Cancellation releases the budget hold and records the reason.',
    orderStates: {
      awaitingReceipt: 'Awaiting receipt',
      accepted: 'Received',
      cancelled: 'Cancelled',
    },
    actionTitle: '{{action}} purchase “{{name}}”',
    completed: '{{action}} completed for purchase “{{name}}”',
    quoteBasisChanged:
      'The procurement requirements changed. Your draft inputs are preserved, but quote evidence must match the latest requirements.',
    frozenRules: 'Submission rule snapshot',
    frozenRulesHint:
      'Only amounts strictly above these thresholds require the corresponding quote evidence or approval stage. Later rule changes do not alter this submission.',
    ruleLabels: {
      purchase_quotes: 'Three-vendor quote threshold',
      spend_vp: 'Executive approval threshold',
      spend_gm: 'General manager approval threshold',
    },
    staleQuoteUpload:
      'The handling version changed. Refresh the request before uploading quote evidence.',
    ordersTitle: 'Purchase orders',
  },
};
