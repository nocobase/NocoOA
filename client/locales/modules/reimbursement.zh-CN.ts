import actionCopy from './reimbursement-actions.zh-CN.js';
import formCopy from './reimbursement-forms.zh-CN.js';
export default {
  reimbursementRequests: {
    businessErrors: {
      REIMBURSEMENT_INVALID_LINE_AMOUNT:
        '每条报销明细金额须大于零且在支持范围内。',
      REIMBURSEMENT_INVALID_LINE_DATE: '请为每条报销明细选择有效的费用日期。',
      REIMBURSEMENT_VOUCHER_REQUIRED: '请填写付款凭证号后再确认付款。',
      REIMBURSEMENT_PAYMENT_CONFIRMATION_REQUIRED:
        '请填写强制付款原因，并准确确认报销总额、借款冲抵额及实付金额。',
      REIMBURSEMENT_HANDLING_REASON_REQUIRED: '请填写无法完成付款的原因。',
      REIMBURSEMENT_PAYMENT_ACCOUNT_STALE:
        '收款账户已变化，请读取最新账户后再更正。',
      REIMBURSEMENT_AUTHORIZATION_CHANGED:
        '前置审批额度已变化，请刷新来源单据并核对报销总额。',
      REIMBURSEMENT_INVOICES_CHANGED:
        '发票凭据已变化，请刷新申请并重新选择可用发票。',
      REIMBURSEMENT_LOAN_CHANGED:
        '借款冲抵信息已变化，请刷新借款并确认冲抵金额。',
      REIMBURSEMENT_TOTAL_TOO_LARGE:
        '报销合计超过支持范围，请减少金额或拆分申请。',
      REIMBURSEMENT_FILE_SIZE: '请选择非空且不超过 5 MiB 的附件。',
      REIMBURSEMENT_FILE_TYPE:
        '请上传格式与扩展名一致的 PDF、JPEG、PNG 或 WebP 文件。',
    },

    ...formCopy,
    ...actionCopy,
    title: '费用报销',
    description: '核对费用证据，跟踪逐行审批与付款办理。',
    new: '新建报销',
    edit: '编辑报销',
    details: '查看详情',
    number: '编号',
    reason: '事由',
    gross: '报销总额',
    offset: '借款冲抵',
    net: '实付现金',
    search: '搜索编号、事由或申请人',
    view: '单据视图',
    allStatuses: '全部状态',
    refresh: '刷新报销',
    clearFilters: '清除筛选',
    emptyTitle: '暂无报销',
    emptyDescription: '创建草稿后添加费用明细与证据。',
    noResults: '没有匹配的报销，请调整筛选。',
    rowActions: '{{name}}的操作',
    views: {
      mine: '我的',
      pending: '待办',
      done: '已办',
      copied: '抄送',
    },
    statuses: {
      draft: '草稿',
      revision: '待修订',
      manager: '经理审批',
      head: '负责人审批',
      finance: '财务核对',
      executive: '副总审批',
      gm: '总经理审批',
      cashier: '出纳办理',
      exception: '办理异常',
      paid: '已付款',
      forcedPaid: '管理员记录已结算',
      rejected: '已驳回',
      withdrawn: '已撤回',
      terminated: '已终止',
    },
    errors: {
      invoiceDuplicate: '同一报销内发票号码不能重复，请核对各条明细。',
      overrunReasonRequired:
        '关联授权的累计报销超过已批额度 20%，请填写超支说明。',
      invoiceUnavailable:
        '发票已被其他报销占用或使用，请核对发票号码及所属单据。',
      paymentAccountRequired:
        '员工档案中的收款账户不完整，请联系 HR 补齐开户行、银行账号和账户户名后再提交。',
      employeeInactive: '申请人需要有效的在职员工档案，请联系 HR 核对。',
      departmentRequired:
        '申请人尚未设置有效主部门，请联系 HR 或组织管理员补齐。',
      categoryInvalid: '明细中的费用类别已停用或不可用，请重新选择费用类别。',
      sourceInvalid:
        '关联费用授权已失效、尚未批准或不属于申请人，请重新核对关联单据。',
      sourceRebind: '提交过的报销不能更换关联费用授权或借款，请保留原关联。',
      loanRequired:
        '填写了借款抵扣额，请选择对应借款；不抵扣借款时请将抵扣额填为 0。',
      loanInvalid: '所选借款不可用或不属于申请人，请重新选择。',
      loanInsufficient: '借款可抵扣余额不足，请降低抵扣额并重新核对余额。',
      invalidOffset: '借款抵扣额不能超过报销合计，请核对金额。',
      attachmentInvalid:
        '部分证据不属于当前报销或已不可用，请重新选择或上传证据。',
      slaConfiguration: '当前审批时限配置不受支持，请联系流程管理员核对。',
      inputInvalid: '请填写报销事由，并添加完整、互不重复的费用明细和证据。',
      configuration: '报销数据结构不完整，请联系系统管理员修复后重试。',
      forbidden: '无权访问这笔报销。',
      notFound: '这笔报销已不存在。',
      conflict: '这笔报销有更新，请重新读取并复核后操作。',
      standardReason: '请逐行说明当日超出已批准标准的费用。',
      standardCategoryChanged:
        '此分类不在原标准快照中，请新建申请采用当前政策。',
      standardConfiguration: '已批准差旅标准不完整，请联系管理员核对配置。',
      invalid: '请核对报销内容及所需证据。',
      failed: '请求未完成，请重试。',
    },
    standard: {
      title: '冻结费用政策',
      unsubmitted: '首次提交时冻结费用政策。',
      frozenHint:
        '修订沿用此处已保存的分类和已批准出差标准；每日费用按标准种类汇总。',
      gradeCode: '出差职级',
      gradeRank: '职级级别',
      lodging: '每晚住宿标准（元）',
      allowance: '每日补贴标准（元）',
      notApplicable: '本单不适用已批准出差标准。',
      kinds: {
        none: '不按差旅每日标准核对',
        lodging: '住宿每日标准',
        allowance: '补贴每日标准',
      },
    },
    detail: {
      lines: '费用明细',
      failure: '办理失败原因',
      voucher: '付款凭证号',
      forcedReason: '管理员结算原因',
      noLines: '尚未添加费用明细。',
      line: '费用明细 {{number}}',
      financeResult: '财务核对结果',
      lineStates: {
        approved: '已通过',
        returned: '退回修正',
        pending: '待核对',
      },
    },
    bank: {
      title: '私有收款账户',
      bankName: '开户行',
      bankAccount: '银行账号',
      bankAccountName: '账户姓名',
      missing: '未存收款账户。',
      correct: '修正收款账户',
      saved: '已修正收款账户',
      denied: '无权读取收款账户。',
      unavailable: '暂不能修正账户，请重新读取报销并检查已保存的账户。',
    },
    authz: {
      resource: '费用报销',
      submit: '创建和提交本人报销',
      delegate: '代理员工创建报销',
      view: '查看报销',
      paymentAccount: '读取和修正获授权的收款账户',
    },
  },
};
