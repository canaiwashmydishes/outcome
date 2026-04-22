import { useCallback, useRef, useState } from 'react';
import { Upload, Folder, FileText, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { uploadFiles, type UploadFileState } from '../lib/uploadClient';
import { cn } from '../lib/utils';

interface Props {
  dealId: string;
}

/**
 * Drag-and-drop upload surface.
 *
 * Supports:
 *   - Single or multiple file selection via a file input (fallback).
 *   - Folder drops with webkitdirectory recognition; folder paths are
 *     preserved in the Firestore doc row (not just filenames).
 *   - Per-file progress bars that update in real time during upload.
 *
 * Rejected for v1 (by design):
 *   - Pause/resume (the resumable upload would add 2-3 days of code).
 *     Clients that navigate away mid-upload lose their in-flight file.
 *   - Client-side upload count/size limits beyond what the server enforces.
 */
export default function DocumentUploadDropzone({ dealId }: Props) {
  const [uploads, setUploads] = useState<UploadFileState[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const onUpdate = useCallback((s: UploadFileState) => {
    setUploads((prev) => {
      const idx = prev.findIndex((p) => p.localId === s.localId);
      if (idx === -1) return [...prev, s];
      const copy = [...prev];
      copy[idx] = s;
      return copy;
    });
  }, []);

  const handleFiles = async (fileList: FileList) => {
    if (fileList.length === 0) return;

    const entries: Array<{ file: File; folderPath: string }> = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      // webkitRelativePath is set for folder drops and folder inputs
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
      const parts = rel.split('/');
      // If we have a relative path with folders, strip the filename to get folderPath
      const folderPath = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
      entries.push({ file, folderPath });
    }

    setUploading(true);
    try {
      await uploadFiles({ dealId, files: entries, onUpdate });
    } finally {
      setUploading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (!e.dataTransfer) return;

    // If items API is available, walk entries to preserve folder structure.
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      const entries = [];
      for (let i = 0; i < e.dataTransfer.items.length; i++) {
        const item = e.dataTransfer.items[i];
        const entry = item.webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
      if (entries.length > 0) {
        const collected = await collectFiles(entries);
        setUploading(true);
        try {
          await uploadFiles({ dealId, files: collected, onUpdate });
        } finally {
          setUploading(false);
        }
        return;
      }
    }

    // Fallback: flat file list, no folder info.
    if (e.dataTransfer.files) await handleFiles(e.dataTransfer.files);
  };

  const clear = () => setUploads([]);

  const anyActive = uploading || uploads.some((u) => isActiveState(u.state));

  return (
    <div className="space-y-4">
      {/* Dropzone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'border-2 border-dashed p-10 text-center transition-colors',
          isDragging
            ? 'border-black bg-black/[0.03]'
            : 'border-black/20 hover:border-black/40'
        )}
      >
        <div className="flex justify-center mb-4">
          <Upload size={32} className="text-black/30" />
        </div>
        <div className="text-sm font-light tracking-tight mb-2">
          Drop files or an entire folder here
        </div>
        <div className="text-[10px] uppercase tracking-widest text-black/40 mb-6">
          PDF, Word, Excel, PowerPoint, images · up to 200 MB per file
        </div>
        <div className="flex justify-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="minimal-button bg-black text-white hover:bg-white hover:text-black disabled:opacity-30"
          >
            <FileText size={12} className="inline mr-2" />
            Select files
          </button>
          <button
            onClick={() => folderInputRef.current?.click()}
            disabled={uploading}
            className="minimal-button border border-black hover:bg-black hover:text-white disabled:opacity-30"
          >
            <Folder size={12} className="inline mr-2" />
            Select folder
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        {/* webkitdirectory attribute isn't in the React DOM types yet. */}
        <input
          ref={folderInputRef}
          type="file"
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-expect-error — webkitdirectory is browser-specific
          webkitdirectory=""
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {/* In-flight uploads list */}
      {uploads.length > 0 && (
        <div className="border-thin">
          <div className="flex items-center justify-between p-3 border-bottom-thin bg-black/[0.02]">
            <div className="text-[10px] uppercase tracking-widest font-bold">
              Upload queue · {uploads.length}
            </div>
            {!anyActive && (
              <button
                onClick={clear}
                className="text-[9px] uppercase tracking-widest text-black/50 hover:text-black hover:underline"
              >
                Clear
              </button>
            )}
          </div>
          <div className="divide-y divide-black/5 max-h-[320px] overflow-y-auto minimal-scrollbar">
            {uploads.map((u) => (
              <UploadRow key={u.localId} upload={u} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UploadRow({ upload }: { upload: UploadFileState }) {
  const { file, folderPath, state, progressPct, error } = upload;

  return (
    <div className="flex items-center gap-3 p-3">
      <StateIcon state={state} />
      <div className="flex-grow min-w-0">
        <div className="text-[11px] font-semibold truncate">{file.name}</div>
        <div className="text-[9px] uppercase tracking-widest text-black/40 truncate">
          {folderPath ? `${folderPath} · ` : ''}
          {formatBytes(file.size)} · <StateLabel state={state} progressPct={progressPct} error={error} />
        </div>
        {state === 'uploading' && (
          <div className="credit-bar mt-1">
            <div className="credit-bar-fill" style={{ width: `${progressPct}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}

function StateIcon({ state }: { state: UploadFileState['state'] }) {
  if (state === 'done') return <CheckCircle2 size={14} className="text-black" />;
  if (state === 'duplicate') return <CheckCircle2 size={14} className="text-black/40" />;
  if (state === 'error') return <XCircle size={14} className="text-red-700" />;
  return <Clock size={14} className="text-black/40 animate-pulse" />;
}

function StateLabel({
  state,
  progressPct,
  error,
}: {
  state: UploadFileState['state'];
  progressPct: number;
  error?: string;
}) {
  switch (state) {
    case 'pending':
      return <span>queued</span>;
    case 'hashing':
      return <span>computing hash…</span>;
    case 'initiating':
      return <span>checking…</span>;
    case 'uploading':
      return <span>uploading {progressPct}%</span>;
    case 'finalizing':
      return <span>starting processing…</span>;
    case 'done':
      return <span className="text-black">uploaded</span>;
    case 'duplicate':
      return <span className="text-black/50">deduplicated</span>;
    case 'error':
      return <span className="text-red-700">{error ?? 'failed'}</span>;
  }
}

function isActiveState(s: UploadFileState['state']): boolean {
  return s !== 'done' && s !== 'duplicate' && s !== 'error';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

/**
 * Walk a dropped FileSystemEntry tree to produce a flat list of files
 * with their folder paths. The File System Access API is awkward; this
 * uses the older webkitGetAsEntry path which is widely supported.
 */
async function collectFiles(
  entries: Array<FileSystemEntry>,
  basePath = ''
): Promise<Array<{ file: File; folderPath: string }>> {
  const out: Array<{ file: File; folderPath: string }> = [];
  for (const entry of entries) {
    if (entry.isFile) {
      const f = await new Promise<File>((resolve, reject) => {
        (entry as FileSystemFileEntry).file(resolve, reject);
      });
      out.push({ file: f, folderPath: basePath });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const children: FileSystemEntry[] = await new Promise((resolve, reject) => {
        const collected: FileSystemEntry[] = [];
        const read = () => {
          reader.readEntries((batch) => {
            if (batch.length === 0) resolve(collected);
            else {
              collected.push(...batch);
              read();
            }
          }, reject);
        };
        read();
      });
      const nested = await collectFiles(
        children,
        basePath ? `${basePath}/${entry.name}` : entry.name
      );
      out.push(...nested);
    }
  }
  return out;
}
