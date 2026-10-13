import { UserNameText } from '#components/user-name';
import { UserName } from '#components/user-name';
import { useRef, useState } from 'react';
import { useParams, useOutletContext } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useToaster } from '@nocobase/app-client';
import { useAuthorizationRevision } from '@nocobase/app-plugin-authorization/client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { RouteDrawer } from '#components/route-drawer';
import { useRouteOverlay } from '#components/use-route-overlay';
import { Button } from '#components/ui/button';
import { Textarea } from '#components/ui/textarea';
import { UserPicker } from '#components/user-picker';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '#components/ui/select';
import { Field, FieldLabel } from '#components/ui/field';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '#components/ui/alert-dialog';
import { Spinner } from '#components/ui/spinner';
import { useCertificateResource } from './resource.js';
import { useCertificateCommand } from './command.js';
import { CertificateError, CertificateSkeleton } from './states.js';
import { selectWidth, type Detail, type Context } from './types.js';
export default function CertificateAction() {
  const revision = useAuthorizationRevision(),
    { session } = useAuthentication();
  return <Overlay key={`${revision}:${session?.user.id}`} />;
}
function Overlay() {
  const { t } = useTranslation(),
    { action } = useParams(),
    { session } = useAuthentication(),
    revision = useAuthorizationRevision(),
    [busy, setBusy] = useState(false),
    workingRef = useRef(false);
  return (
    <RouteDrawer
      title={t(`certificates.actions.${action}`)}
      className='sm:max-w-2xl'
      beforeClose={() => !workingRef.current}
      footer={<Footer busy={busy} />}
    >
      <Body
        key={`${revision}:${session?.user.id}:${action}`}
        pending={(value) => {
          workingRef.current = value;
          setBusy(value);
        }}
      />
    </RouteDrawer>
  );
}
function Footer({ busy }: { busy: boolean }) {
  const { t } = useTranslation(),
    { close } = useRouteOverlay();
  return (
    <>
      <Button variant='outline' disabled={busy} onClick={() => void close()}>
        {t('certificates.cancel')}
      </Button>
      <Button form='certificate-action' type='submit' disabled={busy}>
        {busy ? <Spinner /> : null}
        {t('certificates.confirm')}
      </Button>
    </>
  );
}
function Body({ pending }: { pending: (v: boolean) => void }) {
  const { certificateId, action } = useParams(),
    { t } = useTranslation(),
    { close } = useRouteOverlay(),
    parent = useOutletContext<Context>(),
    toast = useToaster();
  const r = useCertificateResource<{ data: Detail }>(
      `certificateRequests/${encodeURIComponent(certificateId!)}`,
    ),
    cmd = useCertificateCommand();
  const [reason, setReason] = useState(''),
    [recipient, setRecipient] = useState(''),
    [confirm, setConfirm] = useState(false),
    [mode, setMode] = useState('before'),
    [invalid, setInvalid] = useState(false);
  const d = r.data?.data,
    transition = d?.capabilities.transitions.includes(action!),
    offer = d?.capabilities.taskActions.find((o) =>
      o.actions.some((a) => a.name === action),
    );
  const destructive = [
      'withdraw',
      'terminate',
      'forceComplete',
      'reject',
      'return',
      'unable',
    ].includes(action!),
    needsReason = [
      'terminate',
      'forceComplete',
      'reject',
      'return',
      'unable',
      'retry',
      'transfer',
      'reassign',
      'appoint',
    ].includes(action!),
    needsRecipient = [
      'assign',
      'transfer',
      'reassign',
      'appoint',
      'cc',
      'addSigner',
    ].includes(action!);
  async function execute() {
    if (!d || (!transition && !offer)) return;
    if ((needsRecipient && !recipient) || (needsReason && !reason.trim())) {
      setInvalid(true);
      document.getElementById('certificate-reason')?.focus();
      return;
    }
    pending(true);
    const result = await cmd.execute(
      `certificateRequests/${encodeURIComponent(certificateId!)}/${transition ? action : 'actions'}`,
      'POST',
      transition
        ? {
            expectedVersion: d.record.lifecycleVersion,
            ...(reason.trim() ? { reason: reason.trim() } : {}),
          }
        : {
            action,
            target: { taskId: offer!.taskId },
            contentHash: offer!.contentHash,
            ...(reason.trim() ? { comment: reason.trim() } : {}),
            ...(needsRecipient
              ? {
                  input:
                    action === 'addSigner'
                      ? { person: recipient, mode }
                      : { to: action === 'cc' ? [recipient] : recipient },
                }
              : {}),
          },
      transition ? 'requestKey' : 'requestId',
    );
    pending(false);
    if (result) {
      parent.reload();
      toast.show({ type: 'success', title: t('certificates.saved') });
      await close();
    }
  }
  return (
    <>
      {r.error ? <CertificateError error={r.error} retry={r.reload} /> : null}
      {r.loading ? <CertificateSkeleton /> : null}
      {d && !r.error ? (
        transition || offer ? (
          <form
            id='certificate-action'
            className='flex flex-col gap-4'
            onSubmit={(event) => {
              event.preventDefault();
              if (
                (needsRecipient && !recipient) ||
                (needsReason && !reason.trim())
              ) {
                setInvalid(true);
                document.getElementById('certificate-reason')?.focus();
                return;
              }
              if (destructive) setConfirm(true);
              else void execute();
            }}
          >
            {invalid ? (
              <p role='alert' className='text-sm text-destructive'>
                {t('certificates.invalidInput')}
              </p>
            ) : null}
            <p className='text-sm'>
              <UserNameText
                text={t('certificates.recordName', {
                  name: d.record.applicant.name,
                })}
                name={d.record.applicant.name}
              />
            </p>
            {needsRecipient ? (
              <Field>
                <FieldLabel>{t('certificates.recipient')} *</FieldLabel>
                <UserPicker
                  value={recipient}
                  onChange={setRecipient}
                  knownUsers={[d.record.applicant]}
                />
              </Field>
            ) : null}
            {action === 'addSigner' ? (
              <Field>
                <FieldLabel htmlFor='certificate-mode'>
                  {t('certificates.mode')}
                </FieldLabel>
                <Select
                  value={mode}
                  onValueChange={(value) => setMode(value ?? 'before')}
                >
                  <SelectTrigger id='certificate-mode'>
                    <SelectValue>{t(`certificates.modes.${mode}`)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className={selectWidth}>
                    <SelectGroup>
                      {['before', 'alongside'].map((value) => (
                        <SelectItem key={value} value={value}>
                          {t(`certificates.modes.${value}`)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor='certificate-reason'>
                {t('certificates.reason')}
                {needsReason ? ' *' : ''}
              </FieldLabel>
              <Textarea
                id='certificate-reason'
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required={needsReason}
                maxLength={5000}
                disabled={cmd.busy}
              />
            </Field>
            {cmd.error ? <CertificateError error={cmd.error} /> : null}
          </form>
        ) : (
          <p className='text-sm text-muted-foreground'>
            {t('certificates.unavailable')}
          </p>
        )
      ) : null}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(`certificates.actions.${action}`)} ·{' '}
              <UserName name={d?.record.applicant.name} />
            </AlertDialogTitle>
            <AlertDialogDescription>
              <UserNameText
                text={t(`certificates.consequences.${action}`, {
                  name: d?.record.applicant.name ?? '',
                })}
                name={d?.record.applicant.name ?? ''}
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('certificates.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => void execute()}
            >
              {t(`certificates.actions.${action}`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
