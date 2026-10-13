export default {
  travelCancellation: {
    businessErrors: {
      TRAVEL_CANCELLATION_REASON_REQUIRED: '请填写取消出差的原因。',
      TRAVEL_CANCELLATION_ALREADY_PENDING:
        '该出差已有待审批的取消申请，请查看现有申请。',
      TRAVEL_CANCELLATION_BASELINE_CHANGED:
        '原出差单已变化，请刷新并修订取消申请后再提交。',
      TRAVEL_CANCELLATION_INVALID_SOURCE:
        '原出差单已不可取消，请重新选择有效的已批准出差单。',
    },

    retryUnbooking: '重新安排退订',
    bookingInformation: '退订订单与退款安排',
    unbookingHint:
      '部门负责人确认后原出差已撤销。行政需记录退订与退款安排；此记录不表示退款资金已实际到账。',
    complete: '完成退订',
    unable: '无法退订',
    forceComplete: '强制关闭退订',
    source: '原出差申请',
    chooseSource: '选择已批准出差',
    effectHint:
      '取消申请由原部门负责人确认后才撤销考勤和报销额度；关联借款按实际放款状态终止申请或建立补充归还期限。',
    cc: '追加抄送',
    authz: {
      resource: '出差取消',
      submit: '发起出差取消申请',
      delegate: '代员工发起出差取消',
      view: '查看出差取消申请',
    },
    new: '新建出差取消申请',
    edit: '编辑出差取消申请',
    formDescription: '申请取消已批准的出差。',
    name: '出差取消名称',
    institution: '出差取消机构',
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
      '通过后，占用工作时间的出差取消会记录考勤；收费出差取消生成已批报销额度，尚未发生付款。',
    approvedFacts: '出差取消已批准，并抄送 HR。',
    attendanceRecorded: '已记录出差取消考勤活动。',
    authorizationIssued: '已批报销额度：{{amount}} 元。报销遵循额度规则。',
    zeroNoAuthorization: '免费出差取消不生成费用额度。',
    uncertainCreate: '保存结果未知，请先到“我的申请”查询，再决定是否新建。',
    inactive: '申请人须有有效在职员工档案。',
    configuration: '当前审批时钟配置不受支持。',
    invalid: '请检查申请字段，必要时重新加载最新记录。',
    stages: {
      unbooking: '行政退订处理',
      manager: '直属上级',
      head: '部门负责人',
      finance: '财务',
      executive: '分管副总',
      gm: '总经理',
    },
  },
};
