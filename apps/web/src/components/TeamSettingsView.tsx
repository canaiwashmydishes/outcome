import { useState } from 'react';
import { motion } from 'motion/react';
import { FirebaseError } from 'firebase/app';
import { Copy, X, Users, Mail, ShieldCheck } from 'lucide-react';
import type { User } from 'firebase/auth';
import {
  inviteMember,
  revokeInvite,
  changeMemberRole,
  removeMember,
} from '../lib/functions';
import { useTeamMembers } from '../hooks/useTeamMembers';
import type { TeamMemberRole } from '@outcome99/shared';
import type { TeamWithMembership } from '../hooks/useTeams';
import { cn, formatRelativeTime } from '../lib/utils';

interface Props {
  user: User;
  activeTeam: TeamWithMembership;
}

const ROLES: Array<{ value: TeamMemberRole; label: string }> = [
  { value: 'partner', label: 'Partner' },
  { value: 'associate', label: 'Associate' },
  { value: 'external_counsel', label: 'External Counsel' },
  { value: 'consultant', label: 'Consultant' },
  { value: 'observer', label: 'Observer' },
];

export default function TeamSettingsView({ user, activeTeam }: Props) {
  const teamId = activeTeam.team.id;
  const callerIsPartner = activeTeam.membership.role === 'partner';
  const { members, invitations, loading } = useTeamMembers(teamId);

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<TeamMemberRole>('associate');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  // Per-row mutating state
  const [busyMember, setBusyMember] = useState<string | null>(null);
  const [busyInvite, setBusyInvite] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const handleInvite = async () => {
    if (!inviteEmail.trim() || inviting) return;
    setInviting(true);
    setInviteError(null);
    setLastInviteLink(null);
    try {
      const res = await inviteMember({
        teamId,
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
      });
      if (!res.data.ok) throw new Error('Invitation failed.');
      setLastInviteLink(`${window.location.origin}${res.data.inviteLink}`);
      setInviteEmail('');
    } catch (err) {
      const e = err as FirebaseError;
      setInviteError(e.message ?? 'Invitation failed.');
    } finally {
      setInviting(false);
    }
  };

  const handleRoleChange = async (memberUid: string, role: TeamMemberRole) => {
    setBusyMember(memberUid);
    setRowError(null);
    try {
      await changeMemberRole({ teamId, memberUid, role });
    } catch (err) {
      const e = err as FirebaseError;
      setRowError(e.message ?? 'Failed to change role.');
    } finally {
      setBusyMember(null);
    }
  };

  const handleRemove = async (memberUid: string) => {
    if (!confirm('Remove this member from the team?')) return;
    setBusyMember(memberUid);
    setRowError(null);
    try {
      await removeMember({ teamId, memberUid });
    } catch (err) {
      const e = err as FirebaseError;
      setRowError(e.message ?? 'Failed to remove member.');
    } finally {
      setBusyMember(null);
    }
  };

  const handleRevoke = async (invitationId: string) => {
    setBusyInvite(invitationId);
    try {
      await revokeInvite({ teamId, invitationId });
    } catch (err) {
      console.error(err);
    } finally {
      setBusyInvite(null);
    }
  };

  const copyLink = (link: string) => {
    navigator.clipboard.writeText(link);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="max-w-4xl mx-auto space-y-10"
    >
      {/* Header */}
      <div>
        <div className="text-[10px] uppercase tracking-[0.3em] text-black/40 mb-1">
          Team settings
        </div>
        <h2 className="text-3xl font-light tracking-tighter">{activeTeam.team.name}</h2>
        <div className="mt-2 text-[10px] uppercase tracking-widest text-black/50">
          Billing: {activeTeam.team.billingEmail} ·{' '}
          {members.filter((m) => m.status === 'active').length} active member
          {members.filter((m) => m.status === 'active').length === 1 ? '' : 's'}
        </div>
      </div>

      {/* Invite form (partners only) */}
      {callerIsPartner && (
        <section className="border-thin p-6 space-y-4">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-black/60 font-bold">
            <Mail size={12} />
            Invite a member
          </div>
          <div className="flex gap-2">
            <input
              type="email"
              placeholder="colleague@firm.com"
              className="minimal-input flex-grow"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleInvite();
              }}
            />
            <select
              className="minimal-input w-48"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as TeamMemberRole)}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <button
              onClick={handleInvite}
              disabled={!inviteEmail.trim() || inviting}
              className="minimal-button bg-black text-white hover:bg-white hover:text-black disabled:opacity-20 px-6"
            >
              {inviting ? 'Inviting…' : 'Invite'}
            </button>
          </div>
          {inviteError && (
            <div className="border border-red-700 bg-red-50 p-2 text-[11px] text-red-700">
              {inviteError}
            </div>
          )}
          {lastInviteLink && (
            <div className="border-thin bg-black/[0.02] p-3 space-y-2">
              <div className="text-[9px] uppercase tracking-widest text-black/60 font-bold">
                Share this invite link
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-grow text-[10px] font-mono bg-white border-thin px-2 py-1.5 truncate">
                  {lastInviteLink}
                </code>
                <button
                  onClick={() => copyLink(lastInviteLink)}
                  className="px-3 py-1.5 border border-black hover:bg-black hover:text-white text-[10px] uppercase tracking-widest font-bold flex items-center gap-1.5"
                >
                  <Copy size={10} />
                  {linkCopied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="text-[9px] uppercase tracking-widest text-black/40">
                Email delivery arrives in Build H. Share manually for now.
              </div>
            </div>
          )}
        </section>
      )}

      {/* Row-level error bar */}
      {rowError && (
        <div className="border border-red-700 bg-red-50 p-3 text-[11px] text-red-700 flex items-center justify-between">
          <span>{rowError}</span>
          <button onClick={() => setRowError(null)} className="text-black/50">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Members list */}
      <section>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-black/60 font-bold mb-3">
          <Users size={12} />
          Active members ({members.filter((m) => m.status === 'active').length})
        </div>
        {loading ? (
          <div className="h-12 bg-black/[0.03] animate-pulse" />
        ) : (
          <div className="border-thin divide-y divide-black/5">
            {members
              .filter((m) => m.status === 'active')
              .map((m) => {
                const isSelf = m.uid === user.uid;
                const isBusy = busyMember === m.uid;
                return (
                  <div
                    key={m.uid}
                    className={cn(
                      'flex items-center justify-between p-4 gap-4',
                      isBusy && 'opacity-50'
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-grow">
                      <div className="w-8 h-8 bg-black text-white flex items-center justify-center text-[10px] font-mono uppercase flex-shrink-0">
                        {m.uid.slice(0, 2)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold truncate">
                          {m.uid}
                          {isSelf && (
                            <span className="ml-2 text-[9px] uppercase tracking-widest opacity-50 font-normal">
                              (you)
                            </span>
                          )}
                        </div>
                        <div className="text-[9px] uppercase tracking-widest text-black/50 mt-0.5">
                          Joined {m.joinedAt ? formatRelativeTime(m.joinedAt as never) : '—'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {callerIsPartner ? (
                        <select
                          className="minimal-input text-[10px] w-44"
                          value={m.role}
                          onChange={(e) => handleRoleChange(m.uid, e.target.value as TeamMemberRole)}
                          disabled={isBusy}
                        >
                          {ROLES.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-[10px] uppercase tracking-widest px-3 py-1 border border-black/20">
                          {m.role.replace('_', ' ')}
                        </span>
                      )}
                      {callerIsPartner && !isSelf && (
                        <button
                          onClick={() => handleRemove(m.uid)}
                          disabled={isBusy}
                          className="p-2 border border-black/10 hover:border-red-700 hover:text-red-700 transition-colors"
                          title="Remove member"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </section>

      {/* Pending invitations */}
      {invitations.length > 0 && (
        <section>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-black/60 font-bold mb-3">
            <ShieldCheck size={12} />
            Pending invitations ({invitations.length})
          </div>
          <div className="border-thin divide-y divide-black/5">
            {invitations.map((inv) => {
              const isBusy = busyInvite === inv.id;
              return (
                <div
                  key={inv.id}
                  className={cn(
                    'flex items-center justify-between p-4 gap-4',
                    isBusy && 'opacity-50'
                  )}
                >
                  <div className="min-w-0 flex-grow">
                    <div className="text-xs font-semibold truncate">{inv.email}</div>
                    <div className="text-[9px] uppercase tracking-widest text-black/50 mt-0.5">
                      Invited {formatRelativeTime(inv.invitedAt as never)} ·{' '}
                      {inv.role.replace('_', ' ')} · Expires{' '}
                      {Math.max(0, Math.ceil((inv.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)))}d
                    </div>
                  </div>
                  {callerIsPartner && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() =>
                          copyLink(`${window.location.origin}/invite/${inv.id}?team=${teamId}`)
                        }
                        className="px-3 py-1.5 border border-black/20 hover:bg-black/5 text-[10px] uppercase tracking-widest flex items-center gap-1.5"
                      >
                        <Copy size={10} />
                        Link
                      </button>
                      <button
                        onClick={() => handleRevoke(inv.id)}
                        disabled={isBusy}
                        className="p-2 border border-black/10 hover:border-red-700 hover:text-red-700 transition-colors"
                        title="Revoke invitation"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </motion.div>
  );
}
