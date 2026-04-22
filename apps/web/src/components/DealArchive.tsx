import { useState } from 'react';
import { Check, Edit2, X } from 'lucide-react';
import type { Deal } from '@outcome99/shared';
import { cn, formatDate, formatRelativeTime } from '../lib/utils';

interface Props {
  deals: Deal[];
  loading: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => Promise<void>;
  compact?: boolean;
  activeId?: string;
}

export default function DealArchive({
  deals,
  loading,
  onSelect,
  onRename,
  compact,
  activeId,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 bg-black/[0.03] border border-black/5 animate-pulse" />
        ))}
      </div>
    );
  }

  if (deals.length === 0) {
    if (compact) {
      return (
        <div className="text-[9px] uppercase tracking-widest text-black/30 p-2">
          No deals yet.
        </div>
      );
    }
    return (
      <div className="border border-dashed border-black/10 p-24 text-center">
        <p className="text-[10px] uppercase tracking-[0.3em] text-black/30">
          No deal workspaces yet.
        </p>
      </div>
    );
  }

  const startEdit = (e: React.MouseEvent, deal: Deal) => {
    e.stopPropagation();
    setEditingId(deal.id!);
    setEditValue(deal.meta.name);
  };

  const saveEdit = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!editValue.trim()) return;
    await onRename(id, editValue.trim());
    setEditingId(null);
  };

  const cancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
  };

  if (compact) {
    return (
      <div className="space-y-3">
        {deals.map((deal) => {
          const isActive = activeId === deal.id;
          const isEditing = editingId === deal.id;
          return (
            <div
              key={deal.id}
              onClick={() => !isEditing && onSelect(deal.id!)}
              className={cn(
                'text-xs flex flex-col cursor-pointer group transition-opacity',
                isActive ? 'opacity-100' : 'opacity-70 hover:opacity-100'
              )}
            >
              {isEditing ? (
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    autoFocus
                    className="bg-black/5 text-[10px] px-1 py-0.5 border-none outline-none w-full"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                  />
                  <button onClick={(e) => saveEdit(e, deal.id!)} className="p-0.5">
                    <Check size={10} />
                  </button>
                  <button onClick={cancelEdit} className="p-0.5">
                    <X size={10} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        'font-semibold tracking-tight uppercase text-[10px] truncate group-hover:underline',
                        isActive && 'underline'
                      )}
                    >
                      {deal.meta.name}
                    </span>
                    <button
                      onClick={(e) => startEdit(e, deal)}
                      className="opacity-0 group-hover:opacity-40 hover:opacity-100 ml-1"
                    >
                      <Edit2 size={9} />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 text-[9px] opacity-50 uppercase tracking-widest mt-0.5">
                    <span>{deal.meta.targetCompany}</span>
                    <span>·</span>
                    <span>{formatDate(deal.createdAt as never)}</span>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Full grid view
  return (
    <div className="space-y-px bg-black border border-black text-sm">
      {deals.map((deal) => {
        const phaseCount = Object.values(deal.phaseStatus).filter(
          (s) => s === 'completed'
        ).length;
        return (
          <button
            key={deal.id}
            onClick={() => onSelect(deal.id!)}
            className="w-full flex items-center justify-between p-6 bg-white hover:bg-black group transition-all duration-300 text-left"
          >
            <div className="flex items-center gap-8 flex-grow mr-4">
              <div className="w-12 h-12 flex items-center justify-center border border-black/5 group-hover:border-white/30 font-mono text-[10px] group-hover:text-white/40 text-black/30">
                {phaseCount}/7
              </div>
              <div className="space-y-1 flex-grow">
                <h4 className="font-light group-hover:text-white">{deal.meta.name}</h4>
                <div className="flex items-center gap-4 text-[10px] uppercase tracking-widest text-black/40 group-hover:text-white/40">
                  <span>{deal.meta.targetCompany}</span>
                  <span>•</span>
                  <span>{deal.meta.sector}</span>
                  <span>•</span>
                  <span>{formatRelativeTime(deal.createdAt as never)}</span>
                </div>
              </div>
            </div>
            <div className="text-[8px] uppercase tracking-widest px-2 py-0.5 border border-black/20 group-hover:border-white/20 text-black/40 group-hover:text-white/40">
              {deal.meta.structure.replace('_', ' ')}
            </div>
          </button>
        );
      })}
    </div>
  );
}
