import { Briefcase } from 'lucide-react';
import { SUBSCRIPTIONS, type Subscription } from '@outcome99/shared';
import { cn } from '../lib/utils';

interface Props {
  subscription: Subscription | null;
  onClickBilling?: () => void;
}

export default function PlanBadge({ subscription, onClickBilling }: Props) {
  if (!subscription) {
    return (
      <div className="border-thin p-3 text-[9px] uppercase tracking-widest text-black/30">
        Loading plan…
      </div>
    );
  }

  const def = SUBSCRIPTIONS[subscription.tier];
  const used = subscription.dealsUsedThisYear;
  const included = subscription.dealsIncluded;
  const unlimited = included === null;
  const remaining = unlimited ? Infinity : Math.max(0, included - used);
  const pct = unlimited ? 0 : Math.max(0, Math.min(100, (used / included) * 100));
  const low = !unlimited && remaining <= 1;

  return (
    <button
      onClick={onClickBilling}
      className={cn(
        'w-full border-thin p-3 text-left group hover:bg-black hover:text-white transition-colors duration-300',
        low && 'border-black'
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Briefcase size={10} className="text-black/60 group-hover:text-white/60" />
          <span className="text-[9px] uppercase tracking-widest font-bold">{def.name}</span>
        </div>
        <span className="text-[9px] uppercase tracking-widest opacity-40 group-hover:opacity-70">
          Billing →
        </span>
      </div>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-2xl font-light tracking-tighter font-mono">
          {unlimited ? '∞' : remaining}
        </span>
        <span className="text-[9px] uppercase tracking-widest opacity-40">deals remaining</span>
      </div>
      {!unlimited && (
        <>
          <div className="credit-bar group-hover:bg-white/20">
            <div className="credit-bar-fill group-hover:bg-white" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex justify-between mt-1.5 text-[8px] uppercase tracking-widest opacity-40 group-hover:opacity-70">
            <span>{used} used</span>
            <span>of {included}/yr</span>
          </div>
        </>
      )}
    </button>
  );
}
