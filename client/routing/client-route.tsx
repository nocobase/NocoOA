import { useTranslation } from '@nocobase/i18n/client';
import type {
  AppClientRegisteredRoute,
  AppClientRouteComponentModule,
} from '@nocobase/app-client/plugins';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { NamespaceScope } from '@nocobase/i18n/client';
import { type ReactElement, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ErrorBoundary } from 'react-error-boundary';

import { requestActionDefinitions } from '#components/request-action-definitions';
import { RouteDrawer } from '#components/route-drawer';
import { Loading } from '#components/loading';
import { Button } from '#components/ui/button';

export interface ClientRouteProps {
  readonly route: AppClientRegisteredRoute;
}

export function ClientRoute({ route }: ClientRouteProps): ReactElement {
  const { authz, componentLoader } = route;
  const { t } = useTranslation();
  // Request routes load below the workbench Outlet. Keep pending/error feedback
  // in a visible drawer instead of placing it below the long background list.
  const requestEntry = requestActionDefinitions.find(
    ({ to }) => route.path.split('/').at(-1) === to,
  );
  const feedback = (content: ReactElement) =>
    requestEntry ? (
      <RouteDrawer
        title={t(requestEntry.label)}
        className='text-sm sm:max-w-2xl'
      >
        {content}
      </RouteDrawer>
    ) : (
      content
    );
  const checkAccess = authz !== 'skip';
  const { can: allowed, isPending: accessLoading } = useCan(
    authz === 'skip' ? undefined : authz,
  );
  const [componentModule, setComponentModule] =
    useState<AppClientRouteComponentModule>();
  const [loadError, setLoadError] = useState<unknown>();

  useEffect(() => {
    if (checkAccess && !allowed) return;
    let active = true;

    componentLoader!().then(
      (module) => {
        if (active) {
          setComponentModule(module);
          setLoadError(undefined);
        }
      },
      (error: unknown) => {
        if (active) {
          setLoadError(error);
        }
      },
    );

    return () => {
      active = false;
    };
  }, [allowed, checkAccess, componentLoader]);

  if (loadError) {
    return feedback(<ClientPageError />);
  }

  if (checkAccess && accessLoading) return feedback(<ClientPageLoading />);
  if (checkAccess && !allowed) return feedback(<ClientPageDenied />);

  if (!componentModule) {
    return feedback(<ClientPageLoading />);
  }

  const Component = componentModule.default;

  return (
    <ErrorBoundary fallback={feedback(<ClientPageError />)}>
      {/* The owning package is the page's namespace, so a plugin page translates with a bare useTranslation(). */}
      <NamespaceScope ns={route.packageName}>
        <Component />
      </NamespaceScope>
    </ErrorBoundary>
  );
}

function ClientPageDenied(): ReactElement {
  const { t } = useTranslation();

  return (
    <section className='grid min-h-[calc(100svh-4rem)] place-items-center px-6'>
      <section className='w-full max-w-lg space-y-3 text-center'>
        <h1 className='text-xl font-semibold'>
          {t('status.denied', { defaultValue: 'Access denied' })}
        </h1>
        <p className='text-sm text-muted-foreground'>
          {t('status.deniedDescription', {
            defaultValue: 'You do not have permission to access this page.',
          })}
        </p>
        {/* Route ids are implementation details; denied pages offer a safe exit. */}
        <Button nativeButton={false} render={<Link to='/' />}>
          {t('status.backHome', { defaultValue: 'Back to workbench' })}
        </Button>
      </section>
    </section>
  );
}

function ClientPageLoading(): ReactElement {
  const { t } = useTranslation();

  return (
    <Loading
      className='min-h-[calc(100svh-4rem)]'
      label={t('status.loadingPage', { defaultValue: 'Loading page' })}
    />
  );
}

function ClientPageError(): ReactElement {
  const { t } = useTranslation();

  return (
    <section className='grid min-h-[calc(100svh-4rem)] place-items-center px-6'>
      <section className='w-full max-w-lg space-y-4 text-center'>
        <h1 className='text-xl font-semibold'>
          {t('status.pageFailed', { defaultValue: 'Unable to load page' })}
        </h1>
        <p className='text-sm text-muted-foreground'>
          {t('status.routeFailedDescription', {
            defaultValue: 'This page could not be loaded. Please try again.',
          })}
        </p>
        <Button onClick={() => window.location.reload()}>
          {t('status.retry', { defaultValue: 'Retry' })}
        </Button>
      </section>
    </section>
  );
}
