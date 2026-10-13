import { z } from 'zod';

export const ListQuery = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  departmentId: z.string().min(1).max(64).optional(),
  year: z.coerce.number().int().min(1900).max(9999).optional(),
});

export const HeadcountListQuery = ListQuery.extend({
  positionId: z.string().min(1).max(64).optional(),
});

export const LeaveMonthlyQuery = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  year: z.coerce.number().int().min(1900).max(9999).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  sort: z
    .enum(['year', 'month', 'approvedRequestCount', 'approvedRequestedDays'])
    .default('month'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  locale: z.enum(['en-US', 'zh-CN']).default('en-US'),
});
export const LeaveMonthlyRow = z.object({
  id: z.string(),
  year: z.number().int(),
  month: z.number().int(),
  leaveType: z.string(),
  approvedRequestCount: z.number().int(),
  approvedRequestedDays: z.number().nonnegative(),
});

export const ContractListQuery = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(255).optional(),
  endsBefore: z.iso.date().optional(),
  status: z.enum(['activePendingSeal', 'active', 'terminated']).optional(),
});

export const BudgetRow = z.object({
  id: z.string(),
  departmentId: z.string(),
  departmentName: z.string().nullable(),
  year: z.number().int(),
  subject: z.string(),
  subjectLabel: z.record(z.string(), z.string()).nullable(),
  allocatedCents: z.number().int(),
  heldCents: z.number().int(),
  usedCents: z.number().int(),
  availableCents: z.number().int(),
});

export const HeadcountRow = z.object({
  id: z.string(),
  departmentId: z.string(),
  departmentName: z.string().nullable(),
  positionId: z.string(),
  positionName: z.string().nullable(),
  year: z.number().int(),
  limit: z.number().int(),
  initialized: z.boolean(),
  used: z.number().int(),
  pending: z.number().int(),
  allocated: z.number().int(),
  replacementPending: z.number().int(),
  replacementAllocated: z.number().int(),
  replacementBlocked: z.number().int(),
  available: z.number().int(),
  capacityState: z.enum(['uninitialized', 'blocked', 'ready']),
});

export const ContractRow = z.object({
  id: z.string(),
  number: z.string().nullable(),
  departmentId: z.string(),
  departmentName: z.string().nullable(),
  status: z.enum(['activePendingSeal', 'active', 'terminated']),
  amountCents: z.number().int(),
  heldCents: z.number().int(),
  paidCents: z.number().int(),
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
  asOf: z.iso.date(),
  expiryState: z.enum(['terminated', 'expired', 'current']),
  paymentState: z.enum(['unpaid', 'partial', 'paid', 'overpaid']),
  paidBasisPoints: z.number().int().nullable(),
  availableCents: z.number().int(),
});

export const Meta = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  generatedAt: z.iso.datetime(),
  filters: z.record(z.string(), z.union([z.string(), z.number()])),
});
