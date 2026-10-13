export default {
  training: {
    businessErrors: {
      TRAINING_INVALID_INPUT:
        '请补齐培训名称、培训机构和申请原因，并输入有效的非负费用。',
      TRAINING_INVALID_DATE:
        '培训结束时间须晚于开始时间，请检查起止日期和时间。',
      TRAINING_DEPARTMENT_REQUIRED:
        '申请人没有有效主部门，请联系人力资源完善员工档案。',
    },

    cc: '追加抄送',
    authz: {
      resource: '培训与外出学习',
      submit: '发起培训申请',
      delegate: '代员工发起培训',
      view: '查看培训申请',
    },
    new: '新建培训申请',
    edit: '编辑培训申请',
    formDescription: '申请培训或外出学习。',
    name: '培训名称',
    institution: '培训机构',
    startAt: '开始时间',
    endAt: '结束时间',
    usesWorkingTime: '占用工作时间',
    amount: '费用（元）',
    yuan: '元',
    yes: '是',
    no: '否',
    timeZone: '公司时区：{{zone}}',
    amountHint: '以元填写，最多两位小数，费用可为零。',
    amountInvalid: '请输入非负金额，最多两位小数。',
    dateInvalid: '请选择有效时段，结束时间须晚于开始时间。',
    approvalHint:
      '通过后，占用工作时间的培训会记录考勤；收费培训生成已批报销额度，尚未发生付款。',
    approvedFacts: '培训已批准，并抄送 HR。',
    attendanceRecorded: '已记录培训考勤活动。',
    authorizationIssued: '已批报销额度：{{amount}} 元。报销遵循额度规则。',
    zeroNoAuthorization: '免费培训不生成费用额度。',
    uncertainCreate: '保存结果未知，请先到“我的申请”查询，再决定是否新建。',
    inactive: '申请人须有有效在职员工档案。',
    configuration: '当前审批时钟配置不受支持。',
    invalid: '请检查申请字段，必要时重新加载最新记录。',
    stages: {
      manager: '直属上级',
      head: '部门负责人',
      finance: '财务',
      executive: '分管副总',
      gm: '总经理',
    },
  },
};
