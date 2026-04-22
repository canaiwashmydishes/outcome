import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Invitation, TeamMember } from '@outcome99/shared';

export interface TeamMemberWithUid extends TeamMember {}

export interface PendingInvite extends Invitation {
  id: string;
}

/**
 * Subscribes to both the active members and pending invitations for a team.
 * Returns them as separate arrays so the TeamSettingsView can render each
 * with appropriate affordances (members get role dropdown + remove; invites
 * get revoke + resend).
 */
export function useTeamMembers(teamId: string | null) {
  const [members, setMembers] = useState<TeamMemberWithUid[]>([]);
  const [invitations, setInvitations] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!teamId) {
      setMembers([]);
      setInvitations([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const membersUnsub = onSnapshot(
      collection(db, 'teams', teamId, 'members'),
      (snap) => {
        setMembers(snap.docs.map((d) => d.data() as TeamMemberWithUid));
      },
      (err) => console.error('[outcome99] members subscription error', err)
    );

    const invitesUnsub = onSnapshot(
      query(
        collection(db, 'teams', teamId, 'invitations'),
        where('status', '==', 'pending'),
        orderBy('invitedAt', 'desc')
      ),
      (snap) => {
        setInvitations(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Invitation, 'id'>) }))
        );
        setLoading(false);
      },
      (err) => {
        console.error('[outcome99] invitations subscription error', err);
        setLoading(false);
      }
    );

    return () => {
      membersUnsub();
      invitesUnsub();
    };
  }, [teamId]);

  return { members, invitations, loading };
}
