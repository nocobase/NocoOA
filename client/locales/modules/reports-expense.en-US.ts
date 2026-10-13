export default {
  reportsExpense: {
    firstPage: 'Go to first page',

    pageEmpty: 'No expense groups on this page',
    pageEmptyHint:
      'The current source has fewer groups. Go to the first page, or use Previous to return to an available page.',

    exportStarted: 'Excel download started',
    reloading:
      'Refreshing… The previous result remains visible until the current filters finish loading.',
    exportLock:
      'Exporting… Filters and navigation are locked until the download finishes.',

    title: 'Settled expenses by month',
    description:
      'Settled gross expenses by original expense date and category; this is not net cash paid.',
    month: 'Expense month (1–12, optional)',
    effectiveYear: 'Company-calendar year: {{year}}',
    sourceNotice:
      'Up to 10,000 authorized settled requests can be checked. Changing the year or month does not reduce this source scan.',
    precondition:
      'Settlement evidence could not be verified or a report limit was exceeded. Ask an administrator to check the source evidence and report size.',
    forbidden:
      'You do not have access to the current reimbursement source. Contact an administrator to check source permissions.',
    empty: 'No settled expenses in this year yet',
    emptyHint:
      'Only authorized requests with verified settlement evidence are included. Check the year and month, or ask an administrator to check source access.',
    fields: {
      year: 'Year',
      month: 'Expense month',
      category: 'Category code',
      settledRequestCount: 'Settled requests',
      settledExpenseCents: 'Settled gross expense (CNY, not cash)',
    },
  },
};
