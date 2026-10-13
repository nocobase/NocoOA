import { createRequestKey } from '#lib/request-key';
import { UserName } from '#components/user-name';
import { useRef, useState } from 'react';
import { Link, useLocation, useOutletContext, useParams } from 'react-router';
import { useApiClient, useToaster, ApiClientError } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { RouteDrawer } from '#components/route-drawer';
import { useRouteOverlay } from '#components/use-route-overlay';
import { Button } from '#components/ui/button';
import { Spinner } from '#components/ui/spinner';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
} from '#components/ui/field';
import { Checkbox } from '#components/ui/checkbox';
import { Alert, AlertDescription } from '#components/ui/alert';
import {
  useRecruitmentResource,
  useViewerKey,
  useMutationBoundary,
} from './resource.js';
import { Choice, Discard, ErrorState, Loading } from './shared.js';
import { useCloseGuard } from './use-close-guard.js';
import { cents, patchOf } from './model.js';
import type { Detail, Options, Proposal, Source, Person } from './types.js';
export default function RecruitmentForm() {
  const key = useViewerKey();
  return <RecruitmentFormContent key={key} />;
}
function RecruitmentFormContent() {
  const { requestId = '' } = useParams(),
    location = useLocation(),
    review = location.pathname.endsWith('/review-edit'),
    mode = review ? 'reviewEdit' : 'edit',
    { t } = useTranslation(),
    [busy, setBusy] = useState(false),
    [formBlocked, setFormBlocked] = useState(false),
    guard = useCloseGuard(busy);
  const detail = useRecruitmentResource<{ data: Detail }>(
      requestId ? `recruitmentRequests/${encodeURIComponent(requestId)}` : null,
    ),
    options = useRecruitmentResource<{ data: Options }>(
      requestId
        ? 'recruitmentRequests/formOptions'
        : 'recruitmentRequests/createOptions',
      requestId ? { requestId, mode } : undefined,
    );
  const needsSalary =
      !!requestId &&
      (!review ||
        !!options.data?.data.editableFields.some((k) =>
          ['minimumCents', 'maximumCents'].includes(k),
        )),
    salaryGrant = useCan({
      resource: { type: 'composite', id: 'oa.recruitment' },
      action: 'viewSalary',
    }),
    ready =
      !!options.data &&
      !options.loading &&
      !options.error &&
      (!requestId || (!!detail.data && !detail.loading && !detail.error)),
    salary = useRecruitmentResource<{
      data: { minimumCents: number; maximumCents: number };
    }>(
      ready &&
        needsSalary &&
        salaryGrant.can &&
        !salaryGrant.isPending &&
        !salaryGrant.error
        ? `recruitmentRequests/${encodeURIComponent(requestId)}/salary`
        : null,
      undefined,
      detail.data?.data.record.lifecycleVersion,
    );
  const permitted =
    ready &&
    (!needsSalary ||
      (!salaryGrant.isPending &&
        salaryGrant.can &&
        !salaryGrant.error &&
        !!salary.data &&
        !salary.loading &&
        !salary.error));
  return (
    <RouteDrawer
      printable
      title={t(
        review
          ? 'recruitment.actions.reviewEdit'
          : requestId
            ? 'recruitment.actions.edit'
            : 'recruitment.new',
      )}
      beforeClose={guard.beforeClose}
      className='text-sm sm:max-w-2xl'
      footer={
        <Footer
          busy={busy}
          ready={
            !!permitted &&
            !formBlocked &&
            options.data?.data.canCreate !== false
          }
        />
      }
    >
      {options.error ? (
        <ErrorState error={options.error} retry={options.reload} />
      ) : detail.error ? (
        <ErrorState error={detail.error} retry={detail.reload} />
      ) : salary.error ? (
        <ErrorState error={salary.error} retry={salary.reload} />
      ) : !ready ||
        (needsSalary && (salaryGrant.isPending || salary.loading)) ? (
        <Loading />
      ) : !permitted || options.data?.data.canCreate === false ? (
        <Alert>
          <AlertDescription>{t('recruitment.notAvailable')}</AlertDescription>
        </Alert>
      ) : (
        <FormBody
          key={`${requestId}:${detail.data?.data.record.lifecycleVersion}:${options.data!.data.editableFields.join(',')}`}
          options={options.data!.data}
          detail={detail.data?.data}
          salary={salary.data?.data}
          mode={requestId ? mode : 'create'}
          onBusy={setBusy}
          onBlocked={setFormBlocked}
          onReload={() => {
            setFormBlocked(false);
            options.reload();
            detail.reload();
            salary.reload();
          }}
          guard={guard}
        />
      )}
      <Discard guard={guard} />
    </RouteDrawer>
  );
}
function Footer({ busy, ready }: { busy: boolean; ready: boolean }) {
  const { close } = useRouteOverlay(),
    { t } = useTranslation();
  return (
    <>
      <Button variant='outline' disabled={busy} onClick={() => void close()}>
        {t('recruitment.cancel')}
      </Button>
      <Button type='submit' form='recruitment-form' disabled={busy || !ready}>
        {busy ? <Spinner data-icon='inline-start' /> : null}
        {t('recruitment.save')}
      </Button>
    </>
  );
}
function FormBody({
  options,
  detail,
  salary,
  mode,
  onBusy,
  onBlocked,
  onReload,
  guard,
}: {
  options: Options;
  detail?: Detail;
  salary?: { minimumCents: number; maximumCents: number };
  mode: 'create' | 'edit' | 'reviewEdit';
  onBusy: (v: boolean) => void;
  onBlocked: (v: boolean) => void;
  onReload: () => void;
  guard: ReturnType<typeof useCloseGuard>;
}) {
  const boundary = useMutationBoundary();
  const api = useApiClient(),
    { t } = useTranslation(),
    { close } = useRouteOverlay(),
    parent = useOutletContext<Source>(),
    toaster = useToaster(),
    fields = options.editableFields;
  const [original] = useState<Proposal>(() => ({
      departmentId:
        options.department?.id ?? options.departments?.[0]?.id ?? '',
      positionId: '',
      gradeId: '',
      accountId: '',
      year: new Date().getFullYear(),
      quantity: 1,
      kind: 'additional',
      replacementEmployeeIds: [],
      minimumCents: 0,
      maximumCents: 0,
      expectedStartDate: '',
      jobDescription: '',
      reason: '',
      ...detail?.record,
      ...salary,
    })),
    [values, setValues] = useState(original),
    [minimum, setMinimum] = useState(
      salary ? (salary.minimumCents / 100).toFixed(2) : '',
    ),
    [maximum, setMaximum] = useState(
      salary ? (salary.maximumCents / 100).toFixed(2) : '',
    ),
    [reason, setReason] = useState(''),
    [error, setError] = useState<unknown>(),
    [fieldErrors, setFieldErrors] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [blocked, setBlocked] = useState(false),
    [command, setCommand] = useState<{
      path: string;
      method: 'POST' | 'PATCH';
      body: unknown;
    }>(),
    lockRef = useRef(false);
  const headcountsGrant = useCan({
    resource: { type: 'composite', id: 'oa.headcounts' },
    action: 'view',
  });
  const capacity = useRecruitmentResource<{
      data: { id: string; initialized: boolean }[];
    }>(
      fields.includes('accountId') &&
        values.departmentId &&
        values.positionId &&
        Number.isInteger(values.year)
        ? 'recruitmentRequests/capacityOptions'
        : null,
      {
        mode,
        ...(detail ? { requestId: detail.record.id } : {}),
        departmentId: values.departmentId,
        positionId: values.positionId,
        year: String(values.year),
      },
    ),
    replacements = useRecruitmentResource<{
      data: (Person & { status: string })[];
    }>(
      values.kind === 'replacement' &&
        fields.includes('replacementEmployeeIds') &&
        values.departmentId &&
        values.positionId
        ? `recruitmentRequests/${mode === 'create' ? 'createReplacementCandidates' : 'replacementCandidates'}`
        : null,
      {
        ...(detail ? { requestId: detail.record.id, mode } : {}),
        departmentId: values.departmentId,
        positionId: values.positionId,
      },
    );
  const frozen = busy || uncertain || blocked,
    editable = (key: string) => fields.includes(key);
  function change(key: keyof Proposal, value: Proposal[keyof Proposal]) {
    guard.changed();
    setFieldErrors((old) => ({ ...old, [key]: '' }));
    setValues((old) => ({
      ...old,
      [key]: value,
      ...(['departmentId', 'positionId', 'year'].includes(key)
        ? { accountId: '', replacementEmployeeIds: [] }
        : {}),
      ...(key === 'kind' ? { replacementEmployeeIds: [] } : {}),
      ...(key === 'departmentId' ? { positionId: '' } : {}),
    }));
  }
  async function save(retry = false) {
    const signal = boundary.getSignal();
    if (lockRef.current) return;
    let next = command;
    if (!retry) {
      const low = cents(minimum),
        high = cents(maximum);
      const invalid: Record<string, string> = {};
      const required = t('approvals.required');
      if (mode !== 'reviewEdit') {
        for (const key of [
          'departmentId',
          'positionId',
          'gradeId',
          'expectedStartDate',
          'jobDescription',
          'reason',
        ] as const)
          if (!values[key].trim()) invalid[key] = required;
      }
      if (
        !Number.isInteger(values.quantity) ||
        values.quantity < 1 ||
        values.quantity > 100000
      )
        invalid.quantity = t(
          'recruitment.businessErrors.RECRUITMENT_INVALID_QUANTITY',
        );
      if (
        !Number.isInteger(values.year) ||
        values.year < 1900 ||
        values.year > 9999
      )
        invalid.year = t('recruitment.yearInvalid');
      if (
        (editable('minimumCents') && low === null) ||
        (low !== null && high !== null && low > high)
      )
        invalid.minimumCents = t(
          'recruitment.businessErrors.RECRUITMENT_INVALID_SALARY',
        );
      if (
        (editable('maximumCents') && high === null) ||
        (low !== null && high !== null && low > high)
      )
        invalid.maximumCents = t(
          'recruitment.businessErrors.RECRUITMENT_INVALID_SALARY',
        );
      if (!reason.trim()) invalid['command-reason'] = required;
      if (
        editable('accountId') &&
        (!capacity.data?.data.some(
          (a) => a.id === values.accountId && a.initialized,
        ) ||
          capacity.loading ||
          capacity.error)
      )
        invalid.accountId = t('recruitment.capacityEmpty');
      if (
        editable('replacementEmployeeIds') &&
        values.kind === 'replacement' &&
        (values.replacementEmployeeIds.length !== values.quantity ||
          !values.replacementEmployeeIds.every((id) =>
            replacements.data?.data.some(
              (p) => p.id === id && ['leaving', 'left'].includes(p.status),
            ),
          ))
      )
        invalid.replacementEmployeeIds = t(
          'recruitment.businessErrors.RECRUITMENT_INVALID_REPLACEMENTS',
        );
      setFieldErrors(invalid);
      if (Object.keys(invalid).length) {
        document
          .getElementById(`recruitment-${Object.keys(invalid)[0]}`)
          ?.focus();
        return;
      }
      const proposal = {
          ...values,
          minimumCents: low ?? original.minimumCents,
          maximumCents: high ?? original.maximumCents,
        },
        base = { requestKey: createRequestKey(), reason: reason.trim() },
        patch = patchOf(proposal, original, fields);
      // Only explicit DTO fields enter writes; ordinary SDK snapshots never become a proposal.
      const complete: Proposal = Object.fromEntries(
        Object.keys(original)
          .filter((k) =>
            [
              'departmentId',
              'positionId',
              'gradeId',
              'accountId',
              'year',
              'quantity',
              'kind',
              'replacementEmployeeIds',
              'minimumCents',
              'maximumCents',
              'expectedStartDate',
              'jobDescription',
              'reason',
            ].includes(k),
          )
          .map((k) => [k, proposal[k as keyof Proposal]]),
      ) as unknown as Proposal;
      next = {
        path: detail
          ? `recruitmentRequests/${detail.record.id}${mode === 'reviewEdit' ? '/reviewEdit' : ''}`
          : 'recruitmentRequests',
        method: mode === 'edit' ? 'PATCH' : 'POST',
        body: detail
          ? {
              ...base,
              version: detail.record.lifecycleVersion,
              ...(mode === 'reviewEdit' ? { patch } : { proposal: complete }),
            }
          : { ...base, proposal: complete },
      };
      setCommand(next);
    }
    if (!next) return;
    lockRef.current = true;
    setBusy(true);
    onBusy(true);
    setError(undefined);
    try {
      await api.request({
        path: next.path,
        method: next.method,
        json: next.body,
        signal,
      });
      if (signal.aborted) return;
      guard.saved();
      parent.reload();
      setUncertain(false);
      onBusy(false);
      toaster.show({ type: 'success', title: t('recruitment.saved') });
      await close();
    } catch (cause) {
      if (signal.aborted) return;
      setError(cause);
      setUncertain(!(cause instanceof ApiClientError) || cause.status >= 500);
      if (
        cause instanceof ApiClientError &&
        [401, 403, 404, 409, 412].includes(cause.status)
      ) {
        setBlocked(true);
        onBlocked(true);
        setMinimum('');
        setMaximum('');
        setCommand(undefined);
        parent.reload();
      }
    } finally {
      if (!signal.aborted) {
        lockRef.current = false;
        setBusy(false);
        onBusy(false);
      }
    }
  }
  const choices: (keyof Proposal)[] = [
    'departmentId',
    'positionId',
    'gradeId',
    'accountId',
    'kind',
  ];
  return (
    <>
      <form
        id='recruitment-form'
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!frozen) void save();
        }}
      >
        <FieldGroup>
          {error ? <ErrorState error={error} retry={onReload} /> : null}
          {fields.map((key) => {
            if (key === 'replacementEmployeeIds')
              return values.kind === 'replacement' ? (
                <Field
                  key={key}
                  data-invalid={!!fieldErrors[key]}
                  id={`recruitment-${key}`}
                  tabIndex={-1}
                >
                  <FieldLabel>{t(`recruitment.fields.${key}`)} *</FieldLabel>
                  {replacements.error ? (
                    <ErrorState
                      error={replacements.error}
                      retry={replacements.reload}
                    />
                  ) : replacements.loading ? (
                    <Loading fields={2} />
                  ) : (
                    replacements.data?.data
                      .filter((p) => ['leaving', 'left'].includes(p.status))
                      .map((p) => (
                        <label key={p.id} className='flex items-center gap-2'>
                          <Checkbox
                            checked={values.replacementEmployeeIds.includes(
                              p.id,
                            )}
                            disabled={frozen}
                            onCheckedChange={(checked) =>
                              change(
                                'replacementEmployeeIds',
                                checked
                                  ? [...values.replacementEmployeeIds, p.id]
                                  : values.replacementEmployeeIds.filter(
                                      (id) => id !== p.id,
                                    ),
                              )
                            }
                          />
                          <UserName name={p.name} />
                        </label>
                      ))
                  )}
                  <p className='text-sm text-muted-foreground'>
                    {t('recruitment.replacementNote')}
                  </p>
                  {fieldErrors[key] && (
                    <FieldError>{fieldErrors[key]}</FieldError>
                  )}
                </Field>
              ) : null;
            const id = `recruitment-${key}`,
              label = t(`recruitment.fields.${key}`);
            let items: { value: string; label: string }[] = [];
            if (key === 'departmentId')
              items = (
                options.departments ??
                (options.department ? [options.department] : [])
              ).map((p) => ({ value: p.id, label: p.name }));
            if (key === 'positionId')
              items = options.positions.map((p) => ({
                value: p.id,
                label: p.name,
              }));
            if (key === 'gradeId')
              items = options.grades.map((p) => ({
                value: p.id,
                label: p.name,
              }));
            if (key === 'accountId')
              items = (capacity.data?.data ?? [])
                .filter((p) => p.initialized)
                .map((p) => ({
                  value: p.id,
                  label: t('headcounts.name', {
                    department:
                      options.departments?.find(
                        (d) => d.id === values.departmentId,
                      )?.name ??
                      options.department?.name ??
                      '—',
                    position:
                      options.positions.find((v) => v.id === values.positionId)
                        ?.name ?? '—',
                    year: values.year,
                  }),
                }));
            if (key === 'kind')
              items = ['additional', 'replacement'].map((value) => ({
                value,
                label: t(`recruitment.kinds.${value}`),
              }));
            return (
              <Field key={key} data-invalid={!!fieldErrors[key]}>
                <FieldLabel htmlFor={id}>{label} *</FieldLabel>
                {choices.includes(key as keyof Proposal) ? (
                  <>
                    <Choice
                      id={id}
                      label={label}
                      items={items}
                      value={String(values[key as keyof Proposal])}
                      disabled={
                        frozen || (key === 'accountId' && capacity.loading)
                      }
                      onChange={(value) => change(key as keyof Proposal, value)}
                    />
                    {key === 'accountId' &&
                    !capacity.error &&
                    !capacity.loading &&
                    !capacity.data?.data.length ? (
                      <p className='text-sm text-muted-foreground'>
                        {t(
                          !values.departmentId || !values.positionId
                            ? 'recruitment.capacitySelectTarget'
                            : 'recruitment.capacityEmpty',
                        )}
                      </p>
                    ) : null}
                    {key === 'accountId' &&
                    headcountsGrant.can &&
                    !headcountsGrant.isPending &&
                    !headcountsGrant.error ? (
                      <Link
                        className='text-sm underline'
                        to={{
                          pathname: '/headcounts',
                          search: new URLSearchParams({
                            departmentId: values.departmentId,
                            positionId: values.positionId,
                            year: String(values.year),
                          }).toString(),
                        }}
                      >
                        {t('recruitment.capacityLedger')}
                      </Link>
                    ) : null}
                    {key === 'accountId' && capacity.error ? (
                      <ErrorState
                        error={capacity.error}
                        retry={capacity.reload}
                      />
                    ) : null}
                  </>
                ) : ['minimumCents', 'maximumCents'].includes(key) ? (
                  <Input
                    id={id}
                    required
                    inputMode='decimal'
                    disabled={frozen}
                    value={key === 'minimumCents' ? minimum : maximum}
                    onChange={(e) => {
                      guard.changed();
                      setFieldErrors((old) => ({ ...old, [key]: '' }));
                      if (key === 'minimumCents') setMinimum(e.target.value);
                      else setMaximum(e.target.value);
                    }}
                  />
                ) : ['jobDescription', 'reason'].includes(key) ? (
                  <Textarea
                    id={id}
                    required
                    maxLength={key === 'reason' ? 10000 : 20000}
                    disabled={frozen}
                    value={String(values[key as keyof Proposal])}
                    onChange={(e) =>
                      change(key as keyof Proposal, e.target.value)
                    }
                  />
                ) : (
                  <Input
                    id={id}
                    required
                    type={
                      key === 'expectedStartDate'
                        ? 'date'
                        : ['quantity', 'year'].includes(key)
                          ? 'number'
                          : 'text'
                    }
                    min={
                      key === 'quantity' ? 1 : key === 'year' ? 1900 : undefined
                    }
                    max={
                      key === 'quantity'
                        ? 100000
                        : key === 'year'
                          ? 9999
                          : undefined
                    }
                    step={1}
                    disabled={frozen}
                    value={String(values[key as keyof Proposal])}
                    onChange={(e) =>
                      change(
                        key as keyof Proposal,
                        ['quantity', 'year'].includes(key)
                          ? Number(e.target.value)
                          : e.target.value,
                      )
                    }
                  />
                )}
                {fieldErrors[key] && (
                  <FieldError>{fieldErrors[key]}</FieldError>
                )}
              </Field>
            );
          })}
          <Field>
            <FieldLabel htmlFor='recruitment-command-reason'>
              {t('recruitment.commandReason')} *
            </FieldLabel>
            <Textarea
              id='recruitment-command-reason'
              required
              maxLength={10000}
              disabled={frozen}
              value={reason}
              onChange={(e) => {
                guard.changed();
                setReason(e.target.value);
                setFieldErrors((old) => ({ ...old, 'command-reason': '' }));
              }}
            />
            {fieldErrors['command-reason'] && (
              <FieldError>{fieldErrors['command-reason']}</FieldError>
            )}
          </Field>
        </FieldGroup>
      </form>
      {uncertain ? (
        <Alert>
          <AlertDescription>{t('recruitment.unknown')}</AlertDescription>
          <Button
            variant='outline'
            disabled={busy}
            onClick={() => void save(true)}
          >
            {t('recruitment.retryExact')}
          </Button>
        </Alert>
      ) : null}
    </>
  );
}
