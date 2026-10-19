import trialData from './modules/trial-data.zh-CN.js';
import processManagementLocale from './modules/process-management.zh-CN.js';
import attendanceImportZhCN from './modules/attendance-import.zh-CN.js';
import reportsExpenseZhCN from './modules/reports-expense.zh-CN.js';
import reportsEfficiencyZhCN from './modules/reports-efficiency.zh-CN.js';
import onboardingLocale from './modules/onboarding.zh-CN.js';
import sealsLocale from './modules/seals.zh-CN.js';
import recruitmentLocale from './modules/recruitment.zh-CN.js';
import announcementsLocale from './modules/announcements.zh-CN.js';
import workItemsLocale from './modules/work-items.zh-CN.js';
import knowledgeLocale from './modules/knowledge.zh-CN.js';
import transferLocale from './modules/transfer.zh-CN.js';
import attendanceManagementLocale from './modules/attendance-management.zh-CN.js';
import certificatesLocale from './modules/certificates.zh-CN.js';
import accessLocale from './modules/access.zh-CN.js';
import meetingRoomsLocale from './modules/meeting-rooms.zh-CN.js';
import vehiclesLocale from './modules/vehicles.zh-CN.js';
import jobGradesLocale from './modules/job-grades.zh-CN.js';
import templatePrintLocale from './modules/template-print.zh-CN.js';
import headcountsLocale from './modules/headcounts.zh-CN.js';
import contractsLocale from './modules/contracts.zh-CN.js';
import assetRequestsLocale from './modules/asset-requests.zh-CN.js';
import vendorQualificationLocale from './modules/vendor-qualification.zh-CN.js';
import assetLocale from './modules/assets.zh-CN.js';
import departureLocale from './modules/departure.zh-CN.js';
import probationFormCopy from './modules/probation-form.zh-CN.js';
import probationActionsCopy from './modules/probation-actions.zh-CN.js';
import probationLocale from './modules/probation.zh-CN.js';
import paymentFormZhCN from './modules/payment-requests-form.zh-CN.js';
import paymentActionsZhCN from './modules/payment-actions.zh-CN.js';
import reimbursementLocale from './modules/reimbursement.zh-CN.js';
import purchasesLocale from './modules/purchases.zh-CN.js';
import travelZhCN from './modules/travel.zh-CN.js';
import travelCancellationZhCN from './modules/travel-cancellations.zh-CN.js';
import loanRequestsZhCN from './modules/loan-requests.zh-CN.js';
import paymentRequestsZhCN from './modules/payment-requests.zh-CN.js';
import vendorsZhCN from './modules/vendors.zh-CN.js';
import financeAssignmentsZhCN from './modules/finance-assignments.zh-CN.js';
import trainingZhCN from './modules/training.zh-CN.js';
import expensePlansZhCN from './modules/expense-plan.zh-CN.js';
import expenseAuthorizationsZhCN from './modules/expense-authorizations.zh-CN.js';
import suppliesLocale from './modules/supplies.zh-CN.js';
import budgetsZhCN from './modules/budgets.zh-CN.js';
import reportsZhCN from './modules/reports.zh-CN.js';
import budgetAdjustmentsZhCN from './modules/budget-adjustments.zh-CN.js';
import generalLocale from './modules/general.zh-CN.js';
import outingsZhCN from './modules/outings.zh-CN.js';
import attendanceChangeZhCN from './modules/attendance-change.zh-CN.js';
import cancellationsZhCN from './modules/leave-cancellations.zh-CN.js';
import workbenchZhCN from './modules/workbench.zh-CN.js';
import centerZhCN from './modules/approval-center.zh-CN.js';
import overtimeZhCN from './modules/overtime.zh-CN.js';
import leaveBalancesZhCN from './modules/leave-balances.zh-CN.js';
import admin0 from './administration/users/zh-CN.js';
import admin1 from './administration/api-keys/zh-CN.js';
import admin2 from './administration/authorization/zh-CN.js';
import admin3 from './administration/authz-default-access/zh-CN.js';
import admin4 from './administration/authz-sharing-rules/zh-CN.js';
import admin5 from './administration/authz-restriction-rules/zh-CN.js';
import admin7 from './administration/notification/zh-CN.js';
import admin8 from './administration/scheduler/zh-CN.js';
import employeesZhCN from './modules/employees.zh-CN.js';
import importZhCN from './modules/import.zh-CN.js';
import orgZhCN from './modules/org.zh-CN.js';
import platformZhCN from './modules/platform.zh-CN.js';
import approvalsZhCN from './modules/approvals.zh-CN.js';

import system from './system/zh-CN.js';

const zhCN = {
  trialData,
  ...processManagementLocale,
  ...attendanceImportZhCN,
  ...reportsExpenseZhCN,
  reportsEfficiency: reportsEfficiencyZhCN,
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
  'navigation.brandHome': 'NocoOA 首页',
  'auth.welcome': '欢迎回到 OA 工作台',
  'auth.loginDescription':
    '使用用户名或邮箱登录，处理待办、查看进展，开启一天的协作。',
  'auth.about': '关于 OA 协同办公',
  'auth.platform': '连接团队与日常工作',
  'auth.marketingTitleFirst': '让协作更顺畅，',
  'auth.marketingTitleSecond': '让工作更从容。',
  'auth.marketingDescription':
    '从审批待办到员工服务，从知识共享到行政事务，在一个工作台掌握进展，让每一次协作都有清晰的方向。',
  'auth.frontend': '待办有序，进展清晰',
  'auth.frontendDescription':
    '集中处理审批待办，随时查看申请进展，让日常事务有条不紊。',
  'auth.foundation': '服务相伴，协作同行',
  'auth.foundationDescription':
    '连接员工服务、团队知识与行政资源，让办事更便捷，让信息更易触达。',
  'auth.marketingFooter': '从这里，开启井然有序的工作日。',
  departureRequests: departureLocale,
  probationRequests: {
    ...probationLocale.probationRequests,
    ...probationFormCopy,
    ...probationActionsCopy,
  },
  ...reimbursementLocale,
  ...purchasesLocale,
  ...financeAssignmentsZhCN,
  ...vendorsZhCN,
  ...loanRequestsZhCN,
  ...paymentRequestsZhCN,
  ...paymentFormZhCN,
  paymentRequests: {
    ...paymentRequestsZhCN.paymentRequests,
    ...paymentActionsZhCN,
  },
  ...trainingZhCN,
  ...travelZhCN,
  ...travelCancellationZhCN,
  ...expensePlansZhCN,
  ...expenseAuthorizationsZhCN,
  ...budgetsZhCN,
  ...reportsZhCN,
  ...budgetAdjustmentsZhCN,
  ...outingsZhCN,
  ...attendanceChangeZhCN,
  ...cancellationsZhCN,
  ...centerZhCN,
  ...workbenchZhCN,
  ...generalLocale,
  ...suppliesLocale,
  ...overtimeZhCN,
  navigation: { ...system.navigation, home: workbenchZhCN.workbench.title },
  ...leaveBalancesZhCN,
  actions: {
    ...system.actions,
    close: '关闭',
    save: '保存',
    cancel: '取消',
    confirm: '确认',
    language: '语言',
    create: '创建',
    saving: '保存中…',
    discard: '放弃更改',
    signInAgain: '重新登录',
  },
  'status.sessionExpired': '会话已结束，请重新登录后继续。',
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
  ...employeesZhCN,
  ...importZhCN,
  ...orgZhCN,
  ...platformZhCN,
  ...approvalsZhCN,
  oa: {
    navigation: {
      office: '日常办公',
      finance: '财务与费用',
      procurement: '采购与合同',
      administration: '行政与资产',

      organization: '组织与人事',
      configuration: '业务配置',
      system: '系统管理',
      inbox: '消息',
      automation: '自动化',
      agents: '智能体',
      runtimes: '智能体运行环境',
      skills: '智能体技能',
      models: '模型服务',
      agentUsage: '智能体用量',
      users: '用户账号',
      permissionSets: '权限集',
      defaultAccess: '默认访问',
      sharingRules: '共享规则',
      restrictionRules: '限制规则',
      inspector: '权限检查',
      apiKeys: 'API 密钥',
      notificationLogs: '通知日志',
      schedules: '计划任务',
      access: '权限管理',
    },
  },
  userPicker: {
    placeholder: '按姓名、用户名或邮箱搜索',
    multiplePlaceholder: '添加人员',
    empty: '没有匹配的用户',
    searching: '搜索中…',
    forbidden: '你没有查询用户的权限。',
    loadFailed: '无法加载用户。',
    remove: '移除 {{name}}',
  },
  tableScroll: {
    region: '表格横向滚动区域',
    hint: '左右滑动查看完整表格',
    left: '向左滚动表格',
    right: '向右滚动表格',
  },
  datePicker: {
    placeholder: '选择日期',
    rangePlaceholder: '选择日期范围',
  },
};
export default zhCN;
