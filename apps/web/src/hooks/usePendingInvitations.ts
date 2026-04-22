import { useEffect, useState } from 'react';
import {
  collectionGroup,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '../lib/firebase';
import type { Invitation } from '@outcome99/shared';

export interface PendingInvitation extends Invitation {
  id: string;
}

/**
 * Subscribes to every pending invitation addressed to the signed-in
 * user's email. Uses a collection-group query across all teams'
 * `invitations` subcollections — the Firestore rule allows read when
 * the caller's email matches the invitation's `email` field.
 */
export function usePendingInvitations(user: User | null) {
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const email = user?.email?.toLowerCase();
    if (!email) {
      setInvitations([]);
      setLoading(false);
      return;
    }

    const q = query(
      collectionGroup(db, 'invitations'),
      where('email', '==', email),
      where('status', '==', 'pending')
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: PendingInvitation[] = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Invitation, 'id'>) }))
          // Filter out expired client-side — server will mark them expired on
          // next accept attempt.
          .filter((inv) => inv.expiresAt > Date.now());
        setInvitations(rows);
        setLoading(false);
      },
      (err) => {
        console.error('[outcome99] usePendingInvitations error', err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [user?.email]);

  return { invitations, loading };
}
