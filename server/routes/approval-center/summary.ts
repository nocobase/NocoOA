import type { CenterRecord } from './schemas.js';

// These summaries only consume the owning service's already-authorized DTO.
// Never substitute lifecycle statusChangedAt for a real last-edit timestamp.
export function readableSummary(record: object, field: string) {
  const values = record as Record<string, unknown>;
  const text = values[field];
  const title =
    typeof text === 'string'
      ? text.replace(/\s+/g, ' ').trim().slice(0, 240)
      : '';
  const date = values.updatedAt;
  const timestamp =
    typeof date === 'string' || date instanceof Date ? new Date(date) : null;
  return {
    ...(title ? { title } : {}),
    ...(timestamp && Number.isFinite(timestamp.getTime())
      ? { updatedAt: timestamp.toISOString() }
      : {}),
  };
}

const inProgressStatuses = new Set([
  'hrbp',
  'hrDirector',
  'legal',
  'financeManager',
  'stamping',
  'returning',
  'returnException',
  'dispatch',
  'usage',
  'manager',
  'sourceHead',
  'targetHead',
  'pendingEffective',
  'cancellationReview',
  'head',
  'hr',
  'extra',
  'issuing',
  'booking',
  'unbooking',
  'cashier',
  'finance',
  'executive',
  'cfo',
  'gm',
]);

export type CenterCategory =
  'drafts' | 'revisions' | 'inProgress' | 'submitted';
export function matchesCategory(
  record: CenterRecord,
  category: CenterCategory,
  actorId: string,
) {
  // Submitted retains the owning service's mine scope, including authorized proxy creation.
  if (category === 'submitted') return record.status !== 'draft';
  if (record.applicantId !== actorId) return false;
  if (category === 'drafts') return record.status === 'draft';
  if (category === 'revisions')
    return ['revision', 'exception'].includes(record.status);
  return inProgressStatuses.has(record.status);
}
