import { createLoanReminderService } from '../../../server/providers/loan-requests/reminders.ts';
import {
  checkLoanQuota,
  lockLoanApplicant,
} from '../../../server/providers/loan-requests/quota.ts';
// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { composite } from '../employees/helpers.ts';
import { write } from '../platform/helpers.ts';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
  type TestSession,
} from '@nocobase/app-plugin-authentication/testing';
import { describe, expect, vi } from 'vitest';
import { databaseManagerToken } from '@nocobase/db';
import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
import { createPlatformAppTest, createUser } from '../platform/helpers.ts';
import { createLoanRequestService } from '../../../server/providers/loan-requests/service.ts';
import { loanLedgerServiceToken } from '../../../server/providers/loan-ledger/contract.ts';
import { organizationServiceToken } from '../../../server/providers/org/index.ts';
import { orgServiceToken } from '../../../server/providers/org/contract.ts';
import { auditServiceToken } from '../../../server/providers/audit/index.ts';
import { employeeServiceToken } from '../../../server/providers/employees/contract.ts';
import { approvalDirectoryServiceToken } from '../../../server/providers/approval-directory/contract.ts';
import { approvalNotificationServiceToken } from '../../../server/providers/approval-notifications/contract.ts';
import {
  calendarServiceToken,
  ruleServiceToken,
  sequenceServiceToken,
} from '../../../server/providers/platform/index.ts';
const test = createPlatformAppTest();
describe('loan request lifecycle and money', () => {
  test('mandatory manager/head/finance stages then cashier claim and payment creates immutable debt; bank detail stays private', async ({
    app,
    testApp,
  }) => {
    const c = app.container,
      db = c.resolve(databaseManagerToken),
      tx = db.connection(),
      org = c.resolve(organizationServiceToken),
      employees = c.resolve(employeeServiceToken),
      ids: Record<string, string> = {},
      sessions: Record<string, TestSession> = {};
    for (const name of [
      'applicant',
      'manager',
      'head',
      'finance',
      'finance2',
      'cashier',
      'cfo',
    ]) {
      const user = await createUser(testApp, name);
      ids[name] = user.user.id;
      sessions[name] = user;
      await tx.repository('employees').createOne({
        values: {
          id: `loan-${name}`,
          code: randomUUID(),
          name,
          userId: user.user.id,
          status: 'regular',
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    await tx.repository('employees').updateMany({
      filter: { userId: ids.applicant },
      values: { managerId: 'loan-manager' },
    });
    const dept = await org.createDepartment(
      { title: 'Loan HQ', managerId: ids.head },
      { actorId: ids.head },
    );
    await org.addMember(
      { departmentId: dept.id, userId: ids.applicant, primary: true },
      { actorId: ids.head },
    );
    for (const [name, role] of [
      ['finance', 'finance'],
      ['finance2', 'finance'],
      ['cashier', 'cashier'],
      ['cfo', 'cfo'],
    ])
      await org.addDutyRoleMember(role, ids[name], { actorId: ids.head });
    const authz = c.resolve(authorizationToken);
    for (const name of ['applicant', 'head', 'cashier']) {
      const key = `loan-test-${name}`;
      await authz.permissionSets.create({
        key,
        title: key,
        grants: [
          composite('oa.loan', {
            view: { loanRequests: 'allRecords' },
            submit: { loanRequests: 'allRecords' },
            payment: { loanRequests: 'allRecords' },
          }),
        ],
      });
      await authz.permissionSets.assign({
        permissionSet: key,
        subject: { type: 'user', id: ids[name] },
      });
    }
    await authz.permissionSets.create({
      key: 'loan-test-view-only-cfo',
      title: 'View only CFO',
      grants: [composite('oa.loan', { view: { loanRequests: 'allRecords' } })],
    });
    await authz.permissionSets.assign({
      permissionSet: 'loan-test-view-only-cfo',
      subject: { type: 'user', id: ids.cfo },
    });
    sessions.admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
    ids.admin = sessions.admin.user.id;
    const bank = vi.spyOn(employees, 'paymentAccountOf').mockResolvedValue({
      bankName: 'Private bank',
      bankAccount: '123456',
      bankAccountName: 'Borrower',
    });
    const service = createLoanRequestService({
      db,
      ledger: c.resolve(loanLedgerServiceToken),
      org: c.resolve(orgServiceToken),
      audit: c.resolve(auditServiceToken),
      users: c.resolve(userAdministrationServiceToken),
      employees,
      directory: c.resolve(approvalDirectoryServiceToken),
      calendar: c.resolve(calendarServiceToken),
      rules: c.resolve(ruleServiceToken),
      sequences: c.resolve(sequenceServiceToken),
      notifications: c.resolve(approvalNotificationServiceToken),
    });
    await service.initialize();
    const draft = (
      await service.create(
        {
          reason: 'Office advance',
          amountCents: 10000,
          dueDate: '2099-12-31',
          travelId: null,
        },
        ids.applicant,
      )
    ).record;
    await service.transition(
      String(draft.id),
      'submit',
      ids.applicant,
      Number(draft.lifecycleVersion),
      randomUUID(),
    );
    const act = async (
      actorId: string,
      action = 'approve',
      input?: Record<string, string>,
      requestId = String(draft.id),
    ) => {
      const detail = await service.detail(requestId, actorId),
        offer = detail.taskActions.find((v) =>
          v.actions.some((a) => a.name === action),
        );
      expect(offer).toBeDefined();
      const run = detail.runs.find((v) => v.run.id === offer!.task.runId)!;
      return service.action(
        requestId,
        {
          target: { taskId: offer!.task.id },
          action,
          ...(action === 'unable' ? { comment: 'Bank transfer failed' } : {}),
          contentHash: run.run.contentHash,
          requestId: randomUUID(),
          ...(input ? { input } : {}),
        },
        actorId,
      );
    };
    expect(
      (await service.detail(String(draft.id), ids.applicant)).record.status,
    ).toBe('manager');
    await act(ids.manager);
    expect(
      (await service.detail(String(draft.id), ids.applicant)).record.status,
    ).toBe('head');
    const headStage = await service.detail(String(draft.id), ids.head);
    const headRun =
      headStage.runs.find((r) => r.run.status === 'head') ??
      headStage.runs.at(-1)!;
    const copyCandidates = await sessions.head.fetch(
      `/loanRequests/${draft.id}/candidates?runId=${headRun.run.id}&action=cc&search=manager`,
    );
    expect(copyCandidates.status).toBe(200);
    expect(await copyCandidates.json()).toMatchObject({
      data: { people: [{ id: ids.manager, name: 'manager' }] },
    });
    expect(
      (
        await sessions.head.fetch(
          `/loanRequests/${draft.id}/candidates?taskId=${headRun.run.id}&action=cc`,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await sessions.head.fetch(
          `/loanRequests/${draft.id}/candidates?runId=${headRun.run.id}&taskId=other&action=cc`,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await sessions.head.fetch(
          `/loanRequests/${draft.id}/candidates?runId=foreign-run&action=cc`,
        )
      ).status,
    ).toBe(403);
    await act(ids.head);
    await act(ids.finance);
    const approved = await service.detail(String(draft.id), ids.head);
    expect(approved.record.status).toBe('cashier');
    expect(approved.record.paymentAccount).toBeNull();
    expect(approved.view.record.paymentAccount).toBeNull();
    await expect(
      service.paymentInfo(String(draft.id), ids.head),
    ).rejects.toMatchObject({ code: 'LOAN_REQUEST_PAYMENT_ACCESS_DENIED' });
    expect(
      await service.paymentInfo(String(draft.id), ids.applicant),
    ).toMatchObject({ bankAccount: '123456' });
    expect(
      await service.paymentInfo(String(draft.id), ids.cashier),
    ).toMatchObject({ bankAccount: '123456' });
    expect(
      await c.resolve(loanLedgerServiceToken).listFor(ids.applicant),
    ).toHaveLength(0);
    const cashierTask = approved.runs
      .flatMap((r) => r.tasks)
      .find(
        (task) =>
          task.assigneeId === ids.cashier && task.status === 'candidate',
      )!;
    const replacementCandidates = await sessions.admin.fetch(
      `/loanRequests/${draft.id}/candidates?taskId=${cashierTask.id}&action=reassign`,
    );
    expect(replacementCandidates.status).toBe(200);
    const replacementPeople = (await replacementCandidates.json()).data
      .people as { id: string }[];
    expect(replacementPeople.some((p) => p.id === ids.cashier)).toBe(true);
    expect(
      replacementPeople.some(
        (p) => p.id === ids.finance || p.id === ids.applicant,
      ),
    ).toBe(false);
    await act(ids.cashier, 'claim');
    const headPayment = await sessions.head.fetch(
      `/loanRequests/${draft.id}/paymentAccount`,
    );
    expect(headPayment.status).toBe(403);
    expect((await sessions.cfo.fetch(`/loanRequests/${draft.id}`)).status).toBe(
      200,
    );
    expect(
      (await sessions.cfo.fetch(`/loanRequests/${draft.id}/paymentAccount`))
        .status,
    ).toBe(403);

    const httpDetail = await sessions.head.fetch(`/loanRequests/${draft.id}`);
    expect(httpDetail.status).toBe(200);
    expect(JSON.stringify(await httpDetail.json())).not.toContain('123456');
    await act(ids.cashier, 'unable');
    const exception = await service.detail(String(draft.id), ids.applicant);
    const retry = await sessions.applicant.fetch(
      `/loanRequests/${draft.id}/transition`,
      write('POST', {
        transition: 'retryCash',
        version: exception.record.lifecycleVersion,
        requestId: randomUUID(),
        input: {},
      }),
    );
    expect(retry.status).toBe(200);
    const retryBody = await retry.json();
    expect(JSON.stringify(retryBody)).not.toContain('123456');
    expect(retryBody.data.record.paymentAccount).toBeNull();
    await act(ids.cashier, 'claim');
    await expect(act(ids.cashier, 'complete', {})).rejects.toBeDefined();
    const audit = c.resolve(auditServiceToken);
    const writeAudit = audit.record.bind(audit);
    const failedAudit = vi
      .spyOn(audit, 'record')
      .mockImplementation(async (entry, connection) => {
        if (entry.action === 'loan.issue')
          throw new Error('Cash audit rollback');
        return writeAudit(entry, connection);
      });
    await expect(
      act(ids.cashier, 'complete', { paymentVoucher: 'PAY-ROLLBACK' }),
    ).rejects.toThrow('Cash audit rollback');
    expect(
      (await service.detail(String(draft.id), ids.applicant)).record,
    ).toMatchObject({ status: 'cashier', heldCents: 10000 });
    expect(
      await c.resolve(loanLedgerServiceToken).listFor(ids.applicant),
    ).toHaveLength(0);
    failedAudit.mockRestore();
    await act(ids.cashier, 'complete', { paymentVoucher: 'PAY-001' });
    const paid = await service.detail(String(draft.id), ids.applicant);
    expect(paid.record.status).toBe('paid');
    expect(paid.record.heldCents).toBe(0);
    expect(paid.loan).toMatchObject({
      principalCents: 10000,
      outstandingCents: 10000,
      dueDate: '2099-12-31',
    });
    const repayment = {
      receiptId: 'CASH-001',
      cents: 4000,
      reason: 'Cash received',
      requestKey: randomUUID(),
      operation: 'record' as const,
    };
    await expect(
      service.cashRepayment(String(draft.id), repayment, ids.applicant),
    ).rejects.toMatchObject({ code: 'LOAN_REQUEST_REPAYMENT_ACCESS_DENIED' });
    await service.cashRepayment(String(draft.id), repayment, ids.cashier);
    await service.cashRepayment(String(draft.id), repayment, ids.cashier);
    const waiting = await service.repayments(String(draft.id), ids.applicant);
    expect(waiting.reservations).toEqual([
      expect.objectContaining({ cents: 4000 }),
    ]);
    expect(waiting.loan).toMatchObject({
      outstandingCents: 10000,
      heldCents: 4000,
    });
    await expect(
      service.cashRepayment(
        String(draft.id),
        { ...repayment, operation: 'confirm', requestKey: randomUUID() },
        ids.cashier,
      ),
    ).rejects.toMatchObject({ code: 'LOAN_REQUEST_REPAYMENT_ACCESS_DENIED' });
    await expect(
      tx.transaction(async (connection) => {
        await lockLoanApplicant(ids.applicant, connection);
        await checkLoanQuota(
          {
            recordId: 'different-request',
            applicantId: ids.applicant,
            amountCents: 1,
            maxRule: 100,
            localDate: '2026-10-11',
          },
          c.resolve(loanLedgerServiceToken),
          connection,
        );
      }),
    ).rejects.toMatchObject({ code: 'LOAN_REQUEST_PERSONAL_LIMIT' });
    await expect(
      tx.transaction(async (connection) => {
        await lockLoanApplicant(ids.applicant, connection);
        await checkLoanQuota(
          {
            recordId: 'future-overdue',
            applicantId: ids.applicant,
            amountCents: 1,
            maxRule: 50000,
            localDate: '2100-01-01',
          },
          c.resolve(loanLedgerServiceToken),
          connection,
        );
      }),
    ).rejects.toMatchObject({ code: 'LOAN_REQUEST_OVERDUE' });
    const confirm = {
      ...repayment,
      operation: 'confirm' as const,
      requestKey: randomUUID(),
    };
    await service.cashRepayment(String(draft.id), confirm, ids.applicant);
    await service.cashRepayment(String(draft.id), confirm, ids.applicant);
    expect(
      (await service.repayments(String(draft.id), ids.applicant)).loan,
    ).toMatchObject({
      principalCents: 10000,
      outstandingCents: 6000,
      heldCents: 0,
    });
    const second = (
      await service.create(
        {
          reason: 'Second advance',
          amountCents: 5000,
          dueDate: '2099-12-31',
          travelId: null,
        },
        ids.applicant,
      )
    ).record;
    await service.transition(
      second.id,
      'submit',
      ids.applicant,
      second.lifecycleVersion,
      randomUUID(),
    );
    await act(ids.manager, 'approve', undefined, second.id);
    await act(ids.head, 'approve', undefined, second.id);
    await act(ids.finance, 'approve', undefined, second.id);
    const secondDetail = await service.detail(second.id, ids.admin);
    const terminated = await sessions.admin.fetch(
      `/loanRequests/${second.id}/transition`,
      write('POST', {
        transition: 'terminate',
        version: secondDetail.record.lifecycleVersion,
        requestId: randomUUID(),
        input: { reason: 'Administrative correction' },
      }),
    );
    expect(terminated.status).toBe(200);
    const terminatedBody = await terminated.json();
    expect(terminatedBody.data.record.status).toBe('terminated');
    expect(terminatedBody.data.record.paymentAccount).toBeNull();
    expect(JSON.stringify(terminatedBody)).not.toContain('123456');
    const notificationService = c.resolve(approvalNotificationServiceToken);
    const alarm = vi
      .spyOn(notificationService, 'alarm')
      .mockRejectedValueOnce(new Error('Delivery unavailable'))
      .mockResolvedValue(undefined);
    const reminders = createLoanReminderService({
      db,
      calendar: c.resolve(calendarServiceToken),
      ledger: c.resolve(loanLedgerServiceToken),
      directory: c.resolve(approvalDirectoryServiceToken),
      notifications: notificationService,
    });
    const beforeDue = new Date('2099-12-28T04:00:00Z');
    expect(c.resolve(calendarServiceToken).localDate(beforeDue)).toBe(
      '2099-12-28',
    );
    await expect(reminders.run(beforeDue)).rejects.toThrow(
      'Delivery unavailable',
    );
    await reminders.run(beforeDue);
    expect(alarm).toHaveBeenCalledTimes(2);
    expect(alarm.mock.calls[0][0].eventId).toBe(alarm.mock.calls[1][0].eventId);
    await reminders.run(beforeDue);
    expect(alarm).toHaveBeenCalledTimes(2);
    await reminders.run(new Date('2100-01-01T04:00:00Z'));
    await reminders.run(new Date('2100-01-02T04:00:00Z'));
    expect(alarm).toHaveBeenCalledTimes(3);
    await reminders.run(new Date('2100-01-08T04:00:00Z'));
    expect(alarm).toHaveBeenCalledTimes(4);
    const finalReceipt = {
      receiptId: 'CASH-FINAL',
      cents: 6000,
      reason: 'Remaining principal returned',
      operation: 'record' as const,
      requestKey: randomUUID(),
    };
    await service.cashRepayment(String(draft.id), finalReceipt, ids.cashier);
    await service.cashRepayment(
      String(draft.id),
      { ...finalReceipt, operation: 'confirm', requestKey: randomUUID() },
      ids.applicant,
    );
    await reminders.run(new Date('2100-01-15T04:00:00Z'));
    expect(alarm).toHaveBeenCalledTimes(4);
    alarm.mockRestore();
    const createPayload = {
      reason: 'Idempotent draft',
      amountCents: 1000,
      dueDate: '2099-12-31',
      travelId: null,
      requestId: randomUUID(),
    };
    const creations = await Promise.all([
      sessions.applicant.fetch('/loanRequests', write('POST', createPayload)),
      sessions.applicant.fetch('/loanRequests', write('POST', createPayload)),
    ]);
    expect(creations.map((r) => r.status)).toEqual([201, 201]);
    const createdBodies = await Promise.all(creations.map((r) => r.json()));
    expect(createdBodies[0].data.record.id).toBe(
      createdBodies[1].data.record.id,
    );
    const changedCreation = await sessions.applicant.fetch(
      '/loanRequests',
      write('POST', { ...createPayload, amountCents: 1001 }),
    );
    expect(changedCreation.status).toBe(409);
    const capped = await Promise.all(
      ['A', 'B'].map(
        async (suffix) =>
          (
            await service.create(
              {
                reason: `Concurrent cap ${suffix}`,
                amountCents: 3000000,
                dueDate: '2099-12-31',
                travelId: null,
              },
              ids.applicant,
            )
          ).record,
      ),
    );
    const submitted = await Promise.allSettled(
      capped.map((r) =>
        service.transition(
          r.id,
          'submit',
          ids.applicant,
          r.lifecycleVersion,
          randomUUID(),
        ),
      ),
    );
    expect(submitted.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(submitted.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const rejectedResult = submitted.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(rejectedResult.reason).toMatchObject({
      code: 'LOAN_REQUEST_PERSONAL_LIMIT',
    });
    const winner = capped[submitted.findIndex((r) => r.status === 'fulfilled')];
    const winnerDetail = await service.detail(winner.id, ids.applicant);
    await service.transition(
      winner.id,
      'withdraw',
      ids.applicant,
      winnerDetail.record.lifecycleVersion,
      randomUUID(),
    );
    expect(
      (await service.detail(winner.id, ids.applicant)).record.heldCents,
    ).toBe(0);
    await tx.repository('employees').updateMany({
      filter: { userId: ids.applicant },
      values: { managerId: null },
    });
    const unassignedDraft = (
      await service.create(
        {
          reason: 'Missing manager must alert administrators',
          amountCents: 1000,
          dueDate: '2099-12-31',
          travelId: null,
        },
        ids.applicant,
      )
    ).record;
    await service.transition(
      unassignedDraft.id,
      'submit',
      ids.applicant,
      unassignedDraft.lifecycleVersion,
      randomUUID(),
    );
    const heldDetail = await service.detail(unassignedDraft.id, ids.applicant);
    expect(heldDetail.record.status).toBe('manager');
    expect(heldDetail.runs.at(-1)?.run.status).toBe('manager');
    const maintenanceAlarm = vi
      .spyOn(notificationService, 'alarm')
      .mockResolvedValue(undefined);
    await service.maintenance();
    expect(maintenanceAlarm).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: unassignedDraft.id,
        kind: 'oa.loan',
        reason: 'unassigned',
        recipients: expect.arrayContaining([ids.admin]),
      }),
    );
    maintenanceAlarm.mockRestore();
    bank.mockRestore();
  });
});
