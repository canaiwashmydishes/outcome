import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '../lib/firebase';
import type { Integration, IntegrationProvider } from '@outcome99/shared';

/**
 * Subscribes to the user's integrations collection and returns a lookup
 * map keyed by provider. UI components render their state regardless of
 * whether a row exists — providers without a row are treated as 'disconnected'.
 */
export function useIntegrations(user: User | null) {
  const [integrations, setIntegrations] = useState<Partial<Record<IntegrationProvider, Integration>>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setIntegrations({});
      setLoading(false);
      return;
    }

    const unsub = onSnapshot(
      collection(db, 'users', user.uid, 'integrations'),
      (snap) => {
        const next: Partial<Record<IntegrationProvider, Integration>> = {};
        for (const d of snap.docs) {
          const row = d.data() as Integration;
          next[d.id as IntegrationProvider] = row;
        }
        setIntegrations(next);
        setLoading(false);
      },
      (err) => {
        console.error('[outcome99] useIntegrations error', err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [user?.uid]);

  return { integrations, loading };
}
