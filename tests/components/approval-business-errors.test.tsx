import { ApiClientError } from '@nocobase/app-client';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import enUS from '../../client/locales/en-US.js';
import zhCN from '../../client/locales/zh-CN.js';
import { useBusinessErrorMessage } from '../../client/hooks/use-business-error-message.js';
import { ErrorState as PaymentError } from '../../client/pages/payment-requests/states.js';
import { ErrorState as TravelError } from '../../client/pages/travel/states.js';
import { ErrorState as PurchaseError } from '../../client/pages/purchases/states.js';
import { ErrorState as TrainingError } from '../../client/pages/training/states.js';
import { CertificateError } from '../../client/pages/certificates/states.js';
import { SealError } from '../../client/pages/seals/states.js';
import { ErrorState as ContractError } from '../../client/pages/contracts/shared.js';
import { ErrorState as RecruitmentError } from '../../client/pages/recruitment/shared.js';
import { MemoryRouter } from 'react-router';

const runtimes = {
  'en-US': await createTestI18nRuntime({
    locale: 'en-US',
    application: {
      namespace: 'nb3-oa',
      resources: enUS,
    },
  }),
  'zh-CN': await createTestI18nRuntime({
    locale: 'zh-CN',
    application: {
      namespace: 'nb3-oa',
      resources: zhCN,
    },
  }),
};
function error(reason: string, status = 400, payload?: unknown) {
  return new ApiClientError('INTERNAL RAW MESSAGE', {
    reason,
    status,
    method: 'POST',
    url: '/api/requests',
    payload,
  });
}
function Message({ cause, module }: { cause: unknown; module: string }) {
  const message = useBusinessErrorMessage(cause, module);
  return <p>{message ?? 'No business message'}</p>;
}
function show(
  element: React.ReactNode,
  locale: keyof typeof runtimes = 'en-US',
) {
  return render(
    <TestI18nProvider runtime={runtimes[locale]}>
      <MemoryRouter>{element}</MemoryRouter>
    </TestI18nProvider>,
  );
}
afterEach(cleanup);
const cases = [
  [
    PaymentError,
    'PAYMENT_REQUEST_VOUCHER_REQUIRED',
    'Enter the payment voucher number and upload or select payment evidence.',
  ],
  [
    TravelError,
    'TRAVEL_ITINERARY_REQUIRED',
    'International travel requires an itinerary attachment. Upload or select one before submitting.',
  ],
  [
    PurchaseError,
    'PURCHASE_QUOTES_REQUIRED',
    'This amount requires quotes from three different suppliers, each with an attachment.',
  ],
  [
    TrainingError,
    'TRAINING_INVALID_DATE',
    'The training end must be later than its start. Check the dates and times.',
  ],
  [
    CertificateError,
    'CERTIFICATE_PREPARATION_STALE',
    enUS.certificates.businessErrors.CERTIFICATE_PREPARATION_STALE,
  ],
  [SealError, 'INVALID_COPIES', enUS.seals.businessErrors.INVALID_COPIES],
  [
    ContractError,
    'CONTRACT_TEXT_REQUIRED',
    enUS.contracts.errors.CONTRACT_TEXT_REQUIRED,
  ],
  [
    RecruitmentError,
    'RECRUITMENT_INVALID_SALARY',
    enUS.recruitment.businessErrors.RECRUITMENT_INVALID_SALARY,
  ],
] as const;
it.each(cases)(
  'shows the declared business reason through its owning error surface %#',
  (ErrorView, reason, message) => {
    show(<ErrorView error={error(reason)} retry={() => undefined} />);
    expect(screen.getByText(message)).toBeVisible();
    expect(screen.queryByText('INTERNAL RAW MESSAGE')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  },
);
it.each(['en-US', 'zh-CN'] as const)(
  'translates every newly declared business reason in %s',
  (locale) => {
    const resource = locale === 'en-US' ? enUS : zhCN;
    for (const [module, section] of Object.entries(resource)) {
      const map = (section as { businessErrors?: Record<string, string> })
        .businessErrors;
      if (!map) continue;
      for (const [reason, message] of Object.entries(map)) {
        const view = show(
          <Message cause={error(reason)} module={module} />,
          locale,
        );
        expect(screen.getByText(message)).toBeVisible();
        view.unmount();
      }
    }
  },
);
it('keeps denied, missing, expired sessions, server errors and unknown reasons outside business copy', () => {
  for (const cause of [
    error('PAYMENT_REQUEST_VOUCHER_REQUIRED', 401),
    error('PAYMENT_REQUEST_VOUCHER_REQUIRED', 403),
    error('PAYMENT_REQUEST_VOUCHER_REQUIRED', 404),
    error('PAYMENT_REQUEST_VOUCHER_REQUIRED', 500),
    error('UNDECLARED_REASON'),
    new Error('Secret'),
  ]) {
    const view = show(<Message cause={cause} module='paymentRequests' />);
    expect(screen.getByText('No business message')).toBeVisible();
    view.unmount();
  }
});
it('uses translated field labels for schema violations, ignoring unknown paths and raw descriptions', () => {
  show(
    <Message
      module='paymentRequests'
      cause={error('INVALID_ARGUMENT', 422, {
        error: {
          fieldViolations: [
            { field: 'input.invoiceNumber', description: 'SECRET' },
            { field: 'input.invoiceNumber' },
            { field: 'input.privateInternalField' },
          ],
        },
      })}
    />,
  );
  expect(screen.getByText('Check these fields: Invoice number.')).toBeVisible();
  expect(screen.queryByText(/SECRET|privateInternalField/)).toBeNull();
});
it('does not use another module to translate a similarly named reason', () => {
  show(
    <Message
      cause={error('CONTRACT_TEXT_REQUIRED')}
      module='paymentRequests'
    />,
  );
  expect(screen.getByText('No business message')).toBeVisible();
});

it('explains claiming a handling task without overriding general permission failures', () => {
  show(
    <Message
      cause={error('CERTIFICATE_CLAIM_REQUIRED', 403)}
      module='certificates'
    />,
  );
  expect(
    screen.getByText(
      enUS.certificates.businessErrors.CERTIFICATE_CLAIM_REQUIRED,
    ),
  ).toBeVisible();
});
it('translates shared approval refusals across business modules', () => {
  for (const [reason, message] of Object.entries(enUS.approvals.actionErrors)) {
    const view = show(<Message cause={error(reason)} module='training' />);
    expect(screen.getByText(message)).toBeVisible();
    view.unmount();
  }
});
