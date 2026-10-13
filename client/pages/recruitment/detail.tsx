import { statusTone } from './status-tone.js';
import { StatusBadge } from '#components/status-badge';
import { UserName } from '#components/user-name';
import {
  Link,
  Outlet,
  useLocation,
  useOutletContext,
  useParams,
} from 'react-router';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  renderTimelineEntry,
  approvalStepsOf,
} from '@nocobase/app-plugin-approval/client';
import { RecordDetailDrawer } from '#components/record-detail-drawer';
import { Button } from '#components/ui/button';
import { useRecruitmentResource } from './resource.js';
import { offersOf } from './model.js';
import { ErrorState, Loading, Refresh } from './shared.js';
import type { Detail, Source, Options } from './types.js';
export default function RecruitmentDetail() {
  const { requestId = '' } = useParams(),
    location = useLocation(),
    parent = useOutletContext<Source>(),
    { t, i18n } = useTranslation(),
    r = useRecruitmentResource<{ data: Detail }>(
      `recruitmentRequests/${encodeURIComponent(requestId)}`,
    ),
    detail = r.data?.data;
  const salaryGrant = useCan({
      resource: { type: 'composite', id: 'oa.recruitment' },
      action: 'viewSalary',
    }),
    submit = useCan({
      resource: { type: 'composite', id: 'oa.recruitment' },
      action: 'submit',
    }),
    operate = useCan({
      resource: { type: 'composite', id: 'oa.recruitment' },
      action: 'operate',
    }),
    reviewGrant = useCan({
      resource: { type: 'composite', id: 'oa.recruitment' },
      action: 'reviewEdit',
    });
  const ready = !!detail && !r.loading && !r.error,
    salary = useRecruitmentResource<{
      data: { minimumCents: number; maximumCents: number };
    }>(
      ready && salaryGrant.can && !salaryGrant.isPending && !salaryGrant.error
        ? `recruitmentRequests/${encodeURIComponent(requestId)}/salary`
        : null,
      undefined,
      detail?.record.lifecycleVersion,
    ),
    review = useRecruitmentResource<{ data: Options }>(
      ready &&
        detail &&
        offersOf(detail).some((offer) => offer.name === 'approve') &&
        reviewGrant.can &&
        !reviewGrant.isPending &&
        !reviewGrant.error
        ? 'recruitmentRequests/formOptions'
        : null,
      { requestId, mode: 'reviewEdit' },
      detail?.record.lifecycleVersion,
    );
  const reload = () => {
      r.reload();
      salary.reload();
      review.reload();
      parent.reload();
    },
    link = (path: string) => ({
      pathname: path,
      search: location.search,
      hash: location.hash,
    }),
    actions = ready && detail ? offersOf(detail) : [],
    available =
      ready && detail && submit.can && !submit.isPending && !submit.error
        ? [
            ...(detail.canSubmit ? [{ name: 'submit', allowed: true }] : []),
            ...detail.view.available.filter(
              (v) => v.allowed && ['withdraw', 'terminate'].includes(v.name),
            ),
          ]
        : [];
  return (
    <RecordDetailDrawer
      headerStatus={
        detail ? (
          <StatusBadge tone={statusTone(detail.record.status)}>
            {t(`recruitment.status.${detail.record.status}`)}
          </StatusBadge>
        ) : null
      }
      printable
      printDisabled={!ready}
      title={
        detail
          ? t('recruitment.detailTitle', {
              name: detail.identities.position?.name ?? detail.record.id,
            })
          : t('recruitment.detail')
      }
      footer={
        <>
          {available.map((v) => (
            <Button
              key={v.name}
              nativeButton={false}
              variant={v.name === 'submit' ? 'default' : 'destructive'}
              render={<Link to={link(`action/${v.name}`)} />}
            >
              {t(`recruitment.actions.${v.name}`)}
            </Button>
          ))}
          {ready &&
          submit.can &&
          !submit.isPending &&
          !submit.error &&
          ['draft', 'revision'].includes(detail.record.status) ? (
            <Button
              nativeButton={false}
              variant='outline'
              render={<Link to={link('edit')} />}
            >
              {t('recruitment.actions.edit')}
            </Button>
          ) : null}
          {ready &&
          review.data?.data.editableFields.length &&
          !review.loading &&
          !review.error ? (
            <Button
              nativeButton={false}
              variant='outline'
              render={<Link to={link('review-edit')} />}
            >
              {t('recruitment.actions.reviewEdit')}
            </Button>
          ) : null}
          {operate.can && !operate.isPending && !operate.error
            ? actions.map((o) => (
                <Button
                  key={o.key}
                  nativeButton={false}
                  variant={o.name === 'reject' ? 'destructive' : 'outline'}
                  render={
                    <Link
                      to={link(
                        `action/${o.name}/${encodeURIComponent('taskId' in o.target ? o.target.taskId : o.target.runId)}`,
                      )}
                    />
                  }
                >
                  {t(`recruitment.actions.${o.name}`)}
                </Button>
              ))
            : null}
          <Refresh busy={r.loading} onClick={reload} />
        </>
      }
    >
      {r.error ? (
        <ErrorState error={r.error} retry={reload} />
      ) : r.loading ? (
        <Loading />
      ) : detail ? (
        <div className='flex flex-col gap-6'>
          <dl className='grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] sm:grid-cols-[8rem_minmax(0,1fr)] gap-3'>
            <dt className='text-muted-foreground'>
              {t('recruitment.fields.applicant')}
            </dt>
            <dd>
              <UserName
                name={
                  detail.users.find(
                    (user) => user.id === detail.record.applicantId,
                  )?.name ?? '—'
                }
              />
            </dd>
            {(
              [
                'departmentId',
                'positionId',
                'gradeId',
                'quantity',
                'year',
                'kind',
                'expectedStartDate',
                'jobDescription',
                'reason',
              ] as const
            ).map((key) => (
              <div className='contents' key={key}>
                <dt className='text-muted-foreground'>
                  {t(`recruitment.fields.${key}`)}
                </dt>
                <dd className='min-w-0 whitespace-pre-wrap break-words'>
                  {key === 'departmentId'
                    ? (detail.identities.department?.name ?? '—')
                    : key === 'positionId'
                      ? (detail.identities.position?.name ?? '—')
                      : key === 'gradeId'
                        ? (detail.identities.grade?.name ?? '—')
                        : key === 'kind'
                          ? t(`recruitment.kinds.${detail.record.kind}`)
                          : String(detail.record[key] ?? '—')}
                </dd>
              </div>
            ))}
          </dl>
          {salary.error ? (
            <ErrorState error={salary.error} retry={salary.reload} />
          ) : salary.data && !salary.loading ? (
            <dl className='grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] sm:grid-cols-[8rem_minmax(0,1fr)] gap-3'>
              {(['minimumCents', 'maximumCents'] as const).map((key) => (
                <div className='contents' key={key}>
                  <dt>{t(`recruitment.fields.${key}`)}</dt>
                  <dd className='tabular-nums'>
                    {new Intl.NumberFormat(i18n.language, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    }).format(salary.data!.data[key] / 100)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          <section>
            <h2 className='text-base font-medium'>
              {t('recruitment.progress')}
            </h2>
            <ol className='flex flex-col gap-2'>
              {approvalStepsOf(detail.runs).map((step) => (
                <li key={step.key}>
                  {t(`recruitment.status.${step.stage}`, {
                    defaultValue: step.title,
                  })}{' '}
                  ·{' '}
                  {step.tasks.map((task) => (
                    <UserName
                      key={task.id}
                      name={
                        detail.users.find((u) => u.id === task.assigneeId)?.name
                      }
                    />
                  ))}
                </li>
              ))}
            </ol>
          </section>
          <section>
            <h2 className='text-base font-medium'>
              {t('recruitment.timeline')}
            </h2>
            <ol className='flex flex-col gap-3'>
              {detail.timeline.runs
                .flatMap((run) => [
                  ...run.entries,
                  ...run.stages.flatMap((stage) => stage.entries),
                ])
                .map((entry) => {
                  const line = renderTimelineEntry(entry, {
                    t: (key, options) => t(key, options),
                    name: (id) =>
                      detail.users.find((user) => user.id === id)?.name ?? '—',
                    stage: (key, title) =>
                      t(`recruitment.status.${key}`, { defaultValue: title }),
                  });
                  return (
                    <li key={line.key} className='break-words'>
                      {line.title}{' '}
                      <time dateTime={line.at}>
                        {new Date(line.at).toLocaleString(i18n.language)}
                      </time>
                      <div data-print-expanded className='hidden'>
                        {line.details.map((detail) => (
                          <p key={detail.label}>
                            {detail.label}: {detail.value}
                          </p>
                        ))}
                        {line.children.map((child) => (
                          <p key={child.key}>{child.label}</p>
                        ))}
                      </div>
                      {line.comment ? (
                        <p className='whitespace-pre-wrap'>{line.comment}</p>
                      ) : null}
                    </li>
                  );
                })}
            </ol>
          </section>
        </div>
      ) : null}
      <Outlet context={{ reload }} />
    </RecordDetailDrawer>
  );
}
