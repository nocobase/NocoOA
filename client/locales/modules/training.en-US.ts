export default {
  training: {
    businessErrors: {
      TRAINING_INVALID_INPUT:
        'Complete the training name, institution and reason, and enter valid nonnegative costs.',
      TRAINING_INVALID_DATE:
        'The training end must be later than its start. Check the dates and times.',
      TRAINING_DEPARTMENT_REQUIRED:
        'The applicant needs an active primary department. Ask HR to update the employee record.',
    },

    cc: 'Add copy recipient',
    authz: {
      resource: 'Training and learning',
      submit: 'Submit training request',
      delegate: 'Submit on behalf of an employee',
      view: 'View training requests',
    },
    new: 'New training request',
    edit: 'Edit training request',
    formDescription: 'Apply for training or external learning.',
    name: 'Training name',
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
      'Approval records training attendance when working time is used. Paid training creates an approved reimbursement allowance; no payment has been made.',
    approvedFacts: 'This training has been approved. HR receives a copy.',
    attendanceRecorded: 'Training attendance activity has been recorded.',
    authorizationIssued:
      'Approved reimbursement allowance: {{amount}} yuan. Claims follow the allowance policy.',
    zeroNoAuthorization: 'No fee allowance is created for free training.',
    uncertainCreate:
      'The save result is unknown. Check My requests before creating another request.',
    inactive: 'An active employee archive is required.',
    configuration: 'The approval clock configuration is unsupported.',
    invalid: 'Check the request fields and reload the latest record if needed.',
    stages: {
      manager: 'Direct manager',
      head: 'Department head',
      finance: 'Finance',
      executive: 'Executive',
      gm: 'General manager',
    },
  },
};
