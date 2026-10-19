import documentsEnUS from '../../../../server/locales/trial-documents/en-US.js';
import documentsZhCN from '../../../../server/locales/trial-documents/zh-CN.js';
import type { Application } from '@nocobase/app-server/application';
import { databaseManagerToken } from '@nocobase/db';
import { knowledgeServiceToken } from '../../../../server/providers/knowledge/contract.js';
import { announcementServiceToken } from '../../../../server/providers/announcements/contract.js';
import { workItemServiceToken } from '../../../../server/providers/work-items/contract.js';
import { approvalDirectoryServiceToken } from '../../../../server/providers/approval-directory/contract.js';
import {
  templatePrintServiceToken,
  PRINT_SOURCES,
} from '../../../../server/providers/template-print/contract.js';
import { strToU8, zipSync } from 'fflate';
import { trialPrefix, trialAccounts } from './accounts.js';
import { trustedPolicy, type TrialFacts, addDays } from './bootstrap.js';
import type { ScenarioResult } from './engine.js';
import { recordOf } from './http.js';

export async function collaboration(
  app: Application,
  f: TrialFacts,
): Promise<ScenarioResult[]> {
  const c = app.container;
  const db = c.resolve(databaseManagerToken);
  const result: ScenarioResult[] = [];
  await db.transaction(async (tx) => {
    const title = `${trialPrefix}·试用操作指南`;
    const existing = await tx
      .repository('knowledgeDocuments')
      .findOne({ filter: { title } });
    const knowledge =
      existing ??
      (await c.resolve(knowledgeServiceToken).save(
        {
          actorId: f.users.hr,
          requestKey: `${trialPrefix}-knowledge`,
          title,
          folderId: null,
          departmentIds: Object.values(f.departments),
          dutyRoleCodes: [],
          kind: 'markdown',
          markdown:
            '# OA试用指南\n\n所有记录均为虚构数据。\n\n1. 普通员工在任务中心发起申请。\n2. 主管、负责人和职能角色分别处理各自待办。\n3. 财务金额和人事受控字段按已有权限显示。\n4. 反复执行初始化会保留已经试用过的记录。',
        },
        tx,
        trustedPolicy,
        trustedPolicy,
        trustedPolicy,
      ));
    result.push({
      key: 'knowledge',
      title: '知识库',
      path: '/knowledge',
      id: String(knowledge.id),
      status: 'active',
      actor: 'hr',
    });
    const announcementTitle = `${trialPrefix}·OA试用通知（需回执）`;
    const previous = await tx
      .repository('announcements')
      .findOne({ filter: { title: announcementTitle } });
    let announcement =
      previous ??
      (await c.resolve(announcementServiceToken).save(
        {
          actorId: f.users.admin,
          requestId: `${trialPrefix}-announcement`,
          title: announcementTitle,
          body: '虚构试用通知：请登录各角色账号，查看待办、申请、台账及知识库，并确认收到本通知。',
          audience: {
            all: false,
            departmentIds: Object.values(f.departments),
            dutyRoleCodes: [],
          },
          requiresConfirmation: true,
          pinned: true,
          attachments: [],
          validFrom: f.instant(addDays(f.date, -7), '00:00'),
          validUntil: f.instant(addDays(f.date, 90), '23:59'),
          knowledgeDocumentId: String(knowledge.id),
        },
        tx,
        trustedPolicy,
        trustedPolicy,
      ));
    if (announcement.status === 'draft')
      announcement = await c.resolve(announcementServiceToken).act(
        {
          id: String(announcement.id),
          actorId: f.users.admin,
          requestId: `${trialPrefix}-publish`,
          expectedVersion: Number(announcement.version),
          action: 'publish',
        },
        tx,
        trustedPolicy,
        trustedPolicy,
      );
    result.push({
      key: 'announcement',
      title: '公告／回执',
      path: '/announcements',
      id: String(announcement.id),
      status: String(announcement.status),
      actor: 'admin',
    });
    for (const person of trialAccounts) {
      const taskTitle = `${trialPrefix}·${person.name}操作练习`;
      const old = await tx
        .repository('workItems')
        .findOne({ filter: { title: taskTitle } });
      let task =
        old ??
        (await c.resolve(workItemServiceToken).save(
          {
            actorId: f.users.manager,
            requestId: `${trialPrefix}-task-${person.key}`,
            title: taskTitle,
            description:
              '虚构任务：查看当前角色菜单和待办，完成一次操作后填写试用结果。',
            targetUserId: f.users[person.key],
            dutyRoleCode: null,
            dueAt: f.instant(addDays(f.date, 14), '18:00'),
            requiresConfirmation: true,
            attachments: [],
          },
          tx,
          trustedPolicy,
        ));
      if (task.status === 'draft')
        task = await c.resolve(workItemServiceToken).act(
          {
            actorId: f.users.manager,
            requestId: `${trialPrefix}-dispatch-${person.key}`,
            id: String(task.id),
            expectedVersion: Number(task.version),
            action: 'dispatch',
          },
          tx,
          trustedPolicy,
        );
      result.push({
        key: `work-${person.key}`,
        title: '协同任务',
        path: '/workItems',
        id: String(task.id),
        status: String(task.status),
        actor: person.key,
      });
    }
    if (
      !(await c.resolve(approvalDirectoryServiceToken).list(tx)).some(
        (row) =>
          row.principalId === f.users.finance2 && row.source === 'manual',
      )
    )
      await c.resolve(approvalDirectoryServiceToken).createManualDelegation(
        {
          principalId: f.users.finance2,
          delegateId: f.users.finance,
          scope: ['oa.general'],
          from: f.instant(f.date, '00:00'),
          to: f.instant(addDays(f.date, 14), '23:59'),
        },
        { actorId: f.users.finance2, connection: tx },
      );
  });
  const templateService = c.resolve(templatePrintServiceToken);
  const docx = zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${documentsZhCN.template}</w:t></w:r></w:p><w:p><w:r><w:t>${documentsEnUS.template}</w:t></w:r></w:p></w:body></w:document>`,
    ),
  });
  for (const source of PRINT_SOURCES) {
    const name = `${trialPrefix}·${source}打印模板`;
    const existing = await db
      .repository('printTemplates')
      .findOne({ filter: { name } });
    const template =
      existing ??
      recordOf(
        await templateService.create(
          f.users.system,
          { source, name, requestKey: `${trialPrefix}-template-${source}` },
          trustedPolicy,
        ),
      );
    const id = String(template.id);
    if (!template.currentRevisionId)
      await templateService.upload(
        id,
        f.users.system,
        {
          requestKey: `${trialPrefix}-template-upload-${source}`,
          version: Number(template.version),
          file: new File([new Uint8Array(docx)], `oa-trial-${source}.docx`, {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          }),
        },
        trustedPolicy,
      );
    result.push({
      key: `print-${source}`,
      title: '打印模板',
      path: '/printTemplates',
      id,
      status: 'active',
      actor: 'system',
    });
  }
  return result;
}
