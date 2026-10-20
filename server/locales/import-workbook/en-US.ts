/** Workbook content follows the requested download language; codes and account references are shared. */
const userNote =
  'Use an existing enabled account’s username or email. Import does not create accounts; create or enable the account on the Users page first.';
const required = 'Required.';
const active = 'Yes / no; defaults to yes when blank.';
const sort = 'Integer; lower values appear first. Defaults to 0.';
export const workbookEnUS = {
  guide: {
    sheet: 'Instructions',
    title: '{{title}} import template',
    rules: 'Import rules',
    matchedBy: 'Match records by',
    column: 'Column',
    required: 'Required',
    explanation: 'Explanation',
    yes: 'Yes',
    example: 'Examples (enter data on the first worksheet, not here)',
  },
  rules: [
    'Enter one record per row on the first worksheet, starting at row 2. Keep the headers unchanged. You may remove optional columns or reorder columns.',
    'Each row updates the record matching the stated identifier, or creates one if none exists. Omitted columns preserve existing values; a present column with a blank cell clears that value.',
    'Check the workbook before importing. The system reports row numbers, columns and problems. No records are written if any row has an error.',
    'After a successful check, confirm the import. The entire workbook is written in one transaction and rolled back on failure. The original file, import history and audit trail are retained.',
    'Import does not create sign-in accounts. Referenced usernames or email addresses must belong to existing enabled accounts.',
    'Format identifier columns as text so Excel preserves leading zeros.',
  ],
  kinds: {
    departments: {
      sheet: 'Departments',
      title: 'Department tree',
      matchedBy: 'Department code',
      columns: {
        code: [
          'Department code',
          'Required. Up to 64 letters, digits, dots, underscores or hyphens. An existing code updates the department; otherwise a department is created.',
        ],
        title: ['Department name', required],
        parentCode: [
          'Parent department code',
          'Blank for a top-level department. May reference another row or an existing department. Cycles are not allowed.',
        ],
        manager: ['Department head', `${userNote} Leave blank for no head.`],
        executive: [
          'Executive sponsor',
          `${userNote} Usually set only on top-level departments; descendants inherit the sponsor.`,
        ],
        sortOrder: ['Sort order', sort],
        active: ['Active', active],
      },
    },
    positions: {
      sheet: 'Positions',
      title: 'Positions',
      matchedBy: 'Position code',
      columns: {
        code: [
          'Position code',
          'Required. An existing code updates the position; otherwise a position is created.',
        ],
        title: ['Position name', required],
        sortOrder: ['Sort order', sort],
        active: ['Active', active],
      },
    },
    grades: {
      sheet: 'Grades',
      title: 'Grades',
      matchedBy: 'Grade code',
      columns: {
        code: [
          'Grade code',
          'Required, for example P5 or M2. An existing code updates the grade; otherwise a grade is created.',
        ],
        title: ['Grade name', required],
        rank: [
          'Rank',
          'Required integer; higher values indicate a higher grade, including manager and director bands.',
        ],
        active: ['Active', active],
      },
    },
    employees: {
      sheet: 'Employees',
      title: 'Employee records',
      matchedBy: 'Employee code',
      columns: {
        code: [
          'Employee code',
          'Required. An existing employee code updates the record; otherwise a record is created.',
        ],
        name: ['Name', required],
        user: [
          'Sign-in account',
          `${required} ${userNote} One account can belong to only one employee record.`,
        ],
        departmentCode: [
          'Primary department code',
          'Use an existing department code (import departments first). Sets the primary department and removes the previous primary membership. Blank preserves memberships.',
        ],
        managerCode: [
          'Line manager employee code',
          'May reference another row. Self-reference, cycles and departed managers are not allowed. Blank means no line manager.',
        ],
        positionCode: [
          'Position code',
          'Code of an active position; blank means no position.',
        ],
        gradeCode: [
          'Grade code',
          'Code of an active grade; blank means no grade.',
        ],
        careerStartDate: [
          'Career start date',
          'Optional start of cumulative service, for example 2010-07-01. Cannot be after hire date or today. Leave blank if unknown; do not infer from hire date.',
        ],
        hireDate: ['Hire date', 'Date, for example 2026-10-01.'],
        probationEndDate: [
          'Probation end date',
          'Date, for example 2027-01-01.',
        ],
        status: [
          'Status',
          'Required: probation / regular / leaving / left. Changing an existing status is recorded as an administrative correction in employee history.',
        ],
        phone: ['Phone', ''],
        email: ['Email', 'Work email; may differ from the sign-in account.'],
        workLocation: ['Work location', ''],
        emergencyContact: ['Emergency contact', ''],
      },
    },
    dutyRoleMembers: {
      sheet: 'Duty role members',
      title: 'Duty role members',
      matchedBy: 'Role code + member account',
      columns: {
        roleCode: [
          'Role code',
          'Required existing role code, for example gm, finance, cashier or hr.',
        ],
        user: ['Member account', `${required} ${userNote}`],
        active: [
          'Active',
          'Yes adds the member to this duty pool; an existing membership is preserved. No removes the membership. Defaults to yes.',
        ],
      },
    },
  },
  examples: {
    总公司: 'Head office',
    研发中心: 'Engineering center',
    采购专员: 'Purchasing specialist',
    会计: 'Accountant',
    高级工程师: 'Senior engineer',
    经理: 'Manager',
    张三: 'Zhang San',
    李四: 'Li Si',
    上海: 'Shanghai',
    正式: 'regular',
    试用: 'probation',
    是: 'Yes',
    否: 'No',
  },
} as const;
