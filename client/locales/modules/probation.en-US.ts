export default {
  probationRequests: {
    businessErrors: {
      PROBATION_SELF_EVALUATION_REQUIRED:
        "Enter the employee's self-evaluation before submitting.",
      PROBATION_CONCLUSION_REQUIRED:
        "Enter the manager's conclusion before approving.",
      PROBATION_COMPENSATION_REQUIRED:
        'Complete the protected grade and salary information in the HR approval form.',
      PROBATION_INVALID_GRADE: 'Select an enabled grade.',
      PROBATION_ALREADY_ACTIVE:
        'This employee already has an active probation request. Open the existing request.',
      PROBATION_STALE_EMPLOYEE:
        "The employee's probation information changed. Refresh before acting again.",
      PROBATION_DEPARTMENT_REQUIRED:
        'The employee needs an active primary department. Ask HR to update the record.',
    },

    title: 'Probation requests',
    description:
      'Review probation evaluations and follow the regularization decision.',
    new: 'New probation request',
    edit: 'Edit',
    details: 'View details',
    number: 'Number',
    employee: 'Employee',
    probationEndDate: 'Probation end date',
    conclusion: 'Conclusion',
    search: 'Search number, employee name or self-evaluation',
    view: 'Record view',
    allStatuses: 'All statuses',
    refresh: 'Refresh',
    clearFilters: 'Clear filters',
    emptyTitle: 'No probation requests yet',
    emptyDescription:
      'Employees receive system drafts near expiry. HR can create an evaluation for a probation employee.',
    noResults: 'No matching requests',
    rowActions: 'Actions for {{name}}',
    views: { mine: 'Mine', pending: 'Pending', done: 'Done', copied: 'Copied' },
    conclusions: {
      regular: 'Regularize',
      deferred: 'Extend probation',
      declined: 'Decline regularization',
    },
    statuses: {
      draft: 'Draft',
      revision: 'Revision',
      manager: 'Manager review',
      head: 'Department review',
      hr: 'HR review',
      gm: 'General manager review',
      approved: 'Approved',
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
        'This evaluation changed. Read the latest record before acting again.',
      invalid: 'Check the evaluation content and required fields.',
      failed: 'The request did not complete. Try again.',
      departureUnavailable:
        'The departure flow is unavailable; this action was not completed. The general manager review remains pending.',
    },
    detail: {
      creator: 'Created by',
      selfEvaluation: 'Self-evaluation',
      evaluation: 'Manager evaluation',
      deferredTo: 'Extended probation end date',
      grade: 'Grade',
      manager: 'Manager reviewer',
      head: 'Department reviewer',
      hr: 'HR reviewer',
      gm: 'General manager reviewer',
      rules: 'Frozen rules',
      unsubmitted: 'Rules are frozen at submission.',
    },
    rules: {
      grade_managerRank: 'Manager grade threshold',
      sla_remindHours: 'Reminder working hours',
      sla_escalateHours: 'Escalation working hours',
      sla_urgeCooldownHours: 'Reminder cooldown hours',
    },
    compensation: {
      title: 'Private compensation proposal',
      denied: 'You cannot view compensation.',
      missing: 'No compensation proposal has been saved.',
      grade: 'Proposed grade',
      salary: 'Base salary (yuan)',
    },
    authz: {
      resource: 'Probation evaluations',
      submit: 'Edit and submit probation evaluation',
      delegate: 'HR creates probation evaluations',
      view: 'Read authorized probation evaluations',
      compensation: 'Access private probation compensation',
    },
    schedule: {
      title: 'Probation expiry reminders',
      description:
        'Reconcile probation dates in company time, create self-evaluation drafts 14 days before expiry and notify employees.',
    },
  },
};
