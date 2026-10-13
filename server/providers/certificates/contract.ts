import { createServiceToken } from '@nocobase/service-provider';
import type { DatabaseConnection, RepositoryPolicy } from '@nocobase/db';
import type { LifecycleRecord } from '@nocobase/lifecycle';

export const CERTIFICATE_KIND = 'oa.certificateRequest';
export type CertificateState =
  | 'draft'
  | 'revision'
  | 'head'
  | 'issuing'
  | 'issueException'
  | 'issued'
  | 'rejected'
  | 'withdrawn'
  | 'terminated'
  | 'administrativelyClosed';
export interface CertificateRequest extends LifecycleRecord {
  id: string;
  status: CertificateState;
  lifecycleVersion: number;
  createdAt: Date | string;
  statusChangedAt: Date | string;
  applicantId: string;
  createdById: string;
  employeeId: string;
  departmentId: string;
  certificateType: string;
  purpose: string;
  copies: number;
  deliveryMethod: string;
  preparationId: string | null;
  issueId: string | null;
  exceptionReason: string | null;
  administrativeReason: string | null;
  approvedFingerprint: string | null;
  submittedAt: Date | string | null;
}
export interface CertificateCenterItem {
  id: string;
  kind: typeof CERTIFICATE_KIND;
  title?: string;
  number: string | null;
  applicantId: string;
  applicant: { id: string; name: string };
  status: CertificateState;
  createdAt: string;
  startDate: string | null;
  endDate: null;
  amount: null;
  unit: null;
}
export interface CertificateRenderData {
  number: string;
  issueDate: string;
  employee: { id: string; name: string };
  department: { id: string; name: string };
  certificateType: string;
  purpose: string;
  copies: number;
  deliveryMethod: string;
  /** Only present under current viewIncome AND ordinary view AND actual HR duty. */
  income?: { monthlyCents: number; currency: 'CNY'; monthlyFormatted: string };
}
export interface CertificatePreparation {
  id: string;
  requestId: string;
  number: string;
  issueDate: string;
  templateId: string;
  revisionId: string;
  templateHash: string;
  sourceHash: string;
  applicantId: string;
  employeeId: string;
  preparedById: string;
  preparedAt: Date | string;
  status: 'prepared' | 'generated' | 'confirmed';
  sensitivity: 'ordinary' | 'income';
}
export interface CertificatePrintAccess {
  view: RepositoryPolicy;
  issue: RepositoryPolicy;
  income?: RepositoryPolicy;
}
/** Proposed shared-print integration: recordId is preparationId, never a mutable request. */
export interface CertificatePrintService {
  /** Returns a complete explicit frozen DTO after current actor, duties and policies checks. */
  source(
    preparationId: string,
    actorId: string,
    access: CertificatePrintAccess,
    locale: 'zh-CN' | 'en-US',
    connection?: DatabaseConnection,
  ): Promise<CertificateRenderData>;
}
export const certificatePrintServiceToken =
  createServiceToken<CertificatePrintService>('oa/certificate-print-service');
export const certificateRequestServiceToken = createServiceToken<
  import('./service.js').CertificateApplication['requests']
>('oa/certificate-request-service');
