import {
  createContext,
  useContext,
  useLayoutEffect,
  type RefObject,
} from 'react';

type CloseGuard = () => boolean | Promise<boolean>;
export const RouteFormCloseGuardContext = createContext<RefObject<
  CloseGuard | undefined
> | null>(null);

/** Register a form's explicit close check without changing sidebar/history navigation. */
export function useRouteFormCloseGuard(guard: CloseGuard) {
  const registrationRef = useContext(RouteFormCloseGuardContext);
  useLayoutEffect(() => {
    if (!registrationRef) return;
    registrationRef.current = guard;
    return () => {
      if (registrationRef.current === guard)
        registrationRef.current = undefined;
    };
  }, [registrationRef, guard]);
}
