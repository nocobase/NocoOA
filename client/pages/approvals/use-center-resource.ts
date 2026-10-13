import { sharedRead } from './shared-read.js';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useAuthorizationRevision } from '@nocobase/app-plugin-authorization/client';
import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useEffect, useReducer, useState } from 'react';
export interface CenterRecord {
  id: string;
  kind:
    | 'oa.workItem'
    | 'oa.announcementReceipt'
    | 'oa.recruitment'
    | 'oa.sealRequest'
    | 'oa.vehicleRequest'
    | 'oa.transfer'
    | 'oa.certificateRequest'
    | 'oa.leave'
    | 'oa.overtime'
    | 'oa.leaveCancellation'
    | 'oa.general'
    | 'oa.supplies'
    | 'oa.budgetAdjustment'
    | 'oa.expensePlan'
    | 'oa.training'
    | 'oa.reimbursement'
    | 'oa.purchase'
    | 'oa.loan'
    | 'oa.payment'
    | 'oa.probation'
    | 'oa.departure'
    | 'oa.vendorQualification'
    | 'oa.contract'
    | 'oa.assetRequest'
    | 'oa.travel'
    | 'oa.travelCancellation'
    | 'oa.attendanceChange'
    | 'oa.outing';
  title?: string;
  updatedAt?: string | null;
  dueAt?: string;
  number: string | null;
  applicantId: string;
  applicant: { id: string; name: string } | null;
  status: string;
  createdAt: string | null;
  startDate: string | null;
  endDate: string | null;
  amount: number | null;
  unit: 'days' | 'minutes' | 'cents' | null;
}
interface CenterResponse {
  data: CenterRecord[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    kinds: CenterRecord['kind'][];
    attention?: {
      drafts: CenterRecord[];
      revisions: CenterRecord[];
      submitted?: CenterRecord[];
    };
    counts: { drafts: number; revisions: number; inProgress: number };
  };
}
/** Keep the server total with the records; a paged length is never a work count. */
export function useCenterResource(query: Record<string, string>) {
  const api = useApiClient();
  const [generation, reload] = useReducer((v: number) => v + 1, 0);
  const { session } = useAuthentication();
  const revision = useAuthorizationRevision();
  const queryKey = JSON.stringify(query);
  const source = JSON.stringify([queryKey, session?.user.id, revision]);
  const key = JSON.stringify([source, generation]);
  const [result, setResult] = useState<{
    source: string;
    key: string;
    value?: CenterResponse;
    error?: unknown;
  }>();
  useEffect(() => {
    let active = true;
    const read = sharedRead(
      api,
      JSON.stringify(['approvalCenter', key]),
      (signal) =>
        api.request<CenterResponse>({
          path: 'approvalCenter',
          query: JSON.parse(queryKey) as Record<string, string>,
          signal,
        }),
    );
    read.promise.then(
      (value) => {
        if (active) setResult({ source, key, value });
      },
      (error: unknown) => {
        if (!active) return;
        const final =
          error instanceof ApiClientError &&
          [401, 403, 404].includes(error.status);
        setResult((old) => ({
          source,
          key,
          error,
          value: !final && old?.source === source ? old.value : undefined,
        }));
      },
    );
    return () => {
      active = false;
      read.release();
    };
  }, [api, source, key, queryKey]);
  return {
    data: result?.source === source ? result.value?.data : undefined,
    meta: result?.source === source ? result.value?.meta : undefined,
    error: result?.key === key ? result.error : undefined,
    loading: result?.key !== key,
    // A completed first read (success or failure) for this identity/query lets
    // secondary reads start. Refresh retains it; identity/revision changes reset it.
    settled: result?.source === source,
    reload,
  };
}
