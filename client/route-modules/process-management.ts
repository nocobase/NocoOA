import {
  defineAppRoutes,
  type AppClientRouteDefinition,
} from '@nocobase/app-client/plugins';
import { Workflow } from 'lucide-react';
import { viewChildren } from './approvals.js';
function executionChildren(owner: string): AppClientRouteDefinition[] {
  return [
    {
      name: `${owner}-action`,
      path: 'actions/:actionName/:taskId',
      componentLoader: () => import('../pages/process-management/action.js'),
    },
    ...viewChildren(`${owner}-business`).filter(
      (route) =>
        route.path &&
        !route.path.startsWith('new') &&
        !route.path.startsWith('edit'),
    ),
  ];
}
export default defineAppRoutes([
  {
    name: 'oa-process-management',
    parent: 'oa-system',
    path: '/processManagement',
    auth: 'required',
    authz: {
      resource: { type: 'page', id: 'oa.processManagement' },
      action: 'access',
    },
    navigation: { title: 'processManagement.title', icon: Workflow, order: 15 },
    componentLoader: () => import('../pages/process-management/index.js'),
    children: [
      {
        name: 'oa-process-definitions',
        path: 'definitions',
        componentLoader: () => import('../pages/process-management/list.js'),
        children: [
          {
            name: 'oa-process-definition',
            path: ':kind',
            componentLoader: () =>
              import('../pages/process-management/definition.js'),
            children: [
              {
                name: 'oa-process-node-settings',
                path: 'nodes/:node/settings',
                componentLoader: () =>
                  import('../pages/process-management/node-settings-dialog.js'),
              },
              {
                name: 'oa-process-definition-execution',
                path: 'executions/:recordId',
                componentLoader: () =>
                  import('../pages/process-management/detail.js'),
                children: executionChildren('oa-process-definition-execution'),
              },
            ],
          },
        ],
      },
      {
        name: 'oa-process-executions',
        path: 'executions',
        componentLoader: () => import('../pages/process-management/list.js'),
        children: [
          {
            name: 'oa-process-execution',
            path: ':kind/:recordId',
            componentLoader: () =>
              import('../pages/process-management/detail.js'),
            children: executionChildren('oa-process-execution'),
          },
        ],
      },
    ],
  },
]);
