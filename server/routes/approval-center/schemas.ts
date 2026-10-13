import { z } from 'zod';

export const CenterQuery = z.object({
  view: z.enum(['mine', 'pending', 'done', 'copied']).default('pending'),
  kind: z
    .enum([
      'oa.workItem',
      'oa.announcementReceipt',
      'oa.recruitment',
      'oa.sealRequest',
      'oa.vehicleRequest',
      'oa.transfer',
      'oa.certificateRequest',
      'oa.leave',
      'oa.overtime',
      'oa.leaveCancellation',
      'oa.general',
      'oa.supplies',
      'oa.budgetAdjustment',
      'oa.expensePlan',
      'oa.training',
      'oa.travel',
      'oa.reimbursement',
      'oa.purchase',
      'oa.loan',
      'oa.payment',
      'oa.probation',
      'oa.departure',
      'oa.vendorQualification',
      'oa.assetRequest',
      'oa.contract',
      'oa.travelCancellation',
      'oa.attendanceChange',
      'oa.outing',
    ])
    .optional(),
  search: z.string().trim().max(200).default(''),
  status: z.string().max(64).optional(),
  category: z
    .enum(['drafts', 'revisions', 'inProgress', 'submitted'])
    .optional(),
  homeSummary: z.enum(['true', 'false']).default('false'),
  own: z.enum(['true', 'false']).default('false'),
  orderBy: z.enum(['createdAt', 'startDate', 'dueAt']).default('createdAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const CenterItem = z.object({
  id: z.string(),
  kind: z.enum([
    'oa.workItem',
    'oa.announcementReceipt',
    'oa.recruitment',
    'oa.sealRequest',
    'oa.vehicleRequest',
    'oa.transfer',
    'oa.certificateRequest',
    'oa.leave',
    'oa.overtime',
    'oa.leaveCancellation',
    'oa.general',
    'oa.supplies',
    'oa.budgetAdjustment',
    'oa.expensePlan',
    'oa.training',
    'oa.travel',
    'oa.reimbursement',
    'oa.purchase',
    'oa.loan',
    'oa.payment',
    'oa.probation',
    'oa.departure',
    'oa.vendorQualification',
    'oa.assetRequest',
    'oa.contract',
    'oa.travelCancellation',
    'oa.attendanceChange',
    'oa.outing',
  ]),
  title: z.string().optional(),
  updatedAt: z.string().nullable().optional(),
  dueAt: z.string().optional(),
  number: z.string().nullable(),
  applicantId: z.string(),
  applicant: z.object({ id: z.string(), name: z.string() }).nullable(),
  status: z.string(),
  createdAt: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  amount: z.number().nullable(),
  unit: z.enum(['days', 'minutes', 'cents']).nullable(),
});
export type CenterRecord = z.infer<typeof CenterItem>;
export const CenterMeta = z.object({
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  kinds: z.array(
    z.enum([
      'oa.workItem',
      'oa.announcementReceipt',
      'oa.recruitment',
      'oa.sealRequest',
      'oa.vehicleRequest',
      'oa.transfer',
      'oa.certificateRequest',
      'oa.leave',
      'oa.overtime',
      'oa.leaveCancellation',
      'oa.general',
      'oa.supplies',
      'oa.budgetAdjustment',
      'oa.expensePlan',
      'oa.training',
      'oa.travel',
      'oa.reimbursement',
      'oa.purchase',
      'oa.loan',
      'oa.payment',
      'oa.probation',
      'oa.departure',
      'oa.vendorQualification',
      'oa.assetRequest',
      'oa.contract',
      'oa.travelCancellation',
      'oa.attendanceChange',
      'oa.outing',
    ]),
  ),
  attention: z
    .object({
      drafts: z.array(CenterItem),
      revisions: z.array(CenterItem),
      submitted: z.array(CenterItem),
    })
    .optional(),
  counts: z.object({
    drafts: z.number(),
    revisions: z.number(),
    inProgress: z.number(),
  }),
});

const BatchRecord = z.strictObject({
  kind: CenterItem.shape.kind,
  id: z.string().min(1).max(128),
});
const distinctRecords = (items: { kind: string; id: string }[]) =>
  new Set(items.map((v) => `${v.kind}:${v.id}`)).size === items.length;
export const BatchOptionsInput = z.strictObject({
  items: z
    .array(BatchRecord)
    .min(1)
    .max(100)
    .refine(distinctRecords, 'Duplicate record'),
});
export const BatchCandidate = BatchRecord.extend({
  taskId: z.string().min(1),
  contentHash: z.string().min(1),
});
export const BatchApproveInput = z.strictObject({
  items: z
    .array(BatchCandidate.extend({ requestId: z.string().min(1).max(128) }))
    .min(1)
    .max(20)
    .refine(distinctRecords, 'Duplicate record')
    .refine(
      (items) => new Set(items.map((v) => v.requestId)).size === items.length,
      'Duplicate requestId',
    ),
});
export const BatchResult = BatchRecord.extend({
  status: z.enum(['approved', 'unavailable', 'failed']),
});
