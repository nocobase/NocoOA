export interface Room {
  id: string;
  name: string;
  location: string | null;
  facilities: string | null;
  capacity: number;
  active: boolean;
  requiresAdminConfirmation: boolean;
  version: number;
}
export interface Person {
  id: string;
  name: string;
}
export interface Booking {
  id: string;
  seriesId: string | null;
  roomId: string;
  organizerUserId: string;
  organizer: Person;
  title: string;
  companyTimeZone: string;
  attendeeUserIds: string[];
  attendees: Person[];
  status: 'confirmed' | 'pendingConfirmation' | 'cancelled' | 'rejected';
  startAt: string;
  endAt: string;
  confirmedByUser: Person | null;
  confirmedAt: string | null;
  checkedInByUser: Person | null;
  checkedInAt: string | null;
  reason: string | null;
  version: number;
}
export type Action = 'edit' | 'cancel' | 'confirm' | 'reject' | 'checkIn';
export type Tab =
  'availability' | 'rooms' | 'mine' | 'participating' | 'administration';
export interface Options {
  companyTimeZone: string;
  actor: Person;
  modes: Exclude<Tab, 'rooms' | 'availability'>[];
  canCreate: boolean;
  canManage: boolean;
}
export interface Page<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}
export interface Future {
  items: { id: string; version: number; startAt: string; status: string }[];
  total: number;
}
export interface Context {
  onSaved: () => void;
  options?: Options;
}
export function dateLabel(
  value: string | null,
  language: string,
  zone: string,
) {
  return value
    ? new Intl.DateTimeFormat(language, {
        timeZone: zone,
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))
    : '—';
}
