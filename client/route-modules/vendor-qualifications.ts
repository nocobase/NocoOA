import {
  defineAppRoutes,
  type AppClientRouteDefinition,
} from '@nocobase/app-client/plugins';
import { BadgeCheck } from 'lucide-react';
function detailChildren(owner: string): AppClientRouteDefinition[] {
  return [
    {
      name: `${owner}-edit`,
      path: 'edit',
      componentLoader: () =>
        import('../pages/vendor-qualifications/form-page.js'),
    },
    {
      name: `${owner}-action`,
      path: 'action/:actionName/:targetId',
      componentLoader: () =>
        import('../pages/vendor-qualifications/action-dialog.js'),
    },
    {
      name: `${owner}-account`,
      path: 'paymentAccount',
      componentLoader: () =>
        import('../pages/vendor-qualifications/payment-account.js'),
    },
  ];
}
export function vendorQualificationViewChildren(
  owner: string,
): AppClientRouteDefinition[] {
  return [
    {
      name: `${owner}-vendor-new`,
      path: 'newVendorQualification',
      componentLoader: () =>
        import('../pages/vendor-qualifications/form-page.js'),
    },
    {
      name: `${owner}-vendor-edit`,
      path: 'editVendorQualification/:requestId',
      componentLoader: () =>
        import('../pages/vendor-qualifications/form-page.js'),
    },
    {
      name: `${owner}-vendor-detail`,
      path: 'vendorQualification/:requestId',
      componentLoader: () => import('../pages/vendor-qualifications/detail.js'),
      children: detailChildren(`${owner}-vendor-detail`),
    },
  ];
}
export const vendorQualificationRoutes = defineAppRoutes([
  {
    name: 'oa-vendor-qualifications',
    parent: 'oa-procurement',
    path: '/vendorQualifications',
    auth: 'required',
    authz: {
      resource: { type: 'page', id: 'oa-vendor-qualifications' },
      action: 'access',
    },
    navigation: {
      title: 'vendorQualifications.title',
      icon: BadgeCheck,
      order: 20,
    },
    componentLoader: () => import('../pages/vendor-qualifications/index.js'),
    children: [
      {
        name: 'vendor-qualification-new',
        path: 'new',
        componentLoader: () =>
          import('../pages/vendor-qualifications/form-page.js'),
      },
      {
        name: 'vendor-qualification-edit',
        path: 'edit/:requestId',
        componentLoader: () =>
          import('../pages/vendor-qualifications/form-page.js'),
      },
      {
        name: 'vendor-qualification-detail',
        path: ':requestId',
        componentLoader: () =>
          import('../pages/vendor-qualifications/detail.js'),
        children: detailChildren('vendor-qualification-detail'),
      },
    ],
  },
  {
    name: 'oa-vendor-qualification-configuration',
    parent: 'oa-configuration',
    path: '/vendorQualificationConfiguration',
    auth: 'required',
    authz: {
      resource: { type: 'page', id: 'oa-vendor-qualification-configuration' },
      action: 'access',
    },
    componentLoader: () =>
      import('../pages/vendor-qualifications/configuration-redirect.js'),
  },
]);
