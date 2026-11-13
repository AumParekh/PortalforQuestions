import type { RecallTier } from '../../types';
import { RECALL_TIERS } from '../../lib/recallTiers';

/** Best recall-workbook tier of a question's learning objective. */
export function TierBadge({ tier }: { tier: RecallTier }) {
  const info = RECALL_TIERS.find((t) => t.id === tier);
  return (
    <span
      title={info ? `${info.name}: ${info.description}` : undefined}
      className="inline-flex shrink-0 items-center rounded-md bg-primary-50 px-1.5 py-0.5 text-[13px] font-semibold leading-none text-primary-700 dark:bg-primary/15 dark:text-primary-100"
    >
      Tier {tier}
      {info && <span className="sr-only"> ({info.description})</span>}
    </span>
  );
}
