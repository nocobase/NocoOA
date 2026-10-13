import type { LocaleResource } from '@nocobase/i18n';
import type en from './payment-requests.en-US.js';
const zh: LocaleResource<typeof en> = {
  paymentRequests: {
    businessErrors: {
      PAYMENT_REQUEST_INVALID_INPUT:
        '请补齐付款原因、收款方、正数金额、发票号及发票附件。',
      PAYMENT_REQUEST_ACCOUNT_REQUIRED:
        '请先补齐收款方的银行账户信息，再提交审批。',
      PAYMENT_REQUEST_ACCOUNT_STALE: '收款账户已变化，请读取最新账户后再更正。',
      PAYMENT_REQUEST_DEPARTMENT_REQUIRED:
        '申请人没有有效主部门，请联系人力资源完善员工档案。',
      PAYMENT_REQUEST_METHOD_INVALID: '请选择已启用的付款方式。',
      PAYMENT_REQUEST_SOURCE_REQUIRED:
        '无前置审批付款须填写说明，并取消关联采购订单。',
      PAYMENT_REQUEST_SOURCE_INVALID:
        '请选择有效的采购订单或合同，并使用原单据的收款方。',
      PAYMENT_REQUEST_SOURCE_STALE:
        '来源单据已变化，请刷新付款单及来源单据后再操作。',
      PAYMENT_REQUEST_CONTRACT_STALE:
        '合同已变化，请刷新合同版本并修订付款申请后重新提交。',
      PAYMENT_REQUEST_VOUCHER_REQUIRED:
        '请填写付款凭证号，并上传或选择付款凭证附件。',
      PAYMENT_REQUEST_FORCE_CONFIRMATION_REQUIRED:
        '强制完成付款前，请准确确认已批准的付款金额。',
      PAYMENT_REQUEST_HANDLING_REASON_REQUIRED: '请填写无法完成付款的原因。',
      PAYMENT_REQUEST_ALREADY_PAID: '该付款已结算，请刷新查看已登记的结果。',
      PAYMENT_REQUEST_CONTRACT_ACTUAL_PAYMENT_REQUIRED:
        '请先登记合同的实际付款事实，再完成此操作。',
      PAYMENT_FILE_SIZE: '请选择非空且不超过 5 MiB 的附件。',
      PAYMENT_FILE_TYPE:
        '请上传格式与扩展名一致的 PDF、JPEG、PNG 或 WebP 文件。',
      PAYMENT_ATTACHMENT_INVALID: '请选择上传到本付款申请的有效附件。',
    },

    title: '付款申请',
    description: '查看付款申请、冻结的来源事实与出纳办理进度。',
    new: '新建付款申请',
    edit: '编辑',
    details: '查看详情',
    number: '单号',
    reason: '付款事由',
    vendor: '收款方',
    amount: '付款金额（元）',
    search: '搜索单号、事由、申请人或收款方',
    view: '记录范围',
    allStatuses: '全部状态',
    refresh: '刷新',
    clearFilters: '清除筛选',
    emptyTitle: '尚无付款申请',
    emptyDescription: '新建草稿，申请付款并补充发票凭据。',
    noResults: '无匹配记录，请清除或调整筛选。',
    rowActions: '“{{name}}”的操作',
    yes: '是',
    no: '否',
    frozenHint: '来源、收款方、金额和发票在提交时冻结。',
    sourceModes: { contract: '合同', purchase: '采购订单', none: '无前置审批' },
    views: {
      mine: '我的申请',
      pending: '待我处理',
      done: '我已处理',
      copied: '抄送给我',
    },
    statuses: {
      draft: '草稿',
      revision: '待修改',
      head: '部门负责人审批',
      finance: '财务核对',
      executive: '分管副总审批',
      gm: '总经理审批',
      cashier: '出纳办理',
      exception: '办理异常',
      paid: '已付款',
      forcedPaid: '已记录强制付款',
      rejected: '已拒绝',
      withdrawn: '已撤回',
      terminated: '已终止',
    },
    errors: {
      forbidden: '无权限查看，请联系管理员检查权限。',
      notFound: '记录不存在或已无法查看，请返回来源页面。',
      conflict: '付款申请已变化，请读取最新记录后再操作。',
      invalid: '请检查付款内容与必需凭据。',
      failed: '请求未能完成，请重试。',
    },
    detail: {
      creator: '经办人',
      sourceMode: '付款来源',
      order: '采购订单',
      noPriorReason: '无前置审批说明',
      invoice: '发票号码',
      method: '付款方式',
      failure: '办理失败原因',
      voucher: '付款凭证号',
      forcedReason: '强制付款原因',
      paidAt: '付款时间',
      sourceFacts: '冻结的来源事实',
      cumulativeHint:
        '提交时累计付款含在途付款；本单当前占用单独展示，不可再次相加。付款不代表已到货或已验收。',
      sourceApproved: '订单批准金额（元）',
      sourceCumulative: '提交时累计付款（元）',
      sourceHeld: '本单当前来源占用（元）',
      fullApproval: '需完整审批',
      attachments: '发票凭据',
      voucherAttachments: '付款凭据',
      notSubmitted: '提交时冻结规则。',
    },
    rules: {
      spend_vp: '分管副总金额阈值（元）',
      spend_gm: '总经理金额阈值（元）',
      sla_remindHours: '提醒工作小时',
      sla_escalateHours: '升级工作小时',
      sla_urgeCooldownHours: '催办冷却小时',
    },
    authz: {
      voucherEvidence: '上传付款凭据',
      ownScope: '本人申请或经办的付款',
      resource: '付款申请',
      view: '查看付款申请',
      submit: '创建并提交本人付款申请',
      delegate: '代理员工创建付款申请',
      paymentAccount: '查看与更正授权的收款账户',
    },
  },
};
export default zh;
