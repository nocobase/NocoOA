import trialData from './modules/trial-data.en-US.js';
import processManagementLocale from './modules/process-management.en-US.js';
import attendanceImportEnUS from './modules/attendance-import.en-US.js';
import reportsExpenseEnUS from './modules/reports-expense.en-US.js';
import reportsEfficiencyEnUS from './modules/reports-efficiency.en-US.js';
import onboardingLocale from './modules/onboarding.en-US.js';
import sealsLocale from './modules/seals.en-US.js';
import recruitmentLocale from './modules/recruitment.en-US.js';
import announcementsLocale from './modules/announcements.en-US.js';
import workItemsLocale from './modules/work-items.en-US.js';
import knowledgeLocale from './modules/knowledge.en-US.js';
import transferLocale from './modules/transfer.en-US.js';
import attendanceManagementLocale from './modules/attendance-management.en-US.js';
import certificatesLocale from './modules/certificates.en-US.js';
import accessLocale from './modules/access.en-US.js';
import meetingRoomsLocale from './modules/meeting-rooms.en-US.js';
import vehiclesLocale from './modules/vehicles.en-US.js';
import jobGradesLocale from './modules/job-grades.en-US.js';
import templatePrintLocale from './modules/template-print.en-US.js';
import headcountsLocale from './modules/headcounts.en-US.js';
import contractsLocale from './modules/contracts.en-US.js';
import assetRequestsLocale from './modules/asset-requests.en-US.js';
import vendorQualificationLocale from './modules/vendor-qualification.en-US.js';
import assetLocale from './modules/assets.en-US.js';
import departureLocale from './modules/departure.en-US.js';
import probationFormCopy from './modules/probation-form.en-US.js';
import probationActionsCopy from './modules/probation-actions.en-US.js';
import probationLocale from './modules/probation.en-US.js';
import paymentFormEnUS from './modules/payment-requests-form.en-US.js';
import paymentActionsEnUS from './modules/payment-actions.en-US.js';
import reimbursementLocale from './modules/reimbursement.en-US.js';
import purchasesLocale from './modules/purchases.en-US.js';
import travelEnUS from './modules/travel.en-US.js';
import travelCancellationEnUS from './modules/travel-cancellations.en-US.js';
import loanRequestsEnUS from './modules/loan-requests.en-US.js';
import paymentRequestsEnUS from './modules/payment-requests.en-US.js';
import vendorsEnUS from './modules/vendors.en-US.js';
import financeAssignmentsEnUS from './modules/finance-assignments.en-US.js';
import trainingEnUS from './modules/training.en-US.js';
import expensePlansEnUS from './modules/expense-plan.en-US.js';
import expenseAuthorizationsEnUS from './modules/expense-authorizations.en-US.js';
import suppliesLocale from './modules/supplies.en-US.js';
import budgetsEnUS from './modules/budgets.en-US.js';
import reportsEnUS from './modules/reports.en-US.js';
import budgetAdjustmentsEnUS from './modules/budget-adjustments.en-US.js';
import generalLocale from './modules/general.en-US.js';
import outingsEnUS from './modules/outings.en-US.js';
import attendanceChangeEnUS from './modules/attendance-change.en-US.js';
import cancellationsEnUS from './modules/leave-cancellations.en-US.js';
import workbenchEnUS from './modules/workbench.en-US.js';
import centerEnUS from './modules/approval-center.en-US.js';
import overtimeEnUS from './modules/overtime.en-US.js';
import leaveBalancesEnUS from './modules/leave-balances.en-US.js';
import admin0 from './administration/users/en-US.js';
import admin1 from './administration/api-keys/en-US.js';
import admin2 from './administration/authorization/en-US.js';
import admin3 from './administration/authz-default-access/en-US.js';
import admin4 from './administration/authz-sharing-rules/en-US.js';
import admin5 from './administration/authz-restriction-rules/en-US.js';
import admin7 from './administration/notification/en-US.js';
import admin8 from './administration/scheduler/en-US.js';
import type { LocaleResource } from '@nocobase/i18n';
import employeesEnUS from './modules/employees.en-US.js';
import importEnUS from './modules/import.en-US.js';
import orgEnUS from './modules/org.en-US.js';
import platformEnUS from './modules/platform.en-US.js';
import approvalsEnUS from './modules/approvals.en-US.js';

import system from './system/en-US.js';

const enUS = {
  trialData,
  ...processManagementLocale,
  ...attendanceImportEnUS,
  ...reportsExpenseEnUS,
  reportsEfficiency: reportsEfficiencyEnUS,
  ...sealsLocale,
  ...recruitmentLocale,
  ...onboardingLocale,
  ...announcementsLocale,
  transfer: transferLocale,
  ...attendanceManagementLocale,
  ...certificatesLocale,
  ...knowledgeLocale,
  ...workItemsLocale,
  ...accessLocale,
  ...meetingRoomsLocale,
  ...vehiclesLocale,
  ...templatePrintLocale,
  ...jobGradesLocale,
  ...headcountsLocale,
  ...contractsLocale,
  assetRequests: assetRequestsLocale,
  ...vendorQualificationLocale,
  assets: assetLocale,
  ...system,
  // Application-owned OA copy overrides the template authentication branding.
  'auth.brandName': 'NocoOA',
  'navigation.brandHome': 'NocoOA home',
  'auth.welcome': 'Welcome back to your OA workspace',
  'auth.loginDescription':
    'Sign in with your username or email to manage tasks and stay connected with your team.',
  'auth.about': 'About the OA workspace',
  'auth.platform': 'Your everyday workspace',
  'auth.marketingTitleFirst': 'Work together.',
  'auth.marketingTitleSecond': 'Work with ease.',
  'auth.marketingDescription':
    'Bring approvals, employee services and team information together, so you can keep track of requests and focus on the work that matters.',
  'auth.frontend': 'Tasks within reach',
  'auth.frontendDescription':
    'Handle pending approvals and follow your requests from one workspace.',
  'auth.foundation': 'Connected teams',
  'auth.foundationDescription':
    'Find employee services, shared knowledge and administrative resources in one place.',
  'auth.marketingFooter': 'A clear start to every working day.',
  departureRequests: departureLocale,
  probationRequests: {
    ...probationLocale.probationRequests,
    ...probationFormCopy,
    ...probationActionsCopy,
  },
  ...reimbursementLocale,
  ...purchasesLocale,
  ...financeAssignmentsEnUS,
  ...vendorsEnUS,
  ...loanRequestsEnUS,
  ...paymentRequestsEnUS,
  ...paymentFormEnUS,
  paymentRequests: {
    ...paymentRequestsEnUS.paymentRequests,
    ...paymentActionsEnUS,
  },
  ...trainingEnUS,
  ...travelEnUS,
  ...travelCancellationEnUS,
  ...expensePlansEnUS,
  ...expenseAuthorizationsEnUS,
  ...budgetsEnUS,
  ...reportsEnUS,
  ...budgetAdjustmentsEnUS,
  ...outingsEnUS,
  ...attendanceChangeEnUS,
  ...cancellationsEnUS,
  ...centerEnUS,
  ...workbenchEnUS,
  ...generalLocale,
  ...suppliesLocale,
  ...overtimeEnUS,
  navigation: { ...system.navigation, home: workbenchEnUS.workbench.title },
  ...leaveBalancesEnUS,
  actions: {
    ...system.actions,
    close: 'Close',
    save: 'Save',
    cancel: 'Cancel',
    confirm: 'Confirm',
    language: 'Language',
    create: 'Create',
    saving: 'Saving…',
    discard: 'Discard changes',
    signInAgain: 'Sign in again',
  },
  'status.sessionExpired': 'Your session has ended. Sign in again to continue.',
  overrides: {
    '@nocobase/app-plugin-users': admin0,
    '@nocobase/app-plugin-api-keys': admin1,
    '@nocobase/app-plugin-authorization': admin2,
    '@nocobase/app-plugin-authz-default-access': admin3,
    '@nocobase/app-plugin-authz-sharing-rules': admin4,
    '@nocobase/app-plugin-authz-restriction-rules': admin5,
    '@nocobase/app-plugin-notification': admin7,
    '@nocobase/app-plugin-scheduler': admin8,
  },
  ...employeesEnUS,
  ...importEnUS,
  ...orgEnUS,
  ...platformEnUS,
  ...approvalsEnUS,
  oa: {
    navigation: {
      office: 'Daily office',
      finance: 'Finance & expenses',
      procurement: 'Procurement & contracts',
      administration: 'Administration & assets',

      organization: 'Organization & HR',
      configuration: 'Business configuration',
      system: 'System administration',
      inbox: 'Messages',
      automation: 'Automation',
      agents: 'Agents',
      runtimes: 'Agent runtimes',
      skills: 'Agent skills',
      models: 'Model services',
      agentUsage: 'Agent usage',
      users: 'User accounts',
      permissionSets: 'Permission sets',
      defaultAccess: 'Default access',
      sharingRules: 'Sharing rules',
      restrictionRules: 'Restriction rules',
      inspector: 'Permission inspector',
      apiKeys: 'API keys',
      notificationLogs: 'Notification logs',
      schedules: 'Scheduled tasks',
      access: 'Access control',
    },
  },
  userPicker: {
    placeholder: 'Search by name, username or email',
    multiplePlaceholder: 'Add people',
    empty: 'No matching users',
    searching: 'Searching…',
    forbidden: 'You do not have permission to look up users.',
    loadFailed: 'Unable to load users.',
    remove: 'Remove {{name}}',
  },
  tableScroll: {
    region: 'Horizontal table scroll area',
    hint: 'Scroll to see all columns',
    left: 'Scroll table left',
    right: 'Scroll table right',
  },
  datePicker: {
    placeholder: 'Pick a date',
    rangePlaceholder: 'Pick a date range',
  },
};
export type AppResource = LocaleResource<typeof enUS>;
export default enUS;
