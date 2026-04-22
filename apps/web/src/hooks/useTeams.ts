import { useEffect, useState } from 'react';
import {
  collectionGroup,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '../lib/firebase';
import type { Team, TeamMember } from '@outcome99/shared';

export interface TeamWithMembership {
  team: Team & { id: string };
  membership: TeamMember;
}

/**
 * Subscribes to every team the user is an active member of.
 *
 * Implementation: listens to a collection-group query on `members` filtered
 * by uid + status=active. For each hit, the parent doc reference yields the
 * teamId. We then fetch the team docs on-demand (non-realtime — team names
 * change rarely). The returned list re-fires when membership changes.
 */
export function useTeams(user: User | null) {
  const [teams, setTeams] = useState<TeamWithMembership[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setTeams([]);
      setLoading(false);
      return;
    }

    const membershipsQuery = query(
      collectionGroup(db, 'members'),
      where('uid', '==', user.uid),
      where('status', '==', 'active')
    );

    let active = true;

    const unsub = onSnapshot(
      membershipsQuery,
      async (snap) => {
        const results: TeamWithMembership[] = [];
        await Promise.all(
          snap.docs.map(async (memberDoc) => {
            const teamRef = memberDoc.ref.parent.parent;
            if (!teamRef) return;
            const teamSnap = await getDoc(teamRef);
            if (!teamSnap.exists()) return;
            results.push({
              team: { id: teamSnap.id, ...(teamSnap.data() as Omit<Team, 'id'>) },
              membership: memberDoc.data() as TeamMember,
            });
          })
        );
        if (!active) return;
        // Sort — owner-teams first, then by name.
        results.sort((a, b) => {
          const aOwner = a.team.ownerId === user.uid ? 0 : 1;
          const bOwner = b.team.ownerId === user.uid ? 0 : 1;
          if (aOwner !== bOwner) return aOwner - bOwner;
          return a.team.name.localeCompare(b.team.name);
        });
        setTeams(results);
        setLoading(false);
      },
      (err) => {
        console.error('[outcome99] useTeams error', err);
        if (active) setLoading(false);
      }
    );

    return () => {
      active = false;
      unsub();
    };
  }, [user?.uid]);

  return { teams, loading };
}
