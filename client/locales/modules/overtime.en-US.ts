export default {
  overtime: {
    businessErrors: {
      OVERTIME_INVALID_DATE: 'Select a valid overtime date.',
    },

    authz: { resource: 'Overtime requests' },
    navigation: 'Overtime requests',
    description: 'Request overtime and follow its approval and settlement.',
    new: 'New overtime request',
    edit: 'Edit overtime request',
    date: 'Overtime date',
    minutes: 'Duration (minutes)',
    monthlyMinutes: 'Monthly total (minutes)',
    settlement: 'Settlement',
    compensatory: 'Compensatory leave',
    pay: 'Overtime pay',
    durationInvalid: 'Enter a whole number between 1 and 1,440 minutes.',
    formDescription: 'Review the request and submit it, or save a draft.',
    policyHint:
      'One request per date. Late requests require HR review. Compensatory leave is settled after final approval.',
    emptyDescription:
      'Complete an overtime request and submit it, or save a draft.',
    uncertainCreate:
      'The save result is uncertain. Close this form and check My requests before creating another draft.',
    duplicate:
      'An active or approved overtime request already exists for this date.',
    inactive: 'The applicant must be an active employee.',
    configuration:
      'The overtime approval clock configuration is unsupported. Contact an administrator.',
    invalid: 'Review the overtime date, duration, settlement and reason.',
    schemaUnavailable:
      'The overtime database schema needs updating. This operation cannot be completed yet. Contact an administrator.',
  },
};
