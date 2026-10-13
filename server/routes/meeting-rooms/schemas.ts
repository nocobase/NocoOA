import { z } from 'zod';
const Id = z.string().min(1).max(64),
  Request = z.string().min(1).max(128),
  Version = z.number().int().positive();
export const Params = z.object({ id: Id });
export const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).optional(),
  active: z.enum(['true', 'false']).optional(),
  mode: z.enum(['mine', 'participating', 'administration']).default('mine'),
  sort: z
    .enum(['name', 'capacity', 'version', 'title', 'startAt', 'endAt'])
    .optional(),
  direction: z.enum(['asc', 'desc']).default('asc'),
  locale: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
});
export const RoomInput = z
  .object({
    requestId: Request,
    name: z.string().trim().min(1).max(200),
    location: z.string().max(2000).nullable(),
    facilities: z.string().max(2000).nullable(),
    capacity: z.number().int().min(1).max(10000),
    active: z.boolean(),
    requiresAdminConfirmation: z.boolean(),
    expectedVersion: Version.optional(),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();
const Time = z.string().regex(/^\d{2}:\d{2}$/),
  DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const BookingInput = z
  .object({
    requestId: Request,
    roomId: Id,
    title: z.string().trim().min(1).max(200),
    attendeeUserIds: z.array(Id).max(10000),
    date: DateOnly,
    startTime: Time,
    endTime: Time,
    recurrence: z
      .object({
        frequency: z.enum(['daily', 'weekly']),
        count: z.number().int().min(1).max(52),
      })
      .strict()
      .optional(),
  })
  .strict();
export const ActionInput = z
  .object({
    requestId: Request,
    expectedVersion: Version,
    reason: z.string().max(2000).optional(),
  })
  .strict();
export const EditInput = BookingInput.omit({ recurrence: true })
  .extend({
    target: z.enum(['this', 'future']),
    expectedVersions: z.record(Id, Version),
  })
  .strict();
export const CancelFutureInput = z
  .object({
    requestId: Request,
    expectedVersions: z.record(Id, Version),
    reason: z.string().max(2000).optional(),
  })
  .strict();
export const Range = z
  .object({
    startAt: z.iso.datetime({ offset: true }),
    endAt: z.iso.datetime({ offset: true }),
  })
  .refine(
    (v) =>
      new Date(v.endAt) > new Date(v.startAt) &&
      new Date(v.endAt).getTime() - new Date(v.startAt).getTime() <=
        366 * 86400000,
  );
export const Room = z.object({
  id: Id,
  name: z.string(),
  location: z.string().nullable(),
  facilities: z.string().nullable(),
  capacity: z.number(),
  active: z.boolean(),
  requiresAdminConfirmation: z.boolean(),
  version: Version,
});
const User = z.object({ id: Id, name: z.string() });
export const Booking = z.object({
  id: Id,
  seriesId: Id.nullable(),
  roomId: Id,
  organizerEmployeeId: Id,
  organizerUserId: Id,
  organizer: User,
  title: z.string(),
  companyTimeZone: z.string(),
  attendeeUserIds: z.array(Id),
  attendees: z.array(User),
  status: z.enum(['confirmed', 'pendingConfirmation', 'cancelled', 'rejected']),
  startAt: z.string(),
  endAt: z.string(),
  confirmedBy: Id.nullable(),
  confirmedByUser: User.nullable(),
  confirmedAt: z.string().nullable(),
  checkedInBy: Id.nullable(),
  checkedInByUser: User.nullable(),
  checkedInAt: z.string().nullable(),
  reason: z.string().nullable(),
  version: Version,
});
export const Availability = z.object({
  room: z.object({ id: Id, name: z.string() }),
  busy: z.array(z.object({ startAt: z.string(), endAt: z.string() })),
});
export const Meta = z.object({
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});

export const ActionNames = z.enum([
  'edit',
  'cancel',
  'confirm',
  'reject',
  'checkIn',
]);
export const Actions = z.object({ actions: z.array(ActionNames) });
export const FutureQuery = z
  .object({ action: z.enum(['edit', 'cancel']) })
  .strict();
export const Future = z.object({
  items: z.array(
    z.object({
      id: Id,
      version: Version,
      startAt: z.string().datetime({ offset: true }),
      status: z.enum(['confirmed', 'pendingConfirmation']),
    }),
  ),
  total: z.number().int().nonnegative(),
});
export const Options = z.object({
  companyTimeZone: z.string(),
  actor: z.object({ id: Id, name: z.string() }),
  modes: z.array(z.enum(['mine', 'participating', 'administration'])),
  canCreate: z.boolean(),
  canManage: z.boolean(),
});

export const RoomActions = z.object({ actions: z.array(z.literal('edit')) });

export const AvailabilitySearchQuery = Range.safeExtend({
  capacity: z.coerce.number().int().min(1).max(10000),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const AvailabilityRoom = Room.extend({
  busy: z.array(
    z.object({ startAt: z.iso.datetime(), endAt: z.iso.datetime() }),
  ),
});
