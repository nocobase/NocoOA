export default {
  travel: {
    businessErrors: {
      TRAVEL_ITINERARY_REQUIRED:
        'International travel requires an itinerary attachment. Upload or select one before submitting.',
      TRAVEL_OVERLAP:
        'This period overlaps an approved trip. Adjust the travel dates.',
      TRAVEL_COMPANIONS_INVALID:
        'Select distinct companions other than the applicant.',
      TRAVEL_COMPANION_INACTIVE:
        'A selected traveller is no longer active. Select current employees again.',
      TRAVEL_DEPARTMENT_REQUIRED:
        'The applicant needs an active primary department. Ask HR to update the employee record.',
      TRAVEL_INVALID_DATE:
        'The trip end must be later than its start. Check both dates and times.',
      TRAVEL_INVALID_INPUT:
        'Complete the destination and reason, and enter valid nonnegative travel costs.',
    },

    requestLoan: 'Request linked loan',
    reviseTrip: 'Revise trip and restart approval',
    revisionWarning:
      'Revision closes the old reimbursement allowance and ends the old attendance activity before fresh approval. Existing loan principal and original due dates remain unchanged; handle loans separately.',
    cancelTrip: 'Request trip cancellation',
    complete: 'Complete booking',
    unable: 'Unable to book',
    forceComplete: 'Force close booking',
    retryBooking: 'Retry booking',
    standardTargetUnavailable:
      'The selected employee travel standard is unavailable under your delegated target permission. Saving is blocked; the submitter standard will not be substituted.',
    standard: 'Frozen travel standard',
    lodgingPerNight: 'Lodging standard per night (yuan)',
    allowancePerDay: 'Allowance standard per day (yuan)',
    companions: 'Companions',
    addCompanion: 'Add companion',
    removeCompanion: 'Remove',
    companionsInvalid: 'Companions must be distinct',
    peopleUnavailable:
      'Your permissions do not allow employee search. Contact an administrator.',
    destination: 'Destination',
    international: 'International trip',
    needsBooking: 'Administrative booking',
    needsLoan: 'Loan requested',
    transportCents: 'Transport',
    lodgingCents: 'Lodging',
    allowanceCents: 'Allowance',
    bookingInformation: 'Booking details',
    exceptionReason: 'Exception reason',
    cc: 'Add copy recipient',
    authz: {
      resource: 'Travel requests',
      submit: 'Submit travel request',
      delegate: 'Submit on behalf of an employee',
      view: 'View travel requests',
    },
    new: 'New travel request',
    edit: 'Edit travel request',
    formDescription: 'Apply for a business trip.',
    name: 'Travel name',
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
      'Approval records trip attendance and creates a reimbursement allowance for positive estimates. Booking and loan disbursement are separate.',
    approvedFacts:
      'Trip approval is complete; booking progress is shown separately.',
    attendanceRecorded: 'Travel attendance activity has been recorded.',
    authorizationIssued:
      'Approved reimbursement allowance: {{amount}} yuan. Claims follow the allowance policy.',
    zeroNoAuthorization:
      'Zero estimated costs create no allowance; finance review is still required.',
    uncertainCreate:
      'The save result is unknown. Check My requests before creating another request.',
    inactive: 'An active employee archive is required.',
    configuration: 'The approval clock configuration is unsupported.',
    invalid: 'Check the request fields and reload the latest record if needed.',
    stages: {
      completed: 'Completed',
      manager: 'Direct manager',
      head: 'Department head',
      finance: 'Finance',
      executive: 'Executive',
      gm: 'General manager',
      booking: 'Administrative booking',
    },
  },
};
