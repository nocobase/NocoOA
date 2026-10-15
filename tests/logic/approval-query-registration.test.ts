// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ApprovalService } from '@nocobase/app-plugin-approval/server';
import {
  approvalQuerySources,
  createAppApprovalService,
  initializeApprovalQuery,
} from '../../server/providers/approval-runtime/query-service.js';
import type { ApprovalQuery } from '@nocobase/app-plugin-approval/server';

describe('application approval query registration', () => {
  it('shares registration and disposal through a read-context SDK proxy', async () => {
    const runtime = {} as ConstructorParameters<typeof ApprovalService>[0];
    const approval = {
      name: 'oa.test',
      kind: 'oa.test',
      options: {},
      lifecycle: { collection: 'testRequests' },
    } as ConstructorParameters<typeof ApprovalService>[1][number];
    const service = createAppApprovalService(runtime, [approval], {});
    const read = vi.fn((work: () => unknown) => work());
    const proxy = new Proxy(service, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function'
          ? (...args: unknown[]) =>
              read(() => Reflect.apply(value, target, args))
          : value;
      },
    });
    const register = vi.fn();
    const query = { register } as unknown as ApprovalQuery;

    expect(approvalQuerySources(proxy)).toEqual(approvalQuerySources(service));
    expect(approvalQuerySources(proxy)[0].runtime).toBe(runtime);
    const dispose = await initializeApprovalQuery(proxy, query);
    expect(register).toHaveBeenCalledTimes(1);
    expect(await initializeApprovalQuery(service, query)).toBeUndefined();
    dispose!();
    const disposeAgain = await initializeApprovalQuery(service, query);
    expect(register).toHaveBeenCalledTimes(2);
    disposeAgain!();
    expect(read).not.toHaveBeenCalled();
  });

  it('still rejects SDKs that did not use the factory', () => {
    expect(() => approvalQuerySources({} as ApprovalService)).toThrow(
      'Approval owner did not use the application SDK factory.',
    );
  });
});
