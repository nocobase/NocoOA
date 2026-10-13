export default {
  budgetAdjustments: {
    businessErrors: {
      BUDGET_ADJUSTMENT_INVALID_ACCOUNT: '请选择有效部门和预算年度。',
      BUDGET_ADJUSTMENT_INVALID_AMOUNT:
        '请填写调整原因并输入大于零的调整金额。',
      BUDGET_ADJUSTMENT_INVALID_SUBJECT: '请选择已启用的预算科目。',
      BUDGET_ADJUSTMENT_INVALID_TRANSFER:
        '调拨须选择不同的来源和目标科目；追加预算须清空来源科目。',
      BUDGET_ADJUSTMENT_INACTIVE_HEAD:
        '部门负责人已失效，请联系管理员维护部门负责人。',
    },

    authz: {
      resource: '预算调整',
      submit: '提交预算调整',
      delegate: '代员工提交预算调整',
      view: '查看预算调整',
    },
    new: '新建预算调整',
    edit: '编辑预算调整',
    formDescription: '提出科目间调拨或追加预算申请。',
    department: '预算部门',
    yearInvalid: '请输入1900至9999之间的整数年度。',
    year: '预算年度',
    type: '调整类型',
    transfer: '科目间调拨',
    increase: '追加预算',
    targetSubject: '目标科目',
    sourceSubject: '来源科目',
    amount: '金额（元）',
    yuan: '元',
    reason: '原因',
    amountInvalid: '请输入大于零、最多两位小数且不超安全范围的金额。',
    sourceInvalid: '来源科目和目标科目必须不同。',
    amountHint: '以元输入十进制金额，系统按整数分精确保存。',
    reserveHint: '调拨提交时预占来源资金，最终审批通过才生效。',
    revisionHold:
      '退回期间原预占仍保留，修订提议仅在重新提交时释放旧预占并建立新预占。',
    retainedHold:
      '当前原预占：{{subject}} · {{amount}} 元，与本次修订提议分别展示。',
    actualHold: '当前来源实际预占',
    frozenThreshold:
      '提交时追加预算总经理阈值：{{amount}} 元（仅严格超过时追加审批）。',
    applied: '最终审批已通过，本预算调整已生效。',
    reserved: '来源资金已预占，预算调整尚未生效。',
    awaitingEffect: '本提议尚未生效，追加预算仅在最终审批通过后生效。',
    insufficient: '来源预算可用资金不足，请核对金额与来源科目，已保留输入。',
    subjectInactive: '此科目已停用，请在提交前改选启用科目。',
    disabled: '已停用',
    inactive: '申请人必须为在职员工。',
    configuration: '当前审批时钟配置不受支持，请联系管理员。',
    invalid: '请核对预算账户、调整类型、金额和原因。',
    uncertainCreate:
      '保存结果不确定，请关闭并先查看我的申请，避免重复创建草稿。',
    stages: {
      head: '部门负责人',
      finance: '财务经理',
      cfo: '财务总监',
      gm: '总经理',
    },
  },
};
