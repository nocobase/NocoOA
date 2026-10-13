export default {
  travelCancellation: {
    businessErrors: {
      TRAVEL_CANCELLATION_REASON_REQUIRED:
        'Enter the trip cancellation reason.',
      TRAVEL_CANCELLATION_ALREADY_PENDING:
        'A cancellation is already pending for this trip. Open the existing request.',
      TRAVEL_CANCELLATION_BASELINE_CHANGED:
        'The approved trip changed. Refresh it and revise the cancellation before resubmitting.',
      TRAVEL_CANCELLATION_INVALID_SOURCE:
        'The original trip is no longer eligible for cancellation. Select an effective approved trip.',
    },

    retryUnbooking: 'Retry administrative cancellation',
    bookingInformation: 'Cancellation order and refund arrangements',
    unbookingHint:
      'The original trip is revoked after department head approval. Administration must record cancellation and refund arrangements; this does not confirm a refund payment.',
    complete: 'Complete administrative cancellation',
    unable: 'Unable to cancel booking',
    forceComplete: 'Force close cancellation',
    source: 'Original trip',
    chooseSource: 'Choose an approved trip',
    effectHint:
      'The original department head must approve before attendance and reimbursement authorization are revoked. Linked loans are handled according to their disbursement state.',
    cc: 'Add copy recipient',
    authz: {
      resource: 'Trip cancellation requests',
      submit: 'Submit trip cancellation request',
      delegate: 'Submit on behalf of an employee',
      view: 'View trip cancellation requests',
    },
    new: 'New trip cancellation request',
    edit: 'Edit trip cancellation request',
    formDescription: 'Request cancellation of an approved trip.',
    name: 'Trip cancellation name',
    institution: 'Institution',
    startAt: 'Starts at',
    endAt: 'Ends at',
    usesWorkingTime: 'Uses working time',
    amount: 'Fee (yuan)',
    yuan: 'yuan',
    yes: 'Yes',
    no: 'No',
    timeZone: 'Company time zone: {{zone}}',
    amountHint:
      'Enter yuan with up to two decimal places. Zero fees are allowed.',
    amountInvalid: 'Enter a nonnegative amount with up to two decimal places.',
    dateInvalid: 'Choose a valid interval with the end after the start.',
    approvalHint:
      'Approval records trip cancellation attendance when working time is used. Paid trip cancellation creates an approved reimbursement allowance; no payment has been made.',
    approvedFacts:
      'This trip cancellation has been approved. HR receives a copy.',
    attendanceRecorded:
      'Trip cancellation attendance activity has been recorded.',
    authorizationIssued:
      'Approved reimbursement allowance: {{amount}} yuan. Claims follow the allowance policy.',
    zeroNoAuthorization:
      'No fee allowance is created for free trip cancellation.',
    uncertainCreate:
      'The save result is unknown. Check My requests before creating another request.',
    inactive: 'An active employee archive is required.',
    configuration: 'The approval clock configuration is unsupported.',
    invalid: 'Check the request fields and reload the latest record if needed.',
    stages: {
      unbooking: 'Administrative booking cancellation',
      manager: 'Direct manager',
      head: 'Department head',
      finance: 'Finance',
      executive: 'Executive',
      gm: 'General manager',
    },
  },
};
