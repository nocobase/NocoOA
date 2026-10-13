export default {
  flowDiagram: {
    empty: '没有可显示的阶段',
    loading: '正在自动布局流程图…',
    failed: '流程图布局失败，请查看流程规则',
    nodeHelp: '流程阶段，可通过平移和缩放查看',
    edgeHelp: '流程转移',
  },
  processManagement: {
    nodeSettings: {
      edit: '编辑参数',
      editNamed: '编辑{{name}}的参数',
      title: '编辑{{name}}的参数',
      parameter: '配置项',
      effect:
        '修改不覆盖申请已保存的快照或已有任务。新提交按生效配置读取，重提沿用各流程既有规则。',
      shared: '这是共享配置，同时影响：{{flows}}。',
      unavailable: '此节点没有可编辑的参数，请关闭弹窗并选择有配置入口的节点。',
      forbidden: '你没有修改此节点配置的权限。',
      newCommittee: '发布新的委员会结构',
      seat: '版本 {{version}} · {{name}} 席位人员',
      committeeContext:
        '当前节点版本：{{selected}}；运行中版本：{{active}}；最新保存版本：{{latest}}。',
    },
    conditionMissing: '此分支尚缺条件说明，请核对源业务规则',
    snapshotConditions:
      '金额、天数和职级门槛以申请提交时冻结的规则为准；本定义图说明判断方式，不代替历史申请的规则快照。',
    branchConditions: {
      travelCancellation_unbooking: '原出差申请需要预订，取消时需办理退订',
      travelCancellation_approved: '原出差申请不需要预订，无须办理退订',
      reimbursement_managerApproved_head:
        '报销总金额 > 提交快照中的部门负责人门槛，且未通过主管与部门负责人同人审批合并校验',
      reimbursement_managerApproved_finance:
        '报销总金额未超过部门负责人门槛，或已通过主管与部门负责人同人审批合并校验',

      training_managerApproved_head:
        '培训金额 > 0，且未满足主管与部门负责人同人审批合并条件',
      training_managerApproved_finance:
        '培训金额 > 0，主管与部门负责人同一人，且本轮同意任务满足合并校验',
      training_managerApproved_approved: '培训金额为0',

      travel_managerApproved_head: '未满足主管与部门负责人合并条件',
      travel_managerApproved_finance:
        '主管与部门负责人同一人，且本轮同意任务满足合并校验',
      probation_managerApproved_head: '未满足主管与部门负责人合并条件',
      probation_managerApproved_hr:
        '主管与部门负责人同一人，且本轮同意任务满足合并校验',
      departure_managerApproved_head: '未满足主管与部门负责人合并条件',
      departure_managerApproved_hr:
        '主管与部门负责人同一人，且本轮同意任务满足合并校验',
      expensePlan_financeApproved_executive:
        '申请金额 > 提交快照中的分管副总金额门槛',
      expensePlan_financeApproved_gm:
        '不需要分管副总审批，且申请金额 > 提交快照中的总经理金额门槛',
      expensePlan_financeApproved_approved:
        '不满足分管副总、总经理追加审批条件',
      expensePlan_executiveApproved_gm:
        '申请金额 > 提交快照中的总经理金额门槛，且未通过分管副总与总经理同人审批合并校验',
      expensePlan_executiveApproved_approved:
        '不需总经理审批，或已通过分管副总与总经理同人审批合并校验',
      loan_financeApproved_executive: '申请金额 > 提交快照中的分管副总金额门槛',
      loan_financeApproved_gm:
        '不需要分管副总审批，且申请金额 > 提交快照中的总经理金额门槛',
      loan_financeApproved_cashier: '不满足分管副总、总经理追加审批条件',
      loan_executiveApproved_gm:
        '申请金额 > 提交快照中的总经理金额门槛，且未通过分管副总与总经理同人审批合并校验',
      loan_executiveApproved_cashier:
        '不需总经理审批，或已通过分管副总与总经理同人审批合并校验',
      purchase_financeApproved_executive:
        '采购实际金额（尚未定价时用估算金额） > 提交快照中的分管副总金额门槛',
      purchase_financeApproved_gm:
        '不需要分管副总审批，且采购实际金额（尚未定价时用估算金额） > 提交快照中的总经理金额门槛',
      purchase_financeApproved_approved: '不满足分管副总、总经理追加审批条件',
      purchase_executiveApproved_gm:
        '采购实际金额（尚未定价时用估算金额） > 提交快照中的总经理金额门槛，且未通过分管副总与总经理同人审批合并校验',
      purchase_executiveApproved_approved:
        '不需总经理审批，或已通过分管副总与总经理同人审批合并校验',
      payment_financeApproved_executive:
        '需完整审批阶梯，且申请金额 > 提交快照中的分管副总金额门槛',
      payment_financeApproved_gm:
        '不需要分管副总审批，且需完整审批阶梯，且申请金额 > 提交快照中的总经理金额门槛',
      payment_financeApproved_cashier: '不满足分管副总、总经理追加审批条件',
      payment_executiveApproved_gm:
        '需完整审批阶梯，且申请金额 > 提交快照中的总经理金额门槛，且未通过分管副总与总经理同人审批合并校验',
      payment_executiveApproved_cashier:
        '不需总经理审批，或已通过分管副总与总经理同人审批合并校验',
      travel_financeApproved_executive:
        '境外出差，或申请金额 > 提交快照中的分管副总金额门槛',
      travel_financeApproved_gm:
        '不需要分管副总审批，且（境外出差或申请金额 > 提交快照中的总经理金额门槛）',
      travel_financeApproved_booking:
        '无须再走分管副总/总经理审批，且申请需要预订',
      travel_financeApproved_completed:
        '无须再走分管副总/总经理审批，且申请不需要预订',
      travel_executiveApproved_gm:
        '（境外出差或申请金额 > 提交快照中的总经理金额门槛），且未通过分管副总与总经理同人审批合并校验',
      travel_executiveApproved_booking:
        '不需总经理审批或已通过同人合并校验，且需要预订',
      travel_executiveApproved_completed:
        '不需总经理审批或已通过同人合并校验，且不需要预订',
      travel_gmApproved_booking: '申请需要预订',
      travel_gmApproved_completed: '申请不需要预订',
      payment_submit_head:
        '资金来源校验要求完整审批阶梯（含需追加审批的超额支付）',
      payment_submit_finance: '资金来源校验不要求完整审批阶梯',
      budgetAdjustment_cfoApproved_gm:
        '预算类型为增加，且增加金额超过提交快照的总经理审批门槛',
      budgetAdjustment_cfoApproved_approved:
        '不是预算增加，或增加金额未超过提交快照的总经理审批门槛',
      leave_managerApproved_head:
        '请假天数 ≥ 提交快照的部门负责人门槛，且负责人缺位或与主管不是同一人',
      leave_managerApproved_hr:
        '不满足部门负责人追加条件，且假别要求HR或天数 ≥ 提交快照的HR门槛',
      leave_managerApproved_approved:
        '不满足部门负责人追加条件，且假别不要求HR、天数低于HR门槛',
      leave_headApproved_hr: '假别要求HR，或请假天数 ≥ 提交快照的HR门槛',
      leave_headApproved_approved:
        '假别不要求HR，且请假天数低于提交快照的HR门槛',
      overtime_managerApproved_head:
        '当月累计加班时长 > 提交快照的月度负责人门槛，且负责人缺位或与主管不是同一人',
      overtime_managerApproved_hr:
        '不需负责人追加审批，且在加班日期之后超过3个工作日补报',
      overtime_managerApproved_approved:
        '不需负责人追加审批，且未超过3个工作日补报期限',
      overtime_headApproved_hr: '在加班日期之后超过3个工作日补报',
      overtime_headApproved_approved: '未超过加班日期后3个工作日的补报期限',
      supplies_submit_issuing:
        '办理异常重新提交，且审批覆盖内容与上次通过审批时一致',
      supplies_submit_manager:
        '新申请、审批内容已改变或未满足直接恢复办理的条件',
      vehicleRequest_submit_dispatch:
        '办理异常重新提交，且审批覆盖内容与上次通过审批时一致',
      vehicleRequest_submit_head:
        '新申请、审批内容已改变或未满足直接恢复办理的条件',
      purchase_submit_purchasing:
        '办理异常重新提交，且审批覆盖内容与上次通过审批时一致',
      purchase_submit_head: '新申请、审批内容已改变或未满足直接恢复办理的条件',
      assetRequest_submit_issuing:
        '办理异常重新提交，且审批覆盖内容与上次通过审批时一致，并通过恢复资格校验，且不是报废申请',
      assetRequest_submit_head:
        '新申请、审批内容已改变或未满足直接恢复办理的条件',
      sealRequest_submit_stamping:
        '办理异常重新提交，且审批覆盖内容与上次通过审批时一致，并通过恢复资格校验',
      sealRequest_submit_head:
        '新申请、审批内容已改变或未满足直接恢复办理的条件',
      purchase_priced_revision:
        '实际价格 > 原估价的120%，需申请人确认后重新提交',
      purchase_priced_finance: '实际价格 ≤ 原估价的120%',
      purchase_forcedPriced_revision:
        '实际价格 > 原估价的120%，需申请人确认后重新提交',
      purchase_forcedPriced_finance: '实际价格 ≤ 原估价的120%',
      probation_hrApproved_gm:
        '转正结论为不通过，或HR确认的职级达到提交快照的经理级门槛',
      probation_hrApproved_approved:
        '转正结论不是不通过，且HR确认职级低于经理级门槛',
      departure_hrApproved_gm: '离职人员职级 ≥ 提交快照中的经理级门槛',
      departure_hrApproved_handover: '离职人员职级低于提交快照中的经理级门槛',
      departure_cancellationRejected_gm:
        '撤销审批驳回，恢复到撤销前的总经理审批阶段',
      departure_cancellationRejected_handover:
        '撤销审批驳回，恢复到撤销前的交接阶段（其他原状态也回到交接）',
      departure_cancellationRejected_completed:
        '撤销审批驳回，恢复到撤销前的完成状态',
      recruitment_submit_head: '申请人不是部门负责人，或部门负责人缺位',
      recruitment_submit_hrbp: '申请人就是部门负责人，跳过本人审批',
      recruitment_reviewEdit_head: '申请人不是部门负责人，或部门负责人缺位',
      recruitment_reviewEdit_hrbp: '申请人就是部门负责人，跳过本人审批',
      recruitment_hrDirectorApproved_executive: '招聘申请使用新增编制',
      recruitment_hrDirectorApproved_gm:
        '不是新增编制，且目标职级达到提交快照的总监级门槛',
      recruitment_hrDirectorApproved_approved:
        '不是新增编制，且目标职级低于总监级门槛',
      recruitment_executiveApproved_gm:
        '使用新增编制，或目标职级达到总监级门槛',
      recruitment_executiveApproved_approved:
        '非新增编制，且目标职级低于总监级门槛',
      transfer_submit_manager:
        '提交人不是员工的直属主管（无主管时仍进入主管环节）',
      transfer_submit_sourceHead: '提交人是员工的直属主管',
      transfer_reviewEdit_manager:
        '提交人不是员工的直属主管（无主管时仍进入主管环节）',
      transfer_reviewEdit_sourceHead: '提交人是员工的直属主管',
      transfer_sourceHeadApproved_targetHead: '异动类型包含部门调动',
      transfer_sourceHeadApproved_hr: '异动类型不包含部门调动',
      transfer_hrApproved_executive:
        '涨薪比例超过提交快照的副总门槛，或目标职级达到经理级',
      transfer_hrApproved_gm:
        '不需副总审批，且涨薪比例超过总经理门槛或目标职级达到总监级',
      transfer_hrApproved_pendingEffective:
        '未达到副总/总经理的涨薪或职级追加审批条件',
      transfer_executiveApproved_gm:
        '涨薪比例超过提交快照的总经理门槛，或目标职级达到总监级',
      transfer_executiveApproved_pendingEffective:
        '未达到总经理涨薪比例及职级追加审批条件',
      assetRequest_headApproved_appraisal: '申请类型为资产报废',
      assetRequest_headApproved_issuing: '申请类型不是报废',
      assetRequest_financeApproved_gm:
        '申请类型为报废，且资产原值合计超过提交快照的报废总经理门槛',
      assetRequest_financeApproved_scrapped:
        '不满足报废原值合计超过总经理门槛的条件',
      assetRequest_issueCompleted_returning:
        '申请类型为借用，发放后进入归还阶段',
      assetRequest_issueCompleted_issued: '申请类型不是借用',
      sealRequest_stamped_returning: '印章外借使用，须办理归还',
      sealRequest_stamped_completed: '不是印章外借使用',
      vendorQualification_submit_removalReview: '申请操作为移出供应商名录',
      vendorQualification_submit_purchasing: '申请操作不是移出供应商名录',
      contract_headApproved_legalFinance: '合同终止申请，或未使用标准合同模板',
      contract_headApproved_standardFinance: '不是终止申请，且使用标准合同模板',
      contract_legalFinanceApproved_executive:
        '不是合同终止申请，且合同金额 > 提交快照的分管副总金额门槛',
      contract_legalFinanceApproved_gm:
        '不是合同终止申请，且不需副总审批，并且金额超过合同总经理门槛或法务财务判定非标',
      contract_legalFinanceApproved_approved:
        '合同终止申请，或没有副总/总经理追加审批条件',
      contract_standardFinanceApproved_executive:
        '合同金额 > 提交快照的分管副总金额门槛',
      contract_standardFinanceApproved_gm:
        '不需副总审批，并且金额超过合同总经理门槛',
      contract_standardFinanceApproved_approved:
        '未达到副总及合同总经理追加审批门槛',
      contract_executiveApproved_gm: '金额超过合同总经理门槛，或合同被判定非标',
      contract_executiveApproved_approved:
        '金额未超过合同总经理门槛，且不是非标合同',
      committeeVersion: '使用提交时冻结的资质评审委员会版本对应的评审组',
      returnApplicant: '退回时选择由申请人修改并重新提交',
      returnEarlier: '退回时选择这个已走过的前置审批环节',
      seal_legal: '部门负责人通过后，印章为合同章或关联了合同',
      seal_financeManager:
        '从部门负责人或法务审批进入，印章类型为财务章（合同路径优先）',
      seal_gm:
        '前面法务/财务分支未命中，且为法人章或外借，当前审批人不是总经理',
      seal_stamping:
        '法务/财务分支未命中，且无总经理追加审批，或当前审批人就是总经理',
    },

    conditional: '按业务条件选择',
    normalDescription:
      '展示主要审批与办理路径；各环节的人员、操作及流转条件见流程规则。',
    transitionUnknown: '操作：{{name}}',
    transitionNames: {
      edit: '修改内容',
      submit: '提交申请',
      approved: '审批同意',
      rejected: '审批驳回',
      returned: '退回修改',
      withdraw: '申请人撤回',
      terminate: '终止流程',
      booked: '预订完成',
      bookingFailed: '预订失败',
      bookingForced: '管理员确认完成',
      retryBooking: '重试预订',
      reviseTrip: '修改行程',
      cancelApproved: '取消审批通过',
      issued: '发放完成',
      unavailable: '办理不可用 / 失败',
      forceClosed: '强制关闭',
    },

    place: '待分配席位',
    placeNumber: '待分配席位 {{number}}',
    placeRequired: '请选择待分配席位。',
    title: '流程管理',
    description: '查看授权范围内的流程定义、执行记录及审批历史',
    definitions: '流程定义',
    executions: '执行记录',
    refresh: '刷新',
    search: '搜索编号、流程或申请人',
    definitionSearch: '搜索流程名称',
    clear: '清除筛选',
    all: '全部',
    name: '名称',
    domain: '业务域',
    category: '类别',
    capabilities: '管理能力',
    approval: '审批流程',
    connected: '已接入',
    readOnly: '仅查看',
    notConnected: '管理操作尚未接入',
    reference: '编号 / 标题',
    applicant: '申请人',
    status: '状态',
    stage: '当前阶段',
    createdAt: '发起时间',
    endedAt: '结束时间',
    empty: '暂无执行记录',
    emptyDescription: '已接入流程的申请开始执行后会显示在这里',
    noDefinitions: '暂无可读流程定义',
    noDefinitionsDescription: '请联系管理员配置流程读取权限',
    noResults: '没有匹配的记录',
    noResultsDescription: '调整或清除筛选条件后查看记录',
    definitionGraph: '当前流程定义',
    graphDescription: '展示当前主注册的状态与转换，动态分支由业务规则决定',
    currentNode: '当前状态',
    visitedNode: '已走过',
    unvisitedNode: '未经过',
    executionHistory: '执行历史',
    terminationOutcome: '终止结果',
    actualPath: '实际执行路径',
    actualDescription:
      '以完整审批与办理流程为背景，标注实际经过的节点、连线和当前状态；已发生的退回或历史路径仍保留。',
    tasks: '任务与审批历史',
    timeline: '审批与管理干预',
    run: '审批轮次',
    historical: '历次执行',
    definitionMissing: '历史定义不可用',
    commentsRestricted: '审批意见可能包含敏感内容，需要对应业务读取权限',
    comment: '意见 / 原因',
    actor: '操作人',
    assignee: '责任人',
    answer: '决定',
    previousTask: '原任务',
    from: '从',
    to: '至',
    initial: '起点',
    final: '终态',
    manual: '人员操作',
    automatic: '自动转换',
    transitions: '状态转换',
    definitionDetails: '阶段与转换',
    viewExecutions: '查看全部记录',
    back: '返回',
    manage: '管理操作',
    appoint: '指派',
    reassign: '重派',
    terminate: '终止',
    unavailable: '当前任务或业务状态不允许此操作',
    person: '接收人',
    reason: '原因',
    personRequired: '请选择接收人',
    reasonRequired: '请填写原因',
    cancel: '取消',
    retry: '重试',
    loadFailed: '加载失败，请重试',
    submitFailed: '操作失败，请核对后重试',
    unknown: '操作结果未知，请刷新核对',
    stale: '任务已变化，请刷新后核对',
    gone: '记录不存在或不在当前授权范围',
    forbidden: '无权读取此部分，请联系管理员',
    loading: '正在加载',
    noPeople: '没有符合当前任务要求的接收人',
    peopleSearch: '搜索授权候选人员',
    loadMore: '加载更多',
    reassignTitle: '重派申请“{{recordLabel}}”的任务',
    appointTitle: '指派申请“{{recordLabel}}”的任务',
    terminateTitle: '终止申请“{{recordLabel}}”',
    reassigned: '已重派申请“{{recordLabel}}”的任务',
    appointed: '已指派申请“{{recordLabel}}”的任务',
    terminated: '已终止申请“{{recordLabel}}”',
    recentDescription: '最近五条已授权的执行记录；完整历史请进入执行记录列表。',
    vehicleTerminationGuard:
      '已派车的申请不能直接终止，须由实际申请人完成用车登记并按车辆业务处理。',
    terminationConsequences: {
      vehicle: '终止尚未派车的申请；已派车记录不能通过此操作关闭。',
      leave: '关闭当前审批，由请假业务服务处理尚未完成的额度占用。',
      funding:
        '关闭当前审批，由业务服务处理待完成的预算、资金或申请占用；不会撤销已结算款项。',
      stock:
        '关闭当前审批，由领用业务服务处理待完成的库存占用；不会代替实物退还。',
      ordinary: '关闭当前审批，执行该业务的终止守卫和退出处理。',
    },
    terminationDescription:
      '终止会关闭当前任务并按业务规则释放占用，保留全部历史；已经实际执行的业务必须另走对应撤销或清退流程。',
    graphView: '流程图',
    dateRange: '发起日期',
    last7: '最近7天',
    last30: '最近30天',
    last90: '最近90天',
    thisMonth: '本月',
    lastMonth: '上月',
    safeHistory: '当前列表与历史仅包含已授权的安全流程信息',
    business: '业务内容',
    businessRestricted: '业务内容、附件和敏感字段需独立授权',
    rules: '流程规则',
    policy: '决策方式',
    peopleSource: '人员来源',
    dynamicPeople: '提交时根据源业务规则解析人员',
    guardedBranch: '根据源业务条件选择分支',
    frozen: '冻结字段',
    covered: '覆盖字段',
    management: '管理员干预',
    kinds: {
      leave: '请假',
      overtime: '加班申请',
      leaveCancellation: '销假申请',
      general: '通用申请',
      attendanceChange: '考勤更正',
      outing: '外出申请',
      supplies: '用品领用',
      budgetAdjustment: '预算调整',
      expensePlan: '费用事前申请',
      training: '培训申请',
      travel: '出差申请',
      travelCancellation: '出差取消',
      reimbursement: '费用报销',
      purchase: '采购申请',
      loan: '借款申请',
      payment: '付款申请',
      probation: '转正申请',
      vehicleRequest: '车辆申请',
      contract: '合同审批',
      assetRequest: '资产申请',
      vendorQualification: '供应商准入',
      recruitment: '招聘需求',
      sealRequest: '用印申请',
      transfer: '转岗调薪',
      departure: '离职申请',
      certificateRequest: '证明开具',
    },
    domains: {
      office: '日常办公',
      organization: '组织与人事',
      finance: '财务与费用',
      procurement: '采购与合同',
      administration: '行政与资产',
    },
    states: {
      issued: '已发放',
      forcedClosed: '已强制关闭',
      draft: '草稿',
      revision: '待修订',
      manager: '直属上级',
      head: '部门负责人',
      hr: '人力资源',
      extra: '追加审批',
      finance: '财务',
      cashier: '出纳办理',
      executive: '分管副总',
      gm: '总经理',
      cfo: 'CFO',
      legal: '法务',
      financeManager: '财务经理',
      hrbp: 'HRBP',
      hrDirector: '人力资源总监',
      approved: '已通过',
      rejected: '已驳回',
      withdrawn: '已撤回',
      terminated: '已终止',
      completed: '已完成',
      exception: '办理异常',
      dispatch: '调度',
      usage: '实际用车',
      issuing: '发放',
      returning: '归还',
      returnException: '归还异常',
      stamping: '盖章',
      booking: '预订办理',
      unbooking: '取消预订',
      paid: '已付款',
      paymentException: '付款异常',
      pendingEffective: '待生效',
      cancellationReview: '取消审核',
      sourceHead: '原部门负责人',
      targetHead: '目标部门负责人',
      committee: '委员会',
      purchasing: '采购办理',
      inquiry: '询比价',
      quoting: '询比价',
      pending: '待处理',
      claimed: '已认领',
      waiting: '等待中',
      blocked: '已阻塞',
      candidate: '候选待办',
      suspended: '已挂起',
      transferred: '已转办',
      voided: '已关闭',
      open: '进行中',
      cancelled: '已取消',
      returned: '已退回',
      concluded: '已结束',
      decide: '审批',
      copy: '抄送',
      approve: '同意',
      reject: '驳回',
      return: '退回',
      unknown: '其他状态',
    },
    authz: {
      definitionRead: '流程定义',
      historyRead: '历次执行',
      appoint: '指派',
      reassign: '重派',
      terminate: '终止',
    },
    otherStage: '其他环节（{{name}}）',
    otherEvent: '流程事件（{{name}}）',
    coveredCount: '覆盖 {{count}} 个业务字段',
    frozenCount: '提交后冻结 {{count}} 个业务字段',
    policies: {
      all: '会签 / 单人审批',
      any: '或签',
      first: '抢单',
      threshold: '投票',
      sequential: '顺签',
    },
    peopleSources: {
      dynamic: '提交时根据源业务规则解析人员',
      pools: '职能角色 / 候选池',
      subjects: '逐行审批人员',
    },
    events: {
      approve: '同意',
      reject: '驳回',
      return: '退回',
      reassign: '管理员重派',
      appoint: '管理员指派',
      comment: '评论',
      transfer: '转办',
      addSign: '加签',
      claim: '认领',
      release: '释放任务',
      'stage.unassigned': '缺人挂起',
      'run.started': '审批开始',
      'run.ended': '审批结束',
      'stage.entered': '进入环节',
      remind: '超时提醒',
      escalate: '升级',
      read: '已读',
    },
  },
};
