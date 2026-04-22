import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { DealDocument, DocumentStatus } from '@outcome99/shared';

export interface DocumentsSummary {
  total: number;
  uploaded: number;
  processing: number;
  completed: number;
  failed: number;
  duplicates: number;
  byWorkstream: Record<string, number>;
}

const PROCESSING_STATES: DocumentStatus[] = [
  'queued',
  'uploaded',
  'ocr_in_progress',
  'classifying',
];

export function useDocuments(dealId: string | null) {
  const [documents, setDocuments] = useState<DealDocument[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!dealId) {
      setDocuments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, 'deals', dealId, 'documents'),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setDocuments(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DealDocument, 'id'>) }))
        );
        setLoading(false);
      },
      (err) => {
        console.error('[outcome99] useDocuments error', err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [dealId]);

  const summary = useMemo<DocumentsSummary>(() => {
    const byWorkstream: Record<string, number> = {};
    let uploaded = 0;
    let processing = 0;
    let completed = 0;
    let failed = 0;
    let duplicates = 0;
    for (const d of documents) {
      if (d.status === 'skipped_duplicate') {
        duplicates++;
        continue;
      }
      if (PROCESSING_STATES.includes(d.status)) processing++;
      if (d.status === 'uploaded') uploaded++;
      if (d.status === 'completed') {
        completed++;
        if (d.workstream) {
          byWorkstream[d.workstream] = (byWorkstream[d.workstream] ?? 0) + 1;
        }
      }
      if (d.status === 'failed') failed++;
    }
    return {
      total: documents.length - duplicates, // duplicates aren't "real" docs
      uploaded,
      processing,
      completed,
      failed,
      duplicates,
      byWorkstream,
    };
  }, [documents]);

  return { documents, summary, loading };
}
