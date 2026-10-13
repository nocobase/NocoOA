import { UserName } from '#components/user-name';
import { useTranslation } from '@nocobase/i18n/client';
import {
  calendarDateLabel,
  type ProbationDetail,
  type GradeOption,
} from './types.js';
export function ProbationFacts({
  detail,
  grades,
}: {
  detail: ProbationDetail;
  grades?: GradeOption[];
}) {
  const { t, i18n } = useTranslation();
  const { record } = detail;
  const f = (key: string) => t(`probationRequests.detail.${key}`);
  const grade = grades?.find((g) => g.id === record.gradeId);
  const person = (id: string | null) =>
    detail.users.find((p) => p.id === id)?.name ?? '—';
  const values = [
    [
      t('probationRequests.employee'),
      <UserName
        key={t('probationRequests.employee')}
        name={record.applicant?.name ?? person(record.applicantId)}
      />,
    ] as const,
    [
      f('creator'),
      <UserName
        key={f('creator')}
        name={record.createdBy?.name ?? person(record.createdById)}
      />,
    ] as const,
    [
      t('probationRequests.probationEndDate'),
      calendarDateLabel(record.probationEndDate, i18n.language),
    ],
    [f('selfEvaluation'), record.selfEvaluation || '—'],
    [f('evaluation'), record.evaluation || '—'],
    [
      t('probationRequests.conclusion'),
      record.conclusion
        ? t(`probationRequests.conclusions.${record.conclusion}`)
        : '—',
    ],
    [f('deferredTo'), calendarDateLabel(record.deferredTo, i18n.language)],
    [f('grade'), grade?.title ?? record.gradeId ?? '—'],
    [
      f('manager'),
      <UserName
        key={f('manager')}
        name={record.managerApprover?.name ?? person(record.managerApproverId)}
      />,
    ] as const,
    [
      f('head'),
      <UserName
        key={f('head')}
        name={record.headApprover?.name ?? person(record.headApproverId)}
      />,
    ] as const,
    [
      f('hr'),
      <UserName
        key={f('hr')}
        name={record.hrActor?.name ?? person(record.hrActorId)}
      />,
    ] as const,
    [
      f('gm'),
      <UserName
        key={f('gm')}
        name={record.gmApprover?.name ?? person(record.gmApproverId)}
      />,
    ] as const,
  ];
  return (
    <div className='flex flex-col gap-6'>
      <dl className='grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]'>
        {values.map(([label, value]) => (
          <div key={label} className='contents'>
            <dt className='text-muted-foreground'>{label}</dt>
            <dd className='min-w-0 whitespace-pre-wrap break-words text-foreground'>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <section className='flex flex-col gap-4'>
        <h2 className='text-base font-medium'>{f('rules')}</h2>
        {record.ruleSnapshot ? (
          <dl className='grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]'>
            {[
              'grade.managerRank',
              'sla.remindHours',
              'sla.escalateHours',
              'sla.urgeCooldownHours',
            ].map((key) => {
              const value = record.ruleSnapshot?.[key];
              return (
                <div key={key} className='contents'>
                  <dt className='text-muted-foreground'>
                    {t(`probationRequests.rules.${key.replaceAll('.', '_')}`)}
                  </dt>
                  <dd className='min-w-0 break-words'>
                    {typeof value === 'number' || typeof value === 'string'
                      ? String(value)
                      : '—'}
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : (
          <p className='text-sm text-muted-foreground'>{f('unsubmitted')}</p>
        )}
      </section>
    </div>
  );
}
