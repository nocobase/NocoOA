import type { LocaleResource } from '@nocobase/i18n';

const enUS = {
  nav: {
    notifications: 'Notifications',
    logs: 'Notification logs',
  },
  logs: {
    retry: 'Retry',
    limitNotice:
      'Only the newest {{count}} notifications are shown; totals cover these records.',
    deliveryOperations: 'Delivery operations',
    recipeDescription: 'Trace each channel handoff and every provider attempt.',
    redacted: 'Message bodies, recipients, and lease tokens are redacted.',
    providerAttempts: 'Provider attempts',

    eyebrow: 'Notifications',
    title: 'Notification logs',
    description:
      'Trace notification delivery and every provider attempt. Message bodies, recipients, and lease tokens are redacted.',
    refreshing: 'Refreshing…',
    refresh: 'Refresh',
    deliveriesShown: 'Deliveries shown',
    needAttention: 'Need attention',
    unavailable: 'Logs unavailable',
    recent: 'Recent notifications',
    loading: 'Loading delivery history…',
    emptyTitle: 'No deliveries yet',
    emptyDescription:
      'Delivery records will appear here after notifications are sent.',
    expand: 'Expand notification',
    collapse: 'Collapse notification',
    noDeliveries: 'No deliveries recorded.',
    noAttempts: 'No attempts recorded.',
    columns: {
      source: 'Source',
      notificationId: 'Notification ID',
      status: 'Status',
      deliveries: 'Deliveries',
      created: 'Created',
      channel: 'Channel',
      provider: 'Provider',
      attempts: 'Attempts',
      updated: 'Updated',
    },
  },
  status: {
    pending: 'Pending',
    processing: 'Processing',
    completed: 'Completed',
    partial: 'Partial',
    failed: 'Failed',
    unknown: 'Unknown',
    preparing: 'Preparing',
    submitting: 'Submitting',
    retrying: 'Retrying',
    accepted: 'Accepted',
  },
  errors: {
    forbidden: 'Access has been removed. Contact an administrator.',
    notFound: 'These records are unavailable. Return to the workbench.',
    providerFailed:
      'Delivery failed. Review the channel settings or contact an administrator.',
    requestFailed: 'Notification request failed.',
    inAppRecipientNotFound: 'In-app notification recipient does not exist.',
  },
};

export type NotificationResource = LocaleResource<typeof enUS>;

export default enUS;
