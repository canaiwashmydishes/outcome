import { Check, X } from 'lucide-react';
import { SUBSCRIPTIONS, type Subscription } from '@outcome99/shared';
import { cn, formatDate } from '../lib/utils';

interface Props {
  subscription: Subscription | null;
}

const TIER_ORDER: Array<'starter' | 'professional' | 'enterprise'> = [
  'starter',
  'professional',
  'enterprise',
];

export default function BillingView({ subscription }: Props) {
  if (!subscription) {
    return (
      <div className="text-[10px] uppercase tracking-widest text-black/30">
        Loading subscription…
      </div>
    );
  }

  const current = SUBSCRIPTIONS[subscription.tier];
  const anniversaryDate = new Date(subscription.anniversaryDate);

  return (
    <div className="max-w-5xl mx-auto space-y-10">
      <div>
        <div className="text-[10px] uppercase tracking-[0.3em] text-black/40 mb-1">
          Billing // Subscription
        </div>
        <h2 className="text-3xl font-light tracking-tighter">Plan and usage</h2>
      </div>

      {/* Current plan status */}
      <div className="grid md:grid-cols-2 gap-px bg-black border-thin">
        <div className="bg-white p-6">
          <div className="text-[9px] uppercase tracking-widest text-black/40 mb-2 font-bold">
            Current plan
          </div>
          <div className="text-2xl font-light tracking-tighter mb-1">{current.name}</div>
          <div className="text-[11px] text-black/50 mb-4">{current.tagline}</div>
          <div className="text-[10px] uppercase tracking-widest text-black/40 space-y-1">
            <div>Status: {subscription.status}</div>
            <div>Anniversary: {formatDate(anniversaryDate)}</div>
          </div>
        </div>
        <div className="bg-white p-6">
          <div className="text-[9px] uppercase tracking-widest text-black/40 mb-2 font-bold">
            Deal quota
          </div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-3xl font-light tracking-tighter font-mono">
              {subscription.dealsUsedThisYear}
            </span>
            <span className="text-sm text-black/40 font-mono">
              / {subscription.dealsIncluded ?? '∞'}
            </span>
          </div>
          <div className="text-[10px] uppercase tracking-widest text-black/40">
            deals used this year
          </div>
          <div className="mt-4 text-[9px] uppercase tracking-widest text-black/30">
            Resets on anniversary
          </div>
        </div>
      </div>

      {/* Tier comparison */}
      <section>
        <h3 className="text-lg font-light tracking-tighter mb-4">Available tiers</h3>
        <div className="grid md:grid-cols-3 gap-px bg-black border-thin">
          {TIER_ORDER.map((tier) => {
            const def = SUBSCRIPTIONS[tier];
            const isCurrent = tier === subscription.tier;
            return (
              <div
                key={tier}
                className={cn(
                  'bg-white p-6 flex flex-col',
                  isCurrent && 'bg-black text-white'
                )}
              >
                <div className="mb-4">
                  <div
                    className={cn(
                      'text-[9px] uppercase tracking-widest mb-2 font-bold',
                      isCurrent ? 'text-white/60' : 'text-black/40'
                    )}
                  >
                    {def.name}
                    {isCurrent && ' // Current'}
                  </div>
                  <div className="text-2xl font-light tracking-tighter">
                    {def.annualPriceUSD === null
                      ? 'Contact sales'
                      : `$${def.annualPriceUSD.toLocaleString()}/yr`}
                  </div>
                  <div
                    className={cn(
                      'text-[10px] leading-relaxed mt-2',
                      isCurrent ? 'text-white/60' : 'text-black/50'
                    )}
                  >
                    {def.tagline}
                  </div>
                </div>
                <ul className="space-y-2 mb-6 flex-grow">
                  {def.features.map((f) => (
                    <li
                      key={f}
                      className={cn(
                        'flex items-start gap-2 text-[11px] leading-relaxed',
                        isCurrent ? 'text-white/80' : 'text-black/70'
                      )}
                    >
                      <Check size={12} className="mt-0.5 flex-shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <button
                  disabled={isCurrent}
                  className={cn(
                    'w-full border py-2 text-[10px] uppercase font-bold tracking-widest transition-colors',
                    isCurrent
                      ? 'border-white/30 text-white/40 cursor-default'
                      : 'border-black hover:bg-black hover:text-white'
                  )}
                >
                  {isCurrent ? 'Current plan' : tier === 'enterprise' ? 'Contact sales' : 'Upgrade'}
                </button>
              </div>
            );
          })}
        </div>
        <div className="mt-3 text-[10px] uppercase tracking-widest text-black/40 flex items-center gap-2">
          <X size={10} />
          <span>Billing checkout activates in Build H. Current: trialing Starter.</span>
        </div>
      </section>
    </div>
  );
}
