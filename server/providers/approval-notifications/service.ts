import type { UserAdministrationService } from '@nocobase/app-plugin-authentication';
import type {
  NotificationConfig,
  NotificationService,
} from '@nocobase/app-plugin-notification/server';
import type { I18nRuntime } from '@nocobase/i18n';

import type {
  ApprovalNotificationConfig,
  ApprovalNotificationService,
} from './contract.js';

export interface NotificationDependencies {
  readonly notification: NotificationService;
  readonly users: Pick<UserAdministrationService, 'get'>;
  readonly i18n: I18nRuntime;
  readonly channels: NotificationConfig['channels'];
  readonly config: ApprovalNotificationConfig;
  readonly publicOrigin?: string;
  readonly basePath: string;
  /** The installed i18n plugin only persists locale on sessions. Hosts with a durable preference can supply it. */
  readonly localeOf?: (
    userId: string,
  ) => string | undefined | Promise<string | undefined>;
}

// Only published browser routes may become notification targets. New approval modules can send notices before
// their pages ship, but must never link their record ids to the leave detail page.
function recordPath(recordId: string, kind = 'oa.leave'): string | undefined {
  const routes: Record<string, string> = {
    'oa.leave': 'leave',
    leave: 'leave',
    'oa.overtime': 'overtime',
    'oa.general': 'general',
    'oa.supplies': 'supply',
    'oa.expensePlan': 'expensePlan',
    'oa.training': 'training',
    'oa.travel': 'travel',
    'oa.reimbursement': 'reimbursement',
    'oa.purchase': 'purchase',
    'oa.loan': 'loan',
    'oa.payment': 'payment',
    'oa.probation': 'probation',
    'oa.departure': 'departure',
    'oa.vendorQualification': 'vendorQualification',
    'oa.assetRequest': 'assetRequest',
    'oa.contract': 'contract',
    'oa.travelCancellation': 'travelCancellation',
    'oa.budgetAdjustment': 'budgetAdjustment',
    'oa.attendanceChange': 'attendanceChange',
    'oa.outing': 'outings',
    'oa.leaveCancellation': 'cancellation',
  };
  return routes[kind]
    ? `/approvals/mine/${routes[kind]}/${encodeURIComponent(recordId)}`
    : undefined;
}

export function createApprovalNotificationService(
  deps: NotificationDependencies,
): ApprovalNotificationService {
  const channel = (
    name: string | null,
    providers: readonly string[],
  ): string | undefined => {
    if (!name) return undefined;
    const config = deps.channels[name];
    return config?.enabled !== false &&
      config &&
      providers.includes(config.provider)
      ? name
      : undefined;
  };

  async function send(input: {
    key: string;
    userId: string;
    recordId: string;
    message: string;
    email?: boolean;
    kind?: string;
    detail?: import('./contract.js').ApprovalNotificationDetail;
  }): Promise<void> {
    const user = await deps.users.get(input.userId);
    if (!user || user.disabledAt || user.kind !== 'person') return;
    const idempotencyKey = `oa.approvals:${input.key}:${user.id}`;
    // Preserve the original persisted payload across template/locale changes. Delivery retries
    // belong to the notification service; a business-effect retry must not rewrite history.
    if (await deps.notification.getByIdempotencyKey(idempotencyKey)) return;
    const locale = deps.i18n.resolveLocale(
      (await deps.localeOf?.(user.id)) ?? deps.i18n.getDefaultLocale(),
    );
    await deps.i18n.ensureLocaleLoaded(locale);
    const t = deps.i18n.getFixedT('nb3-oa', locale);
    // The path is internal to the application; only external mail/IM links carry the mount path.
    const path = recordPath(input.recordId, input.kind);
    const url =
      deps.publicOrigin && path
        ? new URL(
            `${deps.basePath === '/' ? '' : deps.basePath}${path}`,
            deps.publicOrigin,
          ).href
        : undefined;
    const kind = (input.kind ?? 'oa.leave').replace(/^oa\./u, '');
    const knownKinds = [
      'leave',
      'overtime',
      'general',
      'supplies',
      'expensePlan',
      'training',
      'travel',
      'reimbursement',
      'purchase',
      'loan',
      'payment',
      'probation',
      'departure',
      'vendorQualification',
      'assetRequest',
      'contract',
      'travelCancellation',
      'budgetAdjustment',
      'attendanceChange',
      'outing',
      'leaveCancellation',
      'recruitment',
      'transfer',
      'certificateRequest',
      'sealRequest',
      'vehicleRequest',
    ];
    const title = t('approvals.notifications.eventTitle', {
      kind: t(
        `approvals.notifications.kinds.${knownKinds.includes(kind) ? kind : 'request'}`,
      ),
      event: t(`approvals.notifications.events.${input.message}`),
    });
    const body = input.detail
      ? t(input.detail.key, input.detail.values)
      : t(`approvals.notifications.${input.message}`);
    const messages: Record<string, object> = {};
    const inbox = channel(deps.config.inbox, ['in-app']);
    if (inbox)
      messages[inbox] = {
        to: user.id,
        title,
        body,
        ...(path ? { target: { type: 'route', path } } : {}),
      };
    const email = input.email
      ? channel(deps.config.email, ['smtp', 'resend'])
      : undefined;
    if (email && (url || !path))
      messages[email] = {
        to: user.email,
        subject: title,
        text: url ? `${body}\n${url}` : body,
      };
    if (!Object.keys(messages).length) return;
    await deps.notification.send({
      idempotencyKey,
      source: { type: 'oa.approval', referenceId: input.recordId },
      messages,
    });
  }

  return {
    async task({ task, reason, directory, applicantId, kind, at }) {
      const escalation = task.via === 'escalate';
      const message =
        task.kind === 'copy'
          ? 'copied'
          : reason === 'reminder' || reason === 'urged'
            ? 'reminder'
            : escalation
              ? 'escalated'
              : 'assigned';
      const key = `task:${task.id}:${reason}${reason === 'urged' ? `:${at}` : ''}`;
      await send({
        key,
        userId: task.assigneeId,
        recordId: task.recordId,
        message,
        email: escalation,
        kind: kind ?? task.source,
      });
      // Copies are read-only; they are never delegated. Proxy delegation keeps the principal's own notice.
      if (task.kind !== 'decide') return;
      const proxy = directory?.delegateOf?.(
        task.assigneeId,
        kind ?? task.source,
        at ?? new Date().toISOString(),
        task.createdAt,
      );
      if (
        proxy &&
        proxy.mode !== 'forward' &&
        proxy.to !== applicantId &&
        proxy.to !== task.assigneeId &&
        directory?.isActive(proxy.to)
      ) {
        await send({
          key,
          userId: proxy.to,
          recordId: task.recordId,
          message: 'delegated',
          kind: kind ?? task.source,
        });
      }
    },
    async result({ recordId, applicantId, state, transitionId, kind }) {
      const message = [
        'approved',
        'rejected',
        'revision',
        'withdrawn',
        'terminated',
      ].includes(state)
        ? state
        : 'result';
      await send({
        key: `result:${transitionId}`,
        userId: applicantId,
        recordId,
        message,
        email: true,
        kind,
      });
    },
    async alarm({ recordId, recipients, eventId, kind, detail }) {
      for (const userId of new Set([
        ...recipients,
        ...deps.config.administrators,
      ])) {
        await send({
          key: `alarm:${eventId}`,
          userId,
          recordId,
          message: 'attention',
          email: true,
          kind,
          detail,
        });
      }
      const name = channel(deps.config.alarm, [
        'feishu-webhook',
        'dingtalk-webhook',
      ]);
      if (!name || !deps.publicOrigin) return;
      const idempotencyKey = `oa.approvals:alarm:${eventId}:webhook`;
      if (await deps.notification.getByIdempotencyKey(idempotencyKey)) return;
      const locale = deps.i18n.getDefaultLocale();
      await deps.i18n.ensureLocaleLoaded(locale);
      const t = deps.i18n.getFixedT('nb3-oa', locale);
      const path = recordPath(recordId, kind);
      const url = path
        ? new URL(
            `${deps.basePath === '/' ? '' : deps.basePath}${path}`,
            deps.publicOrigin,
          ).href
        : undefined;
      await deps.notification.send({
        idempotencyKey,
        source: { type: 'oa.approval', referenceId: recordId },
        messages: {
          [name]: {
            text: detail
              ? t(detail.key, detail.values)
              : t('approvals.notifications.attention'),
            ...(url ? { target: { type: 'url', url } } : {}),
          },
        },
      });
    },
  };
}
