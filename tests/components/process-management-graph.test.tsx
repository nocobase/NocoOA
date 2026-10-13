import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import enUS from '../../client/locales/en-US.js';
import type { FlowDiagramProps } from '../../client/components/flow-diagram.js';
import { ProcessGraph } from '../../client/pages/process-management/graph.js';
vi.mock('../../client/components/flow-diagram.js', () => ({
  FlowDiagram: ({ nodes, edges, onNodeClick }: FlowDiagramProps) => (
    <div>
      {nodes.map((node) => (
        <button
          key={node.id}
          data-visited={node.visited}
          data-current={node.highlighted}
          onClick={() => onNodeClick?.(node)}
        >
          {node.label}
        </button>
      ))}
      {edges.map((edge) => (
        <span key={edge.id} data-visited={edge.visited}>
          {edge.source} → {edge.target}: {edge.label}
        </span>
      ))}
    </div>
  ),
}));
const runtime = await createTestI18nRuntime({
  application: { namespace: 'nb3-oa', resources: enUS },
});
const states = ['draft', 'manager', 'revision', 'approved'].map((name) => ({
  name,
  final: name === 'approved',
}));
const edges = [
  { from: 'draft', to: 'manager', name: 'submit' },
  { from: 'approved', to: 'manager', name: 'gmReturned' },
  { from: 'manager', to: 'manager', name: 'reviewEdit' },
  {
    from: 'manager',
    to: 'approved',
    name: 'managerApproved',
    conditional: true,
    condition: 'leave_headApproved_approved',
  },
  { from: 'manager', to: 'revision', name: 'returned' },
  { from: 'draft', to: 'revision', name: 'edit' },
  { from: 'draft', to: 'draft', name: 'edit' },
];
function setup(definition = true) {
  render(
    <TestI18nProvider runtime={runtime}>
      <ProcessGraph
        definition={definition}
        states={states}
        edges={edges}
        initial='draft'
      />
    </TestI18nProvider>,
  );
}
it('shows the main business path with conditions without alternate diagram controls', () => {
  setup();
  expect(screen.getByText('draft → manager: Submit')).toBeVisible();
  expect(
    screen.getByText(
      'manager → approved: Approval passed · The leave type does not require HR and days are below the frozen HR limit',
    ),
  ).toBeVisible();
  expect(screen.queryByText(/manager → revision:/)).toBeNull();
  expect(screen.queryByText(/draft → revision:/)).toBeNull();
  expect(screen.queryByText(/approved → manager:/)).toBeNull();
  expect(screen.queryByText(/manager → manager:/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'All transitions' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Stage table' })).toBeNull();
});
it('keeps return transitions visible in actual execution history', () => {
  setup(false);
  expect(
    screen.getByText('manager → revision: Return for revision'),
  ).toBeVisible();
  expect(screen.getByText('draft → revision: Edit content')).toBeVisible();
  expect(screen.getByText(/approved → manager:/)).toBeVisible();
  expect(screen.getByText(/manager → manager:/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'All transitions' })).toBeNull();
});

it('overlays actual progress on the complete business flow and preserves historical returns', () => {
  render(
    <TestI18nProvider runtime={runtime}>
      <ProcessGraph
        states={states}
        edges={edges}
        initial='draft'
        current='manager'
        history={[
          { from: 'draft', to: 'manager', name: 'submit' },
          { from: 'manager', to: 'revision', name: 'returned' },
          { from: 'revision', to: 'manager', name: 'submit' },
        ]}
      />
    </TestI18nProvider>,
  );
  expect(screen.getByText('draft → manager: Submit')).toHaveAttribute(
    'data-visited',
    'true',
  );
  expect(screen.getByText(/manager → approved:/)).toHaveAttribute(
    'data-visited',
    'false',
  );
  expect(
    screen.getByText('manager → revision: Return for revision'),
  ).toHaveAttribute('data-visited', 'true');
  expect(screen.getByText('revision → manager: Submit')).toHaveAttribute(
    'data-visited',
    'true',
  );
  expect(screen.queryByText(/approved → manager:/)).toBeNull();
  expect(screen.queryByText(/manager → manager:/)).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Approved', exact: true }),
  ).toHaveAttribute('data-visited', 'false');
  expect(
    screen.getByRole('button', { name: 'Manager', exact: true }),
  ).toHaveAttribute('data-current', 'true');
});

it('opens settings only for explicitly configured definition nodes', async () => {
  const configure = vi.fn();
  const { rerender } = render(
    <TestI18nProvider runtime={runtime}>
      <ProcessGraph
        definition
        states={states}
        edges={edges}
        initial='draft'
        configurableNodes={new Set(['manager'])}
        onConfigure={configure}
      />
    </TestI18nProvider>,
  );
  const { default: userEvent } = await import('@testing-library/user-event');
  await userEvent.click(screen.getByRole('button', { name: 'Manager' }));
  expect(configure).toHaveBeenCalledWith('manager');
  await userEvent.click(screen.getByRole('button', { name: 'Approved' }));
  expect(configure).toHaveBeenCalledOnce();
  rerender(
    <TestI18nProvider runtime={runtime}>
      <ProcessGraph
        states={states}
        edges={edges}
        initial='draft'
        configurableNodes={new Set(['manager'])}
        onConfigure={configure}
      />
    </TestI18nProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Manager' }));
  expect(configure).toHaveBeenCalledOnce();
});
