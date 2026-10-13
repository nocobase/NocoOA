import { useTranslation } from '@nocobase/i18n/client';
import type { ReactNode } from 'react';
import { Button } from '#components/ui/button';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '#components/ui/empty';

/** Render inside the existing table; creation stays in its toolbar. */
export function ApplicationTableEmpty({
  title,
  description,
  clearFilters,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly clearFilters?: {
    readonly label: string;
    readonly onClick: () => void;
  };
}) {
  const { t } = useTranslation();
  return (
    <Empty className='min-h-28 gap-2 p-4'>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {!clearFilters || description ? (
          <EmptyDescription className='max-w-md'>
            {description ?? t('dataTable.emptyDescription')}
          </EmptyDescription>
        ) : null}
      </EmptyHeader>
      {clearFilters ? (
        <Button
          type='button'
          variant='link'
          size='sm'
          onClick={clearFilters.onClick}
        >
          {clearFilters.label}
        </Button>
      ) : null}
    </Empty>
  );
}
