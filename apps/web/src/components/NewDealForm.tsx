import { useState } from 'react';
import { motion } from 'motion/react';
import { FirebaseError } from 'firebase/app';
import { createDeal } from '../lib/functions';
import type { DealStructure } from '@outcome99/shared';

interface Props {
  activeTeamId: string;
  onCreated: (dealId: string) => void;
  onCancel: () => void;
  onGoBilling: () => void;
}

const STRUCTURES: Array<{ value: DealStructure; label: string }> = [
  { value: 'asset_purchase', label: 'Asset Purchase' },
  { value: 'stock_purchase', label: 'Stock Purchase' },
  { value: 'merger', label: 'Merger' },
  { value: 'carve_out', label: 'Carve-out' },
  { value: 'recapitalization', label: 'Recapitalization' },
  { value: 'minority_investment', label: 'Minority Investment' },
  { value: 'other', label: 'Other' },
];

export default function NewDealForm({ activeTeamId, onCreated, onCancel, onGoBilling }: Props) {
  const [name, setName] = useState('');
  const [targetCompany, setTargetCompany] = useState('');
  const [sector, setSector] = useState('');
  const [sizeUSD, setSizeUSD] = useState<string>('');
  const [structure, setStructure] = useState<DealStructure>('stock_purchase');
  const [geography, setGeography] = useState('');
  const [expectedCloseDate, setExpectedCloseDate] = useState<string>('');
  const [riskAppetiteNotes, setRiskAppetiteNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid =
    name.trim().length > 0 &&
    targetCompany.trim().length > 0 &&
    sector.trim().length > 0 &&
    geography.trim().length > 0;

  const handleSubmit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await createDeal({
        teamId: activeTeamId,
        meta: {
          name: name.trim(),
          targetCompany: targetCompany.trim(),
          sector: sector.trim(),
          sizeUSD: sizeUSD ? Number(sizeUSD) : null,
          structure,
          geography: geography.trim(),
          expectedCloseDate: expectedCloseDate || undefined,
          riskAppetiteNotes: riskAppetiteNotes.trim() || undefined,
        },
      });
      if (!res.data.ok) throw new Error('Deal creation failed.');
      onCreated(res.data.dealId);
    } catch (err) {
      const e = err as FirebaseError;
      if (e.code === 'functions/resource-exhausted') {
        setError('Annual deal quota reached. Upgrade your plan to add more deals.');
      } else {
        setError(e.message ?? 'Failed to create deal.');
      }
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="max-w-2xl mx-auto border-thin p-10 bg-white"
    >
      <div className="mb-10 border-bottom-thin pb-6">
        <div className="text-[10px] uppercase tracking-widest text-black/30 block mb-3">
          New deal workspace // Setup
        </div>
        <input
          type="text"
          placeholder="Deal name (e.g., Project Atlas)"
          className="text-3xl font-light tracking-tighter bg-transparent border-none p-0 outline-none w-full border-b border-black/5 focus:border-black/20 transition-colors"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <p className="text-xs text-black/50 mt-2">
          Give the workspace an internal code name. You can rename it later.
        </p>
      </div>

      <div className="space-y-6">
        <Field label="Target company">
          <input
            type="text"
            placeholder="Legal name of target"
            className="minimal-input"
            value={targetCompany}
            onChange={(e) => setTargetCompany(e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Sector">
            <input
              type="text"
              placeholder="e.g., B2B SaaS, Industrial Mfg"
              className="minimal-input"
              value={sector}
              onChange={(e) => setSector(e.target.value)}
            />
          </Field>
          <Field label="Geography">
            <input
              type="text"
              placeholder="e.g., North America"
              className="minimal-input"
              value={geography}
              onChange={(e) => setGeography(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Deal size (USD, optional)">
            <input
              type="number"
              placeholder="e.g., 250000000"
              className="minimal-input"
              value={sizeUSD}
              onChange={(e) => setSizeUSD(e.target.value)}
            />
          </Field>
          <Field label="Structure">
            <select
              className="minimal-input"
              value={structure}
              onChange={(e) => setStructure(e.target.value as DealStructure)}
            >
              {STRUCTURES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Expected close date (optional)">
          <input
            type="date"
            className="minimal-input"
            value={expectedCloseDate}
            onChange={(e) => setExpectedCloseDate(e.target.value)}
          />
        </Field>

        <Field label="Risk appetite notes (optional)">
          <textarea
            rows={3}
            placeholder="e.g., Strict on customer concentration risk; tolerant of moderate cyber gaps given post-close remediation plan. Feeds into Phase 2 red-flag calibration."
            className="minimal-input resize-none font-normal"
            value={riskAppetiteNotes}
            onChange={(e) => setRiskAppetiteNotes(e.target.value)}
          />
        </Field>

        {error && (
          <div className="border border-red-700 bg-red-50 p-3 text-[11px] text-red-700 flex items-start justify-between gap-4">
            <span>{error}</span>
            {error.includes('quota') && (
              <button onClick={onGoBilling} className="underline whitespace-nowrap">
                Upgrade →
              </button>
            )}
          </div>
        )}

        <div className="pt-8 flex justify-between items-center border-top-thin border-black/5">
          <button
            onClick={onCancel}
            className="text-[10px] uppercase tracking-widest text-black/40 hover:text-black"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!valid || submitting}
            className="minimal-button bg-black text-white hover:bg-white hover:text-black disabled:opacity-20 w-56"
          >
            {submitting ? 'Creating…' : 'Create deal workspace'}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-widest text-black/50 block font-bold">
        {label}
      </label>
      {children}
    </div>
  );
}
