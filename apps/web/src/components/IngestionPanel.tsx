import { useState } from 'react';
import { motion } from 'motion/react';
import { FileText, Flag, CheckCircle2, Clock, XCircle, Copy } from 'lucide-react';
import type { User } from 'firebase/auth';
import DocumentUploadDropzone from './DocumentUploadDropzone';
import IntegrationsPanel from './IntegrationsPanel';
import { useDocuments } from '../hooks/useDocuments';
import type { DealDocument, DocumentStatus, Integration, IntegrationProvider, Workstream } from '@outcome99/shared';
import { cn } from '../lib/utils';

interface Props {
  dealId: string;
  user: User;
  integrations: Partial<Record<IntegrationProvider, Integration>>;
}

const WORKSTREAM_LABELS: Record<Workstream, string> = {
  legal: 'Legal',
  financial: 'Financial',
  tax: 'Tax',
  hr: 'HR',
  cyber_it: 'Cyber / IT',
  commercial: 'Commercial',
  customer: 'Customer',
  supplier: 'Supplier',
  operations_integration: 'Operations / Integration',
};

/**
 * The Phase 1 (Data-Room Ingestion) surface of a Deal Workspace.
 *
 * Shows:
 *   - Upload dropzone at the top
 *   - Running counts (uploaded, processing, completed, failed, duplicates)
 *   - Per-workstream document counts as classification completes
 *   - A scrollable document list with per-doc status
 */
export default function IngestionPanel({ dealId, user, integrations }: Props) {
  const { documents, summary, loading } = useDocuments(dealId);
  const [filter, setFilter] = useState<DocumentStatus | 'all'>('all');

  const visibleDocs = documents.filter((d) => {
    if (d.status === 'skipped_duplicate') return false; // duplicates are summary-only
    if (filter === 'all') return true;
    return d.status === filter;
  });

  const hasAny = documents.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6"
    >
      {/* Cloud-storage + VDR integrations */}
      <IntegrationsPanel user={user} dealId={dealId} integrations={integrations} />

      {/* Dropzone — always visible so users can add more docs mid-ingestion */}
      <section>
        <div className="text-[10px] uppercase tracking-[0.3em] text-black/40 mb-3 font-bold">
          Upload
        </div>
        <DocumentUploadDropzone dealId={dealId} />
      </section>

      {/* Summary bar — only shows once there's at least one document */}
      {hasAny && (
        <section>
          <div className="text-[10px] uppercase tracking-[0.3em] text-black/40 mb-3 font-bold">
            Data-room status
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-black border-thin">
            <SummaryTile label="Total" value={summary.total} />
            <SummaryTile label="Processing" value={summary.processing} dim={summary.processing === 0} />
            <SummaryTile label="Completed" value={summary.completed} />
            <SummaryTile label="Failed" value={summary.failed} variant={summary.failed > 0 ? 'warn' : 'default'} />
            <SummaryTile label="Dedup'd" value={summary.duplicates} dim />
          </div>
        </section>
      )}

      {/* Workstream distribution — appears once classification starts */}
      {hasAny && Object.keys(summary.byWorkstream).length > 0 && (
        <section>
          <div className="text-[10px] uppercase tracking-[0.3em] text-black/40 mb-3 font-bold">
            Classified by workstream
          </div>
          <div className="grid grid-cols-3 md:grid-cols-5 gap-px bg-black border-thin">
            {(Object.keys(WORKSTREAM_LABELS) as Workstream[]).map((w) => (
              <WorkstreamTile
                key={w}
                label={WORKSTREAM_LABELS[w]}
                count={summary.byWorkstream[w] ?? 0}
              />
            ))}
          </div>
        </section>
      )}

      {/* Document list */}
      {hasAny && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] uppercase tracking-[0.3em] text-black/40 font-bold">
              Documents
            </div>
            <div className="flex gap-1">
              {(['all', 'ocr_in_progress', 'completed', 'failed'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'text-[9px] uppercase tracking-widest px-2 py-1 border',
                    filter === f
                      ? 'border-black bg-black text-white'
                      : 'border-black/20 hover:border-black/40'
                  )}
                >
                  {f === 'ocr_in_progress' ? 'processing' : f.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>
          {loading ? (
            <div className="h-16 bg-black/[0.03] animate-pulse" />
          ) : visibleDocs.length === 0 ? (
            <div className="border-thin p-8 text-center">
              <div className="text-[10px] uppercase tracking-widest text-black/40">
                No documents matching this filter.
              </div>
            </div>
          ) : (
            <div className="border-thin divide-y divide-black/5">
              {visibleDocs.map((d) => (
                <DocumentRow key={d.id} doc={d} />
              ))}
            </div>
          )}
        </section>
      )}
    </motion.div>
  );
}

function SummaryTile({
  label,
  value,
  dim,
  variant = 'default',
}: {
  label: string;
  value: number;
  dim?: boolean;
  variant?: 'default' | 'warn';
}) {
  return (
    <div className="bg-white p-4">
      <div
        className={cn(
          'text-[9px] uppercase tracking-widest font-bold mb-1',
          variant === 'warn' ? 'text-red-700' : 'text-black/40'
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          'text-3xl font-light tracking-tighter font-mono',
          dim && 'text-black/30',
          variant === 'warn' && value > 0 && 'text-red-700'
        )}
      >
        {value}
      </div>
    </div>
  );
}

function WorkstreamTile({ label, count }: { label: string; count: number }) {
  return (
    <div className={cn('bg-white p-3', count === 0 && 'opacity-40')}>
      <div className="text-[8px] uppercase tracking-widest text-black/50 mb-0.5 truncate">
        {label}
      </div>
      <div className="text-xl font-light tracking-tighter font-mono">{count}</div>
    </div>
  );
}

function DocumentRow({ doc }: { doc: DealDocument }) {
  const workstreamLabel = doc.workstream ? WORKSTREAM_LABELS[doc.workstream] : null;

  return (
    <div className="flex items-center gap-3 p-3 min-w-0">
      <StatusIcon status={doc.status} />
      <div className="flex-grow min-w-0">
        <div className="text-[11px] font-semibold truncate">{doc.name}</div>
        <div className="text-[9px] uppercase tracking-widest text-black/40 truncate">
          {doc.folderPath ? `${doc.folderPath} · ` : ''}
          {formatBytes(doc.sizeBytes)}
          {doc.pages > 0 ? ` · ${doc.pages} pages` : ''}
          {doc.status === 'failed' && doc.failureReason ? ` · ${doc.failureReason}` : ''}
        </div>
      </div>
      {workstreamLabel && doc.status === 'completed' && (
        <div className="flex items-center gap-2 flex-shrink-0">
          <Flag size={10} className="text-black/40" />
          <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 border border-black/20">
            {workstreamLabel}
          </span>
          {typeof doc.classifierConfidence === 'number' && (
            <span className="text-[9px] font-mono text-black/40">
              {Math.round(doc.classifierConfidence * 100)}%
            </span>
          )}
        </div>
      )}
      {doc.status !== 'completed' && doc.status !== 'failed' && (
        <span className="text-[9px] uppercase tracking-widest text-black/40 flex-shrink-0">
          {humanStatus(doc.status)}
        </span>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: DocumentStatus }) {
  if (status === 'completed') return <CheckCircle2 size={14} className="text-black" />;
  if (status === 'failed') return <XCircle size={14} className="text-red-700" />;
  if (status === 'skipped_duplicate')
    return <Copy size={14} className="text-black/40" />;
  return <Clock size={14} className="text-black/40 animate-pulse" />;
}

function humanStatus(status: DocumentStatus): string {
  switch (status) {
    case 'queued':
      return 'queued';
    case 'uploaded':
      return 'waiting';
    case 'ocr_in_progress':
      return 'OCR';
    case 'classifying':
      return 'classifying';
    case 'completed':
      return 'done';
    case 'failed':
      return 'failed';
    case 'skipped_duplicate':
      return 'deduped';
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}
