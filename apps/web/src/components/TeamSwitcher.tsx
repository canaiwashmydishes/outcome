import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Plus, Check } from 'lucide-react';
import { FirebaseError } from 'firebase/app';
import { createTeam } from '../lib/functions';
import type { User } from 'firebase/auth';
import type { TeamWithMembership } from '../hooks/useTeams';
import { cn } from '../lib/utils';

interface Props {
  user: User;
  teams: TeamWithMembership[];
  activeTeamId: string | null;
  onSelect: (teamId: string) => void;
}

export default function TeamSwitcher({ user, teams, activeTeamId, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const active = teams.find((t) => t.team.id === activeTeamId);
  const handleCreate = async () => {
    if (!newName.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await createTeam({
        name: newName.trim(),
        billingEmail: user.email ?? '',
      });
      if (!res.data.ok) throw new Error('Team creation failed.');
      onSelect(res.data.teamId);
      setNewName('');
      setCreating(false);
      setOpen(false);
    } catch (err) {
      const e = err as FirebaseError;
      setError(e.message ?? 'Failed to create team.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full border-thin p-3 text-left hover:bg-black hover:text-white transition-colors duration-300 group"
      >
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-grow">
            <div className="text-[9px] uppercase tracking-widest opacity-40 group-hover:opacity-70 mb-0.5">
              Team
            </div>
            <div className="text-[11px] font-bold truncate">
              {active?.team.name ?? 'Select a team'}
            </div>
          </div>
          <ChevronDown
            size={12}
            className={cn(
              'transition-transform opacity-40 group-hover:opacity-70 flex-shrink-0',
              open && 'rotate-180'
            )}
          />
        </div>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-1 border-thin bg-white shadow-sm z-50 max-h-[400px] overflow-y-auto minimal-scrollbar">
          {teams.map((t) => {
            const isActive = t.team.id === activeTeamId;
            return (
              <button
                key={t.team.id}
                onClick={() => {
                  onSelect(t.team.id);
                  setOpen(false);
                }}
                className={cn(
                  'w-full px-3 py-2 text-left border-bottom-thin last:border-b-0 hover:bg-black/5 flex items-center gap-2',
                  isActive && 'bg-black/[0.03]'
                )}
              >
                <div className="w-3 h-3 flex items-center justify-center flex-shrink-0">
                  {isActive && <Check size={10} />}
                </div>
                <div className="min-w-0 flex-grow">
                  <div className="text-[11px] font-semibold truncate">{t.team.name}</div>
                  <div className="text-[9px] uppercase tracking-widest opacity-40">
                    {t.membership.role.replace('_', ' ')}
                  </div>
                </div>
              </button>
            );
          })}

          {!creating ? (
            <button
              onClick={() => setCreating(true)}
              className="w-full px-3 py-2 text-left border-top-thin border-black/10 hover:bg-black hover:text-white flex items-center gap-2 transition-colors"
            >
              <Plus size={12} className="opacity-60" />
              <span className="text-[10px] uppercase tracking-widest font-bold">
                New team
              </span>
            </button>
          ) : (
            <div className="border-top-thin border-black/10 p-3 space-y-2">
              <input
                autoFocus
                type="text"
                placeholder="Team name"
                className="minimal-input text-[11px]"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                  if (e.key === 'Escape') {
                    setCreating(false);
                    setNewName('');
                  }
                }}
              />
              {error && (
                <div className="text-[10px] text-red-700 leading-tight">{error}</div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleCreate}
                  disabled={!newName.trim() || submitting}
                  className="flex-1 py-1.5 bg-black text-white text-[9px] uppercase tracking-widest font-bold disabled:opacity-20"
                >
                  {submitting ? 'Creating…' : 'Create'}
                </button>
                <button
                  onClick={() => {
                    setCreating(false);
                    setNewName('');
                    setError(null);
                  }}
                  className="px-3 py-1.5 border border-black/20 text-[9px] uppercase tracking-widest hover:bg-black/5"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
