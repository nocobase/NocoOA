import { LoaderCircle } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

import { useAuthorizationTranslation } from '../i18n.js';
import { Button } from '#components/ui/button';
import { Card } from '#components/ui/card';
import { PageHeader } from '#components/page-header';

/** The chrome every Authorization settings page renders inside. */
export function PermissionsPage({
  title,
  description,
  fill = false,
  children,
}: {
  title: string;
  description: string;
  /**
   * Fill the host's scroll viewport on large screens so a page with its own
   * scroll regions does not also scroll the page around them. Below the floor
   * the whole page grows and the host scrolls it once, rather than squeezing
   * the content past the page padding.
   */
  fill?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <div
      className={`min-h-[calc(100svh-4rem)] bg-background p-5 sm:p-8 ${fill ? 'lg:flex lg:h-full lg:min-h-[36rem] lg:flex-col' : ''}`}
    >
      <div
        className={`min-w-0 space-y-5 ${fill ? 'lg:flex lg:min-h-0 lg:flex-1 lg:flex-col' : ''}`}
      >
        <PageHeader title={title} description={description} />
        {children}
      </div>
    </div>
  );
}

export function PageLoading(): ReactElement {
  const t = useAuthorizationTranslation();
  return (
    <Card className='grid min-h-64 place-items-center'>
      <div className='flex items-center gap-2 text-sm text-muted-foreground'>
        <LoaderCircle className='size-4 animate-spin' />
        {t('common.loading')}
      </div>
    </Card>
  );
}

export function PageError({
  message,
  onRetry,
}: {
  message?: string;
  onRetry: () => void;
}): ReactElement {
  const t = useAuthorizationTranslation();
  return (
    <Card className='grid min-h-64 place-items-center p-6 text-center'>
      <div className='space-y-3'>
        <p className='text-sm text-muted-foreground'>
          {message ?? t('page.loadFailed')}
        </p>
        <Button onClick={onRetry} variant='outline'>
          {t('common.retry')}
        </Button>
      </div>
    </Card>
  );
}

/** The refusal the page itself produces, in the same card shape as an error. */
export function PageForbidden({ message }: { message: string }): ReactElement {
  return (
    <Card className='grid min-h-64 place-items-center p-6 text-center'>
      <p className='max-w-prose text-sm text-muted-foreground'>{message}</p>
    </Card>
  );
}
