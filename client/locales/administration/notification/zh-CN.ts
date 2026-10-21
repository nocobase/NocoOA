import type { NotificationResource } from './en-US.js';

const zhCN: NotificationResource = {
  nav: {
    notifications: '通知',
    logs: '通知日志',
  },
  logs: {
    retry: '重试',
    limitNotice: '仅显示最新 {{count}} 条通知，统计仅涵盖这些记录。',
    deliveryOperations: '投递操作',
    recipeDescription: '跟踪各渠道的交接和服务提供方的每次尝试。',
    redacted: '消息正文、接收者和租约令牌已隐去。',
    providerAttempts: '服务提供方尝试记录',

    eyebrow: '通知',
    title: '通知日志',
    description:
      '追踪通知投递及每一次服务商尝试。消息正文、收件人和租约令牌均已脱敏。',
    refreshing: '正在刷新…',
    refresh: '刷新',
    deliveriesShown: '当前投递数',
    needAttention: '需要关注',
    unavailable: '通知日志不可用',
    recent: '最近通知',
    loading: '正在加载投递记录…',
    emptyTitle: '暂无投递记录',
    emptyDescription: '发送通知后，投递记录会显示在这里。',
    expand: '展开通知',
    collapse: '收起通知',
    noDeliveries: '暂无投递记录。',
    noAttempts: '暂无尝试记录。',
    columns: {
      source: '来源',
      notificationId: '通知 ID',
      status: '状态',
      deliveries: '投递',
      created: '创建时间',
      channel: '渠道',
      provider: '服务商',
      attempts: '尝试',
      updated: '更新时间',
    },
  },
  status: {
    pending: '等待中',
    processing: '处理中',
    completed: '已完成',
    partial: '部分完成',
    failed: '失败',
    unknown: '状态未知',
    preparing: '准备中',
    submitting: '提交中',
    retrying: '重试中',
    accepted: '已受理',
  },
  errors: {
    forbidden: '您已无权查看这些记录，请联系管理员。',
    notFound: '记录不可用，请返回工作台。',
    providerFailed: '发送失败，请检查通知渠道配置或联系管理员。',
    requestFailed: '通知请求失败。',
    inAppRecipientNotFound: '站内信接收用户不存在。',
  },
};

export default zhCN;
