import { useState } from 'react';
import { motion } from 'motion/react';
import { FirebaseError } from 'firebase/app';
import { Check, X } from 'lucide-react';
import { acceptInvite } from '../lib/functions';
import type { PendingInvitation } from '../hooks/usePendingInvitations';

interface Props {
  invitations: PendingInvitation[];
  onAccepted: (teamId: string) => void;
  onDismissAll: () => void;
}

/**
 * Shown as a prominent banner above the main view when the user has
 * pending invitations addressed to their email. Supports accepting
 * multiple invites in sequence.
 */
export default function InviteAcceptScreen({ invitations, onAccepted, onDismissAll }: Props) {
  const [processing, setProcessing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (invitations.length === 0) return null;

  const handleAccept = async (invitationId: string) => {
    setProcessing(invitationId);
    setError(null);
    try {
      const res = await acceptInvite({ invitationId });
      if (!res.data.ok) throw new Error('Failed to accept invitation.');
      onAccepted(res.data.teamId);
    } catch (err) {
      const e = err as FirebaseError;
      setError(e.message ?? 'Failed to accept invitation.');
    } finally {
      setProcessing(null);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="border-thin bg-black text-white mb-6"
    >
      <div className="p-5 border-bottom-thin border-white/20 flex items-center justify-between">
        <div>
          <div className="text-[9px] uppercase tracking-[0.3em] opacity-60 mb-1">
            Pending invitations
          </div>
          <div className="text-sm font-light tracking-tighter">
            You have {invitations.length} pending team invitation
            {invitations.length === 1 ? '' : 's'}.
          </div>
        </div>
        <button
          onClick={onDismissAll}
          className="text-[9px] uppercase tracking-widest opacity-50 hover:opacity-100"
        >
          Dismiss
        </button>
      </div>
      {error && (
        <div className="bg-red-700 text-white p-3 text-[11px]">{error}</div>
      )}
      <div className="divide-y divide-white/10">
        {invitations.map((inv) => {
          const isBusy = processing === inv.id;
          return (
            <div
              key={inv.id}
              className={`flex items-center justify-between p-4 gap-4 ${isBusy ? 'opacity-50' : ''}`}
            >
              <div className="min-w-0 flex-grow">
                <div className="text-xs font-semibold">
                  Invited as{' '}
                  <span className="uppercase tracking-widest">
                    {inv.role.replace('_', ' ')}
                  </span>
                </div>
                <div className="text-[9px] uppercase tracking-widest opacity-60 mt-0.5">
                  From {inv.invitedByEmail} · Expires in{' '}
                  {Math.max(
                    0,
                    Math.ceil((inv.expiresAt - Date.now()) / (24 * 60 * 60 * 1000))
                  )}
                  d
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleAccept(inv.id)}
                  disabled={isBusy}
                  className="px-4 py-2 bg-white text-black text-[10px] uppercase tracking-widest font-bold hover:bg-black hover:text-white hover:border hover:border-white flex items-center gap-1.5"
                >
                  <Check size={10} />
                  {isBusy ? 'Accepting…' : 'Accept'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
