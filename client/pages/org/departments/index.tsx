import { useApiClient } from '@nocobase/app-client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { cn } from 'cn';
import { NetworkIcon, PlusIcon, SearchIcon } from 'lucide-react';
import {
  type ReactElement,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { Link, Outlet, useLocation, useParams } from 'react-router';

import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Badge } from '#components/ui/badge';
import { Button } from '#components/ui/button';
import { Card, CardContent } from '#components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#components/ui/empty';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '#components/ui/input-group';
import { Skeleton } from '#components/ui/skeleton';
import { Spinner } from '#components/ui/spinner';
import { useUrlSearch } from '#hooks/use-url-search';

import { LoadError } from '../org-ui.js';
import { type ListBody, ORG_SETTINGS, useCanUpdate } from '../shared.js';
import type { Department, DepartmentsOutletContext } from './types.js';

interface TreeNode {
  readonly department: Department;
  readonly children: TreeNode[];
}

function buildTree(
  departments: readonly Department[],
  collator: Intl.Collator,
): TreeNode[] {
  const nodes = new Map<string, TreeNode>(
    departments.map((department) => [
      department.id,
      { department, children: [] },
    ]),
  );
  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    const parent =
      node.department.parentId === null
        ? undefined
        : nodes.get(node.department.parentId);
    // A parent that no longer resolves leaves the department at the top rather than hiding it.
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  const order = (list: TreeNode[]): void => {
    list.sort(
      (left, right) =>
        left.department.sortOrder - right.department.sortOrder ||
        collator.compare(left.department.title, right.department.title),
    );
    for (const node of list) order(node.children);
  };
  order(roots);
  return roots;
}

/** The nodes that match, with the ancestors leading to them. */
function filterTree(
  nodes: readonly TreeNode[],
  matches: (department: Department) => boolean,
): TreeNode[] {
  return nodes.flatMap((node) => {
    const children = filterTree(node.children, matches);
    return matches(node.department) || children.length
      ? [{ department: node.department, children }]
      : [];
  });
}

/** Ids whose department or some ancestor is disabled. */
function effectivelyInactive(departments: readonly Department[]): Set<string> {
  const byId = new Map(departments.map((row) => [row.id, row]));
  const result = new Set<string>();
  for (const department of departments) {
    const seen = new Set<string>();
    let current: Department | undefined = department;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (!current.active) {
        result.add(department.id);
        break;
      }
      current =
        current.parentId === null ? undefined : byId.get(current.parentId);
    }
  }
  return result;
}

function TreeRows({
  nodes,
  depth,
  selectedId,
  inactive,
  search,
}: {
  readonly nodes: readonly TreeNode[];
  readonly depth: number;
  readonly selectedId: string | undefined;
  readonly inactive: ReadonlySet<string>;
  readonly search: string;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <ul className='flex flex-col gap-0.5' role={depth ? 'group' : undefined}>
      {nodes.map(({ department, children }) => {
        const selected = department.id === selectedId;
        return (
          <li key={department.id}>
            <Link
              to={{ pathname: encodeURIComponent(department.id), search }}
              aria-current={selected ? 'page' : undefined}
              className={cn(
                'flex min-w-0 items-center gap-2 rounded-md py-1.5 pr-2 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                selected && 'bg-muted font-medium',
                inactive.has(department.id) && 'text-muted-foreground',
              )}
              // Indentation follows the depth of the tree; a computed value the spacing scale cannot express.
              style={{ paddingLeft: `${0.5 + depth}rem` }}
            >
              <span className='min-w-0 flex-1 truncate'>
                {department.title}
              </span>
              {department.active ? null : (
                <Badge variant='outline'>{t('org.common.inactive')}</Badge>
              )}
            </Link>
            {children.length ? (
              <TreeRows
                nodes={children}
                depth={depth + 1}
                selectedId={selectedId}
                inactive={inactive}
                search={search}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function TreeSkeleton(): ReactElement {
  const { t } = useTranslation();
  return (
    <div
      role='status'
      aria-label={t('status.loading')}
      className='flex flex-col gap-2'
    >
      {['w-32', 'w-28', 'w-36', 'w-24', 'w-20'].map((width) => (
        <Skeleton key={width} className={cn('h-5', width)} />
      ))}
    </div>
  );
}

/**
 * Settings → 组织架构: the searchable department tree on the left and the selected department (the `:departmentId`
 * child route, inline) on the right, like the permission workspace. The tree is small and loaded whole; its search
 * runs in the browser and lives in `?q`.
 */
export default function DepartmentsPage(): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const location = useLocation();
  const { departmentId } = useParams();
  const canUpdate = useCanUpdate(ORG_SETTINGS.departments);
  const searchRef = useRef<HTMLInputElement>(null);
  const { search, text, inputProps, clear } = useUrlSearch();

  const [reloadCount, reload] = useReducer((count: number) => count + 1, 0);
  const [result, setResult] = useState<{
    readonly key: number;
    readonly departments?: Department[];
    readonly error?: unknown;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    const key = reloadCount;
    api
      .request<ListBody<Department>>({
        path: 'departments',
        signal: controller.signal,
      })
      .then(
        ({ data }) => {
          if (!controller.signal.aborted) setResult({ key, departments: data });
        },
        (error: unknown) => {
          if (!controller.signal.aborted)
            setResult((previous) => ({ ...previous, key, error }));
        },
      );
    return () => controller.abort();
  }, [api, reloadCount]);

  const loading = result?.key !== reloadCount;
  const error = loading ? undefined : result?.error;
  const departments = result?.departments;

  const collator = useMemo(() => new Intl.Collator(locale), [locale]);
  const tree = useMemo(
    () => buildTree(departments ?? [], collator),
    [departments, collator],
  );
  const needle = search.toLowerCase();
  const visible = useMemo(
    () =>
      needle
        ? filterTree(
            tree,
            (department) =>
              department.title.toLowerCase().includes(needle) ||
              (department.code ?? '').toLowerCase().includes(needle),
          )
        : tree,
    [tree, needle],
  );
  const inactive = useMemo(
    () => effectivelyInactive(departments ?? []),
    [departments],
  );

  const outletContext = useMemo<DepartmentsOutletContext>(
    () => ({ departments, canUpdate, reload }),
    [departments, canUpdate],
  );

  const createButton = (
    <Button
      nativeButton={false}
      render={<Link to={{ pathname: 'new', search: location.search }} />}
    >
      <PlusIcon data-icon='inline-start' />
      {t('org.departments.create')}
    </Button>
  );

  function clearSearch(): void {
    clear();
    searchRef.current?.focus();
  }

  let content: ReactElement;
  if (error && !departments) {
    content = (
      <LoadError
        error={error}
        title={t('org.departments.loadFailed')}
        onRetry={reload}
      />
    );
  } else if (departments && departments.length === 0) {
    content = (
      <Empty className='min-h-48 border border-dashed'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <NetworkIcon />
          </EmptyMedia>
          <EmptyTitle>{t('org.departments.emptyTitle')}</EmptyTitle>
          <EmptyDescription>
            {canUpdate
              ? t('org.departments.emptyDescription')
              : t('org.common.askAdministrator')}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  } else {
    content = (
      <div className='flex flex-col gap-4 lg:flex-row lg:items-start'>
        <Card className='lg:w-72 lg:shrink-0'>
          <CardContent className='flex flex-col gap-3'>
            <div className='flex items-center gap-2'>
              <InputGroup>
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput
                  ref={searchRef}
                  {...inputProps}
                  placeholder={t('org.departments.searchPlaceholder')}
                  aria-label={t('org.departments.searchPlaceholder')}
                />
              </InputGroup>
              {loading && departments ? (
                <Spinner className='text-muted-foreground' />
              ) : null}
            </div>
            {error ? (
              <LoadError
                error={error}
                title={t('org.departments.loadFailed')}
                onRetry={reload}
              />
            ) : null}
            <nav aria-label={t('org.departments.treeLabel')}>
              {!departments ? (
                <TreeSkeleton />
              ) : visible.length ? (
                <TreeRows
                  nodes={visible}
                  depth={0}
                  selectedId={departmentId}
                  inactive={inactive}
                  search={location.search}
                />
              ) : (
                <div className='flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground'>
                  <span>{t('org.departments.noResults')}</span>
                  {text.trim() ? (
                    <Button variant='link' size='sm' onClick={clearSearch}>
                      {t('org.common.clearSearch')}
                    </Button>
                  ) : null}
                </div>
              )}
            </nav>
          </CardContent>
        </Card>
        <div className='min-w-0 flex-1'>
          {departmentId ? null : (
            <Card>
              <CardContent className='py-6 text-center text-sm text-muted-foreground'>
                {t('org.departments.choose')}
              </CardContent>
            </Card>
          )}
          {/* The selected department renders here inline; the top-level create dialog renders from here too. */}
          <Outlet context={outletContext} />
        </div>
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('org.departments.title')}
        description={t('org.departments.description')}
        actions={canUpdate ? createButton : null}
      />
      {content}
      {/* While the tree is empty the create dialog still needs somewhere to render. */}
      {departments && departments.length === 0 ? (
        <Outlet context={outletContext} />
      ) : null}
    </PageContainer>
  );
}
