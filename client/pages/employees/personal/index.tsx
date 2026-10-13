import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useTranslation } from '@nocobase/i18n/client';
import { AlertCircleIcon, IdCard, RefreshCw } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { SessionExpiredAlert } from '#components/session-expired-alert';
import { Alert, AlertAction, AlertDescription } from '#components/ui/alert';
import { Badge } from '#components/ui/badge';
import { Button } from '#components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '#components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#components/ui/empty';
import { Skeleton } from '#components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#components/ui/tooltip';
import { useDateText } from '../dates.js';
import { FieldList } from '../detail/fields.js';
import type { Employee, EmployeeProfile } from '../types.js';

type Result<T> = { data?: T; error?: unknown };
const statusOf = (error: unknown) =>
  error instanceof ApiClientError ? error.status : undefined;
const mustClear = (error: unknown) =>
  [401, 403, 404].includes(statusOf(error) ?? 0);

/** A new identity mounts a fresh tree, so neither old state nor in-flight responses can cross accounts. */
export default function PersonalArchivePage(): ReactElement {
  const { session } = useAuthentication();
  return session?.user.id ? (
    <PersonalArchive key={session.user.id} />
  ) : (
    <SessionExpiredAlert />
  );
}

function PersonalArchive(): ReactElement {
  const api = useApiClient();
  const { t } = useTranslation();
  const date = useDateText();
  const [archive, setArchive] = useState<Result<Employee>>({});
  const [profile, setProfile] = useState<Result<EmployeeProfile>>({});
  const [request, setRequest] = useState({
    revision: 0,
    target: 'all' as 'all' | 'profile',
  });
  const [completed, setCompleted] = useState(-1);
  const titleRef = useRef<HTMLDivElement>(null);
  const profileTitleRef = useRef<HTMLHeadingElement>(null);
  const focusAfterRetryRef = useRef(false);
  const loading = completed !== request.revision;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      if (request.target === 'all') {
        try {
          const { data } = await api.request<{ data: Employee }>({
            path: 'employees/me',
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          setArchive({ data });
        } catch (error) {
          if (controller.signal.aborted) return;
          setArchive((previous) => ({
            data: mustClear(error) ? undefined : previous.data,
            error,
          }));
          if (mustClear(error)) setProfile({});
          setCompleted(request.revision);
          return;
        }
      }
      try {
        const { data } = await api.request<{ data: EmployeeProfile }>({
          path: 'employees/me/profile',
          signal: controller.signal,
        });
        if (!controller.signal.aborted) setProfile({ data });
      } catch (error) {
        if (!controller.signal.aborted)
          setProfile((previous) => ({
            data: mustClear(error) ? undefined : previous.data,
            error,
          }));
      }
      if (!controller.signal.aborted) setCompleted(request.revision);
    }
    void load();
    return () => controller.abort();
  }, [api, request]);

  useEffect(() => {
    if (!loading && focusAfterRetryRef.current) {
      focusAfterRetryRef.current = false;
      if (request.target === 'profile' ? profile.error : archive.error) return;
      const heading =
        request.target === 'profile'
          ? profileTitleRef.current
          : titleRef.current?.querySelector<HTMLHeadingElement>('h1');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus();
      }
    }
  }, [archive.error, loading, profile.error, request.target]);

  function reload(target: 'all' | 'profile', retry = false) {
    if (loading) return;
    focusAfterRetryRef.current = retry;
    setRequest((previous) => ({ revision: previous.revision + 1, target }));
  }

  function errorView(error: unknown, target: 'all' | 'profile') {
    const status = statusOf(error);
    if (status === 401) return <SessionExpiredAlert />;
    return (
      <Alert variant='destructive'>
        <AlertCircleIcon />
        <AlertDescription>
          {status === 403
            ? t('employees.personal.forbidden')
            : status === 404
              ? t('employees.personal.profileMissing')
              : t('employees.error.requestFailed')}
        </AlertDescription>
        {!mustClear(error) && (
          <AlertAction>
            <Button
              variant='outline'
              size='sm'
              disabled={loading}
              aria-busy={loading}
              onClick={() => reload(target, true)}
            >
              {loading && (
                <RefreshCw
                  aria-hidden='true'
                  data-icon='inline-start'
                  className='animate-spin'
                />
              )}
              {t('status.retry')}
            </Button>
          </AlertAction>
        )}
      </Alert>
    );
  }

  const employee = archive.data;
  const details = profile.data;
  const basicFields: { label: string; value: ReactNode }[] = employee
    ? [
        { label: t('employees.fields.name'), value: employee.name },
        { label: t('employees.fields.code'), value: employee.code },
        {
          label: t('employees.fields.primaryDepartment'),
          value: employee.primaryDepartment?.title,
        },
        {
          label: t('employees.fields.position'),
          value: employee.position?.title,
        },
        { label: t('employees.fields.grade'), value: employee.grade?.title },
        { label: t('employees.fields.manager'), value: employee.manager?.name },
        {
          label: t('employees.fields.status'),
          value: employee.status ? (
            <Badge variant='secondary'>
              {t(`employees.status.${employee.status}`)}
            </Badge>
          ) : null,
        },
        ...(
          [
            'hireDate',
            'careerStartDate',
            'probationEndDate',
            'lastWorkingDay',
          ] as const
        ).map((field) => ({
          label: t(`employees.fields.${field}`),
          value: date(employee[field]),
        })),
        ...(
          ['phone', 'email', 'workLocation', 'emergencyContact'] as const
        ).map((field) => ({
          label: t(`employees.fields.${field}`),
          value: employee[field],
        })),
      ]
    : [];

  return (
    <PageContainer className='w-full max-w-4xl'>
      <div
        ref={titleRef}
        tabIndex={-1}
        className='[&>header]:flex-row [&>header]:items-start'
      >
        <PageHeader
          title={t('employees.personal.title')}
          description={t('employees.personal.description')}
          actions={
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant='outline'
                    size='icon'
                    aria-label={t('employees.personal.refresh')}
                    disabled={loading}
                    onClick={() => reload('all')}
                  />
                }
              >
                <RefreshCw className={loading ? 'animate-spin' : undefined} />
              </TooltipTrigger>
              <TooltipContent>{t('employees.personal.refresh')}</TooltipContent>
            </Tooltip>
          }
        />
        {employee && (
          <p className='mt-2 break-words text-sm text-muted-foreground'>
            {employee.code
              ? t('employees.personal.identity', {
                  name: employee.name,
                  code: employee.code,
                })
              : employee.name}
          </p>
        )}
      </div>
      {Boolean(archive.error) &&
        statusOf(archive.error) !== 404 &&
        errorView(archive.error, 'all')}
      {statusOf(archive.error) === 404 ? (
        <Empty className='min-h-48 border border-dashed'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <IdCard />
            </EmptyMedia>
            <EmptyTitle>{t('employees.personal.emptyTitle')}</EmptyTitle>
            <EmptyDescription>
              {t('employees.personal.emptyDescription')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : employee ? (
        <>
          <Card aria-busy={loading}>
            <CardHeader>
              <CardTitle>{t('employees.personal.basic')}</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldList items={basicFields} />
            </CardContent>
          </Card>
          <div className='flex flex-col gap-4'>
            {Boolean(profile.error) && errorView(profile.error, 'profile')}
            {details ? (
              <>
                <Card aria-busy={loading}>
                  <CardHeader>
                    <CardTitle>
                      <h2 ref={profileTitleRef} tabIndex={-1}>
                        {t('employees.personal.profile')}
                      </h2>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <FieldList
                      items={[
                        ...(
                          [
                            'idType',
                            'idNumber',
                            'address',
                            'education',
                            'school',
                            'major',
                          ] as const
                        ).map((field) => ({
                          label: t(`employees.fields.${field}`),
                          value: details[field],
                        })),
                        {
                          label: t('employees.fields.birthDate'),
                          value: date(details.birthDate),
                        },
                      ]}
                    />
                  </CardContent>
                </Card>
                <Card aria-busy={loading}>
                  <CardHeader>
                    <CardTitle>{t('employees.personal.bank')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <FieldList
                      items={(
                        ['bankName', 'bankAccountName', 'bankAccount'] as const
                      ).map((field) => ({
                        label: t(`employees.fields.${field}`),
                        value: details[field],
                      }))}
                    />
                  </CardContent>
                </Card>
              </>
            ) : loading ? (
              <DetailSkeleton />
            ) : null}
          </div>
        </>
      ) : loading && !archive.error ? (
        <DetailSkeleton />
      ) : null}
    </PageContainer>
  );
}

function DetailSkeleton(): ReactElement {
  const { t } = useTranslation();
  return (
    <div
      role='status'
      aria-label={t('status.loading')}
      className='flex flex-col gap-3 rounded-lg border p-4'
    >
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          className='grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] sm:grid-cols-[8rem_minmax(0,1fr)] gap-4'
        >
          <Skeleton className='h-4 w-20' />
          <Skeleton className='h-4 w-full max-w-48' />
        </div>
      ))}
    </div>
  );
}
