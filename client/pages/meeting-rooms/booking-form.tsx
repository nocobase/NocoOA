import { createRequestKey } from '#lib/request-key';
import { errorKey } from './errors.js';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import {
  ApiClientError,
  useApiClient,
  useToaster,
  useNavigationGuard,
} from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from 'react-router';
import { RouteFormPage } from '#components/route-form-page';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { DatePicker } from '#components/date-picker';
import { parts } from '#components/date-time-picker-zone';
import { UserMultiPicker } from '#components/user-picker';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
  FieldSet,
  FieldLegend,
  FieldDescription,
} from '#components/ui/field';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '#components/ui/alert-dialog';
import { Input } from '#components/ui/input';
import { Button } from '#components/ui/button';
import { Switch } from '#components/ui/switch';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '#components/ui/select';
import { Spinner } from '#components/ui/spinner';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Availability, FutureList } from './availability.js';
import { useMeetingResource } from './resource.js';
import { Loading, MeetingError, FormError } from './states.js';
import {
  type Booking,
  type Room,
  type Options,
  type Page,
  type Context,
  type Future,
} from './types.js';
export default function BookingForm() {
  const { t: drawerTitle } = useTranslation();
  const { bookingId, roomId } = useParams(),
    { t } = useTranslation(),
    parent = useOutletContext<Context>();
  const r = useMeetingResource<{ data: Booking }>(
      bookingId ? `meetingBookings/${encodeURIComponent(bookingId)}` : null,
    ),
    a = useMeetingResource<{ data: { actions: string[] } }>(
      bookingId
        ? `meetingBookings/${encodeURIComponent(bookingId)}/actions`
        : null,
    ),
    o = useMeetingResource<{ data: Options }>('meetingBookings/options');
  const ready =
    !r.loading &&
    !r.error &&
    !a.loading &&
    !a.error &&
    !o.loading &&
    !o.error &&
    !!o.data &&
    (bookingId
      ? !!r.data && !!a.data?.data.actions.includes('edit')
      : o.data.data.canCreate);
  return (
    <RouteFormPage
      title={drawerTitle(
        bookingId ? 'meetingRooms.editBooking' : 'meetingRooms.reserve',
      )}
    >
      <PageContainer>
        {r.error ? <MeetingError error={r.error} retry={r.reload} /> : null}
        {a.error ? <MeetingError error={a.error} retry={a.reload} /> : null}
        {o.error ? <MeetingError error={o.error} retry={o.reload} /> : null}
        {r.loading || a.loading || o.loading ? (
          <>
            <BackButton />
            <PageHeader
              title={t(
                bookingId ? 'meetingRooms.editBooking' : 'meetingRooms.reserve',
              )}
            />
            <Loading />
          </>
        ) : ready ? (
          <FormBody
            key={r.data?.data.version ?? 'new'}
            booking={r.data?.data}
            initialRoomId={roomId}
            options={o.data!.data}
            saved={parent.onSaved}
          />
        ) : (
          <>
            <BackButton />
            <PageHeader
              title={t(
                bookingId ? 'meetingRooms.editBooking' : 'meetingRooms.reserve',
              )}
            />
            <Alert>
              <AlertDescription>
                {t('meetingRooms.errors.unavailable')}
              </AlertDescription>
            </Alert>
          </>
        )}
      </PageContainer>
    </RouteFormPage>
  );
}
function FormBody({
  booking,
  initialRoomId,
  options,
  saved,
}: {
  booking?: Booking;
  initialRoomId?: string;
  options: Options;
  saved: () => void;
}) {
  const { t } = useTranslation(),
    api = useApiClient(),
    toaster = useToaster(),
    location = useLocation(),
    navigate = useNavigate(),
    [requestId] = useState(() => createRequestKey()),
    [roomSearch, setRoomSearch] = useState(''),
    [future, setFuture] = useState(false),
    [searchTerm, setSearchTerm] = useState(''),
    [composing, setComposing] = useState(false),
    [discard, setDiscard] = useState(false);
  const savedRef = useRef(false);
  useEffect(() => {
    if (composing) return;
    const timer = setTimeout(() => setSearchTerm(roomSearch.trim()), 300);
    return () => clearTimeout(timer);
  }, [roomSearch, composing]);
  const zone = options.companyTimeZone,
    begin = booking ? parts(booking.startAt, zone) : undefined,
    end = booking ? parts(booking.endAt, zone) : undefined;
  const schema = useMemo(
    () =>
      z
        .object({
          roomId: z.string().min(1, t('meetingRooms.validation.required')),
          title: z
            .string()
            .trim()
            .min(1, t('meetingRooms.validation.required'))
            .max(200),
          attendeeUserIds: z.array(z.string()),
          date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/, t('meetingRooms.validation.date')),
          startTime: z
            .string()
            .regex(/^\d{2}:\d{2}$/, t('meetingRooms.validation.time')),
          endTime: z
            .string()
            .regex(/^\d{2}:\d{2}$/, t('meetingRooms.validation.time')),
          frequency: z.enum(['none', 'daily', 'weekly']),
          count: z
            .number()
            .int()
            .min(1, t('meetingRooms.validation.count'))
            .max(52, t('meetingRooms.validation.count')),
        })
        .refine((v) => v.endTime > v.startTime, {
          message: t('meetingRooms.validation.interval'),
          path: ['endTime'],
        }),
    [t],
  );
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      roomId:
        booking?.roomId ??
        initialRoomId ??
        new URLSearchParams(location.search).get('selectedRoom') ??
        '',
      title: booking?.title ?? '',
      attendeeUserIds: booking?.attendeeUserIds ?? [],
      date:
        begin?.date ??
        new URLSearchParams(location.search).get('meetingDate') ??
        '',
      startTime:
        begin?.time ??
        new URLSearchParams(location.search).get('meetingStart') ??
        '09:00',
      endTime:
        end?.time ??
        new URLSearchParams(location.search).get('meetingEnd') ??
        '10:00',
      frequency: 'none' as const,
      count: 1,
    },
  });
  const values = useWatch({ control: form.control });
  const rooms = useMeetingResource<Page<Room>>('meetingRooms', {
      active: 'true',
      pageSize: '100',
      search: searchTerm,
    }),
    selected = useMeetingResource<{ data: Room }>(
      (values.roomId ?? '')
        ? `meetingRooms/${encodeURIComponent(values.roomId ?? '')}`
        : null,
    ),
    f = useMeetingResource<{ data: Future }>(
      future && booking
        ? `meetingBookings/${encodeURIComponent(booking.id)}/future`
        : null,
      { action: 'edit' },
    );
  const roomItems = [
    ...new Map(
      [
        ...(selected.data ? [selected.data.data] : []),
        ...(rooms.data?.data ?? []),
      ].map((room) => [room.id, room]),
    ).values(),
  ].map((room) => ({ value: room.id, label: room.name }));
  const frequencyItems = ['none', 'daily', 'weekly'].map((value) => ({
    value,
    label: t(`meetingRooms.series.${value}`),
  }));
  const { isDirty, isSubmitting } = form.formState;
  useNavigationGuard(() => {
    if (savedRef.current) return true;
    if (isSubmitting) return false;
    if (!isDirty) return true;
    setDiscard(true);
    return false;
  });
  const goBack = () =>
    navigate(
      { pathname: '..', search: location.search, hash: location.hash },
      { replace: true, relative: 'route' },
    );
  const submit = (event: FormEvent<HTMLFormElement>) =>
    form.handleSubmit(
      async (values) => {
        if (future && (!f.data || f.loading || f.error)) {
          form.setError('root', {
            message: t('meetingRooms.errors.unavailable'),
          });
          return;
        }
        try {
          const payload = {
            requestId,
            roomId: values.roomId,
            title: values.title,
            attendeeUserIds: values.attendeeUserIds,
            date: values.date,
            startTime: values.startTime,
            endTime: values.endTime,
            ...(booking
              ? {
                  target: future ? 'future' : 'this',
                  expectedVersions: future
                    ? Object.fromEntries(
                        f.data!.data.items.map((row) => [row.id, row.version]),
                      )
                    : { [booking.id]: booking.version },
                }
              : values.frequency === 'none'
                ? {}
                : {
                    recurrence: {
                      frequency: values.frequency,
                      count: values.count,
                    },
                  }),
          };
          const result = await api.request<{ data: Booking[] }>({
            path: booking
              ? `meetingBookings/${encodeURIComponent(booking.id)}`
              : 'meetingBookings',
            method: booking ? 'PATCH' : 'POST',
            json: payload,
          });
          form.reset(values);
          savedRef.current = true;
          toaster.show({
            type: 'success',
            title: t('meetingRooms.savedBooking', {
              name: values.title,
              count: result.data.length,
            }),
          });
          saved();
          await goBack();
        } catch (error) {
          const key = errorKey(error);
          if (['ROOM_CONFLICT', 'CAPACITY_EXCEEDED'].includes(key))
            form.setError(
              'roomId',
              { message: t(`meetingRooms.errors.${key}`) },
              { shouldFocus: true },
            );
          else if (
            [
              'AMBIGUOUS_LOCAL_TIME',
              'NONEXISTENT_LOCAL_TIME',
              'INVALID_INTERVAL',
            ].includes(key)
          )
            form.setError(
              'startTime',
              { message: t(`meetingRooms.errors.${key}`) },
              { shouldFocus: true },
            );
          else
            form.setError('root', {
              type:
                error instanceof ApiClientError && error.status === 401
                  ? 'sessionExpired'
                  : 'server',
              message: t(`meetingRooms.errors.${key}`),
            });
        }
      },
      (errors) => {
        const first = Object.keys(errors)[0];
        document.getElementById(`booking-${first}`)?.focus();
      },
    )(event);
  const busy = form.formState.isSubmitting;
  return (
    <>
      <BackButton />
      <PageHeader
        title={t(booking ? 'meetingRooms.editBooking' : 'meetingRooms.reserve')}
        description={t('meetingRooms.timeZoneDescription', { zone })}
        actions={
          <>
            <Button
              variant='outline'
              disabled={busy}
              onClick={() => void goBack()}
            >
              {t('meetingRooms.cancel')}
            </Button>
            <Button
              type='submit'
              form='booking-form'
              disabled={
                busy ||
                rooms.loading ||
                !!rooms.error ||
                (future && (f.loading || !!f.error))
              }
            >
              {busy ? <Spinner data-icon='inline-start' /> : null}
              {t(booking ? 'meetingRooms.save' : 'meetingRooms.reserve')}
            </Button>
          </>
        }
      />
      <form id='booking-form' noValidate onSubmit={(e) => void submit(e)}>
        <FieldGroup>
          <FormError error={form.formState.errors.root} />
          <FieldSet>
            <FieldLegend>{t('meetingRooms.form.content')}</FieldLegend>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor='room-search'>
                  {t('meetingRooms.roomSearch')}
                </FieldLabel>
                <Input
                  id='room-search'
                  value={roomSearch}
                  onChange={(e) => setRoomSearch(e.target.value)}
                  onCompositionStart={() => setComposing(true)}
                  onCompositionEnd={() => setComposing(false)}
                />
              </Field>
              {rooms.error ? (
                <MeetingError error={rooms.error} retry={rooms.reload} />
              ) : null}
              {rooms.data && rooms.data.meta.total > 100 ? (
                <Alert>
                  <AlertDescription>
                    {t('meetingRooms.roomLimit', { count: 100 })}
                  </AlertDescription>
                </Alert>
              ) : null}
              <Controller
                name='roomId'
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor='booking-roomId'>
                      {t('meetingRooms.fields.room')}
                      <span aria-hidden='true' className='text-destructive'>
                        *
                      </span>
                    </FieldLabel>
                    <Select
                      items={roomItems}
                      value={field.value || null}
                      onValueChange={(value) => field.onChange(value ?? '')}
                    >
                      <SelectTrigger
                        id='booking-roomId'
                        ref={field.ref}
                        onBlur={field.onBlur}
                        aria-invalid={fieldState.invalid}
                        aria-required='true'
                        disabled={busy}
                        className='w-full'
                      >
                        <SelectValue
                          placeholder={t('meetingRooms.selectRoom')}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {roomItems.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
              <Controller
                name='title'
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor='booking-title'>
                      {t('meetingRooms.fields.title')}
                      <span aria-hidden='true' className='text-destructive'>
                        *
                      </span>
                    </FieldLabel>
                    <Input
                      {...field}
                      id='booking-title'
                      aria-invalid={fieldState.invalid}
                      aria-required='true'
                      disabled={busy}
                    />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
              <Controller
                name='attendeeUserIds'
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor='booking-attendeeUserIds'>
                      {t('meetingRooms.fields.attendees')}
                    </FieldLabel>
                    <UserMultiPicker
                      id='booking-attendeeUserIds'
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      knownUsers={booking?.attendees}
                      excludeIds={[options.actor.id]}
                      invalid={fieldState.invalid}
                      disabled={busy}
                    />
                    <FieldDescription>
                      {t('meetingRooms.organizerIncluded')}
                    </FieldDescription>
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
            </FieldGroup>
          </FieldSet>
          <FieldSet>
            <FieldLegend>{t('meetingRooms.form.time')}</FieldLegend>
            <FieldGroup>
              <Controller
                name='date'
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor='booking-date'>
                      {t('meetingRooms.fields.date')}
                      <span aria-hidden='true' className='text-destructive'>
                        *
                      </span>
                    </FieldLabel>
                    <DatePicker
                      id='booking-date'
                      value={
                        field.value
                          ? new Date(`${field.value}T12:00:00`)
                          : undefined
                      }
                      onChange={(date) =>
                        field.onChange(date ? format(date, 'yyyy-MM-dd') : '')
                      }
                      onBlur={field.onBlur}
                      invalid={fieldState.invalid}
                      disabled={busy || future}
                      className='w-full sm:w-60'
                    />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
              {(['startTime', 'endTime'] as const).map((name) => (
                <Controller
                  key={name}
                  name={name}
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={`booking-${name}`}>
                        {t(`meetingRooms.fields.${name}`)}
                        <span aria-hidden='true' className='text-destructive'>
                          *
                        </span>
                      </FieldLabel>
                      <Input
                        {...field}
                        id={`booking-${name}`}
                        type='time'
                        aria-invalid={fieldState.invalid}
                        aria-required='true'
                        disabled={busy}
                      />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
              ))}
              <Availability
                roomId={values.roomId ?? ''}
                date={values.date ?? ''}
                zone={zone}
              />
            </FieldGroup>
          </FieldSet>
          {!booking ? (
            <FieldSet>
              <FieldLegend>{t('meetingRooms.form.repeat')}</FieldLegend>
              <FieldGroup>
                <Controller
                  name='frequency'
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor='booking-frequency'>
                        {t('meetingRooms.fields.recurrence')}
                      </FieldLabel>
                      <Select
                        items={frequencyItems}
                        value={field.value}
                        onValueChange={(v) => {
                          if (v) field.onChange(v);
                        }}
                      >
                        <SelectTrigger
                          id='booking-frequency'
                          ref={field.ref}
                          onBlur={field.onBlur}
                          disabled={busy}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {frequencyItems.map((item) => (
                              <SelectItem key={item.value} value={item.value}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
                {(values.frequency ?? 'none') !== 'none' ? (
                  <Controller
                    name='count'
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor='booking-count'>
                          {t('meetingRooms.fields.count')}
                          <span aria-hidden='true' className='text-destructive'>
                            *
                          </span>
                        </FieldLabel>
                        <Input
                          id='booking-count'
                          type='number'
                          ref={field.ref}
                          onBlur={field.onBlur}
                          value={field.value}
                          onChange={(e) =>
                            field.onChange(Number(e.target.value))
                          }
                          aria-invalid={fieldState.invalid}
                          disabled={busy}
                        />
                        <FieldError errors={[fieldState.error]} />
                      </Field>
                    )}
                  />
                ) : null}
              </FieldGroup>
            </FieldSet>
          ) : booking.seriesId ? (
            <Field>
              <FieldLabel htmlFor='edit-future'>
                {t('meetingRooms.series.future')}
              </FieldLabel>
              <Switch
                id='edit-future'
                checked={future}
                onCheckedChange={setFuture}
                disabled={busy}
              />
              {f.data ? <FutureList future={f.data.data} zone={zone} /> : null}
              {f.error ? (
                <MeetingError error={f.error} retry={f.reload} />
              ) : f.loading ? (
                <Loading />
              ) : f.data ? (
                <FieldDescription>
                  {t('meetingRooms.series.affected', {
                    count: f.data.data.total,
                  })}
                </FieldDescription>
              ) : null}
            </Field>
          ) : null}
        </FieldGroup>
      </form>
      <AlertDialog open={discard} onOpenChange={setDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('meetingRooms.discardTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('meetingRooms.discardDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t('meetingRooms.keepEditing')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                savedRef.current = true;
                void goBack();
              }}
            >
              {t('meetingRooms.discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
