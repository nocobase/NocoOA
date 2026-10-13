export default {
  reportsExpense: {
    firstPage: '返回第一页',

    pageEmpty: '本页暂无费用汇总',
    pageEmptyHint:
      '当前来源的汇总数量已减少，请返回第一页或点击上一页查看有数据的页面。',

    exportStarted: 'Excel 下载已开始',
    reloading: '正在刷新，当前筛选加载完成前显示上次结果。',
    exportLock: '正在导出，下载完成前暂不可调整筛选与翻页。',

    title: '已结算费用月汇总',
    description: '按原费用日期与分类统计已结算费用毛额，非净现金实付。',
    month: '费用月份（1–12，可留空）',
    effectiveYear: '公司日历年度：{{year}}',
    sourceNotice:
      '最多核对 10,000 条获权的已结算申请。调整年度或月份不会减少来源扫描。',
    precondition:
      '结算证据无法核验或已超过报表限额，请联系管理员检查来源证据与报表规模。',
    forbidden: '无权读取当前报销来源，请联系管理员核对来源权限。',
    empty: '本年度暂无已结算费用',
    emptyHint:
      '仅统计获权且结算证据完整的申请。请检查年度与月份，或联系管理员核对来源权限。',
    fields: {
      year: '年度',
      month: '费用月份',
      category: '费用分类代码',
      settledRequestCount: '已结算申请数',
      settledExpenseCents: '已结算费用毛额（元，非现金实付）',
    },
  },
};
