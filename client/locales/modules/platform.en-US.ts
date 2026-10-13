/**
 * English wording of the `platform` OA module, nested under its own top-level key so modules never collide.
 * `client/locales/en-US.ts` spreads it in; `platform.zh-CN.ts` is checked against this shape.
 */
const platformEnUS = {
  platform: {
    navigation: {
      calendar: 'Work calendar',
      dictionaries: 'Dictionaries',
      rules: 'Rule overview and history',
      sequences: 'Document numbers',
      auditLogs: 'Audit log',
    },
    // Titles the server registers in the permission workspace (`server/providers/platform/index.ts`).
    authz: {
      section: 'OA platform',
      calendar: 'Work calendar',
      dictionaries: 'Dictionaries',
      rules: 'Rule overview and history',
      sequences: 'Document numbers',
      auditLogs: 'Audit log',
      actions: { read: 'View', update: 'Edit' },
    },
    common: {
      actions: 'Actions',
      actionsFor: 'Actions for {{name}}',
      edit: 'Edit',
      delete: 'Delete',
      refresh: 'Refresh',
      clearFilters: 'Clear filters',
      noResults: 'Nothing matches the filters.',
      forbidden: 'You do not have permission to view this.',
      notFound: 'This record does not exist or has been deleted.',
      loadFailed:
        'Could not load the data. Check your connection and try again.',
      writeForbidden: 'You do not have permission to make this change.',
      saveFailed: 'Could not save the change. Try again.',
    },
    calendar: {
      title: 'Work calendar',
      description:
        'Set the working hours and maintain each year’s public holidays and make-up working days.',
      loadFailedTitle: 'Could not load the calendar settings',
      kinds: {
        holiday: 'Public holiday',
        adjustedWorkday: 'Make-up working day',
        workday: 'Working day',
        weekend: 'Day off',
      },
      workHours: {
        title: 'Working hours',
        description:
          'Approval reminders and escalations count only these hours on working days.',
        start: 'Starts at',
        end: 'Ends at',
        range: '{{start}}–{{end}}',
        invalidTime: 'Enter a time such as 09:00.',
        endBeforeStart: 'The end must be later than the start.',
        scheduled: 'From {{date}}: {{start}}–{{end}}',
        saved: 'Saved the working hours',
      },
      timeZone: {
        title: 'Time zone',
        description:
          'The time zone the calendar and document numbers use. A change applies at once.',
        label: 'Time zone',
        hint: 'An IANA time zone name, such as Asia/Shanghai.',
        required: 'Enter a time zone.',
        invalid:
          'This is not a time zone the server knows. Use a name such as Asia/Shanghai.',
        saved: 'Saved the time zone',
      },
      days: {
        title: 'Special days',
        description:
          'Days not listed follow the week: Monday to Friday are working days.',
        previousYear: 'Previous year',
        nextYear: 'Next year',
        add: 'Add day',
        addTitle: 'Add day',
        addDescription: 'A date that is already listed is replaced.',
        addSubmit: 'Add',
        editTitle: 'Edit {{date}}',
        import: 'Import',
        date: 'Date',
        weekday: 'Weekday',
        kind: 'Type',
        note: 'Note',
        dateRequired: 'Pick a date.',
        noteTooLong: 'Use at most {{max}} characters.',
        emptyTitle: 'No special days in {{year}} yet',
        emptyDescription:
          'Import the year’s public holidays and make-up working days, or add them one by one.',
        emptyReadOnly:
          'Every day follows the week. Ask an administrator to import the holidays.',
        saved: 'Saved "{{date}}"',
        removed: 'Removed "{{date}}"',
        removeTitle: 'Remove "{{date}}"?',
        removeDescription: 'The date follows the week again.',
        notFound: 'This day is no longer listed. It may have been removed.',
      },
      import: {
        title: 'Import special days of {{year}}',
        description: 'Paste one day per line: date, type and an optional note.',
        lines: 'Days',
        placeholder:
          '{{year}}-10-01,holiday,National Day\n{{year}}-10-10,adjustedWorkday',
        hint: 'Separate with commas or tabs. Types: holiday, adjustedWorkday, workday, weekend (or 休 / 班).',
        replace: 'Replace the year',
        replaceHint:
          'Remove the special days of {{year}} that are not in the list.',
        submit: 'Import',
        emptyText: 'Paste at least one day.',
        success:
          'Imported: {{created}} added, {{updated}} changed, {{removed}} removed',
        problems: {
          format: 'Line {{line}} needs a date and a type.',
          date: 'Line {{line}} has an invalid date.',
          kind: 'Line {{line}} has an unknown type.',
          year: 'Line {{line}} is not in {{year}}.',
          duplicate: 'Line {{line}} repeats a date.',
        },
      },
    },
    dictionaries: {
      title: 'Dictionaries',
      description:
        'Maintain the options request forms offer. Entries are disabled, never deleted.',
      loadFailedTitle: 'Could not load the dictionary',
      searchPlaceholder: 'Search by name or code',
      searchLabel: 'Search entries',
      notFound: 'This entry does not exist or has been removed.',
      enable: 'Enable',
      enabled: 'Enabled "{{name}}"',
      disable: 'Disable',
      disabled: 'Disabled "{{name}}"',
      disableTitle: 'Disable "{{name}}"?',
      disableDescription:
        'Existing requests keep showing it, but new requests can no longer choose it. You can enable it again.',
      extraValue: '{{name}}: {{value}}',
      extraUnlimited: '{{name}}: no limit',
      fields: {
        type: 'Dictionary type',
        label: 'Name',
        labelZh: 'Name (Chinese)',
        labelEn: 'Name (English)',
        code: 'Code',
        extra: 'Attributes',
        sortOrder: 'Order',
        status: 'Status',
      },
      status: { all: 'All statuses', active: 'Enabled', inactive: 'Disabled' },
      empty: {
        title: 'No entries of this type yet',
        description: 'Add the first entry so forms can offer it.',
        readOnly: 'Ask an administrator to add entries.',
      },
      create: {
        action: 'New entry',
        title: 'New entry: {{type}}',
        success: 'Created entry "{{name}}"',
      },
      edit: { title: 'Edit entry', success: 'Saved entry "{{name}}"' },
      form: {
        description: 'An entry of {{type}}. Name it in at least one language.',
        codeHint:
          'Letters, digits, _ and -, starting with a letter. It cannot change later.',
        codeFixed: 'Records store the code, so it cannot change.',
        codeInvalid:
          'Use letters, digits, _ and -, starting with a letter (at most 64).',
        codeTaken: 'This type already has an entry with this code.',
        labelRequired: 'Enter a name in at least one language.',
        labelTooLong: 'Use at most {{max}} characters.',
        sortOrderHint: 'Smaller numbers come first in forms.',
        sortOrderInvalid: 'Enter a whole number from 0 to 1,000,000.',
        numberRequired: 'Enter a number.',
        numberMin: 'Enter a number of at least {{min}}.',
        integerMin: 'Enter a whole number of at least {{min}}.',
        blankUnlimited: 'Leave blank for no limit.',
        extraInvalid: 'This value is not accepted.',
      },
      types: {
        expensePlanType: 'Expense request matters',
        officeItem: 'Office supplies',
        leaveType: 'Leave types',
        annualLeaveTier: 'Annual leave by service',
        paymentMethod: 'Payment method',
        expenseCategory: 'Expense categories',
        budgetSubject: 'Budget subjects',
        sealType: 'Seal types',
        contractType: 'Contract types',
        assetCategory: 'Asset categories',
        supplierCategory: 'Supplier categories',
        vehicleType: 'Vehicle types',
        departureType: 'Departure type',
        resignationReason: 'Resignation reasons',
        recruitmentReason: 'Hiring reasons',
        certificateType: 'Certificate types',
        travelStandard: 'Travel standards',
      },
      travelStandardKindHelp:
        'Use the corresponding category for lodging and allowance. An aggregate travel category does not represent either and has no daily standard.',
      invalidStandardKind: 'Choose a valid travel standard classification.',
      extraOptions: {
        travelStandardKind: {
          none: 'Not applicable',
          lodging: 'Lodging per night',
          allowance: 'Allowance per day',
        },
      },
      extra: {
        travelStandardKind: 'Travel standard classification',
        requiresPrintInfo: 'Needs printing details',
        deductsBalance: 'Deducts balance',
        requiresAttachment: 'Needs an attachment',
        attachmentAboveDays: 'Attachment above (days)',
        maxDays: 'Maximum days',
        requiresHr: 'HR approval',
        minYears: 'From years of service',
        days: 'Days',
        voluntary: 'Voluntary',
        replacement: 'Replaces a leaver',
        involvesSalary: 'Shows salary',
        minRank: 'From grade rank',
        lodgingPerNight: 'Lodging per night (yuan)',
        allowancePerDay: 'Allowance per day (yuan)',
      },
    },
    rules: {
      relatedFlows: 'Related processes (edit at node)',
      editAtNode: 'Edit at process node',
      title: 'Rule overview and history',
      description:
        'View current rules, scheduled changes and history. Open a related process node to edit; shared rules affect multiple processes.',
      loadFailedTitle: 'Could not load the approval rules',
      notFound: 'This rule does not exist.',
      change: 'Change',
      history: 'History',
      changeTitle: 'Change "{{name}}"',
      changeDescription:
        'The new value applies to requests submitted from when it takes effect.',
      changed: 'Changed "{{name}}"',
      historyTitle: 'History of "{{name}}"',
      currentValue: 'Now: {{value}}',
      scheduledValue: 'From {{date}}: {{value}}',
      defaultVersion: 'Default',
      withdraw: 'Withdraw',
      withdrawn: 'Withdrew the scheduled change of "{{name}}"',
      withdrawTitle: 'Withdraw the change of "{{name}}" from {{date}}?',
      withdrawDescription:
        'The scheduled value {{value}} will not take effect.',
      versionStatus: { current: 'In effect', scheduled: 'Scheduled' },
      fields: {
        rule: 'Rule',
        current: 'Current value',
        scheduled: 'Scheduled',
        newValue: 'New value',
        value: 'Value',
        note: 'Note',
        effectiveFrom: 'Takes effect',
        changedBy: 'Changed by',
      },
      effective: {
        label: 'Takes effect',
        now: 'Immediately',
        fromDate: 'From a date',
        dateLabel: 'Effective date',
        hint: 'From 00:00 of that day.',
        dateRequired: 'Pick the date it takes effect.',
        pastError: 'Pick a date from tomorrow on.',
      },
      errors: {
        valueRequired: 'Enter a value.',
        notANumber: 'Enter a number.',
        minimum: 'Enter at least {{min}}.',
        percentRange: 'Enter a percentage from {{min}} to {{max}}.',
        integer: 'Enter a whole number.',
        halfDays: 'Enter days in steps of 0.5.',
        noteTooLong: 'Use at most {{max}} characters.',
        invalidValue: 'This value is not accepted.',
        orderViolated:
          'This value is out of order with a related rule (for example the vice president threshold above the general manager’s). Change the related rule first.',
        versionExists:
          'A change already takes effect at that moment. Pick another date.',
        inEffect: 'This change has already taken effect and is now history.',
      },
      domains: {
        spend: {
          title: 'Spending',
          description:
            'Amount thresholds of the spending ladder and other money approvals.',
        },
        leave: {
          title: 'Leave',
          description: 'Leave lengths that need a department head or HR.',
        },
        attendance: {
          title: 'Attendance',
          description: 'Overtime and attendance correction limits.',
        },
        hr: {
          title: 'HR',
          description: 'Grade tiers and pay rise thresholds.',
        },
        sla: {
          title: 'Approval timing',
          description: 'Reminders and escalations, counted in working hours.',
        },
        committee: {
          title: 'Review committees',
          description: 'Defaults of committee votes.',
        },
        calendar: {
          title: 'Work calendar',
          description: 'Working hours and time zone.',
        },
      },
      units: {
        money: '¥{{value}}',
        count: '{{value}} times',
        integer: '{{value}}',
        days: '{{value}} days',
        hours: '{{value}} hours',
        workingHours: '{{value}} working hours',
        rank: 'Rank {{value}}',
      },
      unitSuffix: {
        money: 'yuan',
        count: 'times',
        integer: '',
        days: 'days',
        hours: 'hours',
        workingHours: 'working hours',
        ratio: '%',
        rank: 'rank',
      },
      keys: {
        leave_annualAccrualEnabled: {
          label: 'Annual leave automatic accrual',
          description:
            '0 disables automatic grants; 1 enables daily accrual. Fill employees’ career start dates before enabling.',
        },
        leave_annualCarryExpiryMonth: {
          label: 'Annual leave carryover expiry month',
          description:
            'Month in the following year when unused annual leave expires (1–12).',
        },
        leave_annualCarryExpiryDay: {
          label: 'Annual leave carryover expiry day',
          description:
            'Last valid day in the expiry month (1–31); shorter months use their last day.',
        },
        spend_vp: {
          label: 'Vice president threshold',
          description: 'Amounts above this need the vice president in charge.',
        },
        spend_gm: {
          label: 'General manager threshold',
          description: 'Amounts above this need the general manager.',
        },
        expense_head: {
          label: 'Expense claims skipping the department head',
          description:
            'A claim totalling up to this amount is approved by the direct manager instead.',
        },
        loan_head: {
          label: 'Loan department head threshold',
          description: 'Loans above this need the department head.',
        },
        loan_personalMax: {
          label: 'Personal loan limit',
          description: 'The most one person may owe at a time.',
        },
        purchase_quotes: {
          label: 'Three quotes required above',
          description: 'Purchases above this need three competing quotes.',
        },
        contract_gm: {
          label: 'Contract general manager threshold',
          description: 'Contracts above this need the general manager.',
        },
        asset_scrapGm: {
          label: 'Asset scrapping threshold',
          description:
            'Scrapping assets of an original value above this needs the general manager.',
        },
        budget_increaseGm: {
          label: 'Budget increase threshold',
          description: 'Budget increases above this need the general manager.',
        },
        leave_head: {
          label: 'Leave needing the department head',
          description:
            'Leave of at least this many days needs the department head.',
        },
        leave_hr: {
          label: 'Leave needing HR',
          description: 'Leave of at least this many days needs HR.',
        },
        overtime_monthlyHead: {
          label: 'Monthly overtime needing the department head',
          description:
            'Overtime above this many hours in a month needs the department head.',
        },
        attendance_fixPerMonth: {
          label: 'Attendance corrections per month',
          description:
            'How many corrections one person may request in a month.',
        },
        grade_managerRank: {
          label: 'Manager grade rank',
          description: 'Grades of at least this rank count as manager level.',
        },
        grade_directorRank: {
          label: 'Director grade rank',
          description: 'Grades of at least this rank count as director level.',
        },
        raise_vp: {
          label: 'Pay rise needing the vice president',
          description: 'Rises above this share need the vice president.',
        },
        raise_gm: {
          label: 'Pay rise needing the general manager',
          description: 'Rises above this share need the general manager.',
        },
        sla_remindHours: {
          label: 'Reminder after',
          description: 'Remind the approver after this much working time.',
        },
        sla_escalateHours: {
          label: 'Escalation after',
          description:
            'Escalate to the approver’s manager after this much working time.',
        },
        sla_urgeCooldownHours: {
          label: 'Nudge cooldown',
          description: 'How long an applicant waits between nudges.',
        },
        committee_min: {
          label: 'Committee passing votes',
          description: 'Default number of approving votes a committee needs.',
        },
        calendar_workHours: {
          label: 'Working hours',
          description: 'The daily working window.',
        },
        calendar_timeZone: {
          label: 'Time zone',
          description: 'The calendar’s time zone.',
        },
      },
    },
    sequences: {
      title: 'Document numbers',
      description:
        'The numbers each document prefix has issued per month. Numbers are issued on submission.',
      loadFailedTitle: 'Could not load the document numbers',
      searchPlaceholder: 'Filter by prefix, such as LV',
      searchLabel: 'Filter by prefix',
      fields: {
        prefix: 'Prefix',
        period: 'Month',
        issued: 'Issued',
        next: 'Next number',
      },
      empty: {
        title: 'No numbers issued yet',
        description: 'Numbers appear here once requests are submitted.',
      },
    },
    auditLogs: {
      title: 'Audit log',
      description:
        'A read-only record of sensitive changes to the organization, people, rules and configuration.',
      loadFailedTitle: 'Could not load the audit log',
      system: 'System',
      notFound: 'This entry does not exist.',
      detailTitle: 'Audit entry: {{action}}',
      detailTitleLoading: 'Audit entry',
      changes: 'What changed',
      noChanges: 'No values were recorded.',
      changed: 'Changed',
      wholeValue: 'Value',
      fields: {
        at: 'Time',
        actor: 'By',
        action: 'Action',
        targetType: 'Object type',
        targetId: 'Object',
        reason: 'Reason',
        field: 'Field',
        before: 'Before',
        after: 'After',
      },
      filters: {
        allTargetTypes: 'All object types',
        allActions: 'All actions',
        actor: 'Anyone',
        dateRange: 'Any date',
        presets: 'Quick range',
      },
      presets: {
        last7: 'Last 7 days',
        last30: 'Last 30 days',
        thisMonth: 'This month',
        lastMonth: 'Last month',
        last90: 'Last 90 days',
      },
      empty: {
        title: 'No audit entries yet',
        description: 'Sensitive changes are recorded here as people make them.',
      },
    },
  },
};

export type PlatformLocale = typeof platformEnUS;

export default platformEnUS;
