import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FileUp,
  Search,
  FileSearch,
  Flag,
  MessageSquare,
  FlaskConical,
  Download,
  ArrowLeft,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { User } from 'firebase/auth';
import { useDeal } from '../hooks/useDeals';
import IngestionPanel from './IngestionPanel';
import type { Integration, IntegrationProvider, PhaseName, PhaseStatus } from '@outcome99/shared';
import { cn, formatDate } from '../lib/utils';

interface Props {
  dealId: string;
  user: User;
  integrations: Partial<Record<IntegrationProvider, Integration>>;
}

interface PhaseCard {
  name: PhaseName;
  label: string;
  description: string;
  buildLabel: string;
  icon: LucideIcon;
  /** True when this build activates the phase; the card becomes clickable. */
  active: boolean;
}

const PHASES: PhaseCard[] = [
  {
    name: 'ingestion',
    label: 'Data-Room Ingestion',
    description:
      'Upload the data room. OCR, folder recognition, and classification into the nine workstreams.',
    buildLabel: 'Build B',
    icon: FileUp,
    active: true,
  },
  {
    name: 'research',
    label: 'Contextual Research',
    description: 'Claude Opus maps the deal to the applicable red-flag library and active workstreams.',
    buildLabel: 'Build C',
    icon: Search,
    active: false,
  },
  {
    name: 'extraction',
    label: 'Workstream Extraction',
    description: 'Per-workstream extraction of issues with source-backed citations.',
    buildLabel: 'Build C',
    icon: FileSearch,
    active: false,
  },
  {
    name: 'detection',
    label: 'Red-Flag Detection',
    description:
      'Rule engine and LLM pattern detection materialize Finding objects with severity and deal-impact tags.',
    buildLabel: 'Build C',
    icon: Flag,
    active: false,
  },
  {
    name: 'followup',
    label: 'Follow-Up Generation',
    description: 'Draft seller-facing clarifications and missing-document requests, grouped by workstream.',
    buildLabel: 'Build E',
    icon: MessageSquare,
    active: false,
  },
  {
    name: 'scenario',
    label: 'Scenario Testing',
    description: 'On-demand Claude-native swarm quantifies deal impact for specific flagged risks.',
    buildLabel: 'Build F',
    icon: FlaskConical,
    active: false,
  },
  {
    name: 'synthesis_export',
    label: 'Synthesis & Export',
    description:
      'IC memo, top-10 pack, unresolved tracker, valuation implications, integration implications.',
    buildLabel: 'Build E',
    icon: Download,
    active: false,
  },
];

type WorkspaceView = 'overview' | 'ingestion';

export default function DealWorkspace({ dealId, user, integrations }: Props) {
  const { deal, loading } = useDeal(dealId);
  const [view, setView] = useState<WorkspaceView>('overview');

  if (loading) {
    return (
      <div className="h-[60vh] flex items-center justify-center text-[10px] uppercase tracking-widest text-black/30">
        Loading deal workspace…
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="border border-dashed border-black/10 p-12 text-center">
        <p className="text-[10px] uppercase tracking-[0.3em] text-black/30">
          Deal not found or access denied.
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-8"
    >
      {/* Header — persistent across views */}
      <header className="border-bottom-thin pb-6 flex items-end justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            {view !== 'overview' && (
              <button
                onClick={() => setView('overview')}
                className="text-[10px] uppercase tracking-widest text-black/40 hover:text-black flex items-center gap-1"
              >
                <ArrowLeft size={10} />
                Overview
              </button>
            )}
            <div className="text-[10px] uppercase tracking-[0.3em] text-black/40">
              {view === 'overview' ? 'Deal workspace' : 'Phase 1 · Ingestion'}
            </div>
          </div>
          <h1 className="text-3xl font-light tracking-tighter">{deal.meta.name}</h1>
          <div className="mt-3 flex items-center gap-4 text-[10px] uppercase tracking-widest text-black/50 flex-wrap">
            <span>{deal.meta.targetCompany}</span>
            <span>•</span>
            <span>{deal.meta.sector}</span>
            <span>•</span>
            <span>{deal.meta.structure.replace('_', ' ')}</span>
            <span>•</span>
            <span>{deal.meta.geography}</span>
          </div>
        </div>
        <div className="text-right text-[10px] uppercase tracking-widest text-black/40">
          <div>Created</div>
          <div className="font-mono text-black/70 mt-1">
            {formatDate(deal.createdAt as never)}
          </div>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {view === 'overview' && (
          <motion.div
            key="overview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-6"
          >
            <section>
              <div className="text-[10px] uppercase tracking-[0.3em] text-black/40 mb-3 font-bold">
                Seven-phase pipeline
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-black border-thin">
                {PHASES.map((phase, idx) => {
                  const status = deal.phaseStatus[phase.name] ?? 'not_started';
                  return (
                    <PhaseCardView
                      key={phase.name}
                      number={idx + 1}
                      phase={phase}
                      status={status}
                      onOpen={
                        phase.active
                          ? () => {
                              if (phase.name === 'ingestion') setView('ingestion');
                            }
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            </section>

            <div className="border-thin bg-black/[0.02] p-4 text-[10px] uppercase tracking-widest text-black/50 leading-relaxed">
              <span className="font-bold text-black/70">Build B · </span>
              Data-room ingestion is live. Click the first phase to upload documents.
              Subsequent phases activate in Builds C, E, and F.
            </div>
          </motion.div>
        )}

        {view === 'ingestion' && (
          <motion.div
            key="ingestion"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <IngestionPanel dealId={dealId} user={user} integrations={integrations} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function PhaseCardView({
  number,
  phase,
  status,
  onOpen,
}: {
  number: number;
  phase: PhaseCard;
  status: PhaseStatus;
  onOpen?: () => void;
}) {
  const Icon = phase.icon;
  const isActive = status === 'in_progress';
  const isDone = status === 'completed';
  const isFailed = status === 'failed';
  const clickable = Boolean(onOpen);

  return (
    <button
      onClick={onOpen}
      disabled={!clickable}
      className={cn(
        'bg-white p-6 flex gap-5 text-left w-full',
        clickable ? 'hover:bg-black/[0.03] cursor-pointer' : 'cursor-default'
      )}
    >
      <div className="flex-shrink-0">
        <div
          className={cn(
            'w-10 h-10 flex items-center justify-center border',
            isDone
              ? 'bg-black text-white border-black'
              : isFailed
                ? 'border-red-700 text-red-700'
                : isActive
                  ? 'border-black animate-pulse'
                  : 'border-black/10 text-black/30'
          )}
        >
          <Icon size={16} />
        </div>
      </div>
      <div className="flex-grow">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="text-[9px] uppercase tracking-widest font-mono text-black/40">
              P{number.toString().padStart(2, '0')}
            </span>
            <h3 className="text-sm font-semibold">{phase.label}</h3>
          </div>
          <span
            className={cn(
              'text-[8px] uppercase tracking-widest px-2 py-0.5 border',
              isDone
                ? 'border-black'
                : isFailed
                  ? 'border-red-700 text-red-700'
                  : isActive
                    ? 'border-black animate-pulse'
                    : 'border-black/10 text-black/30'
            )}
          >
            {status.replace('_', ' ')}
          </span>
        </div>
        <p className="text-[11px] text-black/60 leading-relaxed">{phase.description}</p>
        {status === 'not_started' && !phase.active && (
          <div className="mt-3 text-[9px] uppercase tracking-widest text-black/30">
            Activates in {phase.buildLabel}
          </div>
        )}
        {phase.active && status === 'not_started' && (
          <div className="mt-3 text-[9px] uppercase tracking-widest text-black/60">
            Click to start →
          </div>
        )}
        {phase.active && (status === 'in_progress' || status === 'completed') && (
          <div className="mt-3 text-[9px] uppercase tracking-widest text-black/60">
            Click to manage →
          </div>
        )}
      </div>
    </button>
  );
}
