import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { db } from '../lib/admin.js';
import type { Deal, AuditEvent, DocumentStatus } from '@outcome99/shared';

/**
 * Scheduled ingestion sweep.
 *
 * Runs every 5 minutes. For every deal with phaseStatus.ingestion ==
 * 'in_progress', checks whether any documents remain in processing
 * states (queued, uploaded, ocr_in_progress, classifying). If none
 * do AND at least one document has reached a terminal state, the deal
 * transitions to 'completed' and an ingestion_completed audit event
 * is written.
 *
 * Why a sweep rather than a trigger on document writes:
 *   - A trigger on each of 1,000 document writes is wasteful.
 *   - The sweep is idempotent and batches all deals in one pass.
 *   - Failures are self-healing — the next run picks up where the last
 *     one left off.
 *
 * Why 5 minutes:
 *   - A typical 200-doc data room finishes processing in under 5 min.
 *   - Users tolerate a modest delay between "last doc processed" and
 *     "ingestion marked done." The UI already shows per-doc progress
 *     in real time via onSnapshot.
 */

const PROCESSING_STATES: DocumentStatus[] = [
  'queued',
  'uploaded',
  'ocr_in_progress',
  'classifying',
];

const TERMINAL_PRODUCTIVE_STATES: DocumentStatus[] = ['completed', 'failed'];

export const sweepIngestionStatus = onSchedule(
  {
    schedule: 'every 5 minutes',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 300,
  },
  async () => {
    const dealsSnap = await db
      .collection('deals')
      .where('phaseStatus.ingestion', '==', 'in_progress')
      .limit(500)
      .get();

    if (dealsSnap.empty) {
      logger.debug('sweepIngestionStatus: no deals in ingestion');
      return;
    }

    logger.info('sweepIngestionStatus: scanning deals', { count: dealsSnap.size });

    let transitioned = 0;
    for (const dealDoc of dealsSnap.docs) {
      const deal = dealDoc.data() as Deal;
      const dealId = dealDoc.id;

      try {
        // Any docs still processing?
        const processingSnap = await dealDoc.ref
          .collection('documents')
          .where('status', 'in', PROCESSING_STATES)
          .limit(1)
          .get();
        if (!processingSnap.empty) {
          continue; // still in progress — leave it
        }

        // Any terminal-productive docs? (If the deal has zero documents
        // overall we leave it alone — the user hasn't uploaded anything yet.)
        const terminalSnap = await dealDoc.ref
          .collection('documents')
          .where('status', 'in', TERMINAL_PRODUCTIVE_STATES)
          .limit(1)
          .get();
        if (terminalSnap.empty) {
          continue; // no real docs yet; don't mark completed
        }

        // Transition + audit.
        const auditRef = dealDoc.ref.collection('auditLog').doc();
        const auditEvent: Omit<AuditEvent, 'id'> = {
          dealId,
          teamId: deal.teamId,
          actorId: 'system',
          actorRole: 'system',
          eventType: 'ingestion_completed',
          targetType: 'deal',
          targetId: dealId,
          timestamp: FieldValue.serverTimestamp(),
        };

        const batch = db.batch();
        batch.update(dealDoc.ref, {
          'phaseStatus.ingestion': 'completed',
          updatedAt: FieldValue.serverTimestamp(),
        });
        batch.set(auditRef, auditEvent);
        await batch.commit();

        transitioned++;
        logger.info('Ingestion marked completed', { dealId });
      } catch (err) {
        logger.error('sweepIngestionStatus: deal scan failed', {
          dealId,
          err: String(err),
        });
      }
    }

    logger.info('sweepIngestionStatus: done', {
      scanned: dealsSnap.size,
      transitioned,
    });
  }
);
