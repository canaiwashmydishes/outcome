import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Subscription } from '@outcome99/shared';

export function useSubscription(teamId: string | null) {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!teamId) {
      setSubscription(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, 'subscriptions'),
      where('teamId', '==', teamId),
      where('status', 'in', ['active', 'trialing']),
      limit(1)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          setSubscription(null);
        } else {
          const d = snap.docs[0];
          setSubscription({ id: d.id, ...(d.data() as Omit<Subscription, 'id'>) });
        }
        setLoading(false);
      },
      (err) => {
        console.error('[outcome99] useSubscription error', err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [teamId]);

  return { subscription, loading };
}
