/**
 * English wording of the `import` OA module, nested under its own top-level key so modules never collide.
 * `client/locales/en-US.ts` spreads it in; `import.zh-CN.ts` is checked against this shape.
 */
const importEnUS = {
  import: {
    navigation: { title: 'Data import' },
    // Titles the server registers in the permission workspace (`server/providers/import/index.ts`).
    authz: {
      settings: 'Data import',
      read: 'View history and templates',
      update: 'Import',
    },
    title: 'Data import',
    description:
      'Import departments, positions, grades, employee archives and duty-role members from Excel templates.',
    kinds: {
      departments: 'Departments',
      positions: 'Positions',
      grades: 'Grades',
      employees: 'Employee archives',
      dutyRoleMembers: 'Duty-role members',
    },
    kindHints: {
      departments:
        'Matched by department code. Parents may be defined further down the sheet.',
      positions: 'Matched by position code.',
      grades: 'Matched by grade code.',
      employees:
        'Matched by employee number. Import departments, positions and grades first; managers may be defined in the same sheet.',
      dutyRoleMembers:
        'Matched by role code and account. "No" in the active column removes the member.',
    },
    actions: {
      new: 'New import',
      templates: 'Download template',
      templateFor: 'Download the {{kind}} template',
      check: 'Check',
      checking: 'Checking…',
      confirm: 'Import',
      importing: 'Importing…',
      chooseAgain: 'Choose another file',
      back: 'Back',
      chooseFile: 'Choose file',
      downloadFile: 'Download the original file',
      refresh: 'Refresh',
      clearFilters: 'Clear filters',
    },
    fields: {
      kind: 'Kind',
      file: 'File',
      createdAt: 'Started',
      finishedAt: 'Finished',
      status: 'Result',
      summary: 'Summary',
      actor: 'By',
      rowCount: 'Rows read',
      createdCount: 'Created',
      updatedCount: 'Updated',
      unchangedCount: 'Unchanged',
      errorCount: 'Problems',
      row: 'Row',
      column: 'Column',
      problem: 'Problem',
    },
    filters: { allKinds: 'All kinds' },
    status: { succeeded: 'Succeeded', failed: 'Failed' },
    summary: {
      succeeded:
        '{{created}} created · {{updated}} updated · {{unchanged}} unchanged',
      failed: 'Problems: {{count}}',
    },
    noFile: 'No file selected',
    templateFile: '{{kind}} import template.xlsx',
    fileHint: 'An .xlsx workbook of at most 5 MB, laid out as the template.',
    notice: {
      title: 'Before you import',
      accounts:
        'Imports never create accounts: every account named in the file (username or email) must already exist and be enabled, or its row is reported.',
      atomic:
        'The whole file is checked first and written in one go: if any row has a problem, nothing is written.',
    },
    validation: {
      kindRequired: 'Choose what the file holds.',
      fileRequired: 'Choose an .xlsx file.',
      fileType: 'Only .xlsx workbooks can be imported.',
      fileSize: 'The file is larger than 5 MB. Split it into several files.',
    },
    report: {
      invalidTitle: 'Problems found: {{count}}. Nothing was imported.',
      invalidDescription:
        'Correct the rows below in the file, then check it again.',
      truncated: 'Only the first {{shown}} of {{count}} problems are listed.',
      okTitle: 'The file passed the check',
      okDescription:
        '{{rows}} rows read: {{created}} will be created, {{updated}} updated and {{unchanged}} left unchanged.',
      wholeFile: 'File',
    },
    toast: {
      imported: 'Imported "{{name}}"',
      templateFailed: 'Could not download the template. Try again.',
    },
    failure: {
      forbidden: 'You do not have permission to import.',
      tooLarge: 'The file is larger than 5 MB. Split it into several files.',
      invalidFile: 'The file could not be sent. Choose an .xlsx workbook.',
      generic: 'The request failed. Check your connection and try again.',
    },
    empty: {
      title: 'No imports yet',
      description:
        'Download a template, fill it in and import it to bring in departments, people and roles.',
      readOnly:
        'No imports yet. Ask an administrator to import the organisation data.',
    },
    noResults: 'No imports match the filter.',
    loadFailedTitle: 'Could not load the import history',
    detail: {
      title: 'Import details · {{name}}',
      titleLoading: 'Import details',
      notFound: 'This import does not exist or has been deleted.',
      problems: 'Problems',
    },
    common: {
      forbidden: 'You do not have permission to view this.',
      notFound: 'This record does not exist or has been deleted.',
      loadFailed:
        'Could not load the data. Check your connection and try again.',
    },
    // One sentence per problem code the server reports; {{value}} is the cell, {{header}} its column.
    errors: {
      FILE_UNREADABLE:
        'The file is not a readable .xlsx workbook. Save it as an Excel workbook and try again.',
      SHEET_EMPTY:
        'The first sheet has no data rows. Fill in the rows below the header.',
      TOO_MANY_ROWS:
        'The file has more than {{max}} rows. Split it into several files.',
      HEADER_MISSING:
        'The required column "{{header}}" is missing from the header row.',
      HEADER_DUPLICATE: 'The column "{{header}}" appears more than once.',
      REQUIRED: 'Required.',
      INVALID_CODE:
        '"{{value}}" is not a valid code: use letters, digits, ".", "_" and "-", up to 64 characters.',
      TOO_LONG: 'Longer than {{max}} characters.',
      INVALID_INTEGER: '"{{value}}" is not a whole number.',
      INVALID_BOOLEAN: '"{{value}}" is not yes / no.',
      CAREER_START_FUTURE:
        'First employment date cannot be later than today in the work calendar time zone.',
      CAREER_START_AFTER_HIRE:
        'First employment date cannot be later than the hire date.',
      INVALID_DATE:
        '"{{value}}" is not a valid date. Use a date cell or YYYY-MM-DD.',
      INVALID_STATUS:
        '"{{value}}" is not a status: use probation, regular, leaving or left.',
      INVALID_EMAIL: '"{{value}}" is not an email address.',
      DUPLICATE_IN_FILE: '"{{value}}" already appears on row {{firstRow}}.',
      USER_NOT_FOUND:
        'No account "{{value}}". Imports never create accounts: create it on the Users page first.',
      USER_DISABLED:
        'The account "{{value}}" is disabled. Enable it on the Users page first.',
      USER_TAKEN:
        'The account "{{value}}" already belongs to employee {{code}}.',
      USER_MISMATCH:
        'This employee number is bound to another account; an archive keeps its account.',
      PARENT_NOT_FOUND:
        'No department with code "{{value}}" in the file or the system.',
      EXECUTIVE_TOP_LEVEL_ONLY:
        'Only top-level departments may appoint an executive; child departments inherit it.',
      PARENT_CYCLE: 'The parent departments form a loop.',
      DEPARTMENT_NOT_FOUND:
        'No department with code "{{value}}". Import departments first.',
      DEPARTMENT_INACTIVE: 'The department "{{value}}" is disabled.',
      POSITION_NOT_FOUND: 'No position with code "{{value}}".',
      POSITION_INACTIVE: 'The position "{{value}}" is disabled.',
      GRADE_NOT_FOUND: 'No grade with code "{{value}}".',
      GRADE_INACTIVE: 'The grade "{{value}}" is disabled.',
      MANAGER_NOT_FOUND:
        'No employee number "{{value}}" in the file or the system.',
      MANAGER_SELF: 'An employee cannot be their own manager.',
      MANAGER_INACTIVE: 'The manager "{{value}}" has left.',
      MANAGER_CYCLE: 'The managers form a loop.',
      DUTY_ROLE_NOT_FOUND: 'No duty role with code "{{value}}".',
      WRITE_FAILED:
        'This row could not be written ({{reason}}), so nothing was imported. Check the row and try again.',
      unknown: 'This row cannot be imported.',
    },
  },
};

export type ImportLocale = typeof importEnUS;

export default importEnUS;
