import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Folder, FileText, ChevronRight, X, ArrowLeft, CheckCircle2 } from 'lucide-react';
import type { User } from 'firebase/auth';
import type { IntegrationProvider, ProviderItem } from '@outcome99/shared';
import { listProviderFolder, initiateImport } from '../lib/functions';
import { cn } from '../lib/utils';

interface Props {
  user: User;
  dealId: string;
  provider: IntegrationProvider;
  onClose: () => void;
}

const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  gdrive: 'Google Drive',
  sharepoint: 'SharePoint / OneDrive',
  dropbox: 'Dropbox',
  intralinks: 'Intralinks',
  datasite: 'Datasite',
  firmex: 'Firmex',
};

/**
 * Folder browser modal for connected providers.
 *
 * Users navigate the provider's folder tree (lazy-loaded per folder) and
 * click "Import this folder" on whichever directory holds their data room.
 * The orchestrator walks everything under the selected folder.
 */
export default function ProviderBrowser({ user: _user, dealId, provider, onClose }: Props) {
  const [items, setItems] = useState<ProviderItem[]>([]);
  const [breadcrumb, setBreadcrumb] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [currentId, setCurrentId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listProviderFolder({ provider, folderId: currentId })
      .then((res) => {
        if (cancelled) return;
        if (!res.data.ok) throw new Error('List failed.');
        setItems(res.data.items);
        setBreadcrumb(res.data.breadcrumb);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message ?? 'Failed to list folder.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [provider, currentId]);

  const currentFolder = breadcrumb[breadcrumb.length - 1];

  const handleImport = async () => {
    if (!currentFolder) return;
    setImporting(true);
    try {
      const res = await initiateImport({
        dealId,
        provider,
        rootItemId: currentFolder.id,
        rootItemName: currentFolder.name,
      });
      if (!res.data.ok) throw new Error('Import failed.');
      setImportDone(true);
      setTimeout(() => onClose(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white border-thin w-full max-w-2xl max-h-[80vh] flex flex-col"
      >
        {/* Header */}
        <div className="p-5 border-bottom-thin flex items-center justify-between">
          <div>
            <div className="text-[9px] uppercase tracking-[0.3em] text-black/40 mb-1">
              Import from {PROVIDER_LABELS[provider]}
            </div>
            <div className="text-xs text-black/60">
              Navigate to the folder you want to import. Its entire contents will be ingested.
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-black hover:text-white transition-colors"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Breadcrumb */}
        <div className="px-5 py-3 border-bottom-thin bg-black/[0.02] flex items-center gap-1 text-[11px] overflow-x-auto minimal-scrollbar">
          {breadcrumb.length > 1 && (
            <button
              onClick={() => {
                const parent = breadcrumb[breadcrumb.length - 2];
                setCurrentId(parent.id === 'root' ? undefined : parent.id);
              }}
              className="flex items-center gap-1 hover:underline mr-2 flex-shrink-0"
            >
              <ArrowLeft size={10} />
              Back
            </button>
          )}
          {breadcrumb.map((b, idx) => (
            <span key={b.id} className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => setCurrentId(b.id === 'root' ? undefined : b.id)}
                className={cn(
                  'hover:underline',
                  idx === breadcrumb.length - 1 && 'font-semibold'
                )}
              >
                {b.name}
              </button>
              {idx < breadcrumb.length - 1 && <ChevronRight size={10} className="opacity-30" />}
            </span>
          ))}
        </div>

        {/* Items */}
        <div className="flex-grow overflow-y-auto minimal-scrollbar">
          {error && (
            <div className="p-4 text-[11px] text-red-700 border-bottom-thin">{error}</div>
          )}
          {loading ? (
            <div className="p-8 text-center text-[10px] uppercase tracking-widest text-black/30">
              Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-[10px] uppercase tracking-widest text-black/30">
              This folder is empty.
            </div>
          ) : (
            <div className="divide-y divide-black/5">
              {items.map((it) => (
                <button
                  key={it.id}
                  onClick={() => {
                    if (it.kind === 'folder') setCurrentId(it.id);
                  }}
                  disabled={it.kind !== 'folder'}
                  className={cn(
                    'w-full px-5 py-3 flex items-center gap-3 text-left',
                    it.kind === 'folder'
                      ? 'hover:bg-black/[0.03] cursor-pointer'
                      : 'cursor-default opacity-60'
                  )}
                >
                  {it.kind === 'folder' ? (
                    <Folder size={14} className="flex-shrink-0" />
                  ) : (
                    <FileText size={14} className="flex-shrink-0 text-black/40" />
                  )}
                  <span className="text-[12px] truncate flex-grow">{it.name}</span>
                  {it.kind === 'folder' && (
                    <ChevronRight size={12} className="opacity-40 flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-top-thin flex items-center justify-between gap-3">
          <div className="text-[10px] uppercase tracking-widest text-black/50">
            {currentFolder
              ? `Will import: ${currentFolder.name}`
              : 'Select a folder to import.'}
          </div>
          {importDone ? (
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold">
              <CheckCircle2 size={12} />
              Import started
            </div>
          ) : (
            <button
              onClick={handleImport}
              disabled={!currentFolder || importing || loading}
              className="minimal-button bg-black text-white hover:bg-white hover:text-black disabled:opacity-30"
            >
              {importing ? 'Starting…' : 'Import this folder'}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
