import documentsEnUS from '../../../../server/locales/trial-documents/en-US.js';
import documentsZhCN from '../../../../server/locales/trial-documents/zh-CN.js';
import { randomUUID } from 'node:crypto';
import type { Application } from '@nocobase/app-server/application';
import { databaseManagerToken } from '@nocobase/db';
import { type TrialFacts } from './bootstrap.js';
import type { TrialScenario } from './scenarios.js';
import { trialAccounts, trialPrefix, type TrialRole } from './accounts.js';
import { dataOf, recordOf, type TrialSession } from './http.js';

export type TrialSessions = Record<TrialRole, TrialSession>;
const legacyDutyReplacements = new WeakMap<
  TrialSessions,
  Record<string, TrialRole>
>();
export function setLegacyDutyReplacements(
  sessions: TrialSessions,
  replacements: Record<string, TrialRole>,
) {
  legacyDutyReplacements.set(sessions, replacements);
}
export interface ScenarioResult {
  key: string;
  title: string;
  path: string;
  id: string;
  status: string;
  actor: TrialRole;
}

/** A small real PDF, with offsets calculated from bytes so download/preview works. */
export function trialPdf(): File {
  const chinese = Buffer.from(documentsZhCN.pdf, 'utf16le')
    .swap16()
    .toString('hex');
  const content = `BT /F1 14 Tf 50 750 Td (${documentsEnUS.pdf}) Tj /F2 14 Tf 0 -30 Td <${chinese}> Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 6 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [7 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /DW 1000 >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((v) => `${String(v).padStart(10, '0')} 00000 n \n`)
    .join(
      '',
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return new File([pdf], 'oa-trial-fictional.pdf', { type: 'application/pdf' });
}

export async function transition(
  session: TrialSession,
  s: TrialScenario,
  id: string,
  record: Record<string, unknown>,
  name: string,
  input?: Record<string, unknown>,
): Promise<void> {
  const version = Number(record.lifecycleVersion);
  const requestId = randomUUID();
  if (s.mode === 'versioned') {
    if (name === 'edit')
      await session.request(
        `${s.path}/${id}`,
        { ...input, requestKey: requestId, expectedVersion: version },
        'PUT',
      );
    else
      await session.request(`${s.path}/${id}/${name}`, {
        requestKey: requestId,
        expectedVersion: version,
      });
  } else if (s.mode === 'asset') {
    await session.request(`${s.path}/${id}/lifecycle`, {
      action: name,
      lifecycleVersion: version,
      requestId,
    });
  } else if (s.mode === 'command') {
    await session.request(`${s.path}/${id}/transitions`, {
      transition: name,
      version,
      requestKey: requestId,
      reason: '虚构试用流程准备',
    });
  } else {
    const plural = s.mode === 'plural';
    await session.request(
      `${s.path}/${id}/${plural ? 'transitions' : 'transition'}`,
      {
        [s.mode === 'contracts' || s.mode === 'qualification'
          ? 'name'
          : 'transition']: name,
        version,
        requestId,
        ...(input
          ? { input }
          : s.path === '/vehicleRequests'
            ? {}
            : { input: {} }),
      },
    );
  }
}

interface OfferedAction {
  name: string;
}
interface TaskOffer {
  task?: { id: string; runId: string };
  taskId?: string;
  runId?: string;
  contentHash?: string;
  actions: OfferedAction[];
}

function offered(detail: Record<string, unknown>): TaskOffer[] {
  const capabilities = detail.capabilities as
    { taskActions?: TaskOffer[] } | undefined;
  return (capabilities?.taskActions ??
    detail.taskActions ??
    detail.actions ??
    []) as TaskOffer[];
}

export async function performOffered(
  session: TrialSession,
  path: string,
  id: string,
  action: string,
  input?: Record<string, unknown>,
): Promise<void> {
  const detail = dataOf(await session.request(`${path}/${id}`));
  const offer = offered(detail).find((v) =>
    v.actions.some((a) => a.name === action),
  );
  if (!offer)
    throw new Error(`${path}: no current ${action} offer for the trial actor.`);
  const runs = detail.runs as { run: { id: string; contentHash: string } }[];
  const run = runs.find((v) => v.run.id === (offer.task?.runId ?? offer.runId));
  await session.request(`${path}/${id}/action`, {
    target: { taskId: offer.task?.id ?? offer.taskId },
    action,
    contentHash: offer.contentHash ?? run?.run.contentHash,
    requestId: randomUUID(),
    ...(input ? { input } : {}),
  });
}

async function actionDetail(
  session: TrialSession,
  s: TrialScenario,
  id: string,
): Promise<Record<string, unknown>> {
  const detail = dataOf(await session.request(`${s.path}/${id}`));
  if (s.path === '/sealRequests') {
    detail.capabilities = dataOf(
      await session.request(`/sealBrowser/requests/${id}/capabilities`),
    );
  }
  return detail;
}

export async function advance(
  sessions: TrialSessions,
  s: TrialScenario,
  id: string,
): Promise<void> {
  for (let count = 0; count < 25; count++) {
    const observer = await actionDetail(sessions[s.actor], s, id);
    const current = recordOf(observer);
    if (
      ['approved', 'completed', 'allocated', 'effective'].includes(
        String(current.status),
      )
    )
      return;
    const currentRuns = observer.runs as
      | {
          run?: { endedAt?: string | null };
          tasks?: { id: string; status: string; assigneeId?: string | null }[];
        }[]
      | undefined;
    const pending =
      currentRuns
        ?.filter((run) => !run.run?.endedAt)
        .flatMap((run) => run.tasks ?? [])
        .filter((task) =>
          ['pending', 'candidate', 'claimed'].includes(task.status),
        ) ?? [];
    const assignedIds = new Set(
      pending.map((task) => task.assigneeId).filter(Boolean),
    );
    // Only unfinished records owned by this dataset reach traversal. An explicit
    // migration flag permits the public administrator offer to move frozen old
    // sample assignees; it never answers a decision or touches historical records.
    const legacy = pending.find(
      (task) =>
        task.assigneeId &&
        legacyDutyReplacements.get(sessions)?.[task.assigneeId] &&
        !assignedIds.has(
          sessions[legacyDutyReplacements.get(sessions)![task.assigneeId]!]
            .userId,
        ),
    );
    if (legacy?.assigneeId) {
      const role = legacyDutyReplacements.get(sessions)![legacy.assigneeId]!;
      const admin = await actionDetail(sessions.system, s, id);
      const offer = offered(admin).find(
        (v) =>
          (v.task?.id ?? v.taskId) === legacy.id &&
          v.actions.some((a) => a.name === 'reassign'),
      );
      if (!offer)
        throw new Error(
          `${s.key}: no authorized reassignment offer for the legacy sample task.`,
        );
      const runs = admin.runs as { run: { id: string; contentHash: string } }[];
      const run = runs.find(
        (v) => v.run.id === (offer.task?.runId ?? offer.runId),
      );
      const suffix = ['plural', 'command', 'versioned'].includes(s.mode ?? '')
        ? 'actions'
        : 'action';
      await sessions.system.request(`${s.path}/${id}/${suffix}`, {
        target: { taskId: legacy.id },
        action: 'reassign',
        contentHash: offer.contentHash ?? run?.run.contentHash,
        requestId: randomUUID(),
        comment: '迁移旧示例职责，恢复当前试用单据负责人',
        input: { to: sessions[role].userId },
      });
      continue;
    }
    if (
      !pending.length &&
      legacyDutyReplacements.has(sessions) &&
      ['expense-plan-gm', 'budget-cfo'].includes(s.key) &&
      s.stopAt &&
      current.status === s.stopAt
    ) {
      const admin = await actionDetail(sessions.system, s, id);
      const runs = admin.runActions as {
        run: { id: string; contentHash: string };
        actions: OfferedAction[];
      }[];
      const offer = runs.find((v) =>
        v.actions.some((a) => a.name === 'appoint'),
      );
      if (!offer)
        throw new Error(
          `${s.key}: no authorized appointment offer for the empty trial stage.`,
        );
      await sessions.system.request(`${s.path}/${id}/action`, {
        target: { runId: offer.run.id },
        action: 'appoint',
        contentHash: offer.run.contentHash,
        requestId: randomUUID(),
        comment:
          '旧示例唯一职责迁移后，为尚未初始化完成的试用节点指定当前负责人',
        input: { to: sessions[s.stopAt].userId },
      });
      continue;
    }
    if (s.stopAt) {
      try {
        const target = await actionDetail(sessions[s.stopAt], s, id);
        if (
          offered(target).some((offer) =>
            offer.actions.some(
              (a) => !['comment', 'read', 'urge'].includes(a.name),
            ),
          )
        )
          return;
      } catch (error) {
        if (!(error instanceof Error && /HTTP (403|404)/.test(error.message)))
          throw error;
      }
    }
    let progressed = false;
    for (const person of trialAccounts) {
      if (person.key === 'system') continue;
      if (
        assignedIds.size &&
        pending.every((task) => task.assigneeId) &&
        !assignedIds.has(sessions[person.key].userId)
      )
        continue;
      let detail: Record<string, unknown>;
      try {
        detail = await actionDetail(sessions[person.key], s, id);
      } catch (error) {
        if (error instanceof Error && /HTTP (403|404)/.test(error.message))
          continue;
        throw error;
      }
      const record = recordOf(detail);
      if (
        ['approved', 'completed', 'allocated', 'effective'].includes(
          String(record.status),
        )
      )
        return;
      const available = offered(detail);
      const offer =
        available.find((v) => v.actions.some((a) => a.name === 'approve')) ??
        available.find((v) => v.actions.some((a) => a.name === 'claim'));
      if (!offer) continue;
      const action = offer.actions.some((a) => a.name === 'approve')
        ? 'approve'
        : 'claim';
      const runs = detail.runs as {
        run?: { id: string; contentHash: string };
        id?: string;
        contentHash?: string;
      }[];
      const runId = offer.task?.runId ?? offer.runId;
      const run = runs?.find((v) => (v.run?.id ?? v.id) === runId);
      const body: Record<string, unknown> = {
        target: { taskId: offer.task?.id ?? offer.taskId },
        action,
        requestId: randomUUID(),
        contentHash:
          offer.contentHash ?? run?.run?.contentHash ?? run?.contentHash,
        comment: '虚构示例：准备下一角色的试用待办',
      };
      if (s.mode === 'command') {
        body.requestKey = body.requestId;
        delete body.requestId;
        body.reason = '虚构试用流程准备';
      }
      if (
        action === 'approve' &&
        s.mode === 'contracts' &&
        person.key === 'legal'
      )
        body.input = { data: { nonStandard: false } };
      if (
        s.path === '/probationRequests' &&
        String(record.status) === 'manager'
      )
        body.input = {
          evaluation: '示例试用期评价',
          conclusion: 'regular',
          deferredTo: null,
        };
      const suffix =
        s.mode === 'plural' || s.mode === 'command' || s.mode === 'versioned'
          ? 'actions'
          : 'action';
      await sessions[person.key].request(`${s.path}/${id}/${suffix}`, body);
      progressed = true;
      break;
    }
    if (!progressed)
      throw new Error(
        `${s.key}: no trial role can approve the next step${s.stopAt ? ` before ${s.stopAt}` : ''}.`,
      );
  }
  throw new Error(
    `${s.key}: approval traversal exceeded the declared stage limit.`,
  );
}

export async function populateScenario(
  app: Application,
  sessions: TrialSessions,
  facts: TrialFacts,
  s: TrialScenario,
  prior?: ScenarioResult,
): Promise<ScenarioResult> {
  const session = sessions[s.actor];
  const db = app.container.resolve(databaseManagerToken);
  // Stable fictional markers recover a create committed before its checkpoint was written.
  const inner = s.body.input as Record<string, unknown> | undefined;
  const proposal = (s.body.proposal ?? inner?.proposal) as
    Record<string, unknown> | undefined;
  const marker =
    proposal?.[s.markerField] ??
    inner?.[s.markerField] ??
    s.body[s.markerField];
  const byId = prior?.id
    ? await db.repository(s.collection).findOne({ filter: { id: prior.id } })
    : undefined;
  const existing =
    byId ??
    (typeof marker === 'string'
      ? await db
          .repository(s.collection)
          .findOne({ filter: { [s.markerField]: marker } })
      : undefined);
  let record: Record<string, unknown> =
    existing ?? recordOf(await session.request(s.path, s.body));
  const id = String(record.id);
  if (!record.id)
    throw new Error(`${s.key}: creation did not return a record identity.`);
  // A completed checkpoint is a user-owned trial surface: reruns never resubmit or advance it.
  if (prior && existing) return { ...prior, id, status: String(record.status) };
  if (record.status === 'draft' && s.attachment) {
    if (s.attachment === 'reimbursement') {
      const upload = recordOf(
        await session.upload(
          '/reimbursementAttachments/uploadOne',
          trialPdf(),
          { 'x-reimbursement-request-id': id },
        ),
      );
      const form = {
        ...s.body,
        lines: [
          {
            id: `${trialPrefix}-line`,
            category: facts.dictionary.expenseCategory,
            date: facts.date,
            amountCents: 30000,
            invoiceNumber: `${trialPrefix}-INV-001`,
            attachmentIds: [upload.id],
            standardExceptionReason: '',
          },
        ],
      };
      await transition(session, s, id, record, 'edit', form);
    } else if (s.attachment === 'contracts') {
      const upload = recordOf(
        await session.upload('/contractAttachments/uploadOne', trialPdf(), {
          'x-contract-request-id': id,
          'x-contract-file-purpose': 'text',
        }),
      );
      const text = dataOf(
        await session.request(`${s.path}/${id}/textVersions`, {
          fileId: upload.id,
          requestId: randomUUID(),
        }),
      );
      await transition(session, s, id, record, 'edit', {
        ...proposal,
        textVersionId: (text.textVersion as { id: string }).id,
      });
    } else if (s.attachment === 'payment') {
      const upload = recordOf(
        await session.upload('/paymentAttachments/uploadOne', trialPdf(), {
          'x-payment-request-id': id,
        }),
      );
      await transition(session, s, id, record, 'edit', {
        ...s.body,
        attachments: [upload.id],
      });
    } else if (s.attachment === 'qualification') {
      const upload = recordOf(
        await session.upload(
          '/vendorQualificationAttachments/uploadOne',
          trialPdf(),
          { 'x-vendor-qualification-id': id },
        ),
      );
      await transition(session, s, id, record, 'edit', {
        ...inner,
        attachments: [upload.id],
      });
      const bank = dataOf(
        await session.request(`${s.path}/${id}/paymentAccount`),
      );
      record = recordOf(await session.request(`${s.path}/${id}`));
      await session.request(
        `${s.path}/${id}/paymentAccount`,
        {
          lifecycleVersion: record.lifecycleVersion,
          bankVersion: (bank.account as { version: number }).version,
          reason: '虚构示例银行资料',
          account: {
            bankName: '示例银行（不可支付）',
            bankAccount: '0000000000000000',
            bankAccountName: '虚构试用账户',
          },
        },
        'PATCH',
      );
    } else if (s.attachment === 'seals') {
      const upload = recordOf(
        await session.upload(`${s.path}/${id}/files`, trialPdf(), undefined, {
          requestKey: randomUUID(),
        }),
      );
      await transition(session, s, id, record, 'edit', {
        ...s.body,
        fileIds: [upload.id],
      });
    } else if (s.attachment === 'asset') {
      const png = new File(
        [
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ZkAAAAASUVORK5CYII=',
            'base64',
          ),
        ],
        'oa-trial-placeholder.png',
        { type: 'image/png' },
      );
      const upload = recordOf(
        await session.upload('/assetRequestPhotos/uploadOne', png, {
          'x-asset-request-id': id,
        }),
      );
      await session.request(
        `${s.path}/${id}`,
        {
          ...s.body,
          photos: [upload.id],
          lifecycleVersion: record.lifecycleVersion,
          requestId: randomUUID(),
        },
        'PATCH',
      );
    }
    record = recordOf(await session.request(`${s.path}/${id}`));
  }
  if (!s.draft && record.status === 'draft')
    await transition(
      s.path === '/probationRequests' ? sessions.probation : session,
      s,
      id,
      record,
      'submit',
    );
  if (s.stopAt || s.complete) await advance(sessions, s, id);
  record = recordOf(await session.request(`${s.path}/${id}`));
  return {
    key: s.key,
    title: s.title,
    path: s.path,
    id,
    status: String(record.status),
    actor: s.actor,
  };
}
