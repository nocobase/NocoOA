import { useProcessText } from './text.js';
import { isProcessOverviewEdge } from './overview.js';
import { useTranslation } from '@nocobase/i18n/client';
import { Badge } from '#components/ui/badge';
import { FlowDiagram } from '#components/flow-diagram';
import { Button } from '#components/ui/button';
import { Pencil, OctagonX } from 'lucide-react';
/** Use the registry's React Flow/ELK renderer so cycles and return paths are routed
 * automatically. Parallel transitions share one visual edge; full rules remain below. */
export function ProcessGraph({
  states,
  edges,
  current,
  initial,
  definition = false,
  history,
  configurableNodes,
  onConfigure,
}: {
  states: { name: string; final: boolean }[];
  edges: {
    from: string;
    to: string;
    name: string;
    conditional?: boolean;
    condition?: string;
  }[];
  current?: string;
  initial?: string;
  definition?: boolean;
  history?: { from: string; to: string; name: string }[];
  configurableNodes?: ReadonlySet<string>;
  onConfigure?: (node: string) => void;
}) {
  const { t } = useTranslation(),
    text = useProcessText();
  const historyKeys = new Set(
    history?.map((edge) => JSON.stringify([edge.name, edge.from, edge.to])),
  );
  const visitedStates = new Set(
    history?.flatMap((edge) => [edge.from, edge.to]),
  );
  const normal = edges.filter(isProcessOverviewEdge);
  const completeEdges = history ? [...normal] : [...edges];
  if (history) {
    const defined = new Set(
      completeEdges.map((edge) =>
        JSON.stringify([edge.name, edge.from, edge.to]),
      ),
    );
    completeEdges.push(
      ...history.filter(
        (edge) => !defined.has(JSON.stringify([edge.name, edge.from, edge.to])),
      ),
    );
  }
  // Definitions show the business path; the unified rules below explain other operations.
  // Actual execution history retains every recorded transition.
  const visible = definition ? normal : completeEdges;
  const names = new Set(visible.flatMap((edge) => [edge.from, edge.to]));
  const visibleStates =
    definition || history
      ? states.filter(
          (state) =>
            names.has(state.name) ||
            state.name === initial ||
            state.name === current,
        )
      : states;
  const groups = new Map<
    string,
    {
      from: string;
      to: string;
      key: string;
      labels: Set<string>;
      visited: boolean;
    }
  >();
  for (const edge of visible) {
    const key = JSON.stringify([edge.from, edge.to]);
    const group = groups.get(key) ?? {
      from: edge.from,
      to: edge.to,
      key,
      labels: new Set<string>(),
      visited: false,
    };
    group.visited ||= historyKeys.has(
      JSON.stringify([edge.name, edge.from, edge.to]),
    );
    group.labels.add(
      text.transition(edge.name) +
        (edge.condition
          ? ` · ${t(`processManagement.branchConditions.${edge.condition}`)}`
          : edge.conditional
            ? ` · ${t('processManagement.conditionMissing')}`
            : ''),
    );
    groups.set(key, group);
  }
  const graphEdges = [...groups.values()];
  return (
    <div className='flex flex-col gap-3'>
      {definition && (
        <p className='text-sm text-muted-foreground'>
          {t('processManagement.normalDescription')}
        </p>
      )}
      {history && (
        <div className='flex flex-wrap gap-2 text-sm'>
          <Badge>{t('processManagement.currentNode')}</Badge>
          <Badge variant='secondary'>
            {t('processManagement.visitedNode')}
          </Badge>
          <Badge variant='outline'>
            {t('processManagement.unvisitedNode')}
          </Badge>
        </div>
      )}
      <FlowDiagram
        className='[&_.react-flow__node]:cursor-default'
        onNodeClick={(node) => {
          if (definition && configurableNodes?.has(node.id))
            onConfigure?.(node.id);
        }}
        ariaLabel={t('processManagement.graphView')}
        direction='DOWN'
        autoHeight
        initialZoomLimit={0.75}
        compact
        nodes={visibleStates.map((state) => ({
          id: state.name,
          label: text.state(state.name),
          highlighted: state.name === current,
          visited: visitedStates.has(state.name),
          className:
            state.name === 'terminated'
              ? 'cursor-default rounded-full border-dashed border-destructive! bg-destructive/10! text-destructive ring-destructive/30!'
              : definition && configurableNodes?.has(state.name)
                ? 'cursor-pointer transition-colors hover:border-primary hover:bg-accent hover:ring-2 hover:ring-primary/20'
                : 'cursor-default',
          // Reserve room for the node's configuration control in ELK's layout.
          height:
            state.name === 'terminated'
              ? 112
              : definition && configurableNodes?.has(state.name)
                ? 96
                : undefined,
        }))}
        edges={graphEdges.map((edge) => ({
          id: edge.key,
          source: edge.from,
          target: edge.to,
          label: Array.from(edge.labels).join(' / '),
          visited: edge.visited,
        }))}
        renderNode={(node) => (
          <div className='flex flex-col items-center gap-1'>
            <span className='flex items-center gap-2'>
              {node.id === 'terminated' && (
                <OctagonX className='size-4' aria-hidden='true' />
              )}
              {node.label}
            </span>
            {node.id === 'terminated' && (
              <Badge variant='destructive'>
                {t('processManagement.terminationOutcome')}
              </Badge>
            )}
            {definition && configurableNodes?.has(node.id) && (
              <Button
                variant='ghost'
                size='sm'
                className='nodrag nopan'
                aria-label={t('processManagement.nodeSettings.editNamed', {
                  name: node.label,
                })}
                onClick={(event) => {
                  event.stopPropagation();
                  onConfigure?.(node.id);
                }}
              >
                <Pencil data-icon='inline-start' />
                {t('processManagement.nodeSettings.edit')}
              </Button>
            )}
            {history && node.highlighted ? (
              <Badge
                variant={node.id === 'terminated' ? 'destructive' : 'default'}
              >
                {t('processManagement.currentNode')}
              </Badge>
            ) : history && node.visited ? (
              <Badge variant='secondary'>
                {t('processManagement.visitedNode')}
              </Badge>
            ) : (
              node.id === initial && (
                <Badge variant='outline'>
                  {t('processManagement.initial')}
                </Badge>
              )
            )}
            {states.find((state) => state.name === node.id)?.final && (
              <Badge variant='outline'>{t('processManagement.final')}</Badge>
            )}
          </div>
        )}
      />
    </div>
  );
}
