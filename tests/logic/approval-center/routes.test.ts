// @vitest-environment node
import { describe, expect } from 'vitest';
import { apiDocsToken } from '@nocobase/app-server/router';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { databaseManagerToken } from '@nocobase/db';
import {
  createEmployee,
  createEmployeesAppTest,
  createPerson,
  grantToUser,
} from '../employees/helpers.ts';
import { json } from '../org/helpers.ts';

const test = createEmployeesAppTest();
describe('multi-business approval center', () => {
  test('requires identity and business grants, filters scopes before global paging', async ({
    testApp,
    request,
  }) => {
    expect((await request('/approvalCenter')).status).toBe(401);
    const person = await createPerson(testApp, 'No Business Grant');
    const sets =
      testApp.application.container.resolve(authorizationToken).permissionSets;
    const originals = await Promise.all(
      [
        'oa-work-items-employee',
        'oa-announcements-employee',
        'oa-recruitment-employee',
        'oa-seals-employee',
        'oa-vehicles-employee',
        'oa-transfer-employee',
        'oa-certificates-employee',
        'oa-leave-employee',
        'oa-overtime-employee',
        'oa-leave-cancellation-employee',
        'oa-general-employee',
        'oa-attendance-change-employee',
        'oa-outing-employee',
        'oa-supply-employee',
        'oa-budget-adjustment-employee',
        'oa-expense-plan-employee',
        'oa-training-employee',
        'oa-travel-employee',
        'oa-travel-cancellation-employee',
        'oa-loan-request-employee',
        'oa-reimbursement-employee',
        'oa-purchase-employee',
        'oa-payment-employee',
        'oa-probation-employee',
        'oa-departure-employee',
        'oa-vendor-qualification-employee',
        'oa-asset-requests-employee',
        'oa-contract-employee',
      ].map((key) => sets.get(key)),
    );
    try {
      for (const original of originals)
        await sets.update(original!.key, { ...original!, grants: [] });
      expect(
        (await (await person.session()).fetch('/approvalCenter')).status,
      ).toBe(403);
      await grantToUser(
        testApp,
        'center-ledger-only',
        [
          {
            resource: { type: 'composite', id: 'oa.supplies' },
            actions: [
              {
                action: 'ledger',
                policy: {
                  type: 'composite',
                  scopes: { supplyIssueLedger: 'allRecords' },
                },
              },
            ],
          },
        ],
        person.userId,
      );
      const ledgerOnly = await person.session();
      expect((await ledgerOnly.fetch('/supplyRequests/ledger')).status).toBe(
        200,
      );
      expect(
        (await ledgerOnly.fetch('/approvalCenter?kind=oa.supplies')).status,
      ).toBe(403);
    } finally {
      for (const original of originals)
        await sets.update(original!.key, original!);
    }
    const owner = await createEmployee(testApp, 'Center Owner');
    const stranger = await createEmployee(testApp, 'Center Stranger');
    const session = await owner.session();
    const leave = await session.fetch(
      '/leaveRequests',
      json({
        leaveType: 'personal',
        startDate: '2026-11-02',
        endDate: '2026-11-02',
        startHalf: 'am',
        endHalf: 'pm',
        reason: 'Center fixture',
        attachments: [],
        handoverUserId: null,
        enableDelegation: false,
      }),
    );
    expect(leave.status).toBe(200);
    const overtime = await session.fetch(
      '/overtimeRequests',
      json({
        date: '2026-11-03',
        minutes: 120,
        settlement: 'pay',
        reason: 'Center fixture',
      }),
    );
    expect(overtime.status).toBe(200);
    const response = await session.fetch(
      '/approvalCenter?view=mine&pageSize=1',
    );
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.meta).toEqual({
      page: 1,
      pageSize: 1,
      total: 2,
      kinds: [
        'oa.recruitment',
        'oa.sealRequest',
        'oa.vehicleRequest',
        'oa.transfer',
        'oa.certificateRequest',
        'oa.contract',
        'oa.assetRequest',
        'oa.vendorQualification',
        'oa.departure',
        'oa.probation',
        'oa.payment',
        'oa.loan',
        'oa.purchase',
        'oa.reimbursement',
        'oa.travel',
        'oa.travelCancellation',
        'oa.expensePlan',
        'oa.training',
        'oa.budgetAdjustment',
        'oa.supplies',
        'oa.attendanceChange',
        'oa.outing',
        'oa.general',
        'oa.leave',
        'oa.overtime',
        'oa.leaveCancellation',
      ],
      counts: { drafts: 2, revisions: 0, inProgress: 0 },
    });
    expect(result.data).toHaveLength(1);
    const summary = await (
      await session.fetch(
        '/approvalCenter?view=mine&pageSize=1&homeSummary=true',
      )
    ).json();
    expect(summary.data).toHaveLength(1);
    expect(summary.meta.attention.drafts).toHaveLength(2);
    expect(summary.meta.attention.revisions).toEqual([]);
    expect(summary.meta.attention.submitted).toEqual([]);
    expect(
      summary.meta.attention.drafts.every(
        (row: { title?: string }) => row.title === 'Center fixture',
      ),
    ).toBe(true);
    const drafts = await (
      await session.fetch(
        '/approvalCenter?view=mine&category=drafts&pageSize=1',
      )
    ).json();
    expect(drafts.meta.total).toBe(result.meta.counts.drafts);
    expect(drafts.data).toHaveLength(1);
    const submitted = await (
      await session.fetch('/approvalCenter?view=mine&category=submitted')
    ).json();
    expect(submitted.meta.total).toBe(0);
    expect(summary.meta.counts).toEqual(result.meta.counts);
    const hiddenSummary = await (
      await (
        await stranger.session()
      ).fetch('/approvalCenter?view=mine&homeSummary=true')
    ).json();
    expect(hiddenSummary.meta.attention.drafts).toEqual([]);

    const page2 = await (
      await session.fetch('/approvalCenter?view=mine&pageSize=1&page=2')
    ).json();
    expect(new Set([result.data[0].kind, page2.data[0].kind])).toEqual(
      new Set(['oa.leave', 'oa.overtime']),
    );
    const onlyOvertime = await (
      await session.fetch('/approvalCenter?view=mine&kind=oa.overtime')
    ).json();
    expect(onlyOvertime.data).toHaveLength(1);
    expect(onlyOvertime.data[0]).toMatchObject({
      kind: 'oa.overtime',
      amount: 120,
      unit: 'minutes',
      applicant: { id: owner.userId, name: 'Center Owner' },
    });
    expect(onlyOvertime.data[0]).not.toHaveProperty('reason');
    const strangerRows = await (
      await (await stranger.session()).fetch('/approvalCenter?view=mine')
    ).json();
    expect(strangerRows.data).toEqual([]);
    expect((await session.fetch('/approvalCenter?pageSize=101')).status).toBe(
      400,
    );
    const noMatches = await (
      await session.fetch('/approvalCenter?view=mine&search=unknown')
    ).json();
    expect(noMatches.meta.total).toBe(0);
    const lastPage = await (
      await session.fetch('/approvalCenter?view=mine&pageSize=1&page=999')
    ).json();
    expect(lastPage.meta.page).toBe(2);
    expect(lastPage.data).toHaveLength(1);
    const general = await session.fetch(
      '/generalRequests',
      json({
        title: 'General fixture',
        body: 'No period or unit',
        attachments: [],
        extraApproverIds: [stranger.userId],
      }),
    );
    expect(general.status).toBe(201);
    const generalRows = await (
      await session.fetch('/approvalCenter?view=mine&kind=oa.general')
    ).json();
    expect(generalRows.data).toHaveLength(1);
    expect(generalRows.data[0]).toMatchObject({
      kind: 'oa.general',
      title: 'General fixture',
      startDate: null,
      endDate: null,
      amount: null,
      unit: null,
    });
    await testApp.database.repository('departments').createOne({
      values: {
        id: 'center-budget-dept',
        title: 'Center budget department',
        managerId: stranger.userId,
        active: true,
      },
    });
    const budget = await session.fetch(
      '/budgetAdjustments',
      json({
        departmentId: 'center-budget-dept',
        year: 2026,
        subject: 'travel',
        adjustmentType: 'increase',
        sourceSubject: null,
        amountCents: 29,
        reason: 'Center exact-money fixture',
      }),
    );
    expect(budget.status).toBe(201);
    expect((await session.fetch('/budgetAdjustments/options')).status).toBe(
      200,
    );
    const budgetRows = await (
      await session.fetch('/approvalCenter?view=mine&kind=oa.budgetAdjustment')
    ).json();
    expect(budgetRows.data).toHaveLength(1);
    expect(budgetRows.data[0]).toMatchObject({
      kind: 'oa.budgetAdjustment',
      startDate: null,
      endDate: null,
      amount: 29,
      unit: 'cents',
    });
    const supplies = await session.fetch(
      '/supplyRequests',
      json({
        items: [{ code: 'stationery', quantity: 3 }],
        purpose: 'Center supplies fixture',
      }),
    );
    expect(supplies.status).toBe(200);
    const supplyRows = await (
      await session.fetch('/approvalCenter?view=mine&own=true&kind=oa.supplies')
    ).json();
    expect(supplyRows.data).toHaveLength(1);
    expect(supplyRows.data[0]).toMatchObject({
      kind: 'oa.supplies',
      applicantId: owner.userId,
      startDate: null,
      endDate: null,
      amount: null,
      unit: null,
    });
    expect(supplyRows.data[0]).not.toHaveProperty('items');
    const expensePlan = await session.fetch(
      '/expensePlans',
      json({
        matterType: 'entertainment',
        reason: 'Center expense fixture',
        amountCents: 29,
        subject: 'office',
        participants: 2,
        eventDate: '2026-11-12',
      }),
    );
    expect(expensePlan.status).toBe(201);
    const expenseRows = await (
      await session.fetch(
        '/approvalCenter?view=mine&own=true&kind=oa.expensePlan',
      )
    ).json();
    expect(expenseRows.data).toHaveLength(1);
    expect(expenseRows.data[0]).toMatchObject({
      kind: 'oa.expensePlan',
      amount: 29,
      unit: 'cents',
      startDate: '2026-11-12',
      endDate: '2026-11-12',
    });
    const foreignExpense = await (
      await stranger.session()
    ).fetch(
      '/expensePlans',
      json({
        matterType: 'entertainment',
        reason: 'Private expense',
        amountCents: 51,
        subject: 'office',
        participants: 1,
        eventDate: '2026-11-13',
      }),
    );
    expect(foreignExpense.status).toBe(201);
    const scopedExpenses = await (
      await session.fetch('/approvalCenter?view=mine&kind=oa.expensePlan')
    ).json();
    expect(scopedExpenses.data).toHaveLength(1);
    expect(scopedExpenses.data[0].applicantId).toBe(owner.userId);
    const training = await session.fetch(
      '/trainingRequests',
      json({
        name: 'Training',
        institution: 'Institute',
        startAt: '2026-11-12T00:00:00Z',
        endAt: '2026-11-12T01:00:00Z',
        usesWorkingTime: false,
        amountCents: 29,
        reason: 'Center training fixture',
      }),
    );
    expect(training.status).toBe(201);
    const trainingRows = await (
      await session.fetch('/approvalCenter?view=mine&kind=oa.training')
    ).json();
    expect(trainingRows.data).toHaveLength(1);
    expect(trainingRows.data[0]).toMatchObject({
      kind: 'oa.training',
      amount: 29,
      unit: 'cents',
      startDate: '2026-11-12',
      endDate: '2026-11-12',
    });
    const tripResponse = await session.fetch(
      '/travelRequests',
      json({
        destination: 'Shanghai',
        international: false,
        startAt: '2026-11-12T16:00:00Z',
        endAt: '2026-11-12T17:00:00Z',
        companionIds: [],
        attachments: [],
        transportCents: 2,
        lodgingCents: 3,
        allowanceCents: 4,
        needsBooking: false,
        needsLoan: false,
        reason: 'Center trip',
      }),
    );
    expect(tripResponse.status).toBe(201);
    const trip = (await tripResponse.json()).data.record;
    const tripRows = await (
      await session.fetch('/approvalCenter?view=mine&kind=oa.travel')
    ).json();
    expect(tripRows.data).toHaveLength(1);
    expect(tripRows.data[0]).toMatchObject({
      kind: 'oa.travel',
      amount: 9,
      unit: 'cents',
      startDate: '2026-11-13',
      endDate: '2026-11-13',
    });
    const cancelResponse = await session.fetch(
      '/travelCancellations',
      json({ sourceId: trip.id, reason: 'Cancel meeting' }),
    );
    expect(cancelResponse.status).toBe(201);
    const cancelRows = await (
      await session.fetch(
        '/approvalCenter?view=mine&kind=oa.travelCancellation',
      )
    ).json();
    expect(cancelRows.data).toHaveLength(1);
    expect(cancelRows.data[0]).toMatchObject({
      kind: 'oa.travelCancellation',
      amount: null,
      unit: null,
      startDate: null,
      endDate: null,
    });
    const foreignSupply = await (
      await stranger.session()
    ).fetch(
      '/supplyRequests',
      json({
        items: [{ code: 'stationery', quantity: 1 }],
        purpose: 'Private',
      }),
    );
    expect(foreignSupply.status).toBe(200);
    const scopedSupplies = await (
      await session.fetch('/approvalCenter?view=mine&kind=oa.supplies')
    ).json();
    expect(scopedSupplies.meta.total).toBe(1);
    expect(
      (await request('/generalAttachments/uploadOne', { method: 'POST' }))
        .status,
    ).toBe(401);
    await grantToUser(
      testApp,
      'center-delegate-fixture',
      [
        {
          resource: { type: 'composite', id: 'oa.overtime' },
          actions: [
            {
              action: 'delegate',
              policy: {
                type: 'composite',
                scopes: { overtimeRequests: 'allRecords' },
              },
            },
          ],
        },
      ],
      owner.userId,
    );
    await testApp.application.container
      .resolve(databaseManagerToken)
      .repository('dutyRoleMembers')
      .createOne({
        values: {
          id: 'center-hr-fixture',
          dutyRoleCode: 'hr',
          userId: owner.userId,
        },
      });
    for (let day = 4; day <= 10; day++) {
      const response = await session.fetch(
        '/overtimeRequests',
        json({
          applicantId: stranger.userId,
          date: `2026-11-${String(day).padStart(2, '0')}`,
          minutes: 60,
          settlement: 'pay',
          reason: 'Proxy fixture',
        }),
      );
      expect(response.status).toBe(200);
    }
    const own = await (
      await session.fetch(
        '/approvalCenter?view=mine&status=draft&own=true&pageSize=6',
      )
    ).json();
    expect(own.meta.total).toBe(9);
    expect(
      own.data.every(
        (row: { applicantId: string }) => row.applicantId === owner.userId,
      ),
    ).toBe(true);
    expect(own.meta.counts.drafts).toBe(9);
    const reimbursement = await session.fetch(
      '/reimbursementRequests',
      json({
        reason: 'Center reimbursement',
        authorizationId: null,
        loanId: null,
        offsetCents: 0,
        overrunReason: '',
        lines: [],
      }),
    );
    expect(reimbursement.status).toBe(201);
    const createdReimbursement = (await reimbursement.json()).data.record;
    const reimbursementCenter = await session.fetch(
      '/approvalCenter?view=mine&kind=oa.reimbursement',
    );
    expect(reimbursementCenter.status).toBe(200);
    const reimbursementRows = await reimbursementCenter.json();
    expect(reimbursementRows.meta.total).toBe(1);
    expect(reimbursementRows.data).toEqual([
      expect.objectContaining({
        id: createdReimbursement.id,
        kind: 'oa.reimbursement',
        title: 'Center reimbursement',
        amount: 0,
        unit: 'cents',
      }),
    ]);
    const foreignReimbursement = await (
      await stranger.session()
    ).fetch('/approvalCenter?view=mine&kind=oa.reimbursement');
    expect([200, 403]).toContain(foreignReimbursement.status);
    if (foreignReimbursement.status === 200)
      expect((await foreignReimbursement.json()).data).toEqual([]);
    const payment = await session.fetch(
      '/paymentRequests',
      json({
        reason: 'Center payment',
        sourceMode: 'none',
        purchaseOrderId: null,
        contractId: null,
        noPriorApprovalReason: 'No prior document',
        vendorId: null,
        amountCents: 67890,
        invoiceNumber: '',
        attachments: [],
        paymentMethod: '',
      }),
    );
    expect(payment.status).toBe(201);
    const createdPayment = (await payment.json()).data.record;
    const paymentCenter = await session.fetch(
      '/approvalCenter?view=mine&kind=oa.payment',
    );
    expect(paymentCenter.status).toBe(200);
    expect((await paymentCenter.json()).data).toEqual([
      expect.objectContaining({
        id: createdPayment.id,
        kind: 'oa.payment',
        amount: 67890,
        unit: 'cents',
      }),
    ]);
    const foreignPayment = await (
      await stranger.session()
    ).fetch('/approvalCenter?view=mine&kind=oa.payment');
    expect([200, 403]).toContain(foreignPayment.status);
    if (foreignPayment.status === 200)
      expect((await foreignPayment.json()).data).toEqual([]);
    const loan = await session.fetch(
      '/loanRequests',
      json({
        reason: 'Center loan',
        amountCents: 12345,
        dueDate: '2026-12-01',
        travelId: null,
      }),
    );
    expect(loan.status).toBe(201);
    const createdLoan = (await loan.json()).data.record;
    const loanCenter = await session.fetch(
      '/approvalCenter?view=mine&kind=oa.loan',
    );
    expect(loanCenter.status).toBe(200);
    expect((await loanCenter.json()).data).toEqual([
      expect.objectContaining({
        id: createdLoan.id,
        kind: 'oa.loan',
        amount: 12345,
        unit: 'cents',
      }),
    ]);
    const foreignLoan = await (
      await stranger.session()
    ).fetch('/approvalCenter?view=mine&kind=oa.loan');
    expect([200, 403]).toContain(foreignLoan.status);
    if (foreignLoan.status === 200)
      expect((await foreignLoan.json()).data).toEqual([]);
    const purchase = await session.fetch(
      '/purchaseRequests',
      json({
        items: [
          {
            id: 'center-item',
            name: 'Cable',
            specification: '',
            quantity: '1.5',
            unit: 'kg',
          },
        ],
        subject: 'office',
        estimatedCents: 1234,
        expectedDate: '2026-11-12',
        suggestedVendorId: null,
        purpose: 'Center purchase',
      }),
    );
    expect(purchase.status).toBe(201);
    const purchased = (await purchase.json()).data.record;
    const purchaseRows = await (
      await session.fetch('/approvalCenter?view=mine&kind=oa.purchase&own=true')
    ).json();
    expect(purchaseRows.meta.total).toBe(1);
    expect(purchaseRows.data).toEqual([
      expect.objectContaining({
        id: purchased.id,
        kind: 'oa.purchase',
        title: 'Center purchase',
        amount: 1234,
        unit: 'cents',
        startDate: null,
        endDate: null,
        status: 'draft',
      }),
    ]);
    const foreignPurchase = await (
      await stranger.session()
    ).fetch('/approvalCenter?view=mine&kind=oa.purchase');
    expect([200, 403]).toContain(foreignPurchase.status);
    if (foreignPurchase.status === 200)
      expect((await foreignPurchase.json()).data).toEqual([]);
    // Isolated fixture states verify full-set home summaries and category/count agreement.
    await testApp.database.repository('reimbursementRequests').updateOne({
      filter: { id: createdReimbursement.id },
      values: { status: 'head' },
    });
    await testApp.database.repository('purchaseRequests').updateOne({
      filter: { id: purchased.id },
      values: { status: 'revision' },
    });
    const home = await (
      await session.fetch(
        '/approvalCenter?view=mine&homeSummary=true&pageSize=1',
      )
    ).json();
    expect(home.data).toHaveLength(1);
    expect(home.meta.attention.submitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: createdReimbursement.id }),
        expect.objectContaining({ id: purchased.id }),
      ]),
    );
    for (const category of ['drafts', 'revisions', 'inProgress']) {
      const categoryResult = await (
        await session.fetch(
          `/approvalCenter?view=mine&category=${category}&pageSize=1`,
        )
      ).json();
      expect(categoryResult.meta.total).toBe(home.meta.counts[category]);
      expect(categoryResult.meta.counts[category]).toBe(
        home.meta.counts[category],
      );
    }
    const searchable = await (
      await session.fetch(
        '/approvalCenter?view=mine&search=Center%20reimbursement',
      )
    ).json();
    expect(searchable.data).toEqual([
      expect.objectContaining({ id: createdReimbursement.id }),
    ]);
    expect(
      (await session.fetch('/approvalCenter?category=invalid')).status,
    ).toBe(400);
    const document = await testApp.application.container
      .resolve(apiDocsToken)
      .getDocument();
    expect(document.paths?.['/api/approvalCenter']?.get?.operationId).toBe(
      'listApprovalCenter',
    );
  });
  test('projects an owned departure through its public service with a concise authorized summary', async ({
    testApp,
  }) => {
    const owner = await createEmployee(testApp, 'Departure center owner');
    const stranger = await createEmployee(testApp, 'Departure center stranger');
    const session = await owner.session();
    const response = await session.fetch(
      '/departureRequests',
      json({
        departureType: 'resignation',
        reason: 'Private departure detail',
        expectedLastWorkingDay: '2026-12-01',
      }),
    );
    expect(response.status).toBe(201);
    const record = (await response.json()).data.record;
    const centerResponse = await session.fetch(
      '/approvalCenter?view=mine&kind=oa.departure',
    );
    expect(centerResponse.status).toBe(200);
    const center = await centerResponse.json();
    expect(center.data).toHaveLength(1);
    expect(center.data[0]).toMatchObject({
      id: record.id,
      kind: 'oa.departure',
      applicantId: owner.userId,
      applicant: { id: owner.userId, name: 'Departure center owner' },
      startDate: '2026-12-01',
      endDate: null,
      amount: null,
      unit: null,
    });
    expect(center.data[0]).not.toHaveProperty('reason');
    const other = await (
      await stranger.session()
    ).fetch('/approvalCenter?view=mine&kind=oa.departure');
    expect(other.status).toBe(200);
    expect((await other.json()).data).toEqual([]);
  });
});
