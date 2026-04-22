import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '../lib/firebase';
import type { UserProfile } from '@outcome99/shared';

export function useUserProfile(user: User | null) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        setProfile(snap.exists() ? (snap.data() as UserProfile) : null);
        setLoading(false);
      },
      (err) => {
        console.error('[outcome99] useUserProfile error', err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [user]);

  const totalCredits = (profile?.monthlyCredits ?? 0) + (profile?.purchasedCredits ?? 0);

  return { profile, loading, totalCredits };
}
