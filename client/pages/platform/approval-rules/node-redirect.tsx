import { Navigate, useParams } from 'react-router';
import { ruleNodeTargets } from '../../process-management/node-settings.js';
/** Preserve old bookmarks while centralizing edits at process nodes. */
export default function RuleNodeRedirect() {
  const { key = '' } = useParams();
  return (
    <Navigate replace to={ruleNodeTargets(key)[0]?.path ?? '/approval-rules'} />
  );
}
