export default {
  overtime: {
    businessErrors: {
      OVERTIME_INVALID_DATE: '请选择有效的加班日期。',
    },

    authz: { resource: '加班申请' },
    navigation: '加班申请',
    description: '申请加班，查看审批进度和结算方式。',
    new: '新建加班申请',
    edit: '编辑加班申请',
    date: '加班日期',
    minutes: '时长（分钟）',
    monthlyMinutes: '当月累计（分钟）',
    settlement: '结算方式',
    compensatory: '调休',
    pay: '加班费',
    durationInvalid: '请输入 1 至 1,440 之间的整数分钟数。',
    formDescription: '填写并核对申请后直接提交，也可保存为草稿。',
    policyHint:
      '同日不可重复申请。超期申请增加 HR 审核，调休在最终通过后结算。',
    emptyDescription: '新建加班草稿，核对后提交审批。',
    uncertainCreate:
      '保存结果尚未确认。请关闭表单，先在“我发起的”核实是否已有草稿，避免重复申请。',
    duplicate: '该日期已有在途或已通过的加班申请。',
    inactive: '申请人须为在职员工。',
    configuration: '当前加班审批时钟配置不受支持，请联系管理员。',
    invalid: '请检查加班日期、时长、结算方式及事由。',
    schemaUnavailable: '加班数据结构尚未更新，暂时无法完成操作。请联系管理员。',
  },
};
