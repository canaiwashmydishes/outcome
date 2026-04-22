import { useEffect, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Deal } from '@outcome99/shared';

/**
 * Subscribes to the list of deals for a specific team.
 * Archived deals are filtered out by default.
 */
export function useDeals(teamId: string | null) {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!teamId) {
      setDeals([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, 'deals'),
      where('teamId', '==', teamId),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setDeals(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<Deal, 'id'>) }))
            .filter((d) => !d.archivedAt)
        );
        setLoading(false);
      },
      (err) => {
        console.error('[outcome99] useDeals error', err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [teamId]);

  const rename = async (dealId: string, name: string) => {
    const currentDeal = deals.find((d) => d.id === dealId);
    if (!currentDeal) return;
    await updateDoc(doc(db, 'deals', dealId), {
      meta: { ...currentDeal.meta, name },
      updatedAt: serverTimestamp(),
    });
  };

  return { deals, loading, rename };
}

/** Subscribes to a single deal by id. */
export function useDeal(dealId: string | null) {
  const [deal, setDeal] = useState<Deal | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!dealId) {
      setDeal(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      doc(db, 'deals', dealId),
      (snap) => {
        setDeal(
          snap.exists()
            ? { id: snap.id, ...(snap.data() as Omit<Deal, 'id'>) }
            : null
        );
        setLoading(false);
      },
      (err) => {
        console.error('[outcome99] useDeal error', err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [dealId]);

  return { deal, loading };
}
