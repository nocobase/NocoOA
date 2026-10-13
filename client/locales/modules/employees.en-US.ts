/**
 * English wording of the `employees` OA module, nested under its own top-level key so modules never collide.
 * `client/locales/en-US.ts` spreads it in; `employees.zh-CN.ts` is checked against this shape.
 */
const employeesEnUS = {
  employees: {
    refresh: 'Refresh',
    personal: {
      title: 'Personal archive',
      description:
        'View your employee details; contact HR to correct any errors.',
      identity: '{{name}} · {{code}}',
      basic: 'Basic information',
      profile: 'Personal details',
      bank: 'Payment account',
      emptyTitle: 'No employee archive yet',
      emptyDescription:
        'Contact HR to create an employee archive for your account.',
      profileMissing:
        'Personal details were not found; contact HR to check your archive.',
      forbidden:
        'Unable to access your archive; contact an administrator to check access.',
      refresh: 'Refresh',
    },
    authz: {
      section: 'Employees',
      settings: 'Employee archive page',
      settingsRead: 'Open',
      collections: {
        employees: 'Employee archives',
        employeeProfiles: 'Employee controlled information',
        employeeCompensation: 'Employee compensation',
      },
      archive: {
        title: 'Employee archive',
        view: 'View',
        manage: 'Create and edit',
        correctStatus: 'Correct status',
      },
      profile: {
        title: 'Employee controlled information',
        view: 'View all',
        viewBank: 'View bank account',
        update: 'Edit',
      },
      compensation: {
        title: 'Employee compensation',
        view: 'View',
      },
      directory: {
        title: 'Directory',
        view: 'View people',
        viewContact: 'View phone and email',
      },
      scopes: {
        reports: 'My reports (all levels)',
        selfAndReports: 'Me and my reports',
        reportsHint:
          'People below the viewer in the reporting line, at any depth; an inactive manager in between does not cut it.',
      },
      subjects: {
        position: 'Positions',
        reportingManager: 'Direct managers',
      },
    },
    permissionSets: {
      hr: 'HR: employee archives',
      compensation: 'Employee compensation (GM, CFO)',
      bank: 'Employee bank accounts (finance)',
      manager: 'Direct manager: reports’ archives',
      head: 'Department head: department archives',
      admin: 'Employee archive data correction',
      directory: 'Directory',
    },
    navigation: {
      archive: 'Employees',
      directory: 'Directory',
    },
    title: 'Employees',
    description:
      'Maintain each employee’s account, reporting line, position and controlled information.',
    fields: {
      name: 'Name',
      code: 'Employee code',
      user: 'Account',
      primaryDepartment: 'Primary department',
      position: 'Position',
      grade: 'Grade',
      manager: 'Direct manager',
      status: 'Status',
      careerStartDate: 'First employment date',
      hireDate: 'Hire date',
      probationEndDate: 'Probation end date',
      lastWorkingDay: 'Last working day',
      phone: 'Phone',
      email: 'Email',
      workLocation: 'Work location',
      emergencyContact: 'Emergency contact',
      active: 'Active',
      updatedAt: 'Updated',
      idType: 'ID type',
      idNumber: 'ID number',
      birthDate: 'Date of birth',
      address: 'Address',
      education: 'Education',
      school: 'School',
      major: 'Major',
      bankName: 'Bank',
      bankAccount: 'Bank account',
      bankAccountName: 'Account holder',
      effectiveFrom: 'Effective from',
      baseSalary: 'Base salary',
      sourceApplication: 'Source application',
      note: 'Note',
      kind: 'Change',
      effectiveAt: 'Effective date',
      changes: 'Changes',
    },
    status: {
      probation: 'On probation',
      regular: 'Regular',
      leaving: 'Leaving',
      left: 'Left',
    },
    historyKind: {
      hire: 'Hire',
      regularization: 'Regularization',
      transfer: 'Transfer',
      salaryChange: 'Salary change',
      departure: 'Departure',
      correction: 'Data correction',
    },
    boolean: {
      yes: 'Yes',
      no: 'No',
    },
    search: {
      placeholder: 'Search by name or employee code',
      label: 'Search employees',
    },
    filters: {
      department: 'Department',
      allDepartments: 'All departments',
      status: 'Status',
      allStatuses: 'All statuses',
      clear: 'Clear filters',
    },
    empty: {
      title: 'No employee archives yet',
      description:
        'Create an archive to bind an account, reporting line and position.',
      descriptionReadOnly:
        'No archive is visible to you yet. Ask HR if you expected some here.',
      noResults: 'No employees match the filters.',
    },
    error: {
      title: 'Unable to load employees',
      requestFailed: 'The request failed. Check the connection and try again.',
      forbidden: 'You do not have permission to view this.',
      notFound: 'This employee archive does not exist or has been deleted.',
      tabForbidden: 'You do not have permission to view this section.',
    },
    actions: {
      label: 'Actions',
      more: 'Actions for {{name}}',
      edit: 'Edit',
      correctStatus: 'Correct status',
      editProfile: 'Edit',
      moreActions: 'More actions',
    },
    create: {
      action: 'New employee',
      title: 'New employee',
      description: 'Bind an account and fill in the archive.',
      submit: 'Create',
      success: 'Created employee “{{name}}”',
    },
    edit: {
      title: 'Edit employee',
      success: 'Saved employee “{{name}}”',
    },
    form: {
      basicSection: 'Basic information',
      contactSection: 'Contact',
      nameRequired: 'Enter a name.',
      codeRequired: 'Enter an employee code.',
      userRequired: 'Choose the account to bind.',
      careerStartInvalid: 'Choose a valid first employment date.',
      careerStartFuture: 'First employment date cannot be in the future.',
      careerStartAfterHire:
        'First employment date cannot be later than the hire date.',
      hireDateRequired: 'Choose the hire date.',
      tooLong: 'Use at most {{max}} characters.',
      emailInvalid: 'The email format is invalid.',
      userTaken: 'This account already has an archive.',
      codeTaken: 'This employee code is already used.',
      userInvalid: 'This account does not exist or is disabled.',
      managerInvalid: 'Choose an active employee who is not below this one.',
      positionInvalid: 'This position does not exist or is disabled.',
      gradeInvalid: 'This grade does not exist or is disabled.',
      initialStatus: 'Initial status',
      managerPlaceholder: 'Search by name or employee code',
      managerEmpty: 'No matching employee',
      none: 'None',
      positionPlaceholder: 'Choose a position',
      gradePlaceholder: 'Choose a grade',
      optionsFailed: 'The options could not be loaded.',
      userPlaceholder: 'Search accounts by name or email',
    },
    page: {
      title: 'Employee',
      tabsLabel: 'Employee sections',
    },
    tabs: {
      basic: 'Basic information',
      profile: 'Controlled information',
      compensation: 'Compensation',
      history: 'Change history',
    },
    profile: {
      title: 'Controlled information',
      description:
        'Identity, address, education and bank account; visible only to authorized roles.',
      bankOnly: 'You can see the bank account only.',
      editTitle: 'Edit controlled information',
      success: 'Saved controlled information of “{{name}}”',
      identitySection: 'Identity',
      educationSection: 'Education',
      bankSection: 'Bank account',
    },
    compensation: {
      title: 'Compensation',
      description:
        'Every regularization and salary change adds a row; rows are never edited.',
      empty: 'No compensation records yet.',
    },
    history: {
      title: 'Change history',
      description:
        'Hires, regularizations, transfers, departures and data corrections.',
      empty: 'No changes recorded yet.',
    },
    correction: {
      title: 'Correct status',
      description:
        'A data correction outside the approval flows. It is audited with your reason.',
      reason: 'Reason',
      reasonPlaceholder: 'Why the recorded status is wrong',
      reasonRequired: 'Enter the reason for the correction.',
      submit: 'Correct',
      unchanged: 'The correction changes nothing.',
      success: 'Corrected the status of “{{name}}”',
    },
    directory: {
      title: 'Directory',
      description:
        'Find colleagues by department or name, with their contacts.',
      searchPlaceholder: 'Search by name or employee code',
      searchLabel: 'Search the directory',
      contactHidden: 'Not visible',
      emptyTitle: 'The directory is empty',
      emptyDescription: 'People appear here once HR creates their archives.',
      noResults: 'No colleagues match the filters.',
      errorTitle: 'Unable to load the directory',
    },
  },
};

export type EmployeesLocale = typeof employeesEnUS;

export default employeesEnUS;
