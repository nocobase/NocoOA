import { RefreshCw } from 'lucide-react';
import { Button } from '#components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#components/ui/tooltip';

/** Refresh is a secondary, named action with a consistent pending state. */
export function ApplicationRefreshButton({
  label,
  loading = false,
  onClick,
}: {
  readonly label: string;
  readonly loading?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type='button'
            variant='outline'
            size='icon'
            disabled={loading}
            aria-label={label}
            aria-busy={loading}
            onClick={onClick}
          />
        }
      >
        <RefreshCw className={loading ? 'animate-spin' : undefined} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
