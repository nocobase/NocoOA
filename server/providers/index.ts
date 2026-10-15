import ProcessManagementProvider from './process-management/index.js';
import PersonalSchedulesProvider from './personal-schedules/index.js';
import TransferProvider from './transfer/index.js';
import CertificatesProvider from './certificates/index.js';
import AttendanceManagementProvider from './attendance-management/index.js';
import SealsProvider from './seals/index.js';
import WorkItemsProvider from './work-items/index.js';
import KnowledgeProvider from './knowledge/index.js';
import RecruitmentProvider from './recruitment/index.js';
import OnboardingProvider from './onboarding/index.js';
import AnnouncementsProvider from './announcements/index.js';
import VehiclesProvider from './vehicles/index.js';
import MeetingRoomsProvider from './meeting-rooms/index.js';
import SalaryGradesProvider from './job-grades/index.js';
import HeadcountsProvider from './headcounts/index.js';
import TemplatePrintProvider from './template-print/index.js';
import ContractsProvider from './contracts/index.js';
import AssetRequestsProvider from './asset-requests/index.js';
import VendorQualificationProvider from './vendor-qualification/index.js';
import AssetsProvider from './assets/index.js';
import DepartureReassignmentProvider from './departure-reassignment/index.js';
import DepartureProvider from './departure/index.js';
import ProbationProvider from './probation/index.js';
import LoanRequestsProvider from './loan-requests/index.js';
import PaymentRequestsProvider from './payment-requests/index.js';
import ReimbursementProvider from './reimbursement/index.js';
import VendorsProvider from './vendors/index.js';
import PurchasesProvider from './purchases/index.js';
import ApprovalQueryProvider from './approval-runtime/index.js';
import TravelProvider from './travel/index.js';
import TravelCancellationProvider from './travel/cancellation-provider.js';
import FinanceAssignmentsProvider from './finance-assignments/index.js';
import InvoicesProvider from './invoices/index.js';
import TrainingProvider from './training/index.js';
import LoanLedgerProvider from './loan-ledger/index.js';
import ExpensePlanProvider from './expense-plan/index.js';
import BudgetAdjustmentsProvider from './budget-adjustments/index.js';
import SuppliesProvider from './supplies/index.js';
import GeneralRequestProvider from './general-requests/index.js';
import type { ApplicationServiceProviderConstructor } from '@nocobase/app-server/application';

import AuditProvider from './audit/index.js';
import BudgetsProvider from './budgets/index.js';
import ExpenseAuthorizationsProvider from './expense-authorizations/index.js';
import ApprovalNotificationsProvider from './approval-notifications/index.js';
import ApprovalDirectoryProvider from './approval-directory/index.js';
import LeaveAttachmentsProvider from './leave-attachments/index.js';
import LeaveBalancesProvider from './leave-balances/index.js';
import AnnualLeaveProvider from './annual-leave/index.js';
import LeaveProvider from './leave/index.js';
import CancellationProvider from './leave-cancellations/index.js';
import OvertimeProvider from './overtime/index.js';
import EmployeesProvider from './employees/index.js';
import AttendanceProvider from './attendance/index.js';
import OutingsProvider from './outings/index.js';
import AttendanceChangeProvider from './attendance-change/index.js';
import AttendanceChangeAttachmentsProvider from './attendance-change-attachments/index.js';
import ImportProvider from './import/index.js';
import OrgProvider from './org/index.js';
import PlatformProvider from './platform/index.js';

export { auditServiceToken, type AuditService } from './audit/index.js';
export { orgServiceToken, type OrgService } from './org/contract.js';

// Each OA module owns `server/providers/<module>/` with an `index.ts` default-exporting its provider. Order is
// dependency order: audit first, since every module records into it; org before employees, which reads it.
const serviceProviders: readonly ApplicationServiceProviderConstructor[] = [
  AuditProvider,
  PlatformProvider,
  BudgetsProvider,
  ExpenseAuthorizationsProvider,
  LoanLedgerProvider,
  InvoicesProvider,
  VendorsProvider,
  PurchasesProvider,
  OrgProvider,
  SalaryGradesProvider,
  EmployeesProvider,
  KnowledgeProvider,
  AnnouncementsProvider,
  WorkItemsProvider,
  PersonalSchedulesProvider,
  MeetingRoomsProvider,
  HeadcountsProvider,
  AttendanceProvider,
  AttendanceManagementProvider,
  ApprovalDirectoryProvider,
  FinanceAssignmentsProvider,
  ApprovalNotificationsProvider,
  LeaveBalancesProvider,
  AnnualLeaveProvider,
  LeaveProvider,
  CancellationProvider,
  AttendanceChangeProvider,
  AttendanceChangeAttachmentsProvider,
  OutingsProvider,
  OvertimeProvider,
  GeneralRequestProvider,
  BudgetAdjustmentsProvider,
  ExpensePlanProvider,
  TrainingProvider,
  TravelProvider,
  TravelCancellationProvider,
  LoanRequestsProvider,
  ReimbursementProvider,
  PaymentRequestsProvider,
  ProbationProvider,
  DepartureProvider,
  AssetsProvider,
  AssetRequestsProvider,
  VendorQualificationProvider,
  ContractsProvider,
  SealsProvider,
  TemplatePrintProvider,
  CertificatesProvider,
  SuppliesProvider,
  LeaveAttachmentsProvider,
  // Writes through the organisation and employee services.
  ImportProvider,
  VehiclesProvider,
  RecruitmentProvider,
  OnboardingProvider,
  TransferProvider,
  DepartureReassignmentProvider,
  ProcessManagementProvider,
  ApprovalQueryProvider,
];

export default serviceProviders;
