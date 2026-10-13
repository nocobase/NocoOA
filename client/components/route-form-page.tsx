import { RouteFormCloseGuardContext } from '#hooks/use-route-form-close-guard';
import {
  useContext,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  DrawerFormContext,
  DrawerFormFooterContext,
} from './drawer-form-context.js';
import { RouteChildPage } from './route-child-page.js';
import { RouteDrawer } from './route-drawer.js';
import { RouteOverlayContext } from './use-route-overlay.js';

export interface RouteFormPageProps {
  readonly title: ReactNode;
  readonly presentation?: 'drawer' | 'page';
  readonly children?: ReactNode;
  readonly printable?: boolean;
  readonly beforeClose?: () => boolean | Promise<boolean>;
}

/**
 * OA request forms use the same drawer at workbench, list and detail entries.
 * Configuration forms may retain a covering page at their root entry.
 * Existing navigation guards protect close; actions keep their React ownership.
 */
export function RouteFormPage({
  title,
  presentation = 'drawer',
  printable = false,
  beforeClose,
  children,
}: RouteFormPageProps): ReactElement {
  const closeGuardRef = useRef<(() => boolean | Promise<boolean>) | undefined>(
    undefined,
  );
  const parentOverlay = useContext(RouteOverlayContext);
  const [footerTarget, setFooterTarget] = useState<HTMLDivElement | null>(null);
  if (presentation === 'page' && !parentOverlay)
    return <RouteChildPage>{children}</RouteChildPage>;
  return (
    <RouteDrawer
      beforeClose={() =>
        beforeClose ? beforeClose() : (closeGuardRef.current?.() ?? true)
      }
      printable={printable}
      title={title}
      className='text-sm sm:max-w-2xl'
      footer={<div ref={setFooterTarget} className='contents' />}
    >
      <RouteFormCloseGuardContext.Provider value={closeGuardRef}>
        <DrawerFormContext.Provider value>
          <DrawerFormFooterContext.Provider value={footerTarget}>
            {children}
          </DrawerFormFooterContext.Provider>
        </DrawerFormContext.Provider>
      </RouteFormCloseGuardContext.Provider>
    </RouteDrawer>
  );
}
