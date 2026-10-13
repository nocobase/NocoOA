import type { ReactElement, ReactNode } from 'react';

/** A label–value grid (guideline T2.4); an empty value shows "—". */
export function FieldList({
  items,
}: {
  readonly items: readonly {
    readonly label: string;
    readonly value: ReactNode;
  }[];
}): ReactElement {
  return (
    <dl className='grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] sm:grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm'>
      {items.map((item) => (
        <FieldRow key={item.label} label={item.label} value={item.value} />
      ))}
    </dl>
  );
}

function FieldRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: ReactNode;
}): ReactElement {
  const empty = value === null || value === undefined || value === '';
  return (
    <>
      <dt className='text-muted-foreground'>{label}</dt>
      <dd className='min-w-0 break-words whitespace-pre-line'>
        {empty ? <span className='text-muted-foreground'>—</span> : value}
      </dd>
    </>
  );
}
