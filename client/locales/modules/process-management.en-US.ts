export default {
  flowDiagram: {
    empty: 'No states to display.',
    loading: 'Laying out diagram…',
    failed: 'Unable to lay out diagram. Read the process rules below.',
    nodeHelp: 'Process state. Pan and zoom to explore.',
    edgeHelp: 'Process transition',
  },
  processManagement: {
    nodeSettings: {
      edit: 'Edit parameters',
      editNamed: 'Edit parameters for {{name}}',
      title: 'Edit parameters for {{name}}',
      parameter: 'Parameter',
      effect:
        'Changes do not rewrite saved request snapshots or existing tasks. New submissions use the effective configuration; resubmissions follow the owning process rules.',
      shared: 'Shared setting. Also affects: {{flows}}.',
      unavailable:
        'This node has no available editable parameters. Close this dialog and choose a configured node.',
      forbidden:
        'You do not have permission to edit this node’s configuration.',
      newCommittee: 'Publish a new committee structure',
      seat: 'Version {{version}} · {{name}} seat person',
      committeeContext:
        'Selected node: version {{selected}}. Active: {{active}}. Latest saved: {{latest}}.',
    },
    conditionMissing:
      'This branch needs an explicit condition description; inspect the owning business rules',
    snapshotConditions:
      'Amount, day and grade thresholds use the rules frozen at submission. This definition explains the decision criteria, not an historical request’s snapshot.',
    branchConditions: {
      travelCancellation_unbooking:
        'The original travel requests booking, so cancellation requires unbooking',
      travelCancellation_approved:
        'The original travel does not request booking, so no unbooking is required',
      reimbursement_managerApproved_head:
        'Total reimbursement > the frozen department-head limit and manager/head task merge validation has not passed',
      reimbursement_managerApproved_finance:
        'Total reimbursement does not exceed the head limit, or manager/head approval tasks have been validly merged',

      training_managerApproved_head:
        'Training amount > 0 and manager/head approval tasks have not been validly merged',
      training_managerApproved_finance:
        'Training amount > 0; the manager and head are the same person and this round passes approval-task merge validation',
      training_managerApproved_approved: 'Training amount is zero',

      travel_managerApproved_head: 'Manager/head merge conditions are not met',
      travel_managerApproved_finance:
        'The manager and department head are the same person and this round passes approval-task merge validation',
      probation_managerApproved_head:
        'Manager/head merge conditions are not met',
      probation_managerApproved_hr:
        'The manager and department head are the same person and this round passes approval-task merge validation',
      departure_managerApproved_head:
        'Manager/head merge conditions are not met',
      departure_managerApproved_hr:
        'The manager and department head are the same person and this round passes approval-task merge validation',
      expensePlan_financeApproved_executive:
        'Executive approval is required: amount > the executive limit frozen at submission',
      expensePlan_financeApproved_gm:
        'No executive approval is needed; amount > the GM limit frozen at submission',
      expensePlan_financeApproved_approved:
        'Neither executive nor GM additional-approval conditions apply',
      expensePlan_executiveApproved_gm:
        'GM approval is required and executive/GM task merge validation has not passed',
      expensePlan_executiveApproved_approved:
        'GM approval is not needed, or executive/GM approval tasks have been validly merged',
      loan_financeApproved_executive:
        'Executive approval is required: amount > the executive limit frozen at submission',
      loan_financeApproved_gm:
        'No executive approval is needed; amount > the GM limit frozen at submission',
      loan_financeApproved_cashier:
        'Neither executive nor GM additional-approval conditions apply',
      loan_executiveApproved_gm:
        'GM approval is required and executive/GM task merge validation has not passed',
      loan_executiveApproved_cashier:
        'GM approval is not needed, or executive/GM approval tasks have been validly merged',
      purchase_financeApproved_executive:
        'Executive approval is required: amount > the executive limit frozen at submission',
      purchase_financeApproved_gm:
        'No executive approval is needed; amount > the GM limit frozen at submission',
      purchase_financeApproved_approved:
        'Neither executive nor GM additional-approval conditions apply',
      purchase_executiveApproved_gm:
        'GM approval is required and executive/GM task merge validation has not passed',
      purchase_executiveApproved_approved:
        'GM approval is not needed, or executive/GM approval tasks have been validly merged',
      payment_financeApproved_executive:
        'Executive approval is required: full approval staircase and amount > the executive limit frozen at submission',
      payment_financeApproved_gm:
        'No executive approval is needed; amount > the GM limit frozen at submission and full approval is required',
      payment_financeApproved_cashier:
        'Neither executive nor GM additional-approval conditions apply',
      payment_executiveApproved_gm:
        'GM approval is required and executive/GM task merge validation has not passed',
      payment_executiveApproved_cashier:
        'GM approval is not needed, or executive/GM approval tasks have been validly merged',
      travel_financeApproved_executive:
        'Executive approval is required: international travel, or amount > the executive limit frozen at submission',
      travel_financeApproved_gm:
        'No executive approval is needed; amount > the GM limit frozen at submission',
      travel_financeApproved_booking:
        'No further executive/GM approval is needed and booking is requested',
      travel_financeApproved_completed:
        'No further executive/GM approval is needed and booking is not requested',
      travel_executiveApproved_gm:
        'GM approval is required and executive/GM task merge validation has not passed',
      travel_executiveApproved_booking:
        'GM approval is not needed or validly merged; booking is requested',
      travel_executiveApproved_completed:
        'GM approval is not needed or validly merged; booking is not requested',
      travel_gmApproved_booking: 'Booking is requested',
      travel_gmApproved_completed: 'Booking is not requested',
      payment_submit_head:
        'The funding-source check requires the full approval staircase, including excess payments requiring additional approval',
      payment_submit_finance:
        'The funding-source check does not require the full approval staircase',
      budgetAdjustment_cfoApproved_gm:
        'Budget increase amount exceeds the GM limit frozen at submission',
      budgetAdjustment_cfoApproved_approved:
        'Not a budget increase, or the increase does not exceed the frozen GM limit',
      leave_managerApproved_head:
        'Days ≥ the frozen department-head limit and the head is missing or differs from the manager',
      leave_managerApproved_hr:
        'No head review is required; the leave type requires HR or days ≥ the frozen HR limit',
      leave_managerApproved_approved:
        'No head review, no HR-required leave type, and days below the frozen HR limit',
      leave_headApproved_hr:
        'The leave type requires HR or days ≥ the frozen HR limit',
      leave_headApproved_approved:
        'The leave type does not require HR and days are below the frozen HR limit',
      overtime_managerApproved_head:
        'Monthly overtime exceeds the frozen head-review limit and the head is missing or differs from the manager',
      overtime_managerApproved_hr:
        'No head review is required; submitted more than 3 working days after the overtime date',
      overtime_managerApproved_approved:
        'No head review is required; submitted within the 3-working-day reporting window',
      overtime_headApproved_hr:
        'Submitted more than 3 working days after the overtime date',
      overtime_headApproved_approved:
        'Submitted within 3 working days after the overtime date',
      supplies_submit_issuing:
        'Resubmitted from a fulfillment exception with unchanged approved content',
      supplies_submit_manager:
        'New request, changed approval-covered content, or resume conditions are not met',
      vehicleRequest_submit_dispatch:
        'Resubmitted from a fulfillment exception with unchanged approved content',
      vehicleRequest_submit_head:
        'New request, changed approval-covered content, or resume conditions are not met',
      purchase_submit_purchasing:
        'Resubmitted from a fulfillment exception with unchanged approved content',
      purchase_submit_head:
        'New request, changed approval-covered content, or resume conditions are not met',
      assetRequest_submit_issuing:
        'Resubmitted from a fulfillment exception with unchanged approved content; resume eligibility passes; not a scrap request',
      assetRequest_submit_head:
        'New request, changed approval-covered content, or resume conditions are not met',
      sealRequest_submit_stamping:
        'Resubmitted from a fulfillment exception with unchanged approved content; resume eligibility passes',
      sealRequest_submit_head:
        'New request, changed approval-covered content, or resume conditions are not met',
      purchase_priced_revision:
        'Actual price > 120% of the original estimate; applicant confirmation and resubmission are required',
      purchase_priced_finance: 'Actual price ≤ 120% of the original estimate',
      purchase_forcedPriced_revision:
        'Actual price > 120% of the original estimate; applicant confirmation and resubmission are required',
      purchase_forcedPriced_finance:
        'Actual price ≤ 120% of the original estimate',
      probation_hrApproved_gm:
        'Probation is declined, or the HR-confirmed grade reaches the frozen manager-rank threshold',
      probation_hrApproved_approved:
        'Probation is not declined and the HR-confirmed grade is below the manager threshold',
      departure_hrApproved_gm:
        'Employee grade ≥ the manager-rank threshold frozen at submission',
      departure_hrApproved_handover:
        'Employee grade is below the frozen manager-rank threshold',
      departure_cancellationRejected_gm:
        'Cancellation rejected; resume the saved pre-cancellation gm state',
      departure_cancellationRejected_handover:
        'Cancellation rejected; resume the saved pre-cancellation handover state',
      departure_cancellationRejected_completed:
        'Cancellation rejected; resume the saved pre-cancellation completed state',
      recruitment_submit_head:
        'The applicant is not the department head, or the head is missing',
      recruitment_submit_hrbp:
        'The applicant is the department head; skip self-approval',
      recruitment_reviewEdit_head:
        'The applicant is not the department head, or the head is missing',
      recruitment_reviewEdit_hrbp:
        'The applicant is the department head; skip self-approval',
      recruitment_hrDirectorApproved_executive:
        'The requisition uses additional headcount',
      recruitment_hrDirectorApproved_gm:
        'Not additional headcount; target grade reaches the frozen director-rank threshold',
      recruitment_hrDirectorApproved_approved:
        'Not additional headcount; target grade is below the director-rank threshold',
      recruitment_executiveApproved_gm:
        'Additional headcount or target grade reaches the director threshold',
      recruitment_executiveApproved_approved:
        'Not additional headcount and target grade below the director threshold',
      transfer_submit_manager:
        'The submitting actor is not the employee manager; a missing manager still enters manager review',
      transfer_submit_sourceHead:
        'The submitting actor is the employee manager',
      transfer_reviewEdit_manager:
        'The submitting actor is not the employee manager; a missing manager still enters manager review',
      transfer_reviewEdit_sourceHead:
        'The submitting actor is the employee manager',
      transfer_sourceHeadApproved_targetHead:
        'The change includes a department transfer',
      transfer_sourceHeadApproved_hr:
        'The change does not include a department transfer',
      transfer_hrApproved_executive:
        'Salary increase exceeds the frozen executive threshold, or target grade reaches manager rank',
      transfer_hrApproved_gm:
        'No executive review; raise exceeds the frozen GM threshold or target grade reaches director rank',
      transfer_hrApproved_pendingEffective:
        'No executive/GM additional-review salary or grade conditions apply',
      transfer_executiveApproved_gm:
        'Raise exceeds the frozen GM threshold or target grade reaches director rank',
      transfer_executiveApproved_pendingEffective:
        'Neither GM additional-review salary nor grade conditions apply',
      assetRequest_headApproved_appraisal: 'The request is asset scrapping',
      assetRequest_headApproved_issuing: 'The request is not asset scrapping',
      assetRequest_financeApproved_gm:
        'Scrap request; total original asset value exceeds the frozen scrap GM limit',
      assetRequest_financeApproved_scrapped:
        'The scrap original-value GM threshold is not exceeded',
      assetRequest_issueCompleted_returning:
        'Borrow request: issue then enter return processing',
      assetRequest_issueCompleted_issued: 'The request is not borrowing',
      sealRequest_stamped_returning:
        'External seal borrowing requires return processing',
      sealRequest_stamped_completed: 'The seal is not used externally',
      vendorQualification_submit_removalReview:
        'The operation removes a supplier from the directory',
      vendorQualification_submit_purchasing:
        'The operation does not remove a supplier',
      contract_headApproved_legalFinance:
        'Contract termination or a nonstandard template',
      contract_headApproved_standardFinance:
        'Not termination and a standard template is used',
      contract_legalFinanceApproved_executive:
        'Contract amount exceeds the frozen executive limit; not a termination',
      contract_legalFinanceApproved_gm:
        'No executive review; amount exceeds the frozen contract GM limit or legal/finance marks it nonstandard; not a termination',
      contract_legalFinanceApproved_approved:
        'Termination or no further approval conditions',
      contract_standardFinanceApproved_executive:
        'Contract amount exceeds the frozen executive limit',
      contract_standardFinanceApproved_gm:
        'No executive review; amount exceeds the frozen contract GM limit',
      contract_standardFinanceApproved_approved:
        'Neither executive nor contract GM thresholds are exceeded',
      contract_executiveApproved_gm:
        'Amount exceeds the frozen contract GM limit or the contract is nonstandard',
      contract_executiveApproved_approved:
        'Amount does not exceed the contract GM limit and the contract is standard',
      committeeVersion:
        'Use the committee group matching the version frozen at submission',
      returnApplicant:
        'The return decision selects applicant revision and resubmission',
      returnEarlier:
        'The return decision selects this previously entered earlier approval stage',
      seal_legal: 'After head review: contract seal or a linked contract',
      seal_financeManager:
        'From head/legal review: finance seal, after the contract-path priority',
      seal_gm:
        'No legal/finance branch applies; representative seal or external use, and the current reviewer is not the GM',
      seal_stamping:
        'No legal/finance branch applies and no additional GM review, or the current reviewer is the GM',
    },

    conditional: 'Business conditions apply',
    normalDescription:
      'Main approval and fulfillment path. See Process rules below for people, operations and conditions at each step.',
    transitionUnknown: 'Action: {{name}}',
    transitionNames: {
      edit: 'Edit content',
      submit: 'Submit',
      approved: 'Approval passed',
      rejected: 'Reject',
      returned: 'Return for revision',
      withdraw: 'Withdraw',
      terminate: 'Terminate',
      booked: 'Booking completed',
      bookingFailed: 'Booking failed',
      bookingForced: 'Confirm completion',
      retryBooking: 'Retry booking',
      reviseTrip: 'Revise trip',
      cancelApproved: 'Cancellation approved',
      issued: 'Issue completed',
      unavailable: 'Unavailable / fulfillment failed',
      forceClosed: 'Force close',
    },

    place: 'Vacant place',
    placeNumber: 'Vacant place {{number}}',
    placeRequired: 'Choose a vacant place.',
    title: 'Process management',
    description:
      'View authorized process definitions, executions and approval history',
    definitions: 'Definitions',
    executions: 'Executions',
    refresh: 'Refresh',
    search: 'Search by number, process or applicant',
    definitionSearch: 'Search by process name',
    clear: 'Clear filters',
    all: 'All',
    name: 'Name',
    domain: 'Business domain',
    category: 'Category',
    capabilities: 'Management capabilities',
    approval: 'Approval process',
    connected: 'Connected',
    readOnly: 'Read only',
    notConnected: 'Management actions not connected yet',
    reference: 'Number / title',
    applicant: 'Applicant',
    status: 'Status',
    stage: 'Current stage',
    createdAt: 'Started',
    endedAt: 'Ended',
    empty: 'No executions yet',
    emptyDescription:
      'Connected process executions appear here when they start',
    noDefinitions: 'No readable definitions',
    noDefinitionsDescription:
      'Ask an administrator to configure definition access',
    noResults: 'No matching records',
    noResultsDescription: 'Adjust or clear your filters to find records',
    definitionGraph: 'Current definition',
    graphDescription:
      'Current registered states and transitions; business rules determine dynamic branches',
    currentNode: 'Current state',
    visitedNode: 'Visited',
    unvisitedNode: 'Not visited',
    actualPath: 'Actual execution path',
    actualDescription:
      'The complete approval and fulfillment flow with visited nodes, transitions and current state highlighted. Actual returns and historical paths remain visible.',
    tasks: 'Tasks and approval history',
    timeline: 'Approval and management history',
    run: 'Approval run',
    historical: 'Execution history',
    definitionMissing: 'Historical definition unavailable',
    commentsRestricted:
      'Comments may contain private content and require separate business access',
    comment: 'Comment / reason',
    actor: 'Actor',
    assignee: 'Assignee',
    answer: 'Decision',
    previousTask: 'Previous task',
    from: 'From',
    to: 'To',
    initial: 'Initial',
    final: 'Final',
    manual: 'User action',
    automatic: 'Automatic transition',
    transitions: 'State transitions',
    definitionDetails: 'Stages and transitions',
    viewExecutions: 'View executions',
    back: 'Back',
    manage: 'Management actions',
    appoint: 'Assign',
    reassign: 'Reassign',
    terminate: 'Terminate',
    unavailable:
      'The current task or business state does not allow this action',
    person: 'Recipient',
    reason: 'Reason',
    personRequired: 'Choose a recipient',
    reasonRequired: 'Enter a reason',
    cancel: 'Cancel',
    retry: 'Retry',
    loadFailed: 'Loading failed. Try again',
    submitFailed: 'Action failed. Review and try again',
    unknown: 'Outcome unknown. Refresh to check',
    stale: 'The task changed. Refresh and review it',
    gone: 'Record missing or outside your current scope',
    forbidden: 'You cannot read this section. Contact an administrator',
    loading: 'Loading',
    noPeople: 'No eligible recipients for the current task',
    peopleSearch: 'Search authorized recipients',
    loadMore: 'Load more',
    reassignTitle: 'Reassign a task for "{{recordLabel}}"',
    appointTitle: 'Assign a task for "{{recordLabel}}"',
    terminateTitle: 'Terminate request "{{recordLabel}}"',
    reassigned: 'Reassigned task for "{{recordLabel}}"',
    appointed: 'Assigned task for "{{recordLabel}}"',
    terminated: 'Terminated request "{{recordLabel}}"',
    recentDescription:
      'The five most recent authorized executions. Open the execution list for complete history.',
    vehicleTerminationGuard:
      'Dispatched requests cannot be terminated directly. The actual applicant must register usage and follow the vehicle business process.',
    terminationConsequences: {
      vehicle:
        'Ends an undispatched request. This operation cannot close a dispatched request.',
      leave:
        'Closes current approval; the leave service handles outstanding quota reservations.',
      funding:
        'Closes current approval; the business service handles outstanding budget, funding or request reservations. Settled payments remain recorded.',
      stock:
        'Closes current approval; the supplies service handles outstanding stock reservations. Physical returns require their business process.',
      ordinary:
        'Closes current approval and executes the business termination guards and exit processing.',
    },
    terminationDescription:
      'Termination closes current tasks and releases reservations under business rules, preserving all history. Executed business facts require their own cancellation or custody clearance.',
    graphView: 'Diagram',
    dateRange: 'Started date',
    last7: 'Last 7 days',
    last30: 'Last 30 days',
    last90: 'Last 90 days',
    thisMonth: 'This month',
    lastMonth: 'Last month',
    safeHistory: 'This view contains only authorized safe process information',
    business: 'Business content',
    businessRestricted:
      'Business content, attachments and private fields need separate access',
    rules: 'Process rules',
    policy: 'Decision policy',
    peopleSource: 'People source',
    dynamicPeople: 'Resolved at submission under the source business rules',
    guardedBranch: 'Branch selected under source business conditions',
    frozen: 'Frozen fields',
    covered: 'Covered fields',
    management: 'Administrator intervention',
    kinds: {
      leave: 'Leave',
      overtime: 'Overtime',
      leaveCancellation: 'Leave cancellation',
      general: 'General request',
      attendanceChange: 'Attendance correction',
      outing: 'Outing',
      supplies: 'Supply request',
      budgetAdjustment: 'Budget adjustment',
      expensePlan: 'Expense authorization',
      training: 'Training',
      travel: 'Travel',
      travelCancellation: 'Travel cancellation',
      reimbursement: 'Reimbursement',
      purchase: 'Purchase',
      loan: 'Loan request',
      payment: 'Payment request',
      probation: 'Probation review',
      vehicleRequest: 'Vehicle request',
      contract: 'Contract',
      assetRequest: 'Asset request',
      vendorQualification: 'Vendor qualification',
      recruitment: 'Recruitment',
      sealRequest: 'Seal request',
      transfer: 'Personnel change',
      departure: 'Departure',
      certificateRequest: 'Certificate request',
    },
    domains: {
      office: 'Daily office',
      organization: 'Organization & HR',
      finance: 'Finance & expenses',
      procurement: 'Procurement & contracts',
      administration: 'Administration & assets',
    },
    states: {
      issued: 'Issued',
      forcedClosed: 'Force closed',
      draft: 'Draft',
      revision: 'Revision',
      manager: 'Manager',
      head: 'Department head',
      hr: 'HR',
      extra: 'Additional review',
      finance: 'Finance',
      cashier: 'Cashier',
      executive: 'Executive',
      gm: 'General manager',
      cfo: 'CFO',
      legal: 'Legal',
      financeManager: 'Finance manager',
      hrbp: 'HRBP',
      hrDirector: 'HR director',
      approved: 'Approved',
      rejected: 'Rejected',
      withdrawn: 'Withdrawn',
      terminated: 'Terminated',
      completed: 'Completed',
      exception: 'Handling exception',
      dispatch: 'Dispatch',
      usage: 'Vehicle usage',
      issuing: 'Issuing',
      returning: 'Returning',
      returnException: 'Return exception',
      stamping: 'Stamping',
      booking: 'Booking',
      unbooking: 'Cancel booking',
      paid: 'Paid',
      paymentException: 'Payment exception',
      pendingEffective: 'Pending effective date',
      cancellationReview: 'Cancellation review',
      sourceHead: 'Source department head',
      targetHead: 'Target department head',
      committee: 'Committee',
      purchasing: 'Purchasing',
      inquiry: 'Inquiry',
      quoting: 'Quotation',
      pending: 'Pending',
      claimed: 'Claimed',
      waiting: 'Waiting',
      blocked: 'Blocked',
      candidate: 'Candidate',
      suspended: 'Suspended',
      transferred: 'Transferred',
      voided: 'Closed',
      open: 'Open',
      cancelled: 'Cancelled',
      returned: 'Returned',
      concluded: 'Concluded',
      decide: 'Decision',
      copy: 'Copy',
      approve: 'Approve',
      reject: 'Reject',
      return: 'Return',
      unknown: 'Other state',
    },
    authz: {
      definitionRead: 'Definitions',
      historyRead: 'Execution history',
      appoint: 'Assign',
      reassign: 'Reassign',
      terminate: 'Terminate',
    },
    otherStage: 'Other stage ({{name}})',
    otherEvent: 'Process event ({{name}})',
    coveredCount: 'Covers {{count}} business fields',
    frozenCount: '{{count}} business fields frozen on submission',
    policies: {
      all: 'All / single approval',
      any: 'Any approval',
      first: 'First response',
      threshold: 'Threshold vote',
      sequential: 'Sequential',
    },
    peopleSources: {
      dynamic: 'Resolved at submission under the source business rules',
      pools: 'Role / candidate pools',
      subjects: 'Per-subject reviewers',
    },
    events: {
      approve: 'Approved',
      reject: 'Rejected',
      return: 'Returned',
      reassign: 'Administrative reassignment',
      appoint: 'Administrative assignment',
      comment: 'Comment',
      transfer: 'Transferred',
      addSign: 'Added signer',
      claim: 'Claimed',
      release: 'Released task',
      'stage.unassigned': 'Unassigned stage',
      'run.started': 'Approval started',
      'run.ended': 'Approval ended',
      'stage.entered': 'Stage entered',
      remind: 'Reminder',
      escalate: 'Escalated',
      read: 'Read',
    },
  },
};
